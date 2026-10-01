"""Runtime configuration, read from environment variables.

Values are read through functions (not module constants) so tests can point
the app at a temporary database by changing the environment.
"""

import os
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
APP_DIR = ROOT_DIR / "app"


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
