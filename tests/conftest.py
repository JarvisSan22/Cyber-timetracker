import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session as DBSession

from app.db import get_engine
from app.main import app, run_migrations


@pytest.fixture(autouse=True)
def tmp_database(tmp_path, monkeypatch):
    """Every test gets its own empty, migrated SQLite file."""
    monkeypatch.setenv("DATABASE_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("SEED_DEMO", "0")
    monkeypatch.setenv("APP_TIMEZONE", "Asia/Tokyo")
    run_migrations()
    yield
    get_engine().dispose()


@pytest.fixture
def db():
    with DBSession(get_engine()) as session:
        yield session


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c
