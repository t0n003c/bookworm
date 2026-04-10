# ── BookWorm Dockerfile ─────────────────────────────────────────────────────
# Single stage — pure Python, no compiled assets. (YAGNI on multi-stage.)
FROM python:3.12-slim

WORKDIR /app

# Install dependencies first so Docker layer cache skips this on code-only changes.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source (DB, logs, uploads, and secrets are gitignored + dockerignored).
COPY . .

# /data is the volume mount point for persistent state:
#   /data/bookworm.db     — SQLite database
#   /data/bookworm.secret — auto-generated secret key (overridden by BW_SECRET_KEY)
#   /data/uploads/        — user-uploaded attachments
RUN mkdir -p /data/uploads

EXPOSE 8001

# WORKERS: SQLite with WAL mode safely supports a small number of concurrent
# writers. For a small team (< ~50 concurrent users), 1 worker is fine.
# Raise to 2–4 via the WORKERS environment variable for more throughput,
# but avoid going above 4 with SQLite (lock contention outweighs the gains;
# migrate to PostgreSQL if you need more).
#
# Do NOT use --reload in production.
CMD uvicorn main:app \
      --host 0.0.0.0 \
      --port 8001 \
      --workers ${WORKERS:-1}
