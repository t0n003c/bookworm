# ── BookWorm Dockerfile ─────────────────────────────────────
# Multi-stage would be overkill here — it's a pure-Python app
# with no compiled assets. Single stage keeps it simple (YAGNI).
FROM python:3.12-slim

WORKDIR /app

# Install dependencies first so this layer is cached
# and only rebuilds when requirements.txt changes.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source (DB, logs, uploads are gitignored and dockerignored
# so they never end up in the image)
COPY . .

# /data is the volume mount point for persistent data:
#   /data/bookworm.db   — SQLite database
#   /data/uploads/      — user-uploaded attachments
# Creating it here so the directory exists even without a volume.
RUN mkdir -p /data/uploads

EXPOSE 8001

# Do NOT use --reload in production — it watches the filesystem
# and adds unnecessary overhead inside a container.
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]