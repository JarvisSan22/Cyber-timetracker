"""HTMX endpoints under /ui/. Each returns the HTML fragment that changed.

Mutations that affect another part of the page also send an HX-Trigger event
("sessions-changed", "running-changed") so that part reloads itself.
"""

import json
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import HTMLResponse, Response
from sqlmodel import Session as DBSession

from app import config
from app.db import get_session
from app.models import Project
from app.routes.pages import SESSION_PAGE, base_context, render_block, templates, timer_context
from app.services import projects as project_svc
from app.services import timers

router = APIRouter(prefix="/ui", include_in_schema=False)

LOCAL_INPUT_FORMAT = "%Y-%m-%dT%H:%M"  # <input type="datetime-local">


def _fragment(request: Request, db: DBSession, name: str, project: Project | None = None, *, trigger=None, **extra):
    ctx = base_context(request, db, project, "timer") | timer_context(db, project) | extra
    response = templates.TemplateResponse(request, f"partials/{name}.html", ctx)
    if trigger:
        response.headers["HX-Trigger"] = trigger if isinstance(trigger, str) else json.dumps(trigger)
    return response


def _message(text: str, kind: str = "ok", trigger: str | None = None, status: int = 200) -> HTMLResponse:
    """Small inline status message. Errors use 200 so HTMX still swaps them in."""
    cls = "msg-error" if kind == "error" else "msg-ok"
    response = HTMLResponse(f'<p class="msg {cls}" role="status">{_escape(text)}</p>', status_code=status)
    if trigger:
        response.headers["HX-Trigger"] = trigger
    return response


