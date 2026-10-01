from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.models import Session
from app.services import projects, timers

TOKYO = ZoneInfo("Asia/Tokyo")
T0 = datetime(2026, 9, 1, 10, 0, tzinfo=UTC)


def at(minutes: float) -> datetime:
    return T0 + timedelta(minutes=minutes)


@pytest.fixture
def project(db):
    return projects.create_project(db, "Learning Chinese", "language")


def test_new_project_gets_starter_tags(db, project):
    names = [t.name for t in projects.list_tags(db, project.id)]
    assert names[:3] == ["Listening", "Watching", "YouTube"]
    assert len(names) == 10
    assert projects.list_tags(db, projects.create_project(db, "Misc", "other").id) == []


def test_duration_running_and_stopped(db, project):
    s = timers.start(db, project.id, "Podcast", now=at(0))
    assert timers.duration(s, now=at(30)) == 30 * 60
    timers.stop(db, s.id, now=at(45))
    assert timers.duration(s, now=at(500)) == 45 * 60


def test_duration_with_pause(db, project):
    s = timers.start(db, project.id, "Anki", now=at(0))
    timers.pause(db, s.id, now=at(10))
    # While paused the clock stands still.
    assert timers.duration(s, now=at(10)) == 600
    assert timers.duration(s, now=at(25)) == 600
    assert timers.paused_seconds(s, now=at(25)) == 15 * 60
    timers.resume(db, s.id, now=at(25))
    assert s.paused_sec == 15 * 60 and s.paused_at is None
    assert timers.duration(s, now=at(35)) == 20 * 60
    # Second pause, then stop while paused: the open pause is folded in.
    timers.pause(db, s.id, now=at(40))
    timers.stop(db, s.id, now=at(50))
    assert s.paused_at is None
    assert s.paused_sec == 25 * 60
    assert timers.duration(s) == 25 * 60


def test_pause_twice_and_resume_unpaused_are_no_ops(db, project):
    s = timers.start(db, project.id, "x", now=at(0))
    timers.pause(db, s.id, now=at(5))
    timers.pause(db, s.id, now=at(8))
    assert timers.get_session_or_404(db, s.id).paused_at.replace(tzinfo=UTC) == at(5)
    timers.resume(db, s.id, now=at(10))
    timers.resume(db, s.id, now=at(12))
    assert s.paused_sec == 300


def test_pause_stopped_session_is_rejected(db, project):
    s = timers.start(db, project.id, "x", now=at(0))
    timers.stop(db, s.id, now=at(5))
    with pytest.raises(timers.InvalidState):
        timers.pause(db, s.id)


def test_several_concurrent_timers(db, project):
    painting = projects.create_project(db, "Painting", "art")
    a = timers.start(db, project.id, "Podcast", now=at(0))
    b = timers.start(db, project.id, "Anki", now=at(5))
    c = timers.start(db, painting.id, "Sketch", now=at(10))
    assert [s.id for s in timers.list_running(db)] == [a.id, b.id, c.id]

    timers.pause(db, b.id, now=at(20))
    timers.stop(db, a.id, now=at(30))
    running = timers.list_running(db)
    assert [s.id for s in running] == [b.id, c.id]
    assert timers.duration(a) == 30 * 60
    assert timers.duration(b, now=at(30)) == 15 * 60
    assert timers.duration(c, now=at(30)) == 20 * 60


def test_empty_title_uses_tag_names_then_project_name(db, project):
    tags = projects.list_tags(db, project.id)
    s = timers.start(db, project.id, "", [tags[1].id, tags[0].id])
    assert s.title == "Listening, Watching"
    assert timers.start(db, project.id, "  ").title == "Learning Chinese"


def test_tags_from_other_projects_are_ignored(db, project):
    other = projects.create_project(db, "Painting", "art")
    foreign = projects.list_tags(db, other.id)[0]
    s = timers.start(db, project.id, "x", [foreign.id])
    assert timers.tags_for(db, [s.id])[s.id] == []


def test_restart_copies_title_and_tags(db, project):
    tags = projects.list_tags(db, project.id)
    s = timers.start(db, project.id, "Drama", [tags[1].id, tags[2].id], now=at(0))
    timers.stop(db, s.id, now=at(40))
    new = timers.restart(db, s.id)
    assert new.id != s.id and new.ended_at is None and new.title == "Drama"
    assert [t.id for t in timers.tags_for(db, [new.id])[new.id]] == [tags[1].id, tags[2].id]


def test_session_crossing_midnight_counts_for_start_day(db, project):
    # 23:59 -> 00:15 Tokyo time
    start = datetime(2026, 9, 1, 23, 59, tzinfo=TOKYO).astimezone(UTC)
    s = timers.create_manual(db, project.id, "Late reading", start, start + timedelta(minutes=16))
    assert timers.local_day(s.started_at, TOKYO) == date(2026, 9, 1)
    groups = timers.group_by_day(timers.views(db, [s], TOKYO), TOKYO)
    assert [(g.day, g.total) for g in groups] == [(date(2026, 9, 1), 16 * 60)]


def test_day_start_hour_shifts_the_day(db):
    late = datetime(2026, 9, 2, 2, 30, tzinfo=TOKYO)
    assert timers.local_day(late, TOKYO, 0) == date(2026, 9, 2)
    assert timers.local_day(late, TOKYO, 4) == date(2026, 9, 1)


def test_manual_session_validation(db, project):
    with pytest.raises(ValueError):
        timers.create_manual(db, project.id, "x", at(10), at(5))
    s = timers.create_manual(db, project.id, "x", at(0), at(90))
    assert s.created_via == "manual" and timers.duration(s) == 90 * 60


def test_update_session(db, project):
    tags = projects.list_tags(db, project.id)
    s = timers.create_manual(db, project.id, "x", at(0), at(60), [tags[0].id])
    timers.update(db, s.id, title="Renamed", ended_at=at(30), tag_ids=[tags[3].id], paused_sec=120)
    assert s.title == "Renamed" and timers.duration(s) == 30 * 60 - 120
    assert [t.id for t in timers.tags_for(db, [s.id])[s.id]] == [tags[3].id]
    with pytest.raises(ValueError):
        timers.update(db, s.id, ended_at=at(-10))


def test_delete_and_undo(db, project):
    tags = projects.list_tags(db, project.id)
    s = timers.create_manual(db, project.id, "Gone", at(0), at(20), [tags[0].id, tags[4].id])
    sid = s.id
    snapshot = timers.delete_session(db, sid)
    assert db.get(Session, sid) is None
    restored = timers.restore(db, snapshot)
    assert restored.id == sid and restored.title == "Gone" and timers.duration(restored) == 1200
    assert {t.id for t in timers.tags_for(db, [sid])[sid]} == {tags[0].id, tags[4].id}


def test_formatting():
    assert timers.format_duration(6360) == "1 h 46 min"
    assert timers.format_duration(2760) == "46 min"
    assert timers.format_duration(45) == "45 sec"
    assert timers.format_paused(143) == "2 min 23 sec"
    assert timers.format_clock(2530) == "0:42:10"


def test_demo_seed_only_on_empty_db(db):
    assert projects.seed_demo_data(db) is True
    names = [p.name for p in projects.list_projects(db)]
    assert names == ["Learning Chinese", "Painting", "Work coding"]
    assert len(timers.list_finished(db, limit=1000)) == 40
    assert projects.seed_demo_data(db) is False
