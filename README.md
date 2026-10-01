# ⌬ Cyber Tracker

A self-hosted web app for tracking the time you put into hobbies and learning: languages, painting, coding, anything. It runs as one small Docker container on a Raspberry Pi, and you open it from any phone or laptop on your home network. The default look is a Cyberpunk 2077 style game UI, with four more themes and your own colors.

- **Timer**: pick a project, tap a tag, press Start. Several timers can run at once, across projects. Pause, resume, stop, restart, edit, and delete with undo. Past sessions can be added by hand.
- **Statistics**: total time, session count, longest session, day record, current streak, a bar chart (7 days, 30 days, 12 months, all time) with your daily goal, time per tag, and a one-year heatmap.
- **Projects** with starter tag sets (language, art, coding), **Ideas** (your own feature-request list) and **Settings** (timezone, day start hour, theme and colors, CSV/JSON export, JSON import, database backup).
- **Themes**: Cyberpunk yellow (default), Netrunner purple, Old tech green, Japan sakura and Arasaka red. See [Themes](#themes).
- Installable as a PWA. No login, no cloud, no internet needed: all JS, CSS and fonts are vendored in `app/static/vendor/`.

Stack: Python 3.13, FastAPI, SQLModel, SQLite (WAL), Alembic, Jinja2, HTMX 2, Alpine.js 3, Chart.js 4, Pico.css 2, augmented-ui 2, Rajdhani and Share Tech Mono fonts. No Node or build step. Design: [docs/DESIGN.md](docs/DESIGN.md). Choices made during the build: [docs/DECISIONS.md](docs/DECISIONS.md).

## Run locally with uvicorn

Needs Python 3.13 (with [uv](https://docs.astral.sh/uv/), `uv venv --python 3.13` fetches it for you).

```bash
uv venv --python 3.13 .venv
uv pip install --python .venv -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8686
```

Open http://127.0.0.1:8686. The database is created at `./data/tracker.db` and migrations run on startup. Add `SEED_DEMO=1` in front of the command to get three demo projects with 40 sessions (only when the database has no projects).

`requirements.txt` holds what the app needs to run; `requirements-dev.txt` adds the test tools. Run the tests:

```bash
.venv/bin/pytest -q
```

## Run with Docker Compose

```bash
cp .env.example .env      # optional: port, timezone, host user id
docker compose up -d --build
```

Open http://localhost:8686. Data lives in `./data/tracker.db` on the host (the `./data:/data` volume), so it survives restarts, rebuilds and image updates.

```bash
docker compose logs -f              # follow the logs
docker compose ps                   # shows "healthy" once the app answers
docker compose restart
docker compose down                 # stop (data stays in ./data)
```

What the container is set up for:

- Runs as your host user (`PUID`/`PGID` in `.env`, default 1000), not root, so files in `./data` belong to you.
- One uvicorn worker (SQLite has one writer, and it keeps memory low), no per-request access log, and Docker logs capped at 3 × 1 MB, so nothing slowly fills an SD card.
- `restart: unless-stopped`, a health check on `/api/health` every 60 s, `init: true` for clean shutdowns, and a 256 MB memory cap (the app uses about 80–120 MB).
- No platform pin: the same Dockerfile builds on x86_64, arm64 (64-bit Raspberry Pi OS) and armv7 (32-bit Raspberry Pi OS).

If `./data` was created by an older root-run container, fix ownership once: `sudo chown -R "$(id -u):$(id -g)" data`.

## Deploy on a Raspberry Pi 3

A Pi 3 (1 GB RAM) runs the app comfortably. A Pi 4 or 5 works the same way.

### 1. Prepare the Pi

1. Flash **Raspberry Pi OS Lite (64-bit)** with Raspberry Pi Imager. In the Imager settings, set a hostname (for example `cyberpi`), your user, Wi-Fi if needed, and enable SSH.
   The 64-bit OS is the one to use: Docker Engine 28 is the last version that supports the 32-bit Raspberry Pi OS. The image also builds for 32-bit (armv7) if you must stay on it.
2. Boot it and log in: `ssh <user>@cyberpi.local`.
3. Update it: `sudo apt update && sudo apt full-upgrade -y && sudo reboot`.
4. In your router, give the Pi a fixed IP (DHCP reservation), for example `192.168.0.50`, so the app's address never changes.

### 2. Install with the script (recommended)

```bash
sudo apt install -y git
git clone <your-repo-url> ~/cyber-tracker
cd ~/cyber-tracker
./scripts/install-pi.sh
```

`scripts/install-pi.sh` is safe to run again. It:

1. Checks the architecture and that Docker and the compose plugin are installed. If Docker is missing it offers to install it with the official `get.docker.com` script and adds you to the `docker` group. Log out and back in, then run the script again.
2. Creates `.env` from `.env.example` with your user and group ids.
3. Makes sure `./data` belongs to you.
4. Builds the image and starts the container (`docker compose up -d --build`). The first build on a Pi 3 takes a few minutes.
5. Waits until `/api/health` answers.
6. Offers to add the nightly backup to your crontab (03:15, keeps the newest 14 copies in `~/tracker-backups`).
7. Prints the address to open, for example `http://192.168.0.50:8686`.

On your phone, open that address and use "Add to Home Screen" to install it as an app.

### 2b. Or install by hand

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"        # then log out and back in
git clone <your-repo-url> ~/cyber-tracker && cd ~/cyber-tracker
cp .env.example .env                   # set PUID/PGID to the output of `id -u` / `id -g`
mkdir -p data
docker compose up -d --build
```

### 2c. Or build on your laptop and copy the image

Faster than building on a Pi 3. On the laptop (needs Docker buildx; run `docker run --privileged --rm tonistiigi/binfmt --install arm64,arm` once if it cannot build for ARM):

```bash
docker buildx build --platform linux/arm64 -t cyber-tracker:latest --load .   # linux/arm/v7 for a 32-bit OS
docker save cyber-tracker:latest | gzip | ssh <user>@cyberpi.local 'gunzip | docker load'
```

Then on the Pi, in the cloned repo: `docker compose up -d --no-build`.

### 3. Update to a new version

```bash
cd ~/cyber-tracker
git pull
docker compose up -d --build
```

Migrations run automatically on startup; your data in `./data` is kept.

### 4. Backups

`scripts/backup.sh` downloads a consistent copy of the live database from `/api/backup` and keeps the newest 14 in `~/tracker-backups`. The install script can add it to cron for you; by hand, run `crontab -e` and add (change `/home/pi` to your home directory):

```cron
15 3 * * * TRACKER_URL=http://localhost:8686 /home/pi/cyber-tracker/scripts/backup.sh >> /home/pi/tracker-backups/backup.log 2>&1
```

Backups on the same SD card do not survive the SD card dying, so copy them off the Pi now and then, for example from the laptop:

```bash
rsync -a <user>@cyberpi.local:tracker-backups/ ~/cyber-tracker-backups/
```

You can also download a backup any time from Settings > Database backup.

To restore: `docker compose down`, copy a backup to `./data/tracker.db`, delete `./data/tracker.db-wal` and `./data/tracker.db-shm` if they exist, then `docker compose up -d`.

### Security

There is no login. The app is meant for your home network only:

- Open it at the Pi's LAN address (`http://192.168.x.x:8686`). Do **not** forward port 8686 on your router to the internet; anyone who finds it could read and change your data.
- For access away from home, install [Tailscale](https://tailscale.com/) on the Pi and your phone and use the Pi's Tailscale address. Nothing is exposed publicly.

## Themes

Pick a theme in **Settings > Theme**. Every color can be changed with the color pickers below the theme cards. Changes preview live on the whole page; **Save theme** keeps them, **Reset colors to preset** puts the theme's own colors back.

| Theme | Look | Font |
| --- | --- | --- |
| Cyberpunk yellow (default) | Yellow `#fcee0a`, cyan `#00f0ff` and red `#ff003c` on near-black, faint scanlines | Rajdhani + Share Tech Mono |
| Netrunner purple | Purple `#b026ff` and magenta `#ff2bd6` on deep violet | Rajdhani + Share Tech Mono |
| Old tech green | Phosphor green `#33ff66` and amber on black, glowing text | Share Tech Mono everywhere |
| Japan sakura | Light theme: sakura pink `#e4507c` and indigo `#4f6fa8` on pale pink | System font |
| Arasaka red | Red `#ff2a3d` and white on black | Rajdhani + Share Tech Mono |

The theme is saved on the server (the `setting` table), so your phone and laptop show the same look, and it is included in JSON export/import. Only the colors you change are stored; picking a theme and saving without changes clears them. Text on accent and Stop buttons switches between black and white automatically so it stays readable with any color. Project and tag colors are set per project and keep their colors in every theme.

### How the theme CSS works

- **Tokens.** Every color in `app/static/app.css` comes from CSS custom properties: `--bg`, `--card`, `--card-2`, `--line`, `--text`, `--muted`, `--accent`, `--accent-2`, `--danger`, `--warn`, plus `--accent-ink`, `--danger-ink`, `--font-body` and `--font-mono`. The server writes the active theme's values into `<html style="...">`, with `data-theme="dark|light"` and `data-preset="<name>"` on the same tag. `app.css` maps the tokens onto Pico's `--pico-*` variables, so Pico's forms and buttons follow the theme too.
- **Shapes.** The cut corners and neon borders come from [augmented-ui v2](https://augmented-ui.com/) (`app/static/vendor/augmented-ui.min.css`, BSD-2). Elements opt in with an attribute, and `app.css` sets sizes and border colors with classes:

  ```html
  <section class="panel aug-panel aug-hot" data-augmented-ui="tl-clip br-clip border">…</section>
  ```

  `.aug-panel` sets the corner size and a 1px `--line` border, `.aug-hot` turns the border into an accent-to-cyan gradient, and `.aug-btn` sizes button corners. Augmented elements inside another augmented element sit under a wrapper with `data-augmented-ui-reset`. Plain buttons get a matching cut corner with `clip-path` instead, because augmented-ui borders use `::before`/`::after`, which Pico uses on form controls.
- **Per-theme extras** are plain CSS on `data-preset`, for example `:root[data-preset="terminal"] body { text-shadow: … }` for the glowing terminal text, and the scanlines on `:root[data-theme="dark"] body`.

### Add your own theme preset

Add an entry to `THEMES` in `app/config.py`; it appears in Settings automatically:

```python
"ice": {
    "label": "Ice blue",
    "scheme": "dark",      # "dark" or "light"
    "fonts": "tech",       # "tech", "terminal" or "soft" (see FONT_SETS)
    "colors": {
        "bg": "#05080d", "card": "#0c131d", "card-2": "#132030", "line": "#1f3a55", "text": "#e6f4ff",
        "muted": "#7f9bb3", "accent": "#5ad1ff", "accent-2": "#ffffff", "danger": "#ff4d6d", "warn": "#ffc857",
    },
},
```

All ten color keys are required. For extra effects, add CSS for `:root[data-preset="ice"]` in `app.css`.

## Environment variables

| Variable | Default | Used by | Meaning |
| --- | --- | --- | --- |
| `TRACKER_PORT` | `8686` | docker-compose | Host port the app is served on |
| `TZ` | `Asia/Tokyo` | app, docker-compose | Default timezone until you pick one in Settings |
| `PUID` / `PGID` | `1000` | docker-compose | Host user and group the container runs as (owner of `./data`) |
| `SEED_DEMO` | `0` | app | `1` adds demo projects and sessions when the database has no projects |
| `DATABASE_PATH` | `./data/tracker.db` (`/data/tracker.db` in Docker) | app | SQLite file location |
| `APP_TIMEZONE` | unset | app | Overrides `TZ` as the default timezone |
| `DAY_START_HOUR` | `0` | app | Default hour (0–23) at which a new day starts, until changed in Settings |
| `TRACKER_URL` | `http://localhost:8686` | backup.sh | Where the app is reachable |
| `BACKUP_DIR` | `~/tracker-backups` | backup.sh | Where backups are saved |
| `KEEP` | `14` | backup.sh | How many backups to keep |

Docker Compose reads `.env` in the repo folder (copy `.env.example`). Timezone, day start hour, week start and theme chosen in Settings are stored in the database and override the env defaults.

## Project layout

```text
app/main.py           FastAPI app, static files, routers, migrations on startup
app/config.py         env settings, user settings and theme presets stored in the DB
app/db.py             SQLite engine (WAL), get_session()
app/models.py         Project, Tag, Session, SessionTag, Idea, Setting
app/schemas.py        JSON API models
app/services/         timers, stats, projects (+ ideas, demo seed), backup
app/routes/           pages.py (full pages), htmx.py (/ui/ fragments), api.py (/api/ JSON)
app/templates/        Jinja pages and partials
app/static/           app.css (themes), app.js, PWA files, icons, vendor/ libraries and fonts
migrations/           Alembic
scripts/install-pi.sh one-time Raspberry Pi setup
scripts/backup.sh     nightly backup with retention
tests/                pytest
```

JSON API docs are at `/docs` while the app runs (that page loads Swagger UI from a CDN; the app's own pages load nothing from the internet).
