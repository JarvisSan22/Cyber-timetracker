"""Cards mined by the Cyber Miner extension: create, list and count per day."""

from collections import defaultdict
from datetime import date, datetime

from sqlmodel import Session as DBSession
from sqlmodel import col, select

from app.config import UserSettings
from app.models import MinedCard, Session, utcnow
from app.services.projects import NotFound, get_project
from app.services.timers import local_day


def create_card(
    db: DBSession,
    project_id: int,
    *,
    session_id: int | None = None,
    created_at: datetime | None = None,
    site: str = "",
    source_title: str = "",
    word: str = "",
    anki_note_id: int | None = None,
) -> MinedCard:
    """created_at may be in the past: the extension queues cards while the tracker is offline."""
    get_project(db, project_id)
    if session_id is not None and db.get(Session, session_id) is None:
        raise NotFound(f"Session {session_id} not found")
    card = MinedCard(
        project_id=project_id,
        session_id=session_id,
        created_at=created_at or utcnow(),
        site=site,
        source_title=source_title,
        word=word,
        anki_note_id=anki_note_id,
    )
    db.add(card)
    db.commit()
    db.refresh(card)
    return card


def list_cards(
    db: DBSession,
    project_id: int | None = None,
    from_: datetime | None = None,
    to: datetime | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[MinedCard]:
    query = select(MinedCard)
    if project_id is not None:
        query = query.where(MinedCard.project_id == project_id)
    if from_ is not None:
        query = query.where(MinedCard.created_at >= from_)
    if to is not None:
        query = query.where(MinedCard.created_at < to)
    return list(db.exec(query.order_by(col(MinedCard.created_at).desc()).offset(offset).limit(limit)).all())


def per_day_counts(db: DBSession, settings: UserSettings, project_id: int | None = None) -> dict[date, int]:
    """Cards per local day (same day rule as sessions)."""
    query = select(MinedCard.created_at)
    if project_id is not None:
        query = query.where(MinedCard.project_id == project_id)
    out: dict[date, int] = defaultdict(int)
    for created_at in db.exec(query).all():
        out[local_day(created_at, settings.tz, settings.day_start_hour)] += 1
    return out
