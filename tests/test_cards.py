"""Mined cards from the Cyber Miner extension, and the theme endpoint it reads."""

from datetime import timedelta

import pytest
from sqlmodel import Session as DBSession

from app import config
from app.db import get_engine
from app.models import utcnow
from app.services import cards, projects, stats, timers


@pytest.fixture
def project(client):
    with DBSession(get_engine()) as db:
        p = projects.create_project(db, "Japanese", "language")
        s = timers.start(db, p.id, "Frieren S1E3", [])
        return {"id": p.id, "session_id": s.id}


def test_api_create_and_list_cards(client, project):
    r = client.post(
        "/api/cards",
        json={"project_id": project["id"], "session_id": project["session_id"], "site": "youtube",
              "source_title": "Frieren S1E3", "word": "魔法", "anki_note_id": 1760000000000},
    )
    assert r.status_code == 201
    card = r.json()
    assert card["word"] == "魔法" and card["session_id"] == project["session_id"]

    # A card queued while the tracker was offline keeps the time it was mined.
    earlier = (utcnow() - timedelta(days=2)).isoformat()
    assert client.post("/api/cards", json={"project_id": project["id"], "created_at": earlier}).status_code == 201

    listed = client.get(f"/api/cards?project_id={project['id']}").json()
    assert [c["id"] for c in listed][0] == card["id"] and len(listed) == 2
    assert len(client.get("/api/cards", params={"from": (utcnow() - timedelta(days=1)).isoformat()}).json()) == 1


def test_api_cards_errors(client, project):
    assert client.post("/api/cards", json={"project_id": 999}).status_code == 404
    assert client.post("/api/cards", json={"project_id": project["id"], "session_id": 999}).status_code == 404
    assert client.post("/api/cards", json={"project_id": project["id"], "created_at": "2026-10-16T10:00:00"}).status_code == 422


def test_deleting_session_keeps_card(client, project):
    card = client.post("/api/cards", json={"project_id": project["id"], "session_id": project["session_id"]}).json()
    assert client.delete(f"/api/sessions/{project['session_id']}").status_code == 204
    assert client.get("/api/cards").json()[0] == card | {"session_id": None}


def test_card_counts_in_stats(client, project):
    with DBSession(get_engine()) as db:
        settings = config.get_user_settings(db)
        for days_ago in (0, 0, 3, 40):
            cards.create_card(db, project["id"], created_at=utcnow() - timedelta(days=days_ago))
        st = stats.compute(db, settings, project["id"], "30d")
        assert (st.cards_total, st.cards_today, st.cards_range) == (4, 2, 3)
        other = projects.create_project(db, "Italian", "language")
        assert stats.compute(db, settings, other.id, "30d").cards_total == 0
        assert stats.compute(db, settings, None, "7d").cards_range == 3

    api = client.get(f"/api/stats?project_id={project['id']}&range=all").json()
    assert api["cards"] == {"total": 4, "today": 2, "range": 4}
    page = client.get(f"/stats?project={project['id']}").text
    assert "Cards mined" in page and "2 today" in page


def test_stats_page_hides_cards_when_none(client, project):
    assert "Cards mined" not in client.get(f"/stats?project={project['id']}").text


def test_cards_survive_export_import(client, project):
    client.post("/api/cards", json={"project_id": project["id"], "session_id": project["session_id"], "word": "魔法"})
    data = client.get("/api/export").json()
    assert data["cards"][0]["word"] == "魔法"
    assert client.post("/api/import", json=data).json()["imported"]["cards"] == 1
    assert client.get("/api/cards").json()[0]["word"] == "魔法"

    # Exports made before Cyber Miner have no "cards" key and still import.
    del data["cards"]
    assert client.post("/api/import", json=data).json()["imported"]["cards"] == 0
    assert client.get("/api/cards").json() == []


def test_api_theme(client):
    t = client.get("/api/theme").json()
    assert t["name"] == "cyberpunk" and t["scheme"] == "dark"
    assert t["vars"]["accent"] == "#fcee0a" and t["vars"]["accent-ink"] == "#000000" and "font-body" in t["vars"]

    client.post("/ui/theme", data={"preset": "sakura", "color_accent": "#ff00aa"})
    t = client.get("/api/theme").json()
    assert t["name"] == "sakura" and t["scheme"] == "light" and t["vars"]["accent"] == "#ff00aa"


def test_cors_only_for_cyber_miner(client):
    ext = config.CYBER_MINER_ORIGIN
    r = client.get("/api/health", headers={"Origin": ext})
    assert r.headers["access-control-allow-origin"] == ext
    assert "access-control-allow-origin" not in client.get("/api/health", headers={"Origin": "http://evil.example"}).headers

    pre = client.options(
        "/api/cards",
        headers={"Origin": ext, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type",
                 "Access-Control-Request-Private-Network": "true"},
    )
    assert pre.status_code == 200 and pre.headers["access-control-allow-origin"] == ext
    assert pre.headers["access-control-allow-private-network"] == "true"
    bad = client.options("/api/cards", headers={"Origin": "http://evil.example", "Access-Control-Request-Method": "POST"})
    assert bad.status_code == 400 and "access-control-allow-origin" not in bad.headers


def test_extension_origins_env(monkeypatch):
    monkeypatch.setenv("EXTENSION_ORIGINS", " chrome-extension://a , chrome-extension://b,")
    assert config.extension_origins() == ["chrome-extension://a", "chrome-extension://b"]
