# Decisions

Choices made while building v1 where DESIGN.md was silent or unclear. Simplest option that fits the doc.

## Build plan

DESIGN.md has no "Build plan" section, so the milestones were defined here, following the doc's own order:

1. **Foundation**: config, SQLite engine (WAL), models, Alembic migration run on startup, `/api/health`, Dockerfile, docker-compose, backup script.
2. **Timer**: projects with starter tags, timer service (start, pause, resume, stop, restart, duration), Timer page with project picker, tag chips, running timers (Alpine ticker, 30 s re-poll), session list grouped by day, edit, delete with undo, add past session, demo seed.
3. **Statistics**: stats service (totals, longest, day record, streak, per-day, per-tag), Statistics page with stat cards, range switch, bar chart with goal line, time-per-tag bars, year heatmap.
4. **Other pages and API**: Projects, Ideas, Settings (timezone, day start, export CSV/JSON, import JSON, DB backup), JSON API, PWA (manifest, service worker, icons), README.
5. **Skipped (as asked)**: later integrations the doc mentions as future work (AnkiConnect, scripts, remote access via Tailscale).

## Answers given with the task

- Total time sums session durations even when sessions overlap; a note under the stats says so.
- No login.
- Weeks start on Monday. Default timezone Asia/Tokyo, changeable in Settings.
- Docker image has no platform pin (builds on x86_64 and arm64).

## Choices

- **Repo root** is this folder (the doc's `hobby-tracker/`). DESIGN.md stays at `docs/DESIGN.md` instead of the root.
- **Datetimes** are timezone-aware UTC in Python; SQLModel 0.0.47's `UTCDateTime` type stores them in SQLite.
- **`tzdata`** is added to requirements so `zoneinfo` works in `python:3.13-slim`, which ships no system zone files.
- **httpx** is kept for the test client as the doc lists it; Starlette's deprecation warning about it is filtered in `pytest.ini`.
- **Timezone env**: `APP_TIMEZONE`, falling back to `TZ`, then `Asia/Tokyo`, is the default until changed in Settings. Settings are stored in the `setting` table and win over env.
- **Selected project** comes from `?project=`, then a `project_id` cookie, then the first active project. Statistics also accepts `?project=all`.
- **HTMX refresh pattern**: timer buttons swap `#running-timers` directly; anything that changes the session list sends an `HX-Trigger: sessions-changed` event and the list reloads itself (`GET /ui/sessions`). This keeps each route returning one fragment.
- **Fragments of full pages** (edit dialog, undo toast, list blocks on Projects/Ideas/Settings) are `{% block %}`s inside the page template rendered on their own, so the template folder matches the outline exactly.
- **Undo delete**: the session is really deleted; the toast carries a JSON snapshot that `POST /ui/sessions/restore` re-inserts (same id, same tags). The toast disappears after 8 s. No soft-delete column needed.
- **Tag pencil** on the Timer page links to the project's card on the Projects page, where tags are renamed, recolored or deleted. "+ New tag" adds a tag inline.
- **Tag delete** is blocked while sessions use the tag (as in the API table); rename it instead.
- **Session list** shows finished sessions of the selected project, 50 at a time with "Show older sessions". Running timers show for all projects.
- **Tab title** shows the number of running timers and the longest one's elapsed time.
- **Edit dialog** changes title, start, end, paused minutes, tags and note. Moving a session to another project is not supported in v1.
- **Running timer clock**: the server sends elapsed seconds at render time and Alpine adds local wall-clock time, so a phone with a wrong clock still shows the right elapsed time.
- **Demo seed** (`SEED_DEMO=1`) runs only when the database has no projects, with a fixed random seed: 3 projects, 40 sessions over the last 30 days.
