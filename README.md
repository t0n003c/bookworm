# 📚 BookWorm

A lightweight, self-hosted team note-taking app.  
Markdown editor · Timeline view · Categories · Attachments · Dark mode · No accounts required.

> Built with FastAPI + HTMX + Tailwind CSS + SQLite — runs anywhere Docker runs.

---

## 🚀 Quick Start (Docker — recommended)

**Prerequisites:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running.

```bash
# 1. Clone the repo
git clone https://github.com/YOUR_USERNAME/bookworm.git
cd bookworm

# 2. Start the app (builds the image on first run)
docker compose up -d

# 3. Open in your browser
open http://localhost:8001          # macOS
start http://localhost:8001         # Windows
```

That's it. Your notes are stored in a Docker named volume — they survive container restarts and updates.

---

## 📦 What gets persisted

All data lives in a single Docker volume (`bookworm_data`) mounted at `/data` inside the container:

| Path inside container | What it stores |
|---|---|
| `/data/bookworm.db` | All notes, workspaces, categories |
| `/data/uploads/` | Attached files |

The SQLite database is a single file — easy to back up, copy, or inspect.

---

## 🔄 Updating to a new version

```bash
git pull                    # get the latest source
docker compose up -d --build  # rebuild image, restart container
```

Your data volume is untouched — notes survive updates.

---

## 💾 Backing up your data

```bash
# Copy the database out of the volume to your current directory
docker run --rm \n  -v bookworm_bookworm_data:/data \n  -v "$(pwd)":/backup \n  alpine cp /data/bookworm.db /backup/bookworm_backup.db
```

On **Windows** (PowerShell):
```powershell
docker run --rm `
  -v bookworm_bookworm_data:/data `
  -v "${PWD}":/backup `
  alpine cp /data/bookworm.db /backup/bookworm_backup.db
```

---

## 🌐 Accessing from another device on the same network

Find your machine's local IP (e.g. `192.168.1.42`) and open:
```
http://192.168.1.42:8001
```
If it doesn't connect, check that your OS firewall allows inbound TCP on port 8001.

---

## 🛠️ Local development (without Docker)

**Prerequisites:** Python 3.11+, [uv](https://github.com/astral-sh/uv) (recommended) or pip.

```bash
# Create and activate a virtual environment
python -m venv .venv
source .venv/bin/activate      # macOS / Linux
.venv\Scripts\activate         # Windows

# Install dependencies
pip install -r requirements.txt

# Run with hot reload
python main.py
```

App starts at `http://localhost:8001`.  
The database is created automatically at `./bookworm.db` on first run.

---

## 🏗️ Tech stack

| Layer | Technology |
|---|---|
| Backend | [FastAPI](https://fastapi.tiangolo.com/) + [uvicorn](https://www.uvicorn.org/) |
| Templates | [Jinja2](https://jinja.palletsprojects.com/) + [HTMX](https://htmx.org/) |
| Styling | [Tailwind CSS](https://tailwindcss.com/) (pre-built via standalone CLI) |
| Database | [SQLite](https://sqlite.org/) via [aiosqlite](https://github.com/omnilib/aiosqlite) |
| Container | [Docker](https://docker.com/) + Docker Compose |

---

## 📁 Project structure

```
bookworm/
├── main.py               # FastAPI app + routes
├── database.py           # DB init + connection pool
├── models.py             # Pydantic models
├── templates_env.py      # Shared Jinja2 environment
├── routers/              # Feature routers (notes, workspaces, …)
├── templates/            # Jinja2 HTML templates
│   └── partials/         # HTMX partial templates
├── static/
│   ├── css/
│   └── js/               # Timeline, editor, slash commands
├── Dockerfile
├── docker-compose.yml
└── requirements.txt
```

---

## ⌨️ Keyboard shortcuts

| Key | Action |
|---|---|
| `T` | Jump to today on timeline + hop the worm 🐛 |
| `?` | Open keyboard shortcuts panel |
| `Escape` | Close any modal |
| `Ctrl + Enter` | Save note |
| `Ctrl + B` | Bold |
| `Ctrl + I` | Italic |
| `Ctrl + K` | Insert / edit link |
| `/` | Open slash command palette |

---

## 📄 License

MIT — do whatever you want with it.