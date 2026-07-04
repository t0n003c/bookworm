"""Account management — change credentials + superadmin user management."""
from fastapi import APIRouter, Form, Request
from fastapi.responses import HTMLResponse

from app.api.attachments_db import UPLOAD_DIR
from app.api.auth_db import (
    authenticate,
    create_user,
    delete_user,
    get_all_users,
    get_user_by_username,
    get_registration_open,
    set_registration_open,
    set_site_setting,
    get_unlimited_uploads,
    set_unlimited_uploads,
    update_username,
    update_password,
    get_user_llm_settings,
    set_user_llm_settings,
)
from app.api.turnstile import get_turnstile_config
from templates_env import templates
from app.api.seed_uploads import seed_flower_uploads
from security import encrypt_secret

router = APIRouter(prefix="/account")

_OK  = "<span class='text-green-600 text-xs font-medium'>{}</span>"
_ERR = "<span class='text-red-600  text-xs font-medium'>{}</span>"


def _is_superadmin(request: Request) -> bool:
    return request.session.get("role") == "superadmin"


async def _admin_ctx(request: Request, **extra) -> dict:
    """Shared context dict for admin_users.html — one place to add new keys."""
    me = request.session.get("user_id")
    ctx = {
        "users":             await get_all_users(),
        "me":                me,
        "registration_open": await get_registration_open(),
        "unlimited_uploads": await get_unlimited_uploads(me),
        "turnstile":         await get_turnstile_config(),
    }
    ctx.update(extra)
    return ctx


# ── change username ───────────────────────────────────────────

@router.post("/change-username", response_class=HTMLResponse)
async def change_username(
    request: Request,
    current_password: str = Form(...),
    new_username:     str = Form(...),
):
    uid      = request.session.get("user_id")
    cur_user = request.session.get("username", "")
    new_username = new_username.strip()

    user = await authenticate(cur_user, current_password)
    if not user:
        return HTMLResponse(_ERR.format("Current password is incorrect."))
    if not new_username:
        return HTMLResponse(_ERR.format("Username cannot be empty."))
    existing = await get_user_by_username(new_username)
    if existing and existing["id"] != uid:
        return HTMLResponse(_ERR.format("That username is already taken."))

    await update_username(uid, new_username)
    request.session["username"] = new_username
    return HTMLResponse(_OK.format(f'Username updated to "{new_username}".'))


# ── change password ───────────────────────────────────────────

@router.post("/change-password", response_class=HTMLResponse)
async def change_password(
    request: Request,
    current_password: str = Form(...),
    new_password:     str = Form(...),
    confirm_password: str = Form(...),
):
    cur_user = request.session.get("username", "")

    user = await authenticate(cur_user, current_password)
    if not user:
        return HTMLResponse(_ERR.format("Current password is incorrect."))
    if len(new_password) < 6:
        return HTMLResponse(_ERR.format("New password must be at least 6 characters."))
    if new_password != confirm_password:
        return HTMLResponse(_ERR.format("New passwords do not match."))

    await update_password(user["id"], new_password)
    return HTMLResponse(_OK.format("Password updated successfully."))


# ── admin: list users (HTMX partial) ─────────────────────────

@router.get("/users", response_class=HTMLResponse)
async def list_users(request: Request):
    """Return the admin user-list partial (superadmin only)."""
    if not _is_superadmin(request):
        return HTMLResponse("", status_code=403)
    return templates.TemplateResponse(
        request, "partials/admin_users.html", await _admin_ctx(request)
    )


# ── admin: toggle registration ───────────────────────────────────

@router.post("/settings/registration", response_class=HTMLResponse)
async def toggle_registration(
    request: Request,
    enabled: str = Form(default=""),
):
    """Superadmin-only: persist registration open/closed state to site_settings."""
    if not _is_superadmin(request):
        return HTMLResponse("", status_code=403)
    new_value = enabled.strip().lower() == "on"
    await set_registration_open(new_value)
    label = "open" if new_value else "closed"
    return templates.TemplateResponse(
        request, "partials/admin_users.html",
        await _admin_ctx(request,
            registration_open=new_value,
            success=f"Public registration is now {label}."),
    )


# ── admin: toggle unlimited uploads ───────────────────────────────

