"""FastAPI app: mounts static files, includes routers, runs migrations on startup."""

import logging
from contextlib import asynccontextmanager

from alembic import command
from alembic.config import Config
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session as DBSession

from app import config
from app.db import get_engine
from app.routes import api, htmx, pages
from app.services.projects import Conflict, NotFound, seed_demo_data
from app.services.timers import InvalidState

log = logging.getLogger("cyber_tracker")


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
    if config.seed_demo():
        with DBSession(get_engine()) as db:
            if seed_demo_data(db):
                log.info("seeded demo data")
    yield


app = FastAPI(title="Cyber Tracker", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=config.APP_DIR / "static"), name="static")
app.include_router(pages.router)
app.include_router(htmx.router)
app.include_router(api.router)


@app.exception_handler(NotFound)
async def not_found(_request: Request, exc: NotFound):
    return JSONResponse({"detail": str(exc)}, status_code=404)


@app.exception_handler(Conflict)
@app.exception_handler(InvalidState)
async def conflict(_request: Request, exc: Exception):
    return JSONResponse({"detail": str(exc)}, status_code=409)
