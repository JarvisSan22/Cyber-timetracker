"""Full HTML pages: /, /stats, /projects, /ideas, /settings. Also the Jinja setup shared with htmx.py."""

from datetime import datetime, timedelta
from zoneinfo import available_timezones

from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.templating import Jinja2Templates
from sqlmodel import Session as DBSession

from app import config
from app.db import get_session
from app.models import IDEA_STATUSES, PROJECT_TYPES, Project
from app.services import projects as project_svc
from app.services import stats as stats_svc
from app.services import timers

router = APIRouter()

templates = Jinja2Templates(directory=config.APP_DIR / "templates")
templates.env.filters["dur"] = timers.format_duration
templates.env.filters["paused"] = timers.format_paused
templates.env.filters["clock"] = timers.format_clock
templates.env.filters["hm"] = lambda dt: dt.strftime("%H:%M") if dt else ""

PROJECT_COOKIE = "project_id"
SESSION_PAGE = 50


def render_block(template_name: str, block: str, context: dict) -> str:
    """Render one {% block %} of a page template (used for HTMX fragments of full pages)."""
    template = templates.env.get_template(template_name)
    ctx = template.new_context(dict(context))
    return "".join(template.blocks[block](ctx))


def day_label(day, today) -> str:
    if day == today:
        return "Today"
    if day == today - timedelta(days=1):
        return "Yesterday"
    if day.year == today.year:
        return day.strftime("%a, %b %-d")
    return day.strftime("%a, %b %-d, %Y")


templates.env.globals["day_label"] = day_label


def pick_project(request: Request, db: DBSession, allow_all: bool = False) -> Project | None:
    """Selected project from ?project=, then the cookie, then the first active project.

    Returns None for "All projects" (only when allow_all) or when no projects exist.
    """
    active = project_svc.list_projects(db)
    raw = request.query_params.get("project") or request.cookies.get(PROJECT_COOKIE)
    if raw == "all" and allow_all:
        return None
    if raw and raw.isdigit():
        project = db.get(Project, int(raw))
        if project is not None:
            return project
    return active[0] if active else None


def base_context(request: Request, db: DBSession, project: Project | None, page: str) -> dict:
    settings = config.get_user_settings(db)
    now = datetime.now(settings.tz)
    return {
        "request": request,
        "page": page,
        "project": project,
        "projects": project_svc.list_projects(db),
        "settings": settings,
        "today": timers.local_day(now, settings.tz, settings.day_start_hour),
        "now_local": now,
    }


def timer_context(db: DBSession, project: Project | None, limit: int = SESSION_PAGE) -> dict:
    """Data for the Timer page and its fragments."""
    settings = config.get_user_settings(db)
    running = timers.views(db, timers.list_running(db), settings.tz)
    finished = timers.list_finished(db, project.id if project else None, limit=limit + 1) if project else []
    return {
        "running": running,
        "groups": timers.group_by_day(timers.views(db, finished[:limit], settings.tz), settings.tz, settings.day_start_hour),
        "has_more": len(finished) > limit,
        "limit": limit,
        "tags": project_svc.list_tags(db, project.id) if project else [],
        "checked_tag_ids": set(),
    }


def remember_project(response, project: Project | None, raw: str | None) -> None:
    if raw == "all":
        response.set_cookie(PROJECT_COOKIE, "all", max_age=3600 * 24 * 365, samesite="lax")
    elif project is not None:
        response.set_cookie(PROJECT_COOKIE, str(project.id), max_age=3600 * 24 * 365, samesite="lax")


@router.get("/", response_class=HTMLResponse)
def timer_page(request: Request, db: DBSession = Depends(get_session)):
    project = pick_project(request, db)
    if project is not None and project.archived:
        project = (project_svc.list_projects(db) or [project])[0]
    ctx = base_context(request, db, project, "timer") | timer_context(db, project)
    ctx["past_start"] = (ctx["now_local"] - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M")
    response = templates.TemplateResponse(request, "timer.html", ctx)
    remember_project(response, project, request.query_params.get("project"))
    return response


@router.get("/stats", response_class=HTMLResponse)
def stats_page(request: Request, range: str = "30d", db: DBSession = Depends(get_session)):
    project = pick_project(request, db, allow_all=True)
    settings = config.get_user_settings(db)
    st = stats_svc.compute(db, settings, project.id if project else None, range)
    ctx = base_context(request, db, project, "stats") | {
        "st": st,
        "ranges": stats_svc.RANGES,
        "heatmap_levels": stats_svc.HEATMAP_LEVELS_MIN,
    }
    response = templates.TemplateResponse(request, "stats.html", ctx)
    remember_project(response, project, request.query_params.get("project"))
    return response


def projects_context(db: DBSession, **extra) -> dict:
    all_projects = project_svc.list_projects(db, include_archived=True)
    tags = {p.id: project_svc.list_tags(db, p.id) for p in all_projects}
    return {
        "all_projects": all_projects,
        "project_tags": tags,
        "tag_usage": {t.id: project_svc.tag_usage(db, t.id) for ts in tags.values() for t in ts},
        "project_types": PROJECT_TYPES,
        "palette": project_svc.PALETTE,
        "message": "",
        "error": "",
        "open_project": None,
    } | extra


def ideas_context(db: DBSession, status: str = "", **extra) -> dict:
    return {
        "ideas": project_svc.list_ideas(db, status or None),
        "statuses": IDEA_STATUSES,
        "status_filter": status if status in IDEA_STATUSES else "",
        "error": "",
    } | extra


def settings_context(db: DBSession, **extra) -> dict:
    return {
        "settings": config.get_user_settings(db),
        "timezones": sorted(available_timezones()),
        "message": "",
        "error": "",
        "import_message": "",
    } | extra


@router.get("/projects", response_class=HTMLResponse)
def projects_page(request: Request, db: DBSession = Depends(get_session)):
    ctx = base_context(request, db, None, "projects") | projects_context(db)
    return templates.TemplateResponse(request, "projects.html", ctx)


@router.get("/ideas", response_class=HTMLResponse)
def ideas_page(request: Request, status: str = "", db: DBSession = Depends(get_session)):
    ctx = base_context(request, db, None, "ideas") | ideas_context(db, status)
    return templates.TemplateResponse(request, "ideas.html", ctx)


@router.get("/settings", response_class=HTMLResponse)
def settings_page(request: Request, db: DBSession = Depends(get_session)):
    ctx = base_context(request, db, None, "settings") | settings_context(db)
    return templates.TemplateResponse(request, "settings.html", ctx)


@router.get("/sw.js", include_in_schema=False)
def service_worker():
    """Served from the root so the service worker can control every page."""
    return FileResponse(config.APP_DIR / "static" / "sw.js", media_type="application/javascript")
