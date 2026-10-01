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


# --- Projects, Ideas, Settings pages and their /ui/ fragments ---


@pytest.mark.parametrize("path", ["/", "/stats", "/projects", "/ideas", "/ideas?status=open", "/settings"])
def test_every_page_returns_200(client, seeded, path):
    r = client.get(path)
    assert r.status_code == 200 and r.text.lstrip().lower().startswith("<!doctype html>")


@pytest.mark.parametrize("path", ["/sw.js", "/static/manifest.webmanifest", "/static/icons/icon-192.png", "/static/vendor/htmx.min.js"])
def test_pwa_and_vendor_files(client, path):
    assert client.get(path).status_code == 200


def test_ui_projects_and_tags(client, seeded):
    pid = seeded["project_id"]
    r = client.post("/ui/projects", data={"name": "Painting", "type": "art", "color": "#a855f7", "daily_goal_min": "30"})
    assert r.status_code == 200 and "Created" in r.text and "Sketching" in r.text and 'id="project-list"' in r.text
    assert "msg-error" in client.post("/ui/projects", data={"name": " "}).text

    r = client.post(f"/ui/projects/{pid}", data={"name": "Chinese", "type": "language", "color": "#ff0000", "daily_goal_min": ""})
    assert r.status_code == 200 and "Saved “Chinese”" in r.text
    r = client.post(f"/ui/projects/{pid}/archive", data={"archived": "1"})
    assert r.status_code == 200 and "(archived)" in r.text
    assert "(archived)" not in client.post(f"/ui/projects/{pid}/archive", data={"archived": "0"}).text

    r = client.post(f"/ui/projects/{pid}/tags/manage", data={"new_tag": "Podcasts"})
    assert r.status_code == 200 and "Podcasts" in r.text
    used_tag, free_tag = seeded["tag_ids"][0], seeded["tag_ids"][9]
    assert client.post(f"/ui/tags/{free_tag}", data={"name": "Essays", "color": "#00ff00"}).status_code == 200
    assert "Deleted tag" in client.post(f"/ui/tags/{free_tag}/delete").text
    assert "cannot be deleted" in client.post(f"/ui/tags/{used_tag}/delete").text


def test_ui_ideas(client):
    r = client.post("/ui/ideas", data={"text": "AnkiConnect import"})
    assert r.status_code == 200 and "AnkiConnect import" in r.text
    idea_id = client.get("/api/ideas").json()[0]["id"]
    r = client.post(f"/ui/ideas/{idea_id}", data={"status": "planned", "status_filter": ""})
    assert r.status_code == 200 and client.get("/api/ideas").json()[0]["status"] == "planned"
    assert "msg-error" in client.post(f"/ui/ideas/{idea_id}", data={"status": "nope"}).text
    assert client.post(f"/ui/ideas/{idea_id}/delete", data={"status_filter": ""}).status_code == 200
    assert client.get("/api/ideas").json() == []


def test_ui_settings_change_timezone(client):
    r = client.post("/ui/settings", data={"timezone": "Europe/Berlin", "day_start_hour": "4", "week_start": "monday"})
    assert r.status_code == 200 and "Saved." in r.text
    assert client.get("/api/settings").json() == {"timezone": "Europe/Berlin", "day_start_hour": 4, "week_start": "monday"}
    assert "msg-error" in client.post("/ui/settings", data={"timezone": "Mars/Base", "day_start_hour": "0"}).text


def test_ui_import_roundtrip(client, seeded):
    exported = client.get("/api/export?format=json")
    assert exported.status_code == 200
    client.post("/ui/sessions/{done_id}/delete".format(**seeded))
    r = client.post("/ui/import", files={"file": ("export.json", exported.content, "application/json")})
    assert r.status_code == 200 and "Imported 1 projects" in r.text
    assert seeded["done_id"] in sessions_in_db()
    assert "msg-error" in client.post("/ui/import", files={"file": ("x.json", b"{}", "application/json")}).text


# --- JSON API ---


def test_api_timer_lifecycle(client, seeded):
    r = client.post("/api/sessions/start", json={"project_id": seeded["project_id"], "title": "API timer"})
    assert r.status_code == 201 and r.json()["running"]
    sid = r.json()["id"]
    assert client.post(f"/api/sessions/{sid}/pause").json()["paused"]
    assert not client.post(f"/api/sessions/{sid}/resume").json()["paused"]
    assert len(client.get("/api/sessions/running").json()) == 2
    stopped = client.post(f"/api/sessions/{sid}/stop").json()
    assert not stopped["running"] and stopped["ended_at"]
    assert client.post(f"/api/sessions/{sid}/restart").status_code == 201
    assert client.post("/api/sessions/999/pause").status_code == 404
    assert client.post(f"/api/sessions/{sid}/pause").status_code == 409


