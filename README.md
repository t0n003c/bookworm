# 📚 BookWorm

**A lightweight, self-hosted team note-taking app.**  
Markdown · Timeline · Reminders · CRM · Attachments · PWA · Dark mode — runs wherever Docker runs.

> Built with FastAPI + HTMX + Tailwind CSS + SQLite. No cloud required, no subscription, no nonsense.

---

## ✨ Features

| Category | What you get |
|---|---|
| **Notes** | Rich Markdown editor with slash commands (`/`), live preview, and inline formatting |
| **Timeline** | Horizontal swimlane view — pan, zoom, and drag notes across dates |
| **Workspaces** | Nested folders with emoji icons; shared workspaces across team members |
| **Categories & Attributes** | Tag notes with custom categories and typed attributes (text, date, select…) |
| **Reminders** | Due-date reminders with badge counter in the sidebar |
| **Attachments** | Upload images, PDFs, videos, and Word docs per note |
| **Home Pages** | Personal dashboards: RSS reader, CRM board, subscription tracker, trip planner, budget/settle-up |
| **Collabora Online** | Edit `.docx` / `.xlsx` files in-browser via LibreOffice (optional Docker service) |
| **Sharing** | Generate read-only share links for individual notes or workspaces |
| **2FA / TOTP** | Optional two-factor authentication per account |
| **Demo mode** | One-click sandboxed demo sessions (auto-cleaned up after expiry) |
| **PWA** | Installable on mobile and desktop — works offline for cached pages |
| **Dark mode** | System-preference aware; toggle in settings |
| **Keyboard shortcuts** | Full keyboard navigation (`T` for today, `?` for help, `Ctrl+B/I/K`, …) |

---

## 🚀 Quick Start

**Prerequisites:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or Docker Engine + Compose plugin on Linux).

```bash
# 1. Clone the repo
git clone https://github.com/YOUR_USERNAME/bookworm.git
cd bookworm

# 2. Start (builds the image on first run, ~60 seconds)
docker compose up -d

# 3. Open in your browser
open http://localhost:8001          # macOS
start http://localhost:8001         # Windows
xdg-open http://localhost:8001      # Linux
```

**That's it.** BookWorm auto-creates the database and a secure session key on first boot.  
Register the first account — it automatically becomes the superadmin.

