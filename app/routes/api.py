"""JSON API under /api/. Shares the service functions with the /ui/ routes."""

import json
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response
from sqlalchemy import text
from sqlmodel import Session as DBSession
from sqlmodel import col, select

from app import config, schemas
from app.db import get_session
from app.models import Session, SessionTag
from app.services import backup, stats, timers
from app.services import projects as project_svc

router = APIRouter(prefix="/api", tags=["api"])


def _session_out(db: DBSession, s: Session) -> schemas.SessionOut:
    tags = timers.tags_for(db, [s.id])[s.id]
    return schemas.SessionOut(
        **s.model_dump(),
        running=s.ended_at is None,
        paused=s.paused_at is not None and s.ended_at is None,
        duration_sec=timers.duration(s),
        tag_ids=[t.id for t in tags],
    )


def _bad_request(e: ValueError) -> HTTPException:
    return HTTPException(status_code=400, detail=str(e))


@router.get("/health")
def health(db: DBSession = Depends(get_session)) -> dict:
    db.exec(text("SELECT 1"))
    return {"status": "ok"}


# --- Projects and tags ---


@router.get("/projects", response_model=list[schemas.ProjectOut])
def list_projects(archived: bool = False, db: DBSession = Depends(get_session)):
    """Active projects, or all projects including archived ones with ?archived=true."""
    return project_svc.list_projects(db, include_archived=archived)


@router.post("/projects", response_model=schemas.ProjectOut, status_code=201)
def create_project(body: schemas.ProjectIn, db: DBSession = Depends(get_session)):
    try:
        return project_svc.create_project(db, body.name, body.type, body.color, body.daily_goal_min)
    except ValueError as e:
        raise _bad_request(e) from e


@router.patch("/projects/{project_id}", response_model=schemas.ProjectOut)
def update_project(project_id: int, body: schemas.ProjectPatch, db: DBSession = Depends(get_session)):
    fields = body.model_dump(exclude_unset=True)
    if "daily_goal_min" not in fields:
        fields["daily_goal_min"] = ""
    return project_svc.update_project(db, project_id, **fields)


@router.delete("/projects/{project_id}", response_model=schemas.ProjectOut)
def archive_project(project_id: int, db: DBSession = Depends(get_session)):
    """Archive (projects are never hard-deleted)."""
    return project_svc.archive_project(db, project_id)


@router.get("/projects/{project_id}/tags", response_model=list[schemas.TagOut])
def list_tags(project_id: int, db: DBSession = Depends(get_session)):
    project_svc.get_project(db, project_id)
    return project_svc.list_tags(db, project_id)


@router.post("/projects/{project_id}/tags", response_model=schemas.TagOut, status_code=201)
def create_tag(project_id: int, body: schemas.TagIn, db: DBSession = Depends(get_session)):
    return project_svc.create_tag(db, project_id, body.name, body.color)


@router.patch("/tags/{tag_id}", response_model=schemas.TagOut)
def update_tag(tag_id: int, body: schemas.TagPatch, db: DBSession = Depends(get_session)):
    return project_svc.update_tag(db, tag_id, name=body.name, color=body.color)


@router.delete("/tags/{tag_id}", status_code=204)
def delete_tag(tag_id: int, db: DBSession = Depends(get_session)):
    """Blocked with 409 while sessions use the tag."""
    project_svc.delete_tag(db, tag_id)
    return Response(status_code=204)


# --- Sessions ---


@router.get("/sessions", response_model=list[schemas.SessionOut])
def list_sessions(
    project_id: int | None = None,
    tag_id: int | None = None,
    from_: datetime | None = Query(None, alias="from"),
    to: datetime | None = None,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: DBSession = Depends(get_session),
):
    query = select(Session)
    if project_id is not None:
        query = query.where(Session.project_id == project_id)
    if tag_id is not None:
        query = query.where(col(Session.id).in_(select(SessionTag.session_id).where(SessionTag.tag_id == tag_id)))
    if from_ is not None:
        query = query.where(Session.started_at >= from_)
    if to is not None:
        query = query.where(Session.started_at < to)
    rows = db.exec(query.order_by(col(Session.started_at).desc()).offset(offset).limit(limit)).all()
    return [_session_out(db, s) for s in rows]


@router.get("/sessions/running", response_model=list[schemas.SessionOut])
def running(db: DBSession = Depends(get_session)):
    return [_session_out(db, s) for s in timers.list_running(db)]


@router.post("/sessions/start", response_model=schemas.SessionOut, status_code=201)
def start(body: schemas.StartIn, db: DBSession = Depends(get_session)):
    return _session_out(db, timers.start(db, body.project_id, body.title, body.tag_ids))


@router.post("/sessions/{session_id}/pause", response_model=schemas.SessionOut)
def pause(session_id: int, db: DBSession = Depends(get_session)):
    return _session_out(db, timers.pause(db, session_id))


@router.post("/sessions/{session_id}/resume", response_model=schemas.SessionOut)
def resume(session_id: int, db: DBSession = Depends(get_session)):
    return _session_out(db, timers.resume(db, session_id))


