"""Runtime configuration.

Env values are read through functions (not module constants) so tests can point
the app at a temporary database by changing the environment. User settings
(timezone, day start hour, week start) live in the `setting` table; the env
values are only their defaults.
"""

import json
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


# --- Themes (stored in the `setting` table as "theme" and "theme_colors") ---

THEME_COLOR_KEYS: dict[str, str] = {
    "bg": "Background",
    "card": "Panels",
    "card-2": "Inputs and chips",
    "line": "Lines",
    "text": "Text",
    "muted": "Muted text",
    "accent": "Accent",
    "accent-2": "Second accent",
    "danger": "Stop / delete",
    "warn": "Warning",
}

FONT_SETS: dict[str, dict[str, str]] = {
    "tech": {
        "font-body": "'Rajdhani', system-ui, sans-serif",
        "font-mono": "'Share Tech Mono', ui-monospace, monospace",
    },
    "terminal": {
        "font-body": "'Share Tech Mono', ui-monospace, monospace",
        "font-mono": "'Share Tech Mono', ui-monospace, monospace",
    },
    "soft": {
        "font-body": "system-ui, -apple-system, 'Segoe UI', 'Hiragino Sans', sans-serif",
        "font-mono": "'Share Tech Mono', ui-monospace, monospace",
    },
}

THEMES: dict[str, dict] = {
    "cyberpunk": {
        "label": "Cyberpunk yellow",
        "scheme": "dark",
        "fonts": "tech",
        "colors": {
            "bg": "#0b0b10", "card": "#15151c", "card-2": "#1e1e28", "line": "#3d3b1a", "text": "#eef6f7",
            "muted": "#8d9aa0", "accent": "#fcee0a", "accent-2": "#00f0ff", "danger": "#ff003c", "warn": "#ff9f1c",
        },
    },
    "netrunner": {
        "label": "Netrunner purple",
        "scheme": "dark",
        "fonts": "tech",
        "colors": {
            "bg": "#0d0716", "card": "#170c27", "card-2": "#221237", "line": "#3d2263", "text": "#f1e8ff",
            "muted": "#a28cc4", "accent": "#b026ff", "accent-2": "#ff2bd6", "danger": "#ff3b6b", "warn": "#ffb000",
        },
    },
    "terminal": {
        "label": "Old tech green",
        "scheme": "dark",
        "fonts": "terminal",
        "colors": {
            "bg": "#020a04", "card": "#061409", "card-2": "#0b1f10", "line": "#155224", "text": "#b8ffc9",
            "muted": "#4fa86a", "accent": "#33ff66", "accent-2": "#ffb000", "danger": "#ff4d4d", "warn": "#ffb000",
        },
    },
    "sakura": {
        "label": "Japan sakura",
        "scheme": "light",
        "fonts": "soft",
        "colors": {
            "bg": "#fff5f7", "card": "#ffffff", "card-2": "#fde8ee", "line": "#f1c1cf", "text": "#3b2a30",
            "muted": "#8c6b75", "accent": "#e4507c", "accent-2": "#4f6fa8", "danger": "#c8102e", "warn": "#c77700",
        },
    },
    "arasaka": {
        "label": "Arasaka red",
        "scheme": "dark",
        "fonts": "tech",
        "colors": {
            "bg": "#0a0607", "card": "#160b0d", "card-2": "#221013", "line": "#4a1820", "text": "#f5e9ea",
            "muted": "#a3858a", "accent": "#ff2a3d", "accent-2": "#e8e8e8", "danger": "#ff7a00", "warn": "#ffc400",
        },
    },
}
DEFAULT_THEME = "cyberpunk"


def _is_hex_color(value: str) -> bool:
    return len(value) == 7 and value[0] == "#" and all(c in "0123456789abcdefABCDEF" for c in value[1:])


def ink_for(hex_color: str) -> str:
    """Black or white text, whichever reads better on the given background."""
    r, g, b = (int(hex_color[i : i + 2], 16) / 255 for i in (1, 3, 5))

    def lin(c: float) -> float:
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    return "#000000" if luminance > 0.25 else "#ffffff"


@dataclass(frozen=True)
class Theme:
    name: str
    label: str
    scheme: str
    colors: dict[str, str]
    overrides: dict[str, str]

    @property
    def style(self) -> str:
        """CSS custom properties for the <html style="..."> attribute."""
        props = dict(self.colors)
        props["accent-ink"] = ink_for(self.colors["accent"])
        props["danger-ink"] = ink_for(self.colors["danger"])
        props |= FONT_SETS[THEMES[self.name]["fonts"]]
        return "; ".join(f"--{k}: {v}" for k, v in props.items())


def get_theme(db: DBSession) -> Theme:
    """Active theme preset with the user's color overrides applied."""
    rows = {s.key: s.value for s in db.exec(select(Setting).where(Setting.key.in_(("theme", "theme_colors")))).all()}
    name = rows.get("theme") if rows.get("theme") in THEMES else DEFAULT_THEME
    try:
        stored = json.loads(rows.get("theme_colors") or "{}")
    except ValueError:
        stored = {}
    overrides = {k: v for k, v in stored.items() if k in THEME_COLOR_KEYS and isinstance(v, str) and _is_hex_color(v)}
    preset = THEMES[name]
    return Theme(name, preset["label"], preset["scheme"], preset["colors"] | overrides, overrides)


def save_theme(db: DBSession, name: str, colors: dict[str, str] | None = None) -> Theme:
    """Store the preset and only the colors that differ from it. Raises ValueError on bad input."""
    if name not in THEMES:
        raise ValueError(f"Unknown theme: {name}")
    overrides = {}
    for key, value in (colors or {}).items():
        if key not in THEME_COLOR_KEYS:
            continue
        value = value.strip().lower()
        if not _is_hex_color(value):
            raise ValueError(f"{THEME_COLOR_KEYS[key]}: {value!r} is not a #rrggbb color")
        if value != THEMES[name]["colors"][key]:
            overrides[key] = value
    db.merge(Setting(key="theme", value=name))
    db.merge(Setting(key="theme_colors", value=json.dumps(overrides)))
    db.commit()
    return get_theme(db)
