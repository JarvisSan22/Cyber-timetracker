"""Timer rules: start, pause, resume, stop, restart, manual sessions and duration().

Duration = (ended_at or now) - started_at - paused_sec - (now - paused_at if paused).
"""

import json
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlmodel import Session as DBSession
from sqlmodel import col, delete, select

from app.models import Project, Session, SessionTag, Tag, utcnow
from app.services.projects import NotFound, get_project

LONG_RUNNING_SEC = 6 * 3600


class InvalidState(ValueError):
    pass


def _aware(dt: datetime | None) -> datetime | None:
    """Treat naive datetimes as UTC (SQLite may hand them back without offset)."""
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt


def duration(s: Session, now: datetime | None = None) -> int:
    """Active seconds of a session, excluding paused time. Never negative."""
    now = now or utcnow()
    end = _aware(s.ended_at) or now
    total = (end - _aware(s.started_at)).total_seconds() - (s.paused_sec or 0)
    if s.paused_at is not None and s.ended_at is None:
        total -= (now - _aware(s.paused_at)).total_seconds()
    return max(0, int(total))


def paused_seconds(s: Session, now: datetime | None = None) -> int:
    """Total paused time so far, including a pause still in progress."""
    now = now or utcnow()
    extra = (now - _aware(s.paused_at)).total_seconds() if s.paused_at is not None and s.ended_at is None else 0
    return int((s.paused_sec or 0) + extra)


def local_day(dt: datetime, tz: ZoneInfo, day_start_hour: int = 0) -> date:
    """Calendar day a moment belongs to in the user's timezone (day starts at day_start_hour)."""
    return (_aware(dt).astimezone(tz) - timedelta(hours=day_start_hour)).date()


def get_session_or_404(db: DBSession, session_id: int) -> Session:
    s = db.get(Session, session_id)
    if s is None:
        raise NotFound(f"Session {session_id} not found")
    return s


def tags_for(db: DBSession, session_ids: list[int]) -> dict[int, list[Tag]]:
    """Tags of many sessions in one query, keyed by session id."""
    out: dict[int, list[Tag]] = {sid: [] for sid in session_ids}
    if not session_ids:
        return out
    rows = db.exec(
        select(SessionTag.session_id, Tag)
        .join(Tag, col(Tag.id) == col(SessionTag.tag_id))
        .where(col(SessionTag.session_id).in_(session_ids))
        .order_by(Tag.sort_order, Tag.id)
    ).all()
    for sid, tag in rows:
        out[sid].append(tag)
    return out


def _valid_tag_ids(db: DBSession, project_id: int, tag_ids: list[int] | None) -> list[int]:
    if not tag_ids:
        return []
    wanted = {int(t) for t in tag_ids}
    rows = db.exec(select(Tag).where(col(Tag.id).in_(wanted), Tag.project_id == project_id)).all()
    return sorted(t.id for t in rows)


def _set_tags(db: DBSession, session_id: int, tag_ids: list[int]) -> None:
    db.exec(delete(SessionTag).where(SessionTag.session_id == session_id))
    for tid in tag_ids:
        db.add(SessionTag(session_id=session_id, tag_id=tid))


def _default_title(db: DBSession, project: Project, tag_ids: list[int]) -> str:
    """Empty title: use the tag names, or the project name when there are no tags."""
    if tag_ids:
        names = [t.name for t in db.exec(select(Tag).where(col(Tag.id).in_(tag_ids)).order_by(Tag.sort_order)).all()]
        return ", ".join(names)
    return project.name


def start(
    db: DBSession, project_id: int, title: str = "", tag_ids: list[int] | None = None, now: datetime | None = None
) -> Session:
    """Start a new running timer. Other running timers are left alone."""
    project = get_project(db, project_id)
    ids = _valid_tag_ids(db, project_id, tag_ids)
    s = Session(
        project_id=project_id,
        title=(title or "").strip() or _default_title(db, project, ids),
        started_at=now or utcnow(),
        created_via="timer",
    )
    db.add(s)
    db.flush()
    _set_tags(db, s.id, ids)
    db.commit()
    db.refresh(s)
    return s


