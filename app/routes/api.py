"""JSON API under /api/ (health, export, backup and the session/project actions)."""

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlmodel import Session as DBSession

from app.db import get_session

router = APIRouter(prefix="/api", tags=["api"])


@router.get("/health")
def health(db: DBSession = Depends(get_session)) -> dict:
    db.exec(text("SELECT 1"))
    return {"status": "ok"}
