"""Database engine (SQLite in WAL mode) and the get_session() dependency."""

from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlmodel import Session, create_engine

from app import config

_engine: Engine | None = None
_engine_path: Path | None = None


def _on_connect(dbapi_connection, _record) -> None:
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()


def get_engine() -> Engine:
    """Return the engine for the configured DATABASE_PATH, creating it if needed."""
    global _engine, _engine_path
    path = config.database_path()
    if _engine is None or _engine_path != path:
        if _engine is not None:
            _engine.dispose()
        path.parent.mkdir(parents=True, exist_ok=True)
        _engine = create_engine(
            f"sqlite:///{path}",
            connect_args={"check_same_thread": False},
        )
        event.listen(_engine, "connect", _on_connect)
        _engine_path = path
    return _engine


def get_session() -> Iterator[Session]:
    """FastAPI dependency: one DB session per request."""
    with Session(get_engine()) as session:
        yield session