> **Zero-config works great for local use.** For production deployments (team server, public URL),
> see [Configuration](#%EF%B8%8F-configuration) below.

---

## 📦 What gets persisted

Everything lives in a single Docker named volume (`bookworm_data`) mounted at `/data`:

| Path inside container | Contents |
|---|---|
| `/data/bookworm.db` | All notes, workspaces, categories, users |
| `/data/uploads/` | Attached images, PDFs, documents |
| `/data/bookworm.secret` | Auto-generated session key (persists across restarts) |

The SQLite database is a single portable file — easy to inspect, back up, or migrate.

---

## ⚙️ Configuration

Copy `.env.example` to `.env` and customise as needed.  
`docker compose` loads `.env` automatically.

```bash
cp .env.example .env
# Edit .env with your preferred editor
```

### Key environment variables

| Variable | Default | Description |
|---|---|---|
| `BW_SECRET_KEY` | *(auto-generated)* | Session signing key. Set a fixed value in production so sessions survive volume changes. Generate: `python -c "import secrets; print(secrets.token_hex(32))"` |
| `BW_HTTPS` | `false` | Set `true` when behind a TLS proxy. Enables `Secure` flag on cookies. |
| `BW_TRUST_PROXY` | `false` | Set `true` when behind nginx / Caddy / Traefik / Cloudflare Tunnel. Reads `X-Forwarded-*` headers. |
| `BW_ALLOW_REGISTRATION` | `true` | Set `false` to make registration invite-only (superadmin creates accounts manually). |
| `BW_DEMO_ENABLED` | `true` | Set `false` to hide the Try Demo button. |
| `BW_MAX_UPLOAD_MB` | `200` | Max file size per upload in MB. |
| `WORKERS` | `1` | Uvicorn worker count. Safe up to ~4 with SQLite; migrate to PostgreSQL for more. |
| `BW_HTTP_PROXY` | *(empty)* | Outbound HTTP/HTTPS proxy for RSS, weather, image proxy and link previews. Format: `http://proxy.example.com:8080`. Leave empty for direct internet access. |
| `BW_COLLABORA_URL` | *(empty)* | Browser-facing URL of Collabora Online. Leave empty to disable document editing. |
| `BW_WOPI_BASE_URL` | *(empty)* | Server-to-server URL for Collabora → BookWorm WOPI calls. Required when `BW_COLLABORA_URL` is set. |

See `.env.example` for the full reference with examples.

---

## 🔄 Updating

```bash
git pull                          # get the latest source
docker compose up -d --build      # rebuild the image and restart
```

Your data volume is untouched — all notes survive updates.

---

## 💾 Backing up

The `docker-compose.yml` pins `name: bookworm` so the data volume is always
named `bookworm_bookworm_data` regardless of which folder you cloned into.

```bash
# Full backup (database + uploads) as a tar.gz
docker run --rm \
  -v bookworm_bookworm_data:/data \
  -v "$(pwd)":/backup \
  alpine tar czf /backup/bookworm-backup.tar.gz /data
```

On **Windows PowerShell**:
```powershell
docker run --rm `
  -v bookworm_bookworm_data:/data `
  -v "${PWD}:/backup" `
  alpine tar czf /backup/bookworm-backup.tar.gz /data
```

**Restore:**
```bash
docker run --rm \
  -v bookworm_bookworm_data:/data \
  -v "$(pwd)":/backup \
  alpine tar xzf /backup/bookworm-backup.tar.gz -C /
```

> **Tip:** verify the volume name on your machine with `docker volume ls | grep bookworm`.

---

## 🌐 Network access

### Same network (LAN)

Find your machine's local IP and open `http://<your-ip>:8001` from any device on the same Wi-Fi.

```bash
# Find your IP
ipconfig   # Windows — look for "IPv4 Address"
ifconfig   # macOS / Linux
```

If it doesn't connect, allow inbound TCP on port 8001 in your OS firewall.

### Public access via Cloudflare Tunnel + Nginx Proxy Manager (recommended for home servers)

This is the sweet spot for a local Docker deployment: Cloudflare Tunnel handles the secure
inbound connection (no port-forwarding, no exposed ports), and Nginx Proxy Manager (NPM) routes
traffic to BookWorm and any other services you run.

```
Internet → Cloudflare → cloudflared → NPM (port 80/443) → BookWorm (port 8001)
```

**Step 1 — Add BookWorm to NPM's Docker network**

NPM and BookWorm need to be on the same Docker network so NPM can reach BookWorm by
service name. In your `docker-compose.yml`, add an `external` network that matches
NPM's network (typically named `npm_default` or `nginx-proxy-manager_default` — check
with `docker network ls`):

```yaml
# Add to the bookworm service:
services:
  bookworm:
    # ... existing config ...
    networks:
      - default        # BookWorm's own compose network
      - npm_network    # shared with NPM

networks:
  npm_network:
    external: true
    name: nginx-proxy-manager_default   # ← match your actual NPM network name
```

Then `docker compose up -d` to reconnect BookWorm to the shared network.

**Step 2 — Add a Proxy Host in NPM**

In the NPM web UI (`http://<your-server-ip>:81`):

| Field | Value |
|---|---|
| Domain Name | `notes.yourdomain.com` |
| Scheme | `http` |
| Forward Hostname / IP | `bookworm` (Docker service name) or your server's LAN IP |
| Forward Port | `8001` |
| Cache Assets | off |
| Block Common Exploits | on |

Under **SSL** tab: Request a Let's Encrypt certificate, enable **Force SSL** and **HTTP/2**.

