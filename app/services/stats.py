"""Statistics: totals, longest session, day record, streak, per-day series, per-tag totals, heatmap.

Rules (from DESIGN.md):
- A session counts toward the day it started in the user's timezone.
- Totals add up session durations even when sessions overlap.
- Time per tag adds the full duration to every tag on the session.
- Running sessions count with their duration so far.
"""

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from sqlmodel import Session as DBSession
from sqlmodel import select

from app.config import UserSettings
from app.models import Project, Session, utcnow
from app.services.timers import duration, local_day, tags_for

RANGES = {"7d": "7 days", "30d": "30 days", "12m": "12 months", "all": "All time"}
HEATMAP_LEVELS_MIN = (15, 45, 90)  # minutes: <15 → level 1, <45 → 2, <90 → 3, else 4


@dataclass
class Stats:
    total_sec: int = 0
    sessions: int = 0
    longest_sec: int = 0
    longest_title: str = ""
    longest_day: date | None = None
    record_sec: int = 0
    record_day: date | None = None
    streak_days: int = 0
    range_key: str = "30d"
    range_total_sec: int = 0
    series_labels: list[str] = field(default_factory=list)
    series_values: list[float] = field(default_factory=list)  # minutes
    series_unit: str = "day"
    per_tag: list[dict] = field(default_factory=list)  # name, color, seconds, pct
    heatmap: list[list[dict | None]] = field(default_factory=list)  # weeks of 7 cells: {day, sec, level}
    goal_min: int | None = None
    color: str = "#22c55e"

    def chart_json(self) -> dict:
        return {
            "series": {"labels": self.series_labels, "values": self.series_values, "unit": self.series_unit},
            "goal_min": self.goal_min,
            "color": self.color,
        }


def per_day_totals(items: list[tuple[Session, int]], settings: UserSettings) -> dict[date, int]:
    """Seconds per local day, each session counted on the day it started."""
    out: dict[date, int] = defaultdict(int)
    for s, secs in items:
        out[local_day(s.started_at, settings.tz, settings.day_start_hour)] += secs
    return out


def current_streak(per_day: dict[date, int], today: date) -> int:
    """Consecutive days with logged time ending today (or yesterday if today is still empty)."""
    day = today if per_day.get(today, 0) > 0 else today - timedelta(days=1)
    streak = 0
    while per_day.get(day, 0) > 0:
        streak += 1
        day -= timedelta(days=1)
    return streak


def _month_start(d: date, back: int = 0) -> date:
    y, m = d.year, d.month - back
    while m <= 0:
        m += 12
        y -= 1
    return date(y, m, 1)


def series(per_day: dict[date, int], range_key: str, today: date) -> tuple[list[str], list[float], str, date | None]:
    """Bars for the range switch. Returns labels, minutes, unit ("day"/"month") and the range's first day."""
    if range_key in ("7d", "30d"):
        n = 7 if range_key == "7d" else 30
        days = [today - timedelta(days=i) for i in range(n - 1, -1, -1)]
        fmt = "%a" if n == 7 else "%b %-d"
        return [d.strftime(fmt) for d in days], [round(per_day.get(d, 0) / 60, 1) for d in days], "day", days[0]

    if range_key == "12m":
        first = _month_start(today, 11)
    else:  # all time
        first = _month_start(min(per_day) if per_day else today)
    months = []
    m = first
    while m <= today:
        months.append(m)
        m = date(m.year + m.month // 12, m.month % 12 + 1, 1)
    by_month: dict[date, int] = defaultdict(int)
    for d, secs in per_day.items():
        by_month[_month_start(d)] += secs
    fmt = "%b" if range_key == "12m" else "%b %Y"
    return [m.strftime(fmt) for m in months], [round(by_month.get(m, 0) / 60, 1) for m in months], "month", (
        first if range_key == "12m" else None
    )


def heatmap(per_day: dict[date, int], today: date, week_start: str = "monday") -> list[list[dict | None]]:
    """About one year of days as weeks (columns) of 7 cells, like Anki's review heatmap."""
    first_weekday = 0 if week_start == "monday" else 6
    start = today - timedelta(days=364)
    start -= timedelta(days=(start.weekday() - first_weekday) % 7)
    weeks: list[list[dict | None]] = []
    d = start
    while d <= today:
        week = []
        for _ in range(7):
            if d > today:
                week.append(None)
            else:
                secs = per_day.get(d, 0)
                minutes = secs / 60
                level = 0 if secs <= 0 else 1 + sum(minutes >= t for t in HEATMAP_LEVELS_MIN)
                week.append({"day": d, "sec": secs, "level": level})
            d += timedelta(days=1)
        weeks.append(week)
    return weeks


def compute(
    db: DBSession,
    settings: UserSettings,
    project_id: int | None = None,
    range_key: str = "30d",
    now: datetime | None = None,
) -> Stats:
    """All numbers for the Statistics page. project_id=None means all projects (archived included)."""
    now = now or utcnow()
    range_key = range_key if range_key in RANGES else "30d"
    today = local_day(now, settings.tz, settings.day_start_hour)

    query = select(Session)
    if project_id is not None:
        query = query.where(Session.project_id == project_id)
    sessions = list(db.exec(query).all())
    items = [(s, duration(s, now)) for s in sessions]

    st = Stats(range_key=range_key)
    if project_id is not None:
        project = db.get(Project, project_id)
        if project is not None:
            st.goal_min = project.daily_goal_min
            st.color = project.color

    st.total_sec = sum(secs for _, secs in items)
    st.sessions = len(items)
    if items:
        longest, st.longest_sec = max(items, key=lambda it: it[1])
        st.longest_title = longest.title
        st.longest_day = local_day(longest.started_at, settings.tz, settings.day_start_hour)

    per_day = per_day_totals(items, settings)
    if per_day:
        st.record_day, st.record_sec = max(per_day.items(), key=lambda kv: (kv[1], kv[0]))
    st.streak_days = current_streak(per_day, today)

    st.series_labels, st.series_values, st.series_unit, range_start = series(per_day, range_key, today)
    st.heatmap = heatmap(per_day, today, settings.week_start)

    in_range = [
        (s, secs)
        for s, secs in items
        if range_start is None or local_day(s.started_at, settings.tz, settings.day_start_hour) >= range_start
    ]
    st.range_total_sec = sum(secs for _, secs in in_range)
    tag_map = tags_for(db, [s.id for s, _ in in_range])
    totals: dict[int, dict] = {}
    for s, secs in in_range:
        for tag in tag_map.get(s.id, []):
            entry = totals.setdefault(tag.id, {"name": tag.name, "color": tag.color, "seconds": 0})
            entry["seconds"] += secs
    if project_id is None:
        # Same tag name in different projects: show them as one bar.
        merged: dict[str, dict] = {}
        for entry in totals.values():
            m = merged.setdefault(entry["name"], {**entry, "seconds": 0})
            m["seconds"] += entry["seconds"]
        totals = dict(enumerate(merged.values()))
    st.per_tag = sorted(totals.values(), key=lambda e: e["seconds"], reverse=True)
    top = st.per_tag[0]["seconds"] if st.per_tag else 0
    for entry in st.per_tag:
        entry["pct"] = round(100 * entry["seconds"] / top, 1) if top else 0
    return st
