# Single stage, no Node: templates and vendored JS ship as plain files.
# No platform pin: builds natively on x86_64 (laptop), arm64 (Pi 3/4/5 on
# 64-bit Raspberry Pi OS) and armv7 (Pi 3 on 32-bit Raspberry Pi OS).
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /srv
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY alembic.ini .
COPY migrations/ ./migrations/
COPY app/ ./app/

# Run as an unprivileged user. docker-compose.yml overrides the uid/gid with
# PUID/PGID so files in ./data belong to the host user.
RUN useradd --uid 1000 --user-group --no-create-home --shell /usr/sbin/nologin app \
 && mkdir -p /data && chown app:app /data
USER app

ENV DATABASE_PATH=/data/tracker.db TZ=Asia/Tokyo
VOLUME /data
EXPOSE 8686
HEALTHCHECK --interval=60s --timeout=10s --start-period=60s --retries=3 \
  CMD python -c "import urllib.request;urllib.request.urlopen('http://localhost:8686/api/health')"

# One worker: SQLite has one writer, and a Pi 3 has 1 GB of RAM.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8686", "--workers", "1", "--no-access-log", "--timeout-graceful-shutdown", "10"]
