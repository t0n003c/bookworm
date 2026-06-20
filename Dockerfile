# ── BookWorm Dockerfile ─────────────────────────────────────────────────────
# Single-stage build — no compiled assets; Tailwind CSS is pre-built and
# committed to the repo, so no Node.js layer is needed.
FROM python:3.13-slim-bookworm

# Sane Python defaults for containers:
#   PYTHONDONTWRITEBYTECODE — skip .pyc files (saves ~10 MB, irrelevant in containers)
#   PYTHONUNBUFFERED        — stdout/stderr go straight to Docker logs, no buffering
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    BW_DATA_DIR=/data

WORKDIR /app

# Install dependencies first — Docker caches this layer as long as
# requirements.txt hasn't changed, even if source files have.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source.
# .dockerignore strips: *.db, uploads/, *.log, *.secret, .git/, dev scripts,
# Windows batch files, and Tailwind CLI binary.
COPY . .

# /data is the volume mount point for all persistent state:
#   /data/bookworm.db      — SQLite database
#   /data/bookworm.secret  — auto-generated session key (or override via BW_SECRET_KEY)
#   /data/uploads/         — user-uploaded attachments
#
# Create the directory and a non-root user in one RUN layer to keep
# the image lean.  The bookworm user owns /data so it can write the
# DB and uploads without running as root.
#
# UID/GID are PINNED to 100:101. adduser --system would otherwise auto-assign
# them, and the value can drift between base-image rebuilds — which silently
# breaks bind-mount deployments (the host /data folder stays owned by the old
# uid, so the new container can't access it). Pinning keeps a chowned bind mount
# valid across rebuilds forever. 100/101 are the values --system picks on the
# current python:3.13-slim base (gid 100 is taken by Debian's "users" group, so
# the group lands on 101). If a future base ever occupies these, the build fails
# loudly here — far preferable to a silent runtime lockout.
RUN mkdir -p /data/uploads \
    && addgroup --system --gid 101 bookworm \
    && adduser --system --uid 100 --ingroup bookworm --no-create-home bookworm \
    && chown -R bookworm:bookworm /data /app

USER bookworm

EXPOSE 8001

# WORKERS: SQLite + WAL safely handles a small number of concurrent writers.
# 1 worker is correct for most self-hosted team deployments (< ~50 users).
# Raise to 2–4 via the WORKERS env var for more throughput, but stay ≤ 4
# with SQLite — beyond that, write contention outweighs the gains.
# Migrate to PostgreSQL for larger teams.
#
# exec replaces the shell so uvicorn is PID 1 and receives SIGTERM directly
# (clean shutdown, no zombie processes).
CMD exec uvicorn main:app \
      --host 0.0.0.0 \
      --port 8001 \
      --workers ${WORKERS:-1}
