import json
from datetime import timedelta

import pytest
from sqlmodel import Session as DBSession
from sqlmodel import select

from app.db import get_engine
from app.models import Session, utcnow
from app.services import projects, timers


@pytest.fixture
def seeded(client):
    """A project with one running and one finished session."""
    with DBSession(get_engine()) as db:
        p = projects.create_project(db, "Learning Chinese", "language", daily_goal_min=60)
        tags = projects.list_tags(db, p.id)
        done = timers.create_manual(db, p.id, "Podcast", utcnow() - timedelta(hours=3), utcnow() - timedelta(hours=2), [tags[0].id])
        running = timers.start(db, p.id, "Anki", [tags[6].id])
        return {"project_id": p.id, "tag_ids": [t.id for t in tags], "done_id": done.id, "running_id": running.id}


def sessions_in_db():
    with DBSession(get_engine()) as db:
        return {s.id: s for s in db.exec(select(Session)).all()}


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_timer_page_empty_and_seeded(client):
    r = client.get("/")
    assert r.status_code == 200 and "No projects yet" in r.text


def test_timer_page_shows_running_and_sessions(client, seeded):
    r = client.get(f"/?project={seeded['project_id']}")
    assert r.status_code == 200
    assert "Anki" in r.text and "Podcast" in r.text
    assert 'id="running-timers"' in r.text and 'id="session-list"' in r.text
    assert r.cookies.get("project_id") == str(seeded["project_id"])


@pytest.mark.parametrize(
    "path",
    [
        "/ui/running",
        "/ui/sessions?project_id={project_id}",
        "/ui/sessions/{done_id}/edit",
        "/ui/projects/{project_id}/tags",
    ],
)
def test_ui_get_fragments(client, seeded, path):
    r = client.get(path.format(**seeded))
    assert r.status_code == 200
    assert "<html" not in r.text


def test_ui_timer_lifecycle(client, seeded):
    pid = seeded["project_id"]
    r = client.post("/ui/sessions/start", data={"project_id": pid, "title": "", "tag_ids": [seeded["tag_ids"][0], seeded["tag_ids"][1]]})
    assert r.status_code == 200 and "Listening, Watching" in r.text
    new_id = max(sessions_in_db())
    assert r.text.count('class="timer-card') == 2

    assert client.post(f"/ui/sessions/{new_id}/pause").status_code == 200
    assert sessions_in_db()[new_id].paused_at is not None
    r = client.post(f"/ui/sessions/{new_id}/resume")
    assert r.status_code == 200 and sessions_in_db()[new_id].paused_at is None

    r = client.post(f"/ui/sessions/{new_id}/stop")
    assert r.status_code == 200 and r.headers["HX-Trigger"] == "sessions-changed"
    assert sessions_in_db()[new_id].ended_at is not None
    assert r.text.count('class="timer-card') == 1

    r = client.post(f"/ui/sessions/{new_id}/restart")
    assert r.status_code == 200 and r.text.count('class="timer-card') == 2


def test_ui_edit_delete_undo(client, seeded):
    sid = seeded["done_id"]
    r = client.post(f"/ui/sessions/{sid}", data={"title": "Podcast ep. 12", "paused_min": "2", "tag_ids": [seeded["tag_ids"][2]]})
    assert r.status_code == 200 and "sessions-changed" in r.headers["HX-Trigger"]
    assert sessions_in_db()[sid].title == "Podcast ep. 12" and sessions_in_db()[sid].paused_sec == 120

    r = client.post(f"/ui/sessions/{sid}", data={"started_at": "2099-01-01T10:00"})
    assert r.status_code == 200 and "msg-error" in r.text

    r = client.post(f"/ui/sessions/{sid}/delete")
    assert r.status_code == 200 and "Undo" in r.text
    assert sid not in sessions_in_db()
    snapshot = r.text.split('name="data" value="')[1].split('"')[0].replace("&#34;", '"').replace("&quot;", '"')
    assert json.loads(snapshot)["id"] == sid
    r = client.post("/ui/sessions/restore", data={"data": snapshot})
    assert r.status_code == 200 and sid in sessions_in_db()


def test_ui_add_past_session_and_tag(client, seeded):
    pid = seeded["project_id"]
    r = client.post("/ui/sessions", data={"project_id": pid, "title": "Reader", "started_at": "2026-01-05T20:00", "duration_min": "30"})
    assert r.status_code == 200 and "Added" in r.text
    r = client.post("/ui/sessions", data={"project_id": pid, "started_at": "2026-01-05T20:00"})
    assert "msg-error" in r.text

    r = client.post(f"/ui/projects/{pid}/tags", data={"new_tag": "Shadowing"})
    assert r.status_code == 200 and "Shadowing" in r.text
    r = client.post(f"/ui/projects/{pid}/tags", data={"new_tag": "shadowing"})
    assert "already exists" in r.text


def test_unknown_session_is_404(client):
    assert client.post("/ui/sessions/999/stop").status_code == 404


@pytest.mark.parametrize("query", ["", "?project=all", "?project={project_id}&range=7d", "?range=12m", "?range=all", "?range=nope"])
def test_stats_page(client, seeded, query):
    r = client.get("/stats" + query.format(**seeded))
    assert r.status_code == 200
    assert "Total time" in r.text and 'id="stats-data"' in r.text
    assert "both count" in r.text  # overlap note


def test_stats_page_without_projects(client):
    assert client.get("/stats").status_code == 200


def test_ui_edit_keeps_untouched_times_of_short_session(client, seeded):
    with DBSession(get_engine()) as db:
        s = timers.create_manual(db, seeded["project_id"], "Quick", utcnow() - timedelta(seconds=40), utcnow() - timedelta(seconds=10))
        view = timers.views(db, [s], timers.ZoneInfo("Asia/Tokyo"))[0]
        form = {"title": "Quick edit", "started_at": view.start_local.strftime("%Y-%m-%dT%H:%M"), "ended_at": view.end_local.strftime("%Y-%m-%dT%H:%M")}
    r = client.post(f"/ui/sessions/{s.id}", data=form)
    assert r.status_code == 200 and "msg-error" not in r.text
    assert sessions_in_db()[s.id].title == "Quick edit"
    assert timers.duration(sessions_in_db()[s.id]) == 30
