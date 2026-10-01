"""Runtime configuration.

Env values are read through functions (not module constants) so tests can point
the app at a temporary database by changing the environment. User settings
(timezone, day start hour, week start) live in the `setting` table; the env
values are only their defaults.
"""

import os
from dataclasses import dataclass
from pathlib import Path
from zoneinfo import ZoneInfo, available_timezones

from sqlmodel import Session as DBSession
from sqlmodel import select

from app.models import Setting

ROOT_DIR = Path(__file__).resolve().parent.parent
APP_DIR = ROOT_DIR / "app"
WEEK_STARTS = ("monday", "sunday")


def database_path() -> Path:
    """Path of the SQLite file. Default: ./data/tracker.db next to the repo."""
    return Path(os.environ.get("DATABASE_PATH", ROOT_DIR / "data" / "tracker.db"))


def default_timezone() -> str:
    """Timezone used until the user picks one in Settings."""
    return os.environ.get("APP_TIMEZONE") or os.environ.get("TZ") or "Asia/Tokyo"


def default_day_start_hour() -> int:
    """Hour (0-23) at which a new "day" begins for grouping and stats."""
    try:
        return max(0, min(23, int(os.environ.get("DAY_START_HOUR", "0"))))
    except ValueError:
        return 0


def seed_demo() -> bool:
    """When true, demo projects and sessions are added on first run."""
    return os.environ.get("SEED_DEMO", "0").lower() in ("1", "true", "yes")


@dataclass(frozen=True)
class UserSettings:
    timezone: str
    day_start_hour: int
    week_start: str

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)


def get_user_settings(db: DBSession) -> UserSettings:
    """Settings from the database, falling back to env defaults."""
    stored = {s.key: s.value for s in db.exec(select(Setting)).all()}
    tz = stored.get("timezone") or default_timezone()
    if tz not in available_timezones():
        tz = "UTC"
    try:
        hour = max(0, min(23, int(stored.get("day_start_hour", default_day_start_hour()))))
    except ValueError:
        hour = 0
    week = stored.get("week_start", "monday")
    return UserSettings(tz, hour, week if week in WEEK_STARTS else "monday")


def save_user_settings(
    db: DBSession, *, timezone: str, day_start_hour: int, week_start: str = "monday"
) -> UserSettings:
    """Validate and store settings. Raises ValueError on bad input."""
    if timezone not in available_timezones():
        raise ValueError(f"Unknown timezone: {timezone}")
    if not 0 <= int(day_start_hour) <= 23:
        raise ValueError("Day start hour must be 0-23")
    if week_start not in WEEK_STARTS:
        raise ValueError("Week start must be monday or sunday")
    values = {"timezone": timezone, "day_start_hour": str(int(day_start_hour)), "week_start": week_start}
    for key, value in values.items():
        db.merge(Setting(key=key, value=value))
    db.commit()
    return get_user_settings(db)
