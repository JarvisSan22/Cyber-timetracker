"""Projects and tags: create with starter tags, edit, archive. Plus the demo seed."""

import random
from datetime import timedelta

from sqlmodel import Session as DBSession
from sqlmodel import col, func, select

from app.models import PROJECT_TYPES, Project, Session, SessionTag, Tag, utcnow

STARTER_TAGS: dict[str, list[str]] = {
    "language": ["Listening", "Watching", "YouTube", "Reading", "Manga", "Audiobook", "Anki", "Mining", "Speaking", "Writing"],
    "art": ["Sketching", "Painting", "Study", "Reference", "Practice drills"],
    "coding": ["Work", "Side project", "Learning", "Code review", "Debugging"],
    "other": [],
}

PALETTE = ["#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#a855f7", "#14b8a6", "#ec4899", "#eab308", "#64748b", "#f97316"]


class NotFound(LookupError):
    pass


class Conflict(ValueError):
    pass


def _clean_color(color: str | None, fallback: str) -> str:
    color = (color or "").strip()
    if len(color) == 7 and color.startswith("#") and all(c in "0123456789abcdefABCDEF" for c in color[1:]):
        return color.lower()
    return fallback


def list_projects(db: DBSession, include_archived: bool = False) -> list[Project]:
    query = select(Project).order_by(Project.archived, Project.id)
    if not include_archived:
        query = query.where(Project.archived == False)  # noqa: E712
    return list(db.exec(query).all())


def get_project(db: DBSession, project_id: int) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise NotFound(f"Project {project_id} not found")
    return project


def create_project(
    db: DBSession,
    name: str,
    type: str = "other",
    color: str | None = None,
    daily_goal_min: int | None = None,
    starter_tags: bool = True,
) -> Project:
    name = name.strip()
    if not name:
        raise ValueError("Project name is required")
    if type not in PROJECT_TYPES:
        type = "other"
    count = db.exec(select(func.count()).select_from(Project)).one()
    project = Project(
        name=name,
        type=type,
        color=_clean_color(color, PALETTE[count % len(PALETTE)]),
        daily_goal_min=daily_goal_min or None,
    )
    db.add(project)
    db.flush()
    if starter_tags:
        for i, tag_name in enumerate(STARTER_TAGS[type]):
            db.add(Tag(project_id=project.id, name=tag_name, color=PALETTE[i % len(PALETTE)], sort_order=i))
    db.commit()
    db.refresh(project)
    return project


def update_project(
    db: DBSession,
    project_id: int,
    *,
    name: str | None = None,
    color: str | None = None,
    type: str | None = None,
    daily_goal_min: int | None | str = "",
    archived: bool | None = None,
) -> Project:
    """Change the given fields. daily_goal_min="" means "leave as is"; None or 0 clears it."""
    project = get_project(db, project_id)
    if name is not None and name.strip():
        project.name = name.strip()
    if color is not None:
        project.color = _clean_color(color, project.color)
    if type is not None and type in PROJECT_TYPES:
        project.type = type
    if daily_goal_min != "":
        project.daily_goal_min = int(daily_goal_min) if daily_goal_min else None
    if archived is not None:
        project.archived = archived
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


def archive_project(db: DBSession, project_id: int, archived: bool = True) -> Project:
    """Projects are never hard-deleted so old hours stay in the totals."""
    return update_project(db, project_id, archived=archived)


# --- Tags ---


def list_tags(db: DBSession, project_id: int) -> list[Tag]:
    return list(db.exec(select(Tag).where(Tag.project_id == project_id).order_by(Tag.sort_order, Tag.id)).all())


def create_tag(db: DBSession, project_id: int, name: str, color: str | None = None) -> Tag:
    get_project(db, project_id)
    name = name.strip()
    if not name:
        raise ValueError("Tag name is required")
    existing = list_tags(db, project_id)
    if any(t.name.lower() == name.lower() for t in existing):
        raise Conflict(f"Tag {name!r} already exists")
    tag = Tag(
        project_id=project_id,
        name=name,
        color=_clean_color(color, PALETTE[len(existing) % len(PALETTE)]),
        sort_order=max((t.sort_order for t in existing), default=-1) + 1,
    )
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return tag


def update_tag(db: DBSession, tag_id: int, *, name: str | None = None, color: str | None = None) -> Tag:
    tag = db.get(Tag, tag_id)
    if tag is None:
        raise NotFound(f"Tag {tag_id} not found")
    if name is not None and name.strip():
        tag.name = name.strip()
    if color is not None:
        tag.color = _clean_color(color, tag.color)
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return tag


def tag_usage(db: DBSession, tag_id: int) -> int:
    return db.exec(select(func.count()).select_from(SessionTag).where(SessionTag.tag_id == tag_id)).one()


def delete_tag(db: DBSession, tag_id: int) -> None:
    """Delete an unused tag. Tags already on sessions are kept so history stays intact."""
    tag = db.get(Tag, tag_id)
    if tag is None:
        raise NotFound(f"Tag {tag_id} not found")
    used = tag_usage(db, tag_id)
    if used:
        raise Conflict(f"Tag {tag.name!r} is used by {used} session(s) and cannot be deleted")
    db.delete(tag)
    db.commit()


# --- Demo data ---


def seed_demo_data(db: DBSession, *, seed: int = 7) -> bool:
    """Add three demo projects and ~40 sessions over the last 30 days. Only on an empty database."""
    if db.exec(select(func.count()).select_from(Project)).one():
        return False
    rng = random.Random(seed)
    chinese = create_project(db, "Learning Chinese", "language", "#ef4444", daily_goal_min=60)
    painting = create_project(db, "Painting", "art", "#a855f7")
    coding = create_project(db, "Work coding", "coding", "#3b82f6")

    plans = [
        (chinese, ["Podcast episode", "Anki reviews", "Graded reader", "Drama episode", "Mining sentences"], 17, (15, 90)),
        (painting, ["Gesture sketches", "Watercolor study", "Still life", "Color drills"], 11, (30, 120)),
        (coding, ["API refactor", "Bug triage", "Code review", "Side project"], 12, (40, 150)),
    ]
    now = utcnow()
    for project, titles, count, (lo, hi) in plans:
        tags = list_tags(db, project.id)
        for _ in range(count):
            days_ago = rng.randint(0, 29)
            start = (now - timedelta(days=days_ago)).replace(
                hour=rng.choice([0, 1, 9, 10, 11, 12, 13, 14]), minute=rng.randint(0, 59), second=0, microsecond=0
            )
            minutes = rng.randint(lo, hi)
            end = start + timedelta(minutes=minutes)
            if end > now:
                start, end = now - timedelta(minutes=minutes + 5), now - timedelta(minutes=5)
            paused = rng.choice([0, 0, 0, 60, 143, 300])
            session = Session(
                project_id=project.id,
                title=rng.choice(titles),
                started_at=start,
                ended_at=end,
                paused_sec=paused,
                created_via="timer",
            )
            db.add(session)
            db.flush()
            for tag in rng.sample(tags, k=rng.choice([1, 1, 2])):
                db.add(SessionTag(session_id=session.id, tag_id=tag.id))
    db.commit()
    return True


def project_ids_with_sessions(db: DBSession) -> set[int]:
    return set(db.exec(select(col(Session.project_id)).distinct()).all())