def pause(db: DBSession, session_id: int, now: datetime | None = None) -> Session:
    s = get_session_or_404(db, session_id)
    if s.ended_at is not None:
        raise InvalidState("Session already stopped")
    if s.paused_at is None:
        s.paused_at = now or utcnow()
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


def resume(db: DBSession, session_id: int, now: datetime | None = None) -> Session:
    s = get_session_or_404(db, session_id)
    if s.ended_at is not None:
        raise InvalidState("Session already stopped")
    if s.paused_at is not None:
        now = now or utcnow()
        s.paused_sec = (s.paused_sec or 0) + max(0, int((now - _aware(s.paused_at)).total_seconds()))
        s.paused_at = None
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


def stop(db: DBSession, session_id: int, now: datetime | None = None) -> Session:
    """Stop a timer. A paused timer folds its current pause into paused_sec first."""
    s = get_session_or_404(db, session_id)
    if s.ended_at is not None:
        return s
    now = now or utcnow()
    if s.paused_at is not None:
        s = resume(db, session_id, now=now)
    s.ended_at = now
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


def restart(db: DBSession, session_id: int, now: datetime | None = None) -> Session:
    """New running session with the same project, title and tags."""
    s = get_session_or_404(db, session_id)
    tag_ids = [t.id for t in tags_for(db, [s.id])[s.id]]
    return start(db, s.project_id, s.title, tag_ids, now=now)


def list_running(db: DBSession) -> list[Session]:
    """All running timers, all projects, oldest first."""
    return list(db.exec(select(Session).where(Session.ended_at == None).order_by(Session.started_at)).all())  # noqa: E711


def list_finished(db: DBSession, project_id: int | None = None, limit: int = 50, offset: int = 0) -> list[Session]:
    query = select(Session).where(Session.ended_at != None)  # noqa: E711
    if project_id is not None:
        query = query.where(Session.project_id == project_id)
    return list(db.exec(query.order_by(col(Session.started_at).desc()).offset(offset).limit(limit)).all())


def create_manual(
    db: DBSession,
    project_id: int,
    title: str,
    started_at: datetime,
    ended_at: datetime,
    tag_ids: list[int] | None = None,
    note: str = "",
) -> Session:
    """Add a past session logged without the timer."""
    project = get_project(db, project_id)
    if ended_at <= started_at:
        raise ValueError("End must be after start")
    ids = _valid_tag_ids(db, project_id, tag_ids)
    s = Session(
        project_id=project_id,
        title=(title or "").strip() or _default_title(db, project, ids),
        started_at=started_at,
        ended_at=ended_at,
        note=note or "",
        created_via="manual",
    )
    db.add(s)
    db.flush()
    _set_tags(db, s.id, ids)
    db.commit()
    db.refresh(s)
    return s


def update(
    db: DBSession,
    session_id: int,
    *,
    title: str | None = None,
    started_at: datetime | None = None,
    ended_at: datetime | None = None,
    tag_ids: list[int] | None = None,
    note: str | None = None,
    paused_sec: int | None = None,
) -> Session:
    s = get_session_or_404(db, session_id)
    if title is not None:
        s.title = title.strip() or s.title
    if started_at is not None:
        s.started_at = started_at
    if ended_at is not None and s.ended_at is not None:
        s.ended_at = ended_at
    if note is not None:
        s.note = note
    if paused_sec is not None:
        s.paused_sec = max(0, int(paused_sec))
    if s.ended_at is not None and _aware(s.ended_at) <= _aware(s.started_at):
        db.rollback()
        raise ValueError("End must be after start")
    if _aware(s.started_at) > utcnow() + timedelta(minutes=1):
        db.rollback()
        raise ValueError("Start cannot be in the future")
    db.add(s)
    if tag_ids is not None:
        _set_tags(db, s.id, _valid_tag_ids(db, s.project_id, tag_ids))
    db.commit()
    db.refresh(s)
    return s


