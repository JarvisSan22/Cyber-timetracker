# Hobby Time Tracker

A self-hosted web app for tracking the time you spend on hobbies and learning: Chinese or Japanese study, painting, coding, anything. It runs as one Docker container on a Raspberry Pi and you open it from any phone or laptop on your home network.

- **Timer**: pick a project, tap a tag, press Start. Several timers can run at once, across projects. Pause, resume, stop, restart, edit, and delete with undo. Past sessions can be added by hand.
- **Statistics**: total time, session count, longest session, day record, current streak, a bar chart (7 days, 30 days, 12 months, all time) with your daily goal, time per tag, and a one-year heatmap.
- **Projects** with starter tag sets (language, art, coding), **Ideas** (your own feature-request list) and **Settings** (timezone, day start hour, CSV/JSON export, JSON import, database backup).
- Installable as a PWA. No login, no cloud, no internet needed: all JS/CSS is vendored in `app/static/vendor/`.

Stack: Python 3.13, FastAPI, SQLModel, SQLite (WAL), Alembic, Jinja2, HTMX 2, Alpine.js 3, Chart.js 4, Pico.css. No Node or build step. Design: [docs/DESIGN.md](docs/DESIGN.md). Choices made during the build: [docs/DECISIONS.md](docs/DECISIONS.md).

## Run locally with uvicorn

Needs Python 3.13 (with [uv](https://docs.astral.sh/uv/), `uv venv --python 3.13` fetches it for you).

```bash
uv venv --python 3.13 .venv
uv pip install --python .venv -r requirements.txt
SEED_DEMO=1 .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8686
```

Open http://127.0.0.1:8686. The database is created at `./data/tracker.db` and migrations run on startup. `SEED_DEMO=1` adds three demo projects with 40 sessions, but only when the database is empty. Leave it out for a clean start.

Run the tests:

```bash
.venv/bin/pytest -q
```

## Run locally with Docker Compose

```bash
docker compose up -d --build
```

Open http://localhost:8686. Data lives in `./data/tracker.db` on the host (the `./data:/data` volume), so it survives restarts and rebuilds. Useful variations:

```bash
SEED_DEMO=1 docker compose up -d --build       # demo data on first run
TRACKER_PORT=9686 docker compose up -d --build  # if port 8686 is taken on the host
docker compose logs -f
docker compose down
```

The container runs as root, so files in `./data` are owned by root. To switch from Docker to a local uvicorn run on the same `./data` folder, fix ownership first: `sudo chown -R "$USER" data`.

The image has no platform pin. It builds natively on x86_64 and on arm64 (Raspberry Pi).

## Deploy on the Raspberry Pi

Target: Raspberry Pi 4 or 5 with 64-bit Raspberry Pi OS and Docker installed (`curl -fsSL https://get.docker.com | sh`, then `sudo usermod -aG docker $USER` and log in again).

1. Copy the repo to the Pi, for example `git clone <your-remote> ~/hobby-tracker` or `rsync -a --exclude .venv --exclude data ./ pi@<pi-ip>:~/hobby-tracker/`.
2. Build and start it on the Pi:

   ```bash
   cd ~/hobby-tracker
   docker compose up -d --build
   ```

   To build on the laptop instead: `docker buildx build --platform linux/arm64 -t hobby-tracker:latest --load .`, then `docker save hobby-tracker:latest | ssh pi@<pi-ip> docker load`.
3. Give the Pi a fixed IP in your router (DHCP reservation) and open `http://<pi-ip>:8686` on your phone. Use "Add to Home Screen" to install it as an app.
4. Set up the nightly backup. `scripts/backup.sh` downloads a consistent copy of the database from `/api/backup` and keeps the newest 14 in `~/tracker-backups`. Run `crontab -e` on the Pi and add:

   ```cron
   15 3 * * * /home/pi/hobby-tracker/scripts/backup.sh >> /home/pi/tracker-backups/backup.log 2>&1
   ```

   Change `/home/pi` to your home directory, and run `mkdir -p ~/tracker-backups` once so the log file has a folder. Copy the backups off the Pi now and then; SD cards fail. To restore, stop the container, copy a backup to `./data/tracker.db`, delete any `tracker.db-wal` and `tracker.db-shm` next to it, and start the container again.

**Security**: there is no login. Keep port 8686 closed on your router and only use the app on your home network. For access away from home, use Tailscale rather than port forwarding.

## Environment variables

| Variable | Default | Used by | Meaning |
| --- | --- | --- | --- |
| `DATABASE_PATH` | `./data/tracker.db` (`/data/tracker.db` in Docker) | app | SQLite file location |
| `TZ` | `Asia/Tokyo` in Docker | app | Default timezone until you pick one in Settings |
| `APP_TIMEZONE` | unset | app | Overrides `TZ` as the default timezone |
| `DAY_START_HOUR` | `0` | app | Default hour (0–23) at which a new day starts, until changed in Settings |
| `SEED_DEMO` | `0` | app | `1` adds demo projects and sessions when the database is empty |
| `TRACKER_PORT` | `8686` | docker-compose | Host port mapped to the container's port 8686 |
| `TRACKER_URL` | `http://localhost:8686` | backup.sh | Where the app is reachable |
| `BACKUP_DIR` | `~/tracker-backups` | backup.sh | Where backups are saved |
| `KEEP` | `14` | backup.sh | How many backups to keep |

Timezone, day start hour and week start chosen in Settings are stored in the database and override the env defaults.

## Project layout

```text
app/main.py          FastAPI app, static files, routers, migrations on startup
app/config.py        env settings + user settings stored in the DB
app/db.py            SQLite engine (WAL), get_session()
app/models.py        Project, Tag, Session, SessionTag, Idea, Setting
app/schemas.py       JSON API models
app/services/        timers, stats, projects (+ ideas, demo seed), backup
app/routes/          pages.py (full pages), htmx.py (/ui/ fragments), api.py (/api/ JSON)
app/templates/       Jinja pages and partials
app/static/          app.css, app.js, PWA files, vendor/ libraries
migrations/          Alembic
scripts/backup.sh    nightly backup with retention
tests/               pytest
```

JSON API docs are at `/docs` while the app runs.