Under **Advanced** tab, add these custom headers so BookWorm gets the real client IP, knows it's on HTTPS, **and so that AI streaming (SSE) works correctly** — without `proxy_buffering off` nginx queues every token from the LLM and the browser sees nothing until the entire response finishes:

```nginx
# Required headers
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header Host              $host;

# SSE / AI streaming — disables NPM's response buffer so tokens
# arrive in real-time instead of all at once at the end.
proxy_buffering           off;
proxy_http_version        1.1;
proxy_set_header          Connection '';
proxy_read_timeout        300s;
```

**Step 3 — Point Cloudflare Tunnel at NPM**

In the [Cloudflare Zero Trust dashboard](https://one.dash.cloudflare.com/) → Networks → Tunnels:
- Create a tunnel (or use an existing one)
- Add a **Public Hostname**:
  - Subdomain: `notes` | Domain: `yourdomain.com`
  - Service: `http://localhost:80` (or `http://<server-ip>:80` if cloudflared runs elsewhere)

Cloudflare terminates HTTPS externally; traffic from Cloudflare to NPM is plain HTTP on your LAN,
which is fine — it never leaves your server.

**Step 4 — Update BookWorm's `.env`**

```env
BW_HTTPS=true
BW_TRUST_PROXY=true
BW_SECRET_KEY=<run: python -c "import secrets; print(secrets.token_hex(32))">
```

Then restart: `docker compose up -d`

> **Why both flags?**  
> `BW_HTTPS=true` → session cookies get the `Secure` flag (required for HTTPS).  \W_TRUST_PROXY=true` → BookWorm reads NPM's `X-Forwarded-Proto: https` header so it
> knows the connection is actually HTTPS (NPM → BookWorm is plain HTTP internally).  
> Without both, logins will break — sessions won't persist over HTTPS.

**Step 5 — Visit your domain and install the PWA**

Open `https://notes.yourdomain.com` on your Pixel. Within a few seconds the
**"Install BookWorm"** banner will slide up from the bottom. Tap **Install app** and it'll
land on your home screen like a native app 🎉

### Public access via Cloudflare Tunnel (free, no open ports)

```bash
# 1. Install cloudflared
#    https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

# 2. Authenticate and create a tunnel
cloudflared tunnel login
cloudflared tunnel create bookworm
cloudflared tunnel route dns bookworm your.domain.com

# 3. Set in .env:
#      BW_HTTPS=true
#      BW_TRUST_PROXY=true
#      BW_SECRET_KEY=<long random string>

# 4. Run the tunnel
cloudflared tunnel run --url http://localhost:8001 bookworm
```

### Reverse proxy (nginx / Caddy / Traefik)

<a name="https--pwa"></a>

> **HTTPS is required for PWA installation.**  
> Browsers only allow the "Install app" prompt over a secure connection (HTTPS).  
> `localhost` is the only exception — any other host over plain HTTP will silently skip the prompt.

Set `BW_HTTPS=true` and `BW_TRUST_PROXY=true` in `.env`, then point your proxy at `localhost:8001`.

**Option A — Caddy (easiest, auto-HTTPS via Let’s Encrypt)**

A `Caddyfile` is included in the repo. To enable it:

1. Add your domain to `.env`:
   ```
   CADDY_DOMAIN=notes.example.com
   BW_HTTPS=true
   BW_TRUST_PROXY=true
   ```
2. Uncomment the `caddy` service and the two `caddy_*` volumes in `docker-compose.yml`.
3. `docker compose up -d`

Caddy will auto-issue a free TLS certificate and renew it. The install banner on mobile will then offer to add BookWorm to the home screen.

**Option B — Cloudflare Tunnel (local network, no public IP needed)**

See the [Cloudflare Tunnel](#-network-access) section above — this gives you a real HTTPS subdomain with no port-forwarding or certificates to manage.

**Option C — nginx / Traefik**

```nginx
server {
    listen 443 ssl;
    server_name notes.example.com;
    # ... ssl_certificate / ssl_certificate_key ...
    location / {
        proxy_pass             http://localhost:8001;
        proxy_set_header       Host              $host;
        proxy_set_header       X-Forwarded-Proto https;
        proxy_set_header       X-Real-IP         $remote_addr;

        # SSE / AI streaming — without these, nginx buffers every LLM
        # token and the browser sees nothing until the response ends.
        proxy_buffering        off;
        proxy_http_version     1.1;
        proxy_set_header       Connection '';
        proxy_read_timeout     300s;
    }
}
```

---

## 🐋 Pre-built image (no local build)

If you'd rather pull a pre-built image from GitHub Container Registry instead of building locally
(useful on low-CPU servers like Raspberry Pi):

```bash
# In docker-compose.yml, replace `build: .` with:
#   image: ghcr.io/YOUR_USERNAME/bookworm:latest
docker compose up -d
```

Images are built automatically via GitHub Actions on every push to `main`.

---

## 🛠️ Local development (without Docker)

**Prerequisites:** Python 3.13+

```bash
# Create a virtual environment
python -m venv .venv
source .venv/bin/activate      # macOS / Linux
.venv\Scripts\activate         # Windows

# Install dependencies
pip install -r requirements.txt

# Run with hot reload
uvicorn main:app --reload --port 8001
```

App starts at `http://localhost:8001`.  
The database is created automatically at `./bookworm.db` on first run.

**Rebuild Tailwind CSS** (after editing templates):
```bash
# Windows
rebuild_css.bat

# macOS / Linux — download the Tailwind CLI binary first:
# https://github.com/tailwindlabs/tailwindcss/releases
./tailwindcss -c tailwind.config.js -i static/css/input.css -o static/css/tailwind.css --minify
```

---

## 🏗️ Tech stack

| Layer | Technology |
|---|---|
| Backend | [FastAPI](https://fastapi.tiangolo.com/) + [uvicorn](https://www.uvicorn.org/) |
| Templates | [Jinja2](https://jinja.palletsprojects.com/) + [HTMX](https://htmx.org/) |
| Styling | [Tailwind CSS](https://tailwindcss.com/) (pre-built; no Node.js required) |
| Database | [SQLite](https://sqlite.org/) via [aiosqlite](https://github.com/omnilib/aiosqlite) |
| Auth | bcrypt + itsdangerous sessions + TOTP 2FA |
| Container | [Docker](https://docker.com/) + Docker Compose |

---

## 📁 Project structure

```
bookworm/
├── main.py                  # FastAPI app, middleware, root routes
├── database.py              # DB init, schema, connection management
├── auth_middleware.py       # Session auth + redirect logic
├── security.py              # Secret key management, session expiry
├── models.py                # Pydantic models
├── templates_env.py         # Shared Jinja2 environment + custom filters
├── routers/                 # Feature routers
│   ├── auth.py              # Login / register / logout
│   ├── notes.py             # Note CRUD
│   ├── workspaces.py        # Workspace management
│   ├── home_*.py            # Home page feature modules
│   ├── sharing.py           # Share link generation & serving
│   ├── wopi.py              # Collabora Online WOPI protocol
│   └── demo.py              # Sandboxed demo sessions
├── templates/               # Jinja2 HTML templates
│   └── partials/            # HTMX partial templates
├── static/
│   ├── css/tailwind.css     # Pre-built Tailwind output (committed)
│   └── js/                  # Timeline, editor, slash commands, etc.
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── requirements.txt
```

---

## ⌨️ Keyboard shortcuts

| Key | Action |
|---|---|
| `T` | Jump to today on the timeline |
| `?` | Open keyboard shortcuts panel |
| `Escape` | Close any modal or panel |
| `Ctrl + Enter` | Save note |
| `Ctrl + B` | Bold |
| `Ctrl + I` | Italic |
| `Ctrl + K` | Insert / edit link |
| `/` | Open slash command palette |

---

## 📄 License

[MIT](LICENSE) — do whatever you want with it.