def _escape(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def _parse_local(value: str, tz) -> datetime | None:
    """<input type=datetime-local> value in the user's timezone -> aware UTC datetime."""
    if not value:
        return None
    return datetime.fromisoformat(value).replace(tzinfo=tz).astimezone(timers.UTC)


def _ids(values: list[str] | None) -> list[int]:
    return [int(v) for v in values or [] if str(v).isdigit()]


# --- Running timers ---


@router.get("/running", response_class=HTMLResponse)
def running(request: Request, db: DBSession = Depends(get_session)):
    return _fragment(request, db, "running_timers")


@router.post("/sessions/start", response_class=HTMLResponse)
def start(
    request: Request,
    project_id: int = Form(...),
    title: str = Form(""),
    tag_ids: list[str] | None = Form(None),
    db: DBSession = Depends(get_session),
):
    timers.start(db, project_id, title, _ids(tag_ids))
    return _fragment(request, db, "running_timers")


@router.post("/sessions/{session_id}/pause", response_class=HTMLResponse)
def pause(request: Request, session_id: int, db: DBSession = Depends(get_session)):
    timers.pause(db, session_id)
    return _fragment(request, db, "running_timers")


@router.post("/sessions/{session_id}/resume", response_class=HTMLResponse)
def resume(request: Request, session_id: int, db: DBSession = Depends(get_session)):
    timers.resume(db, session_id)
    return _fragment(request, db, "running_timers")


@router.post("/sessions/{session_id}/stop", response_class=HTMLResponse)
def stop(request: Request, session_id: int, db: DBSession = Depends(get_session)):
    timers.stop(db, session_id)
    return _fragment(request, db, "running_timers", trigger="sessions-changed")


@router.post("/sessions/{session_id}/restart", response_class=HTMLResponse)
def restart(request: Request, session_id: int, db: DBSession = Depends(get_session)):
    timers.restart(db, session_id)
    return _fragment(request, db, "running_timers")


# --- Session list ---


@router.get("/sessions", response_class=HTMLResponse)
def session_list(
    request: Request, project_id: int, limit: int = SESSION_PAGE, db: DBSession = Depends(get_session)
):
    project = project_svc.get_project(db, project_id)
    ctx = base_context(request, db, project, "timer") | timer_context(db, project, limit=max(1, min(limit, 5000)))
    return templates.TemplateResponse(request, "partials/session_list.html", ctx)


@router.post("/sessions", response_class=HTMLResponse)
def add_past_session(
    request: Request,
    project_id: int = Form(...),
    title: str = Form(""),
    started_at: str = Form(...),
    ended_at: str = Form(""),
    duration_min: str = Form(""),
    tag_ids: list[str] | None = Form(None),
    note: str = Form(""),
    db: DBSession = Depends(get_session),
):
    tz = config.get_user_settings(db).tz
    try:
        start_dt = _parse_local(started_at, tz)
        end_dt = _parse_local(ended_at, tz)
        if end_dt is None and duration_min.strip():
            end_dt = start_dt + timedelta(minutes=float(duration_min))
        if start_dt is None or end_dt is None:
            raise ValueError("Give a start and either an end or a duration")
        if end_dt > timers.utcnow() + timedelta(minutes=1):
            raise ValueError("A past session cannot end in the future")
        s = timers.create_manual(db, project_id, title, start_dt, end_dt, _ids(tag_ids), note)
    except ValueError as e:
        return _message(str(e), "error")
    return _message(f"Added “{s.title}” ({timers.format_duration(timers.duration(s))}).", trigger="sessions-changed")


@router.post("/sessions/restore", response_class=HTMLResponse)
def restore(request: Request, data: str = Form(...), db: DBSession = Depends(get_session)):
    timers.restore(db, data)
    response = HTMLResponse('<div id="toast" hx-swap-oob="true"></div>')
    response.headers["HX-Trigger"] = json.dumps({"sessions-changed": True, "running-changed": True})
    return response


@router.get("/sessions/{session_id}/edit", response_class=HTMLResponse)
def edit_form(request: Request, session_id: int, db: DBSession = Depends(get_session)):
    s = timers.get_session_or_404(db, session_id)
    return _edit_dialog(request, db, s)


def _edit_dialog(request: Request, db: DBSession, s, error: str = ""):
    settings = config.get_user_settings(db)
    view = timers.views(db, [s], settings.tz)[0]
    project = project_svc.get_project(db, s.project_id)
    ctx = base_context(request, db, project, "timer") | {
        "v": view,
        "all_tags": project_svc.list_tags(db, s.project_id),
        "checked": {t.id for t in view.tags},
        "error": error,
    }
    return HTMLResponse(render_block("timer.html", "edit_dialog", ctx))


@router.post("/sessions/{session_id}", response_class=HTMLResponse)
def save_edit(
    request: Request,
    session_id: int,
    title: str = Form(""),
    started_at: str = Form(""),
    ended_at: str = Form(""),
    paused_min: str = Form(""),
    tag_ids: list[str] | None = Form(None),
    note: str = Form(""),
    db: DBSession = Depends(get_session),
):
    tz = config.get_user_settings(db).tz
    current = timers.views(db, [timers.get_session_or_404(db, session_id)], tz)[0]

    def changed(value: str, shown: datetime | None) -> datetime | None:
        # The form shows minutes only; an untouched field keeps the exact stored time.
        if not value or (shown and value == shown.strftime(LOCAL_INPUT_FORMAT)):
            return None
        return _parse_local(value, tz)

    try:
        timers.update(
            db,
            session_id,
            title=title,
            started_at=changed(started_at, current.start_local),
            ended_at=changed(ended_at, current.end_local),
            paused_sec=int(float(paused_min) * 60) if paused_min.strip() else None,
            tag_ids=_ids(tag_ids),
            note=note,
        )
    except ValueError as e:
        return _edit_dialog(request, db, timers.get_session_or_404(db, session_id), error=str(e))
    response = HTMLResponse("")
    response.headers["HX-Trigger"] = json.dumps({"sessions-changed": True, "running-changed": True})
    return response


@router.post("/sessions/{session_id}/delete", response_class=HTMLResponse)
def delete(request: Request, session_id: int, db: DBSession = Depends(get_session)):
    s = timers.get_session_or_404(db, session_id)
    title = s.title
    snapshot = timers.delete_session(db, session_id)
    response = HTMLResponse(render_block("timer.html", "undo_toast", {"snapshot": snapshot, "deleted_title": title}))
    response.headers["HX-Trigger"] = json.dumps({"sessions-changed": True, "running-changed": True})
    return response


# --- Tags (chips on the Timer page) ---


@router.get("/projects/{project_id}/tags", response_class=HTMLResponse)
def tag_chips(request: Request, project_id: int, db: DBSession = Depends(get_session)):
    project = project_svc.get_project(db, project_id)
    return _fragment(request, db, "tag_chips", project)


@router.post("/projects/{project_id}/tags", response_class=HTMLResponse)
def add_tag(
    request: Request,
    project_id: int,
    new_tag: str = Form(""),
    tag_ids: list[str] | None = Form(None),
    db: DBSession = Depends(get_session),
):
    project = project_svc.get_project(db, project_id)
    checked = set(_ids(tag_ids))
    error = ""
    try:
        tag = project_svc.create_tag(db, project_id, new_tag)
        checked.add(tag.id)
    except ValueError as e:
        error = str(e)
    return _fragment(request, db, "tag_chips", project, checked_tag_ids=checked, tag_error=error)