def test_api_crud(client, seeded):
    r = client.post("/api/projects", json={"name": "Work coding", "type": "coding"})
    assert r.status_code == 201
    new_pid = r.json()["id"]
    assert len(client.get(f"/api/projects/{new_pid}/tags").json()) == 5
    assert client.patch(f"/api/projects/{new_pid}", json={"daily_goal_min": 45}).json()["daily_goal_min"] == 45
    assert client.delete(f"/api/projects/{new_pid}").json()["archived"] is True
    assert len(client.get("/api/projects").json()) == 1 and len(client.get("/api/projects?archived=true").json()) == 2

    tag = client.post(f"/api/projects/{new_pid}/tags", json={"name": "Infra"}).json()
    assert client.patch(f"/api/tags/{tag['id']}", json={"name": "Infra ops"}).json()["name"] == "Infra ops"
    assert client.delete(f"/api/tags/{tag['id']}").status_code == 204
    assert client.delete(f"/api/tags/{seeded['tag_ids'][0]}").status_code == 409

    r = client.post("/api/sessions", json={"project_id": seeded["project_id"], "title": "Manual",
                                           "started_at": "2026-09-01T10:00:00+09:00", "ended_at": "2026-09-01T11:30:00+09:00"})
    assert r.status_code == 201 and r.json()["duration_sec"] == 5400
    sid = r.json()["id"]
    assert client.patch(f"/api/sessions/{sid}", json={"title": "Renamed"}).json()["title"] == "Renamed"
    assert len(client.get(f"/api/sessions?project_id={seeded['project_id']}&from=2026-09-01T00:00:00%2B09:00&to=2026-09-02T00:00:00%2B09:00").json()) == 1
    assert len(client.get(f"/api/sessions?tag_id={seeded['tag_ids'][0]}").json()) == 1
    assert client.delete(f"/api/sessions/{sid}").status_code == 204

    idea = client.post("/api/ideas", json={"text": "Heatmap colors"}).json()
    assert client.patch("/api/ideas", json={"id": idea["id"], "status": "done"}).json()["status"] == "done"
    assert client.put("/api/settings", json={"timezone": "UTC", "day_start_hour": 0, "week_start": "monday"}).status_code == 200


def test_api_stats_export_backup(client, seeded):
    st = client.get(f"/api/stats?project_id={seeded['project_id']}&range=7d").json()
    assert st["sessions"] == 2 and len(st["series"]["minutes"]) == 7 and st["per_tag"]

    csv_text = client.get("/api/export?format=csv").text
    assert csv_text.startswith("id,project,title") and "Podcast" in csv_text

    r = client.get("/api/backup")
    assert r.status_code == 200 and r.content[:16] == b"SQLite format 3\x00"

    data = client.get("/api/export").json()
    assert client.post("/api/import", json=data).json()["imported"]["sessions"] == 2
    assert client.post("/api/import", json={"app": "other"}).status_code == 400


# --- Themes ---


def test_default_theme_is_cyberpunk(client):
    r = client.get("/settings")
    assert 'data-preset="cyberpunk"' in r.text and "--accent: #fcee0a" in r.text
    assert "--accent-ink: #000000" in r.text
    for preset in ("netrunner", "terminal", "sakura", "arasaka"):
        assert f'value="{preset}"' in r.text


def test_ui_theme_preset_and_custom_colors(client):
    r = client.post("/ui/theme", data={"preset": "sakura", "color_accent": "#ff00aa", "color_bg": "#fff5f7"})
    assert r.status_code == 200 and "1 custom colors" in r.text
    page = client.get("/").text
    assert 'data-theme="light"' in page and 'data-preset="sakura"' in page
    assert "--accent: #ff00aa" in page and "--bg: #fff5f7" in page

    # Picking a preset with its own colors clears the overrides.
    from app import config
    r = client.post("/ui/theme", data={"preset": "terminal", **{f"color_{k}": v for k, v in config.THEMES["terminal"]["colors"].items()}})
    assert "Saved “Old tech green”." in r.text
    assert "--accent: #33ff66" in client.get("/stats").text

    assert "msg-error" in client.post("/ui/theme", data={"preset": "nope"}).text
    assert "msg-error" in client.post("/ui/theme", data={"preset": "terminal", "color_text": "red"}).text


def test_theme_survives_export_import(client):
    client.post("/ui/theme", data={"preset": "netrunner", "color_accent": "#123456"})
    data = client.get("/api/export").json()
    client.post("/ui/theme", data={"preset": "cyberpunk"})
    client.post("/api/import", json=data)
    page = client.get("/").text
    assert 'data-preset="netrunner"' in page and "--accent: #123456" in page
