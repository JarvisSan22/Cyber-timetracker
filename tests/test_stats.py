from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.config import UserSettings
from app.services import projects, stats, timers

TOKYO = ZoneInfo("Asia/Tokyo")
SETTINGS = UserSettings("Asia/Tokyo", 0, "monday")
NOW = datetime(2026, 9, 30, 12, 0, tzinfo=TOKYO).astimezone(UTC)  # Wed Sep 30, noon in Tokyo


def local(y, mo, d, h, mi=0) -> datetime:
    return datetime(y, mo, d, h, mi, tzinfo=TOKYO).astimezone(UTC)


def log(db, project, start: datetime, minutes: int, tags=(), title="s", paused_sec=0):
    s = timers.create_manual(db, project.id, title, start, start + timedelta(minutes=minutes), [t.id for t in tags])
    if paused_sec:
        timers.update(db, s.id, paused_sec=paused_sec)
    return s


@pytest.fixture
def project(db):
    return projects.create_project(db, "Learning Chinese", "language", daily_goal_min=60)


@pytest.fixture
def tags(db, project):
    return {t.name: t for t in projects.list_tags(db, project.id)}


def test_totals_longest_and_day_record(db, project):
    log(db, project, local(2026, 9, 28, 9), 30, title="Short")
    log(db, project, local(2026, 9, 28, 20), 50, title="Evening")
    log(db, project, local(2026, 9, 29, 9), 70, title="Long one", paused_sec=600)  # 60 min active
    st = stats.compute(db, SETTINGS, project.id, "30d", now=NOW)
    assert st.total_sec == (30 + 50 + 60) * 60
    assert st.sessions == 3
    assert (st.longest_title, st.longest_sec) == ("Long one", 3600)
    assert (st.record_day, st.record_sec) == (date(2026, 9, 28), 80 * 60)
    assert st.goal_min == 60


def test_overlapping_sessions_both_count(db, project):
    log(db, project, local(2026, 9, 29, 9), 60)
    log(db, project, local(2026, 9, 29, 9, 30), 60)
    assert stats.compute(db, SETTINGS, project.id, now=NOW).total_sec == 120 * 60


def test_running_session_counts_so_far(db, project):
    timers.start(db, project.id, "Live", now=NOW - timedelta(minutes=25))
    assert stats.compute(db, SETTINGS, project.id, now=NOW).total_sec == 25 * 60


def test_midnight_session_counts_for_start_day(db, project):
    log(db, project, local(2026, 9, 28, 23, 59), 16)
    st = stats.compute(db, SETTINGS, project.id, "7d", now=NOW)
    labels_values = dict(zip(st.series_labels, st.series_values, strict=True))
    assert labels_values["Mon"] == 16.0  # Sep 28 was a Monday
    assert labels_values["Tue"] == 0.0


def test_tag_totals_add_full_duration_to_each_tag(db, project, tags):
    log(db, project, local(2026, 9, 29, 9), 60, [tags["Watching"], tags["YouTube"]])
    log(db, project, local(2026, 9, 29, 12), 30, [tags["Anki"]])
    log(db, project, local(2026, 9, 29, 13), 20, [tags["YouTube"]])
    st = stats.compute(db, SETTINGS, project.id, "30d", now=NOW)
    per_tag = {t["name"]: t["seconds"] // 60 for t in st.per_tag}
    assert per_tag == {"YouTube": 80, "Watching": 60, "Anki": 30}
    assert [t["name"] for t in st.per_tag] == ["YouTube", "Watching", "Anki"]
    assert sum(per_tag.values()) > st.total_sec // 60  # tags can sum to more than the total
    assert st.per_tag[0]["pct"] == 100


def test_tag_totals_respect_range(db, project, tags):
    log(db, project, local(2026, 9, 1, 9), 60, [tags["Reading"]])  # 29 days ago
    log(db, project, local(2026, 9, 29, 9), 15, [tags["Reading"]])
    assert stats.compute(db, SETTINGS, project.id, "7d", now=NOW).per_tag[0]["seconds"] == 15 * 60
    assert stats.compute(db, SETTINGS, project.id, "30d", now=NOW).per_tag[0]["seconds"] == 75 * 60


def test_streak(db, project):
    for day in (26, 27, 28, 29):
        log(db, project, local(2026, 9, day, 9), 10)
    log(db, project, local(2026, 9, 24, 9), 10)  # gap on the 25th
    # Today (30th) has nothing yet: streak still counts through yesterday.
    assert stats.compute(db, SETTINGS, project.id, now=NOW).streak_days == 4
    log(db, project, local(2026, 9, 30, 8), 10)
    assert stats.compute(db, SETTINGS, project.id, now=NOW).streak_days == 5


def test_streak_broken(db, project):
    log(db, project, local(2026, 9, 27, 9), 10)
    assert stats.compute(db, SETTINGS, project.id, now=NOW).streak_days == 0


def test_streak_helper():
    today = date(2026, 9, 30)
    assert stats.current_streak({}, today) == 0
    assert stats.current_streak({today: 5}, today) == 1


def test_series_ranges(db, project):
    log(db, project, local(2025, 11, 5, 9), 120)
    log(db, project, local(2026, 9, 29, 9), 30)
    st30 = stats.compute(db, SETTINGS, project.id, "30d", now=NOW)
    assert len(st30.series_values) == 30 and st30.series_values[-2] == 30.0 and st30.series_labels[-1] == "Sep 30"
    st12 = stats.compute(db, SETTINGS, project.id, "12m", now=NOW)
    assert len(st12.series_values) == 12 and st12.series_labels[0] == "Oct" and st12.series_values[1] == 120.0
    st_all = stats.compute(db, SETTINGS, project.id, "all", now=NOW)
    assert st_all.series_labels[0] == "Nov 2025" and st_all.series_labels[-1] == "Sep 2026"
    assert stats.compute(db, SETTINGS, project.id, "bogus", now=NOW).range_key == "30d"


def test_all_projects_and_heatmap(db, project):
    painting = projects.create_project(db, "Painting", "art")
    log(db, project, local(2026, 9, 29, 9), 30)
    log(db, painting, local(2026, 9, 29, 10), 100)
    st = stats.compute(db, SETTINGS, None, now=NOW)
    assert st.total_sec == 130 * 60 and st.goal_min is None
    cells = [c for week in st.heatmap for c in week if c]
    assert cells[0]["day"].weekday() == 0  # weeks start on Monday
    assert cells[-1]["day"] == date(2026, 9, 30)
    assert next(c for c in cells if c["day"] == date(2026, 9, 29))["level"] == 4


def test_archived_project_still_counts_in_all(db, project):
    log(db, project, local(2026, 9, 29, 9), 30)
    projects.archive_project(db, project.id)
    assert stats.compute(db, SETTINGS, None, now=NOW).total_sec == 30 * 60
