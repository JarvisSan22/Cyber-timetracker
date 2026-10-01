"""Request/response models for the JSON API."""

from datetime import datetime

from pydantic import AwareDatetime, BaseModel, Field


class ProjectIn(BaseModel):
    name: str = Field(min_length=1)
    type: str = "other"
    color: str | None = None
    daily_goal_min: int | None = None


class ProjectPatch(BaseModel):
    name: str | None = None
    type: str | None = None
    color: str | None = None
    daily_goal_min: int | None = None
    archived: bool | None = None


class ProjectOut(BaseModel):
    id: int
    name: str
    color: str
    type: str
    daily_goal_min: int | None
    archived: bool
    created_at: datetime


class TagIn(BaseModel):
    name: str = Field(min_length=1)
    color: str | None = None


class TagPatch(BaseModel):
    name: str | None = None
    color: str | None = None


class TagOut(BaseModel):
    id: int
    project_id: int
    name: str
    color: str
    sort_order: int


class StartIn(BaseModel):
    project_id: int
    title: str = ""
    tag_ids: list[int] = []


class ManualSessionIn(BaseModel):
    project_id: int
    title: str = ""
    started_at: AwareDatetime
    ended_at: AwareDatetime
    tag_ids: list[int] = []
    note: str = ""


class SessionPatch(BaseModel):
    title: str | None = None
    started_at: AwareDatetime | None = None
    ended_at: AwareDatetime | None = None
    paused_sec: int | None = None
    tag_ids: list[int] | None = None
    note: str | None = None


class SessionOut(BaseModel):
    id: int
    project_id: int
    title: str
    started_at: datetime
    ended_at: datetime | None
    paused_at: datetime | None
    paused_sec: int
    note: str
    created_via: str
    running: bool
    paused: bool
    duration_sec: int
    tag_ids: list[int]


class IdeaIn(BaseModel):
    text: str = Field(min_length=1)
    status: str = "open"


class IdeaPatch(BaseModel):
    id: int
    text: str | None = None
    status: str | None = None


class IdeaOut(BaseModel):
    id: int
    text: str
    status: str
    created_at: datetime


class SettingsIO(BaseModel):
    timezone: str
    day_start_hour: int = Field(ge=0, le=23)
    week_start: str = "monday"
