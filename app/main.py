"""FastAPI app: mounts static files, includes routers, runs migrations on startup."""

import logging
from contextlib import asynccontextmanager

from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app import config
from app.db import get_engine
from app.routes import api

log = logging.getLogger("hobby_tracker")


def run_migrations() -> None:
    """Bring the database at DATABASE_PATH up to the latest Alembic revision."""
    cfg = Config(str(config.ROOT_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(config.ROOT_DIR / "migrations"))
    with get_engine().begin() as connection:
        cfg.attributes["connection"] = connection
        command.upgrade(cfg, "head")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    run_migrations()
    log.info("database ready at %s", config.database_path())
    yield


app = FastAPI(title="Hobby Time Tracker", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=config.APP_DIR / "static"), name="static")
app.include_router(api.router)
