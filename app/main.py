"""FastAPI app: mounts static files, includes routers, runs migrations on startup."""

import logging
from contextlib import asynccontextmanager

from alembic import command
from alembic.config import Config
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
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
# Only the Cyber Miner extension may read the API cross-origin; web pages stay blocked. Chrome is meant to
# skip CORS for extensions holding a host permission, but does not always do so for permissions granted
# at runtime, so the tracker says yes explicitly.
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.extension_origins(),
    allow_methods=["*"],
    allow_headers=["*"],
    allow_private_network=True,  # Chrome's Local Network Access preflight (the Pi is a LAN address)
)



@app.middleware("http")
async def block_foreign_origins(request: Request, call_next):
    """Refuse state-changing requests sent from other web pages (CSRF).

    CORS alone does not stop them: a text/plain or multipart POST is a "simple request" with no
    preflight, so a page on any site could still trigger /api/import and replace all data.
    """
    origin = request.headers.get("origin")
    if request.method not in ("GET", "HEAD", "OPTIONS") and origin:
        own = f"{request.url.scheme}://{request.url.netloc}"
        if origin != own and origin not in config.extension_origins():
            return JSONResponse({"detail": "Cross-origin request refused"}, status_code=403)
    return await call_next(request)


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
