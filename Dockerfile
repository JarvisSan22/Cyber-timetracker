# Single stage, no Node: templates and vendored JS ship as plain files.
# No platform pin: builds natively on x86_64 (laptop) and arm64 (Raspberry Pi).
FROM python:3.13-slim
WORKDIR /srv
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY alembic.ini .
COPY migrations/ ./migrations/
COPY app/ ./app/
ENV DATABASE_PATH=/data/tracker.db TZ=Asia/Tokyo
VOLUME /data
EXPOSE 8686
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request;urllib.request.urlopen('http://localhost:8686/api/health')"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8686"]