@router.post("/settings/unlimited-uploads", response_class=HTMLResponse)
async def toggle_unlimited_uploads(
    request: Request,
    enabled: str = Form(default=""),
):
    """Superadmin-only: lift (or restore) the per-file upload size cap."""
    if not _is_superadmin(request):
        return HTMLResponse("", status_code=403)
    new_value = enabled.strip().lower() == "on"
    me    = request.session.get("user_id")
    await set_unlimited_uploads(me, new_value)
    label = "enabled" if new_value else "disabled"
    return templates.TemplateResponse(
        request, "partials/admin_users.html",
        await _admin_ctx(request,
            unlimited_uploads=new_value,
            success=f"Unlimited file uploads {label} for your account."),
    )


# ── admin: bot challenge / Turnstile settings ──────────────────────────

@router.post("/settings/turnstile", response_class=HTMLResponse)
async def save_turnstile_settings(
    request: Request,
    enabled: str = Form(default=""),
    site_key: str = Form(default=""),
    secret_key: str = Form(default=""),
    clear_secret: str = Form(default=""),
    protect_login: str = Form(default=""),
    protect_register: str = Form(default=""),
    protect_demo: str = Form(default=""),
):
    """Superadmin-only: persist Cloudflare Turnstile bot challenge settings."""
    if not _is_superadmin(request):
        return HTMLResponse("", status_code=403)

    await set_site_setting("turnstile_enabled", "true" if enabled == "on" else "false")
    await set_site_setting("turnstile_site_key", site_key.strip())
    if clear_secret == "on":
        await set_site_setting("turnstile_secret_key", "")
    elif secret_key.strip():
        await set_site_setting("turnstile_secret_key", encrypt_secret(secret_key.strip()))
    await set_site_setting("turnstile_login_enabled", "true" if protect_login == "on" else "false")
    await set_site_setting("turnstile_register_enabled", "true" if protect_register == "on" else "false")
    await set_site_setting("turnstile_demo_enabled", "true" if protect_demo == "on" else "false")

    cfg = await get_turnstile_config()
    if cfg["enabled"] and not cfg["configured"]:
        success = "Bot challenge saved, but it will not run until both keys are set."
    else:
        success = "Bot challenge settings saved."

    return templates.TemplateResponse(
        request, "partials/admin_users.html",
        await _admin_ctx(request, success=success),
    )


# ── admin: create user ────────────────────────────────────────

@router.post("/users/create", response_class=HTMLResponse)
async def create_user_handler(
    request: Request,
    new_username: str = Form(...),
    new_password: str = Form(...),
    confirm:      str = Form(...),
):
    if not _is_superadmin(request):
        return HTMLResponse(_ERR.format("Forbidden."), status_code=403)

    new_username = new_username.strip()
    if not new_username:
        return HTMLResponse(_ERR.format("Username cannot be empty."))
    if len(new_password) < 6:
        return HTMLResponse(_ERR.format("Password must be at least 6 characters."))
    if new_password != confirm:
        return HTMLResponse(_ERR.format("Passwords do not match."))
    existing = await get_user_by_username(new_username)
    if existing:
        return HTMLResponse(_ERR.format("Username already taken."))

    new_uid = await create_user(new_username, new_password, role="user")
    await seed_flower_uploads(new_uid)
    return templates.TemplateResponse(
        request, "partials/admin_users.html",
        await _admin_ctx(request, success=f'User "{new_username}" created.'),
    )


def _purge_files(filenames: list[str]) -> None:
    """Silently unlink attachment files from disk."""
    for name in filenames:
        try:
            (UPLOAD_DIR / name).unlink(missing_ok=True)
        except OSError:
            pass


# ── admin: delete user ────────────────────────────────────

@router.post("/users/{target_id}/delete", response_class=HTMLResponse)
async def delete_user_handler(request: Request, target_id: int):
    if not _is_superadmin(request):
        return HTMLResponse(_ERR.format("Forbidden."), status_code=403)
    me = request.session.get("user_id")
    if target_id == me:
        return HTMLResponse(_ERR.format("You cannot delete your own account."))

    all_users = await get_all_users()
    target_user = next((u for u in all_users if u["id"] == target_id), None)
    if not target_user:
        return HTMLResponse(_ERR.format("User not found."))
    if target_user["role"] == "superadmin":
        return HTMLResponse(_ERR.format("Cannot delete another superadmin."))

    filenames = await delete_user(target_id)
    _purge_files(filenames)
    tname = target_user["username"]
    return templates.TemplateResponse(
        request, "partials/admin_users.html",
        await _admin_ctx(request,
            success=f'User "{tname}" and all their data deleted.'),
    )


