"""Export (JSON, CSV), import (JSON) and a consistent copy of the SQLite file."""

import csv
import io
import os
import sqlite3
import tempfile
from datetime import datetime
from pathlib import Path

from sqlalchemy import text
from sqlmodel import Session as DBSession
from sqlmodel import delete, select

from app import config
from app.models import Idea, Project, Session, SessionTag, Setting, Tag, utcnow
from app.services.timers import duration, tags_for

EXPORT_VERSION = 1


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _parse(value: str | None) -> datetime | None:
    if not value:
        return None
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        raise ValueError(f"Datetime without timezone: {value}")
    return dt


def export_json(db: DBSession) -> dict:
    sessions = list(db.exec(select(Session).order_by(Session.id)).all())
    tag_map = tags_for(db, [s.id for s in sessions])
    return {
        "app": "cyber-tracker",
        "version": EXPORT_VERSION,
        "exported_at": utcnow().isoformat(),
        "projects": [
            {**p.model_dump(exclude={"created_at"}), "created_at": _iso(p.created_at)}
            for p in db.exec(select(Project).order_by(Project.id)).all()
        ],
        "tags": [t.model_dump() for t in db.exec(select(Tag).order_by(Tag.id)).all()],
        "sessions": [
            {
                "id": s.id,
                "project_id": s.project_id,
                "title": s.title,
                "started_at": _iso(s.started_at),
                "ended_at": _iso(s.ended_at),
                "paused_at": _iso(s.paused_at),
                "paused_sec": s.paused_sec,
                "note": s.note,
                "created_via": s.created_via,
                "tag_ids": [t.id for t in tag_map[s.id]],
            }
            for s in sessions
        ],
        "ideas": [
            {**i.model_dump(exclude={"created_at"}), "created_at": _iso(i.created_at)}
            for i in db.exec(select(Idea).order_by(Idea.id)).all()
        ],
        "settings": {s.key: s.value for s in db.exec(select(Setting)).all()},
    }


def export_csv(db: DBSession) -> str:
    """One row per session, times in the user's timezone."""
    settings = config.get_user_settings(db)
    projects = {p.id: p.name for p in db.exec(select(Project)).all()}
    sessions = list(db.exec(select(Session).order_by(Session.started_at)).all())
    tag_map = tags_for(db, [s.id for s in sessions])
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["id", "project", "title", "started_at", "ended_at", "duration_min", "paused_min", "tags", "note", "created_via"])
    for s in sessions:
        writer.writerow(
            [
                s.id,
                projects.get(s.project_id, ""),
                s.title,
                s.started_at.astimezone(settings.tz).isoformat(timespec="seconds"),
                s.ended_at.astimezone(settings.tz).isoformat(timespec="seconds") if s.ended_at else "",
                round(duration(s) / 60, 1),
                round((s.paused_sec or 0) / 60, 1),
                "; ".join(t.name for t in tag_map[s.id]),
                s.note,
                s.created_via,
            ]
        )
    return out.getvalue()


def import_json(db: DBSession, data: dict) -> dict:
    """Replace all data with a JSON export. Everything happens in one transaction."""
    # "hobby-tracker" is the app's name before the rename; old exports still import.
    if not isinstance(data, dict) or data.get("app") not in ("cyber-tracker", "hobby-tracker"):
        raise ValueError("Not a Cyber Tracker export file")
    if data.get("version") != EXPORT_VERSION:
        raise ValueError(f"Unsupported export version: {data.get('version')}")
    try:
        for model in (SessionTag, Session, Tag, Idea, Project, Setting):
            db.exec(delete(model))
        for p in data.get("projects", []):
            db.add(Project(**{**p, "created_at": _parse(p.get("created_at")) or utcnow()}))
        db.flush()
        for t in data.get("tags", []):
            db.add(Tag(**t))
        db.flush()
        for s in data.get("sessions", []):
            db.add(
                Session(
                    id=s["id"],
                    project_id=s["project_id"],
                    title=s.get("title", ""),
                    started_at=_parse(s["started_at"]),
                    ended_at=_parse(s.get("ended_at")),
                    paused_at=_parse(s.get("paused_at")),
                    paused_sec=int(s.get("paused_sec") or 0),
                    note=s.get("note") or "",
                    created_via=s.get("created_via") or "timer",
                )
            )
        db.flush()
        for s in data.get("sessions", []):
            for tag_id in s.get("tag_ids", []):
                db.add(SessionTag(session_id=s["id"], tag_id=tag_id))
        for i in data.get("ideas", []):
            db.add(Idea(**{**i, "created_at": _parse(i.get("created_at")) or utcnow()}))
        for key, value in (data.get("settings") or {}).items():
            db.add(Setting(key=str(key), value=str(value)))
        db.commit()
    except (KeyError, TypeError, ValueError) as e:
        db.rollback()
        raise ValueError(f"Import failed: {e}") from e
    except Exception:
        db.rollback()
        raise
    return {k: len(data.get(k, [])) for k in ("projects", "tags", "sessions", "ideas")}


def backup_copy(db: DBSession) -> Path:
    """Consistent copy of the live database (SQLite online backup API) in a temp file."""
    db.exec(text("PRAGMA wal_checkpoint(PASSIVE)"))
    fd, name = tempfile.mkstemp(prefix="tracker-backup-", suffix=".db")
    os.close(fd)  # an empty file is a valid empty SQLite database
    src = sqlite3.connect(config.database_path())
    dst = sqlite3.connect(name)
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()
    return Path(name)
