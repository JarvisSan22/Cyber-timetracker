"""Database tables. Datetimes are timezone-aware and stored as UTC."""

from datetime import UTC, datetime

from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    """Current time, timezone-aware UTC."""
    return datetime.now(UTC)


PROJECT_TYPES = ("language", "art", "coding", "other")
IDEA_STATUSES = ("open", "planned", "done")


class Project(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str
    color: str = "#22c55e"
    type: str = "other"
    daily_goal_min: int | None = None
    archived: bool = False
    created_at: datetime = Field(default_factory=utcnow)


class Tag(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    name: str
    color: str = "#64748b"
    sort_order: int = 0


class Session(SQLModel, table=True):
    """One block of time. ended_at is None while the timer runs."""

    id: int | None = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    title: str = ""
    started_at: datetime = Field(index=True)
    ended_at: datetime | None = Field(default=None, index=True)
    paused_at: datetime | None = None
    paused_sec: int = 0
    note: str = ""
    created_via: str = "timer"  # "timer" or "manual"


class SessionTag(SQLModel, table=True):
    session_id: int = Field(foreign_key="session.id", primary_key=True, ondelete="CASCADE")
    tag_id: int = Field(foreign_key="tag.id", primary_key=True)


class Idea(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    text: str
    status: str = "open"
    created_at: datetime = Field(default_factory=utcnow)


class Setting(SQLModel, table=True):
    key: str = Field(primary_key=True)
    value: str