# ── admin: bulk-delete all demo users ────────────────────────

@router.post("/users/delete-all-demo", response_class=HTMLResponse)
async def delete_all_demo_handler(request: Request):
    """Hard-delete every user whose role == 'demo' in one shot."""
    if not _is_superadmin(request):
        return HTMLResponse(_ERR.format("Forbidden."), status_code=403)
    me = request.session.get("user_id")

    all_users = await get_all_users()
    demo_users = [u for u in all_users if u["role"] == "demo"]
    if not demo_users:
        return templates.TemplateResponse(
            request, "partials/admin_users.html",
            await _admin_ctx(request, success="No demo users to delete."),
        )

    all_filenames: list[str] = []
    for u in demo_users:
        all_filenames += await delete_user(u["id"])
    _purge_files(all_filenames)
    return templates.TemplateResponse(
        request, "partials/admin_users.html",
        await _admin_ctx(request,
            success=f"{len(demo_users)} demo user(s) and all their data deleted."),
    )


# ── admin: reset another user’s password ────────────────────────

@router.post("/users/{target_id}/reset-password", response_class=HTMLResponse)
async def reset_user_password(
    request: Request,
    target_id: int,
    new_password: str = Form(...),
    confirm_password: str = Form(...),
):
    if not _is_superadmin(request):
        return HTMLResponse(_ERR.format("Forbidden."), status_code=403)

    all_users = await get_all_users()
    target_user = next((u for u in all_users if u["id"] == target_id), None)
    if not target_user:
        return HTMLResponse(_ERR.format("User not found."))
    if target_user["role"] == "superadmin" and target_user["id"] != request.session.get("user_id"):
        return HTMLResponse(_ERR.format("Cannot reset another superadmin\'s password."))
    if len(new_password) < 6:
        return HTMLResponse(_ERR.format("Password must be at least 6 characters."))
    if new_password != confirm_password:
        return HTMLResponse(_ERR.format("Passwords do not match."))

    await update_password(target_id, new_password)
    tname = target_user["username"]
    return templates.TemplateResponse(
        request, "partials/admin_users.html",
        await _admin_ctx(request, success=f'Password reset for "{tname}".'),
    )


# ── per-user AI settings (Phase 4B) ──────────────────────────────