def delete_session(db: DBSession, session_id: int) -> str:
    """Delete a session and return a JSON snapshot that restore() can put back (undo)."""
    s = get_session_or_404(db, session_id)
    snapshot = snapshot_json(s, [t.id for t in tags_for(db, [s.id])[s.id]])
    db.exec(delete(SessionTag).where(SessionTag.session_id == s.id))
    db.delete(s)
    db.commit()
    return snapshot


def snapshot_json(s: Session, tag_ids: list[int]) -> str:
    def iso(dt):
        return _aware(dt).isoformat() if dt else None

    return json.dumps(
        {
            "id": s.id,
            "project_id": s.project_id,
            "title": s.title,
            "started_at": iso(s.started_at),
            "ended_at": iso(s.ended_at),
            "paused_at": iso(s.paused_at),
            "paused_sec": s.paused_sec,
            "note": s.note,
            "created_via": s.created_via,
            "tag_ids": tag_ids,
        }
    )


def restore(db: DBSession, snapshot: str) -> Session:
    """Undo a delete: re-insert the session from its snapshot (same id when it is free)."""
    data = json.loads(snapshot)

    def parse(v):
        return datetime.fromisoformat(v) if v else None

    get_project(db, int(data["project_id"]))
    sid = data.get("id")
    s = Session(
        id=sid if sid and db.get(Session, sid) is None else None,
        project_id=int(data["project_id"]),
        title=str(data.get("title", "")),
        started_at=parse(data["started_at"]),
        ended_at=parse(data.get("ended_at")),
        paused_at=parse(data.get("paused_at")),
        paused_sec=int(data.get("paused_sec") or 0),
        note=str(data.get("note") or ""),
        created_via=str(data.get("created_via") or "timer"),
    )
    db.add(s)
    db.flush()
    _set_tags(db, s.id, _valid_tag_ids(db, s.project_id, data.get("tag_ids") or []))
    db.commit()
    db.refresh(s)
    return s


# --- View helpers (plain data for templates and JSON) ---


@dataclass
class SessionView:
    session: Session
    project: Project
    tags: list[Tag]
    seconds: int
    paused: int
    start_local: datetime
    end_local: datetime | None

    @property
    def is_paused(self) -> bool:
        return self.session.paused_at is not None and self.session.ended_at is None

    @property
    def long_running(self) -> bool:
        return self.session.ended_at is None and self.seconds > LONG_RUNNING_SEC


@dataclass
class DayGroup:
    day: date
    total: int = 0
    sessions: list[SessionView] = field(default_factory=list)


def views(db: DBSession, sessions: list[Session], tz: ZoneInfo, now: datetime | None = None) -> list[SessionView]:
    now = now or utcnow()
    tag_map = tags_for(db, [s.id for s in sessions])
    projects = {p.id: p for p in db.exec(select(Project)).all()}
    return [
        SessionView(
            session=s,
            project=projects[s.project_id],
            tags=tag_map.get(s.id, []),
            seconds=duration(s, now),
            paused=paused_seconds(s, now),
            start_local=_aware(s.started_at).astimezone(tz),
            end_local=_aware(s.ended_at).astimezone(tz) if s.ended_at else None,
        )
        for s in sessions
    ]


def group_by_day(items: list[SessionView], tz: ZoneInfo, day_start_hour: int = 0) -> list[DayGroup]:
    """Group sessions by the day they started (newest day first), with day totals."""
    groups: dict[date, DayGroup] = {}
    for v in items:
        d = local_day(v.session.started_at, tz, day_start_hour)
        g = groups.setdefault(d, DayGroup(day=d))
        g.total += v.seconds
        g.sessions.append(v)
    return sorted(groups.values(), key=lambda g: g.day, reverse=True)


def format_duration(seconds: int) -> str:
    """1 h 46 min / 46 min / 45 sec."""
    seconds = int(seconds)
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h} h {m} min"
    if m:
        return f"{m} min"
    return f"{s} sec"


def format_paused(seconds: int) -> str:
    """2 min 23 sec."""
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    if h:
        return f"{h} h {m} min"
    return f"{m} min {s} sec" if m else f"{s} sec"


def format_clock(seconds: int) -> str:
    """0:42:10."""
    h, rem = divmod(int(seconds), 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}"
