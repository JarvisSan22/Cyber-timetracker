"""HTMX endpoints under /ui/. Each returns the HTML fragment that changed.

Mutations that affect another part of the page also send an HX-Trigger event
("sessions-changed", "running-changed") so that part reloads itself.
"""

import json
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import HTMLResponse, Response
from sqlmodel import Session as DBSession

from app import config
from app.db import get_session
from app.models import Project
from app.routes.pages import (
    SESSION_PAGE,
    base_context,
    ideas_context,
    projects_context,
    render_block,
    settings_context,
    templates,
    timer_context,
)
from app.services import backup
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


# --- Projects page ---


def _project_list(db: DBSession, **extra) -> HTMLResponse:
    return HTMLResponse(render_block("projects.html", "project_list", projects_context(db, **extra)))


def _goal(value: str) -> int | None:
    value = (value or "").strip()
    return max(0, int(float(value))) if value else None


@router.post("/projects", response_class=HTMLResponse)
def create_project(
    name: str = Form(""),
    type: str = Form("other"),
    color: str = Form(""),
    daily_goal_min: str = Form(""),
    db: DBSession = Depends(get_session),
):
    try:
        p = project_svc.create_project(db, name, type, color, _goal(daily_goal_min))
    except ValueError as e:
        return _project_list(db, error=str(e))
    return _project_list(db, message=f"Created “{p.name}”.", open_project=p.id)


@router.post("/projects/{project_id}", response_class=HTMLResponse)
def update_project(
    project_id: int,
    name: str = Form(""),
    type: str = Form("other"),
    color: str = Form(""),
    daily_goal_min: str = Form(""),
    db: DBSession = Depends(get_session),
):
    try:
        p = project_svc.update_project(db, project_id, name=name, color=color, type=type, daily_goal_min=_goal(daily_goal_min))
    except ValueError as e:
        return _project_list(db, error=str(e))
    return _project_list(db, message=f"Saved “{p.name}”.")


@router.post("/projects/{project_id}/archive", response_class=HTMLResponse)
def archive_project(project_id: int, archived: str = Form("1"), db: DBSession = Depends(get_session)):
    p = project_svc.archive_project(db, project_id, archived == "1")
    return _project_list(db, message=f"{'Archived' if p.archived else 'Restored'} “{p.name}”.")


@router.post("/projects/{project_id}/tags/manage", response_class=HTMLResponse)
def add_tag_on_projects_page(project_id: int, new_tag: str = Form(""), db: DBSession = Depends(get_session)):
    try:
        tag = project_svc.create_tag(db, project_id, new_tag)
    except ValueError as e:
        return _project_list(db, error=str(e), open_project=project_id)
    return _project_list(db, message=f"Added tag “{tag.name}”.", open_project=project_id)


@router.post("/tags/{tag_id}", response_class=HTMLResponse)
def update_tag(tag_id: int, name: str = Form(""), color: str = Form(""), db: DBSession = Depends(get_session)):
    tag = project_svc.update_tag(db, tag_id, name=name, color=color)
    return _project_list(db, message=f"Saved tag “{tag.name}”.", open_project=tag.project_id)


@router.post("/tags/{tag_id}/delete", response_class=HTMLResponse)
def delete_tag(tag_id: int, db: DBSession = Depends(get_session)):
    tag = project_svc.get_tag(db, tag_id)
    name, project_id = tag.name, tag.project_id
    try:
        project_svc.delete_tag(db, tag_id)
    except ValueError as e:
        return _project_list(db, error=str(e), open_project=project_id)
    return _project_list(db, message=f"Deleted tag “{name}”.", open_project=project_id)


# --- Ideas page ---


def _idea_list(db: DBSession, status_filter: str = "", **extra) -> HTMLResponse:
    return HTMLResponse(render_block("ideas.html", "idea_list", ideas_context(db, status_filter, **extra)))


@router.post("/ideas", response_class=HTMLResponse)
def create_idea(text: str = Form(""), db: DBSession = Depends(get_session)):
    try:
        project_svc.create_idea(db, text)
    except ValueError as e:
        return _idea_list(db, error=str(e))
    return _idea_list(db)


@router.post("/ideas/{idea_id}", response_class=HTMLResponse)
def update_idea(idea_id: int, status: str = Form(...), status_filter: str = Form(""), db: DBSession = Depends(get_session)):
    try:
        project_svc.update_idea(db, idea_id, status=status)
    except ValueError as e:
        return _idea_list(db, status_filter, error=str(e))
    return _idea_list(db, status_filter)


@router.post("/ideas/{idea_id}/delete", response_class=HTMLResponse)
def delete_idea(idea_id: int, status_filter: str = Form(""), db: DBSession = Depends(get_session)):
    project_svc.delete_idea(db, idea_id)
    return _idea_list(db, status_filter)


# --- Settings page ---


@router.post("/settings", response_class=HTMLResponse)
def save_settings(
    timezone: str = Form(...),
    day_start_hour: int = Form(0),
    week_start: str = Form("monday"),
    db: DBSession = Depends(get_session),
):
    try:
        config.save_user_settings(db, timezone=timezone, day_start_hour=day_start_hour, week_start=week_start)
        extra = {"message": "Saved."}
    except ValueError as e:
        extra = {"error": str(e)}
    return HTMLResponse(render_block("settings.html", "settings_form", settings_context(db, **extra)))


@router.post("/theme", response_class=HTMLResponse)
async def save_theme(request: Request, db: DBSession = Depends(get_session)):
    form = await request.form()
    colors = {key: str(form.get(f"color_{key}", "")) for key in config.THEME_COLOR_KEYS if form.get(f"color_{key}")}
    try:
        theme = config.save_theme(db, str(form.get("preset", "")), colors)
        extra = {"theme_message": f"Saved “{theme.label}”" + (f" with {len(theme.overrides)} custom colors." if theme.overrides else ".")}
    except ValueError as e:
        extra = {"theme_error": str(e)}
    return HTMLResponse(render_block("settings.html", "theme_form", settings_context(db, **extra)))


@router.post("/import", response_class=HTMLResponse)
async def import_json(file: UploadFile = File(...), db: DBSession = Depends(get_session)):
    try:
        data = json.loads(await file.read())
        counts = backup.import_json(db, data)
    except (ValueError, UnicodeDecodeError) as e:
        return _message(str(e), "error")
    return _message(
        f"Imported {counts['projects']} projects, {counts['tags']} tags, {counts['sessions']} sessions, {counts['ideas']} ideas."
    )