@router.get("/ai-settings", response_class=HTMLResponse)
async def get_user_ai_settings(request: Request):
    """Return the Account modal AI-settings form for the current user.

    API key is never returned to the browser — only has_key: bool.
    """
    uid = request.session.get("user_id")
    if not uid:
        return HTMLResponse("", status_code=401)
    cfg = await get_user_llm_settings(uid)
    has_key   = bool(cfg["api_key"])
    endpoint  = cfg["endpoint"]
    model     = cfg["model"]
    checked   = "checked" if has_key else ""
    key_ph    = "\u2022" * 8 + " (saved)" if has_key else "Paste API key…"
    return HTMLResponse(f"""
<form id="acct-ai-form" hx-post="/account/ai-settings" hx-target="#acct-ai-msg"
      hx-swap="innerHTML" class="space-y-3">

  <div class="flex flex-col gap-1">
    <label class="text-xs font-medium text-gray-500 dark:text-zinc-400">Provider</label>
    <select id="acct-ai-provider" onchange="_acctProviderChange()"
            class="w-full border-b border-gray-300 dark:border-zinc-600 bg-transparent
                   py-1 text-sm focus:outline-none focus:border-blue-500">
      <option value="custom">Custom…</option>
      <option value="https://api.openai.com/v1">OpenAI</option>
      <option value="https://api.anthropic.com/v1">Anthropic</option>
      <option value="https://openrouter.ai/api/v1">OpenRouter</option>
      <option value="https://api.groq.com/openai/v1">Groq</option>
      <option value="https://api.together.xyz/v1">Together AI</option>
      <option value="https://api.mistral.ai/v1">Mistral</option>
      <option value="https://api.deepseek.com/v1">DeepSeek</option>
      <option value="https://api.perplexity.ai">Perplexity</option>
      <option value="https://generativelanguage.googleapis.com/v1beta/openai">Google Gemini</option>
      <option value="http://localhost:11434/v1">Ollama (local)</option>
      <option value="http://localhost:1234/v1">LM Studio (local)</option>
    </select>
    <p class="text-[11px] text-gray-400 dark:text-zinc-500">
      Pick a provider to fill the endpoint, or Custom to enter your own.
    </p>
  </div>

  <div class="flex flex-col gap-1">
    <label class="text-xs font-medium text-gray-500 dark:text-zinc-400">LLM Endpoint URL</label>
    <input name="ai_endpoint" type="url" value="{endpoint}"
           placeholder="https://api.openai.com/v1"
           class="w-full border-b border-gray-300 dark:border-zinc-600 bg-transparent
                  py-1 text-sm focus:outline-none focus:border-blue-500"
           id="acct-ai-endpoint" autocomplete="off">
  </div>

  <div class="flex flex-col gap-1">
    <label class="text-xs font-medium text-gray-500 dark:text-zinc-400">
      API Key <span class="font-normal text-gray-400">(leave blank to keep current)</span>
    </label>
    <input name="ai_api_key" type="password" placeholder="{key_ph}"
           class="w-full border-b border-gray-300 dark:border-zinc-600 bg-transparent
                  py-1 text-sm focus:outline-none focus:border-blue-500"
           autocomplete="new-password" id="acct-ai-key">
  </div>

  <div class="flex flex-col gap-1">
    <label class="text-xs font-medium text-gray-500 dark:text-zinc-400">Model</label>
    <div class="flex items-center gap-1.5">
      <input name="ai_model" type="text" value="{model}" list="bw-acct-model-list"
             placeholder="e.g. gpt-4o-mini"
             class="flex-1 border-b border-gray-300 dark:border-zinc-600 bg-transparent
                    py-1 text-sm focus:outline-none focus:border-blue-500"
             id="acct-ai-model" autocomplete="off">
      <button type="button" id="acct-ai-load-btn"
              title="Load available models from your endpoint"
              onclick="_acctLoadModels(false)"
              class="flex-shrink-0 px-2 py-1 text-xs rounded
                     border border-gray-300 dark:border-zinc-600
                     text-gray-500 dark:text-zinc-400
                     hover:bg-gray-100 dark:hover:bg-zinc-700 transition">
        🔄
      </button>
    </div>
    <datalist id="bw-acct-model-list"></datalist>
    <p id="acct-ai-model-status" class="text-xs text-gray-400 dark:text-zinc-500"></p>
  </div>

  <div class="flex items-center justify-between gap-2 pt-1">
    <span id="acct-ai-msg" class="text-xs"></span>
    <div class="flex gap-2">
      <button type="button" id="acct-ai-test-btn"
              onclick="_acctTestLlm()"
              class="px-3 py-1 text-xs rounded border border-gray-300 dark:border-zinc-600
                     text-gray-600 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-700 transition">
        Test
      </button>
      <button type="submit"
              class="px-3 py-1 text-xs rounded bg-[#0053e2] text-white
                     hover:bg-blue-700 transition">
        Save
      </button>
    </div>
  </div>
</form>
<script>(function(){{
  /* Guard against HTMX re-injection */
  if (window._acctAiWired) return;
  window._acctAiWired = true;

  function _acctLoadModels(silent) {{
    var ep  = (document.getElementById('acct-ai-endpoint') || {{}}).value || '';
    var st  = document.getElementById('acct-ai-model-status');
    var btn = document.getElementById('acct-ai-load-btn');
    if (!ep) {{
      if (!silent && st) st.textContent = '⚠ Enter an endpoint URL first.';
      return;
    }}
    if (st)  st.textContent = '⏳ Loading models…';
    if (btn) btn.disabled = true;
    fetch('/qa/models?endpoint=' + encodeURIComponent(ep))
      .then(function(r) {{ return r.json(); }})
      .then(function(d) {{
        var dl  = document.getElementById('bw-acct-model-list');
        var ml  = document.getElementById('acct-ai-model');
        if (dl) {{
          dl.innerHTML = '';
          (d.models || []).forEach(function(m) {{
            var opt = document.createElement('option');
            opt.value = m;
            dl.appendChild(opt);
          }});
        }}
        if (st) {{
          if (d.error)            st.textContent = '\u26a0 ' + d.error;
          else if (!d.models || !d.models.length) st.textContent = '\u26a0 No models returned — check endpoint & key.';
          else                    st.textContent = '\u2713 ' + d.models.length + ' models loaded — click the field to browse.';
        }}
      }})
      .catch(function() {{ if (st) st.textContent = '\u26a0 Request failed.'; }})
      .finally(function() {{ if (btn) btn.disabled = false; }});
  }}
  window._acctLoadModels = _acctLoadModels;

  /* Provider → endpoint auto-fill (Custom keeps the field editable) */
  function _acctStrip(s){{ s = (s || '').trim(); while (s.charAt(s.length - 1) === '/') s = s.slice(0, -1); return s; }}
  function _acctProviderChange() {{
    var sel = document.getElementById('acct-ai-provider');
    var ep  = document.getElementById('acct-ai-endpoint');
    if (!sel || !ep) return;
    if (sel.value === 'custom') {{
      ep.readOnly = false; ep.classList.remove('opacity-60'); ep.focus();
    }} else {{
      ep.value = sel.value; ep.readOnly = true; ep.classList.add('opacity-60');
    }}
  }}
  window._acctProviderChange = _acctProviderChange;
  /* On load, infer the provider from the saved endpoint (else Custom). */
  (function _acctInitProvider(){{
    var sel = document.getElementById('acct-ai-provider');
    var ep  = document.getElementById('acct-ai-endpoint');
    if (!sel || !ep) return;
    var cur = _acctStrip(ep.value), matched = false;
    for (var i = 0; i < sel.options.length; i++) {{
      if (cur && sel.options[i].value !== 'custom' && _acctStrip(sel.options[i].value) === cur) {{
        sel.selectedIndex = i; matched = true; break;
      }}
    }}
    if (matched) {{ ep.readOnly = true; ep.classList.add('opacity-60'); }}
    else {{ sel.value = 'custom'; ep.readOnly = false; }}
  }})();

  /* Test connection — hits /qa/ping-llm and shows real error details */
  function _acctTestLlm() {{
    var msg = document.getElementById('acct-ai-msg');
    var btn = document.getElementById('acct-ai-test-btn');
    if (msg) msg.textContent = '⏳ Testing…';
    if (btn) btn.disabled = true;
    fetch('/qa/ping-llm')
      .then(function(r) {{ return r.json(); }})
      .then(function(d) {{
        if (msg) {{
          msg.className = 'text-xs ' + (d.ok ? 'text-green-600' : 'text-red-600');
          msg.textContent = (d.ok ? '✓ ' : '✗ ') + d.detail;
        }}
      }})
      .catch(function(err) {{
        if (msg) {{ msg.className = 'text-xs text-red-600'; msg.textContent = '✗ ' + err; }}
      }})
      .finally(function() {{ if (btn) btn.disabled = false; }});
  }}
  window._acctTestLlm = _acctTestLlm;

  /* Auto-fetch after a successful Save so model list is always fresh */
  document.getElementById('acct-ai-form').addEventListener('htmx:afterRequest', function(ev) {{
    if (ev.detail.successful) _acctLoadModels(true);
  }});

  /* Auto-fetch on load if an endpoint is already configured */
  if (document.getElementById('acct-ai-endpoint').value.trim()) {{
    _acctLoadModels(true);
  }}
}})();</script>
""")


@router.post("/ai-settings", response_class=HTMLResponse)
async def save_user_ai_settings(
    request: Request,
    ai_endpoint: str = Form(default=""),
    ai_api_key:  str = Form(default=""),
    ai_model:    str = Form(default=""),
):
    """Persist per-user LLM config. Empty api_key leaves the stored key untouched."""
    uid = request.session.get("user_id")
    if not uid:
        return HTMLResponse(_ERR.format("Not logged in."), status_code=401)
    key_or_none = ai_api_key.strip() or None
    await set_user_llm_settings(
        user_id=uid,
        endpoint=ai_endpoint,
        api_key=key_or_none,
        model=ai_model,
    )
    return HTMLResponse(_OK.format("AI Search settings saved."))