@router.post("/sessions/{session_id}/stop", response_model=schemas.SessionOut)
def stop(session_id: int, db: DBSession = Depends(get_session)):
    return _session_out(db, timers.stop(db, session_id))


@router.post("/sessions/{session_id}/restart", response_model=schemas.SessionOut, status_code=201)
def restart(session_id: int, db: DBSession = Depends(get_session)):
    return _session_out(db, timers.restart(db, session_id))


@router.post("/sessions", response_model=schemas.SessionOut, status_code=201)
def add_session(body: schemas.ManualSessionIn, db: DBSession = Depends(get_session)):
    try:
        s = timers.create_manual(db, body.project_id, body.title, body.started_at, body.ended_at, body.tag_ids, body.note)
    except ValueError as e:
        raise _bad_request(e) from e
    return _session_out(db, s)


@router.patch("/sessions/{session_id}", response_model=schemas.SessionOut)
def update_session(session_id: int, body: schemas.SessionPatch, db: DBSession = Depends(get_session)):
    try:
        s = timers.update(db, session_id, **body.model_dump(exclude_unset=True))
    except ValueError as e:
        raise _bad_request(e) from e
    return _session_out(db, s)


@router.delete("/sessions/{session_id}", status_code=204)
def delete_session(session_id: int, db: DBSession = Depends(get_session)):
    timers.delete_session(db, session_id)
    return Response(status_code=204)


# --- Stats ---


@router.get("/stats")
def get_stats(
    project_id: int | None = None,
    range: Literal["7d", "30d", "12m", "all"] = "30d",
    db: DBSession = Depends(get_session),
) -> dict:
    st = stats.compute(db, config.get_user_settings(db), project_id, range)
    return {
        "project_id": project_id,
        "range": st.range_key,
        "total_sec": st.total_sec,
        "sessions": st.sessions,
        "longest": {"seconds": st.longest_sec, "title": st.longest_title, "day": st.longest_day},
        "day_record": {"seconds": st.record_sec, "day": st.record_day},
        "streak_days": st.streak_days,
        "range_total_sec": st.range_total_sec,
        "series": {"unit": st.series_unit, "labels": st.series_labels, "minutes": st.series_values},
        "per_tag": [{"name": t["name"], "color": t["color"], "seconds": t["seconds"]} for t in st.per_tag],
        "goal_min": st.goal_min,
    }


# --- Ideas ---


@router.get("/ideas", response_model=list[schemas.IdeaOut])
def list_ideas(status: str | None = None, db: DBSession = Depends(get_session)):
    return project_svc.list_ideas(db, status)


@router.post("/ideas", response_model=schemas.IdeaOut, status_code=201)
def create_idea(body: schemas.IdeaIn, db: DBSession = Depends(get_session)):
    return project_svc.create_idea(db, body.text, body.status)


@router.patch("/ideas", response_model=schemas.IdeaOut)
def update_idea(body: schemas.IdeaPatch, db: DBSession = Depends(get_session)):
    try:
        return project_svc.update_idea(db, body.id, text=body.text, status=body.status)
    except ValueError as e:
        raise _bad_request(e) from e


# --- Settings ---


@router.get("/settings", response_model=schemas.SettingsIO)
def get_settings(db: DBSession = Depends(get_session)):
    s = config.get_user_settings(db)
    return schemas.SettingsIO(timezone=s.timezone, day_start_hour=s.day_start_hour, week_start=s.week_start)


@router.put("/settings", response_model=schemas.SettingsIO)
def put_settings(body: schemas.SettingsIO, db: DBSession = Depends(get_session)):
    try:
        s = config.save_user_settings(db, **body.model_dump())
    except ValueError as e:
        raise _bad_request(e) from e
    return schemas.SettingsIO(timezone=s.timezone, day_start_hour=s.day_start_hour, week_start=s.week_start)


# --- Export, import, backup ---


@router.get("/export")
def export(format: Literal["json", "csv"] = "json", db: DBSession = Depends(get_session)):
    stamp = timers.utcnow().strftime("%Y%m%d-%H%M")
    if format == "csv":
        return Response(
            backup.export_csv(db),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="cyber-tracker-sessions-{stamp}.csv"'},
        )
    return Response(
        json.dumps(backup.export_json(db), ensure_ascii=False, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="cyber-tracker-{stamp}.json"'},
    )


@router.post("/import")
async def import_data(request: Request, db: DBSession = Depends(get_session)) -> dict:
    """Replace all data with a JSON export (request body is the export file)."""
    try:
        counts = backup.import_json(db, await request.json())
    except (ValueError, UnicodeDecodeError) as e:
        raise _bad_request(e) from e
    return {"imported": counts}


@router.get("/backup")
def download_backup(tasks: BackgroundTasks, db: DBSession = Depends(get_session)):
    """A consistent copy of the SQLite file (used by scripts/backup.sh)."""
    path = backup.backup_copy(db)
    tasks.add_task(path.unlink, missing_ok=True)
    stamp = timers.utcnow().strftime("%Y%m%d-%H%M%S")
    return FileResponse(path, media_type="application/vnd.sqlite3", filename=f"tracker-{stamp}.db")
