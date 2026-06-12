# Plan: Quick-Ask PWA Overlay
Date: 2026-06-07
Estimated complexity: Medium

## Summary
Add a standalone `/quick-ask` page that acts as a phone-native AI search overlay —
no sidebar, no full app chrome, just a focused fullscreen ask-and-answer experience.
The page renders instantly from the Android home screen shortcut (no SPA boot cost),
streams the LLM answer token-by-token using the existing `/qa/stream` SSE endpoint,
and accepts pre-filled questions via the `?q=` param so the PWA Web Share Target
works (Android share sheet → BookWorm → question auto-submitted). Auth is enforced
by the existing middleware; unauthed users hit `/login?next=/quick-ask?q=…` and
return after login with the question intact.

---

## Files to Change
Ordered — touch in this sequence to avoid dependency issues.

| # | File | What changes |
|---|---|---|
| 1 | `static/js/sw.js` | Add `/qa/` to `_isDynamic()`; bump cache name `bw-shell-v3` → `bw-shell-v4` |
| 2 | `main.py` | Import + mount `quick_ask_router`; update manifest shortcut URL; add `share_target` |

## New Files to Create

| File | Purpose |
|---|---|
| `routers/quick_ask.py` | `GET /quick-ask` route — reads `?q=`, renders `quick_ask.html` |
| `templates/quick_ask.html` | Standalone fullscreen template (no `base.html`) |
| `static/js/quick-ask.js` | SSE streaming, session history (localStorage), auto-submit on `?q=` |

---

## DB Migrations Needed
**None.** Session history lives in `localStorage` on the client only.

---

## Skills to Invoke
- **bookworm-template-audit** — after creating `quick_ask.html` and `quick-ask.js`
  (verify no `let`/`const` in script blocks, `?v={{ static_v }}` on all asset links,
  no unregistered Jinja2 filters used)
- **bookworm-pre-commit** — before committing (hardcoded URLs, `_PUBLIC` gaps,
  temp debug statements, raw `aiosqlite.connect()`)

---

## BookWorm Gotchas That Apply To This Feature

### Quirk A — Use `fetch()` + ReadableStream pump, NOT `EventSource`
`bw-search-qa.js` (lines ~341–395) streams using `fetch('/qa/stream?q=…')` +
`resp.body.getReader()` + a recursive `pump()` function + `AbortController`.
**Never use the `EventSource` API** for this endpoint. The AbortController is
what makes the Stop button work. `quick-ask.js` must replicate this exact pattern.

### Quirk B — `var` not `let`/`const` in the JS file
Even though `quick-ask.js` is not an HTMX-reinjected partial, use `var` throughout
to match the BookWorm JS codebase. Wrap the whole file in an IIFE:
`(function () { 'use strict'; … })();` — exactly like `bw-search-qa.js`.

### Quirk C — Cache-bust every asset link in the standalone template
`quick_ask.html` has no `base.html` inheritance. The stylesheet and script must
each have `?v={{ static_v }}` appended manually:
```html
<link href="/static/css/tailwind.css?v={{ static_v }}" rel="stylesheet">
<script src="/static/js/quick-ask.js?v={{ static_v }}" defer></script>
```
Missing `?v=` means stale assets survive deployments silently.

### Quirk D — Standalone dark mode requires the localStorage inline script
Copy the dark-mode bootstrap from `templates/offline.html` verbatim into the
`<head>` of `quick_ask.html`. It reads `localStorage.getItem('bw-theme')` and
conditionally adds `class="dark"` to `<html>` *before* the body renders. Do NOT
rely only on `prefers-color-scheme` — the app overrides the OS preference.

### Quirk E — iOS safe-area inset must be an inline style, not a Tailwind class
Tailwind has no built-in `pb-safe` utility. The fixed input bar needs:
```html
<div style="padding-bottom: env(safe-area-inset-bottom);">…input…</div>
```
And the viewport meta must include `viewport-fit=cover`:
```html
<meta name="viewport"
      content="width=device-width, initial-scale=1, viewport-fit=cover">
```
Without these, the input bar is hidden under the iOS home indicator.

### Quirk F — Do NOT add `/quick-ask` to `_PUBLIC` in `auth_middleware.py`
The route must be auth-gated. The middleware already redirects unauthed requests
to `/login?next=<url>`. The `?q=` parameter gets preserved in the `next` chain
so the user returns to quick-ask with their question intact after logging in.
**No changes to `auth_middleware.py`.**

### Quirk G — Do NOT precache `/quick-ask` in the service worker
`/quick-ask` is auth-gated. Precaching it during SW install would cache ` redirect instead of the actual page. The network-first handler in `sw.js`
will cache the page on the first successful authenticated visit. No change to
`PRECACHE` is needed — only update `_isDynamic()` and bump the cache name.

### Quirk H — Must add `/qa/` to `_isDynamic()` in `sw.js`
Currently `/qa/` is not excluded from the SW fetch handler. This allows the
streaming SSE response at `/qa/stream?q=…` to be partially cached — producing
corrupted cached entries. Fix in `sw.js` while touching it for this feature:
```js
function _isDynamic(url) {
  const p = url.pathname;
  return p.startsWith('/home/')
      || p.startsWith('/auth/')
      || p.startsWith('/uploads/')
      || p.startsWith('/wopi/')
      || p.startsWith('/qa/');      // ← ADD THIS
}
```

### Quirk I — Tailwind CSS rebuild required after writing the template
The prebuilt `static/css/tailwind.css` only contains classes scanned from
existing templates and JS files at build time. New classes introduced in
`quick_ask.html` will be silently missing until `rebuild_css.bat` is run and
the updated CSS is committed. Run it and commit `static/css/tailwind.css`
before testing.

### Quirk J — Web Share Target only activates after PWA reinstall
The `share_target` manifest key only works when BookWorm is **installed as a
PWA**. After updating the manifest, existing PWA installs must be reinstalled
(or updated) to pick up the share target. Note this in the commit message.

### Quirk K — Leave `base.html` `#bw=ai-search` handler alone (backwards compat)
Users who installed the PWA before this update have shortcuts pointing to
`/#bw=ai-search`. The hash handler in `base.html` (~line 1808) calls
`bwSearchOpen()` and continues to work. **Do not remove or modify it.** Only
the manifest `shortcuts[2].url` is changed — new or reinstalled users get
`/quick-ask`, old users keep the modal.

### Quirk L — `share_target` is a top-level manifest key
`share_target` must be a **sibling** of `"shortcuts"` in the manifest dict,
NOT nested inside it. Incorrect placement silently breaks sharing.

---

## Implementation Checklist

### Phase 1 — Service Worker (`static/js/sw.js`)
- [ ] 1.1 Add `|| p.startsWith('/qa/')` to the `_isDynamic()` function
- [ ] 1.2 Bump `const CACHE_NAME = 'bw-shell-v3'` → `'bw-shell-v4'`
- [ ] 1.3 Confirm `PRECACHE` list is unchanged — `/quick-ask` must NOT be added

### Phase 2 — Router (`routers/quick_ask.py`)
- [ ] 2.1 Create `routers/quick_ask.py`:
  ```python
  from fastapi import APIRouter, Request
  from fastapi.responses import HTMLResponse
  from templates_env import templates

  router = APIRouter(tags=["quick-ask"])

  @router.get("/quick-ask", response_class=HTMLResponse,
              include_in_schema=False)
  async def quick_ask_page(request: Request, q: str = ""):
      """Standalone PWA AI search overlay."""
      return templates.TemplateResponse(
          request, "quick_ask.html", {"q": q}
      )
  ```
- [ ] 2.2 No `_PUBLIC` entry needed — auth middleware handles redirect automatically

### Phase 3 — Template (`templates/quick_ask.html`)
Standalone page — NO `{% extends "base.html" %}`.

- [ ] 3.1 `<head>` — copy dark-mode inline script from `offline.html` verbatim (runs before body to toggle `html.dark`)
- [ ] 3.2 `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`
- [ ] 3.3 Link `<link href="/static/css/tailwind.css?v={{ static_v }}" rel="stylesheet">`
- [ ] 3.4 Body structure (`class="h-screen flex flex-col bg-white dark:bg-zinc-900 overflow-hidden"`):
  - **Header** (`class="flex items-center gap-3 px-4 h-14 border-b border-gray-100 dark:border-zinc-800 flex-shrink-0"`):
    - Left: `🪱` emoji + `<span>Quick Ask</span>` in bold
    - Right: back button — `<button onclick="qaBack()" aria-label="Back to BookWorm">`
      with an SVG left-arrow icon (WCAG: visible focus ring, `aria-label`)
  - **Answer area** (`id="qa-answer-area"`, `class="flex-1 overflow-y-auto px-4 py-4 space-y-4"`):
    - `<div id="qa-thinking" class="hidden">` — animated "Thinking…" indicator
    - `<div id="qa-answer" class="text-base text-gray-900 dark:text-zinc-100 whitespace-pre-wrap">` — streams into here
    - Sources toggle: `<button id="qa-sources-toggle" onclick="qaToggleSources()" class="hidden text-sm text-blue-600">Show sources</button>`
    - Sources panel: `<div id="qa-sources-panel" class="hidden space-y-2">` — result cards go here
  - **History rail** (`id="qa-history"`, `class="hidden overflow-x-auto flex gap-2 px-4 py-2 border-t border-gray-100 dark:border-zinc-800 flex-shrink-0"`):
    — filled by `qaRenderHistory()` in JS
  - **Input bar** (`class="flex-shrink-0 border-t border-gray-100 dark:border-zinc-800 bg-white dark:bg-zinc-900"`, inline style `padding-bottom: env(safe-area-inset-bottom)`):
    - `<input id="qa-input" type="search" autocomplete="off" placeholder="Ask anything…" aria-label="Your question">`
    - `<button id="qa-send-btn" onclick="qaSubmit()" aria-label="Send">` — send icon or "Ask"
    - `<button id="qa-stop-btn" onclick="qaStopStream()" class="hidden" aria-label="Stop">` — stop icon
- [ ] 3.5 Pass pre-filled query safely via `data-autoq` on body:
  `<body data-autoq="{{ q | e }}" …>`
  JS reads `document.body.dataset.autoq` on `DOMContentLoaded` — avoids injecting
  user-controlled content into a `<script>` block
- [ ] 3.6 `<script src="/static/js/quick-ask.js?v={{ static_v }}" defer></script>`

### Phase 4 — JavaScript (`static/js/quick-ask.js`)
IIFE, all `var`, `'use strict'`.

- [ ] 4.1 Module-level variables:
  ```js
  var _qaAbort     = null;
  var _qaText      = '';
  var _HISTORY_KEY = 'bw-qa-history';
  var _MAX_HISTORY = 8;
  ```
- [ ] 4.2 `qaBack()` — `window.history.length > 1 ? window.history.back() : (window.location.href = '/')`
- [ ] 4.3 `qaStopStream()` — abort + null out `_qaAbort`, hide Stop button, show Send button, hide thinking indicator
- [ ] 4.4 `qaStartStream(q)` — replicates `_bwSqStream()` from `bw-search-qa.js`:
  - `_qaText = ''`; reset `#qa-answer`; show `#qa-thinking`; hide send, show stop
  - `_qaAbort = new AbortController()`
  - `fetch('/qa/stream?q=' + encodeURIComponent(q), { signal: _qaAbort.signal })`
  - On `resp.redirected` → `window.location.href = resp.url` (session expired)
  - ReadableStream pump with `resp.body.getReader()` + `TextDecoder` + recursive `pump()`
  - Line splitting: `buf.split('\n')`, keep incomplete line: `buf = lines.pop()`
  - Token parse: `var token = JSON.parse(raw); _qaText += token; ansEl.textContent = _qaText;`
  - Hide `#qa-thinking` on first token received
  - `[DONE]`/`[ERROR]` → `qaStopStream()` + show nudge message if `_qaText === ''`
  - Show `#qa-sources-toggle` when stream ends (if sources were fetched)
  - On AbortError: no-op; on other errors: `qaStopStream()`
- [ ] 4.5 `qaFetchResults(q)` — `fetch('/qa/search?q=…&limit=5')` → parse JSON → call `qaRenderSources(data.results)`. On `resp.redirected` → redirect to login.
- [ ] 4.6 `qaRenderSources(results)` — build a simple list of result cards in `#qa-sources-panel` (title + workspace name). Each card is a link: `window.location.href = '/?note=' + id` for notes.
- [ ] 4.7 `qaToggleSources()` — toggle `hidden` on `#qa-sources-panel`; update toggle button text
- [ ] 4.8 `qaSubmit()` — reads `#qa-input` value, trims, returns if empty.
  - **Offline check**: `if (!navigator.onLine) { show inline error "AI search needs a connection"; return; }`
  - Calls `qaStartStream(q)` and `qaFetchResults(q)` in parallel (no `await` — fire and forget)
  - Calls `qaAddHistory(q)`
- [ ] 4.9 `qaAddHistory(q)` — read/parse localStorage, prepend, deduplicate, trim to `_MAX_HISTORY`, write back, call `qaRenderHistory()`
- [ ] 4.10 `qaRenderHistory()` — reads history, renders clickable pills in `#qa-history`, shows the rail container if history is non-empty
- [ ] 4.11 `DOMContentLoaded` wiring:
  - Read `document.body.dataset.autoq`; if non-empty: set `#qa-input` value, `setTimeout(qaSubmit, 100)` (give `defer` time to settle)
  - Else: `document.getElementById('qa-input').focus()`
  - `#qa-send-btn` → `onclick = qaSubmit`
  - `#qa-stop-btn` → `onclick = qaStopStream`
  - `#qa-input` `keydown` → if `Enter` and not `shiftKey`: `e.preventDefault(); qaSubmit()`
  - Call `qaRenderHistory()` to show any existing session history on load

### Phase 5 — Wire up `main.py`
- [ ] 5.1 Add import near the `search_qa` import (~line 168):
  ```python
  from routers import quick_ask as quick_ask_router
  ```
- [ ] 5.2 Mount router near the `search_qa_router` mount (~line 1004), before any wildcard route:
  ```python
  app.include_router(quick_ask_router.router)
  ```
- [ ] 5.3 Update manifest shortcut URL (the third shortcut, "AI Search"):
  ```python
  # BEFORE:
  "url": "/#bw=ai-search",
  # AFTER:
  "url": "/quick-ask",
  ```
- [ ] 5.4 Add `share_target` as a **top-level sibling** of `"shortcuts"` in the manifest dict:
  ```python
  "share_target": {
      "action": "/quick-ask",
      "method": "GET",
      "enctype": "application/x-www-form-urlencoded",
      "params": {"text": "q"},
  },
  ```

### Phase 6 — CSS rebuild
- [ ] 6.1 Run `rebuild_css.bat` to regenerate `static/css/tailwind.css` with any new classes from `quick_ask.html`
- [ ] 6.2 Commit the updated `static/css/tailwind.css`

### Phase 7 — Validation
- [ ] 7.1 `GET http://localhost:8000/quick-ask` — renders, input is focused, no console errors, dark mode works
- [ ] 7.2 `GET http://localhost:8000/quick-ask?q=test` — input pre-filled, stream auto-fires within ~150 ms of page load
- [ ] 7.3 Open while logged out → redirects to `/login?next=%2Fquick-ask` (and with `?q=`: redirects to `/login?next=%2Fquick-ask%3Fq%3Dtest`)
- [ ] 7.4 Back button → returns to previous page; if no history → goes to `/`
- [ ] 7.5 Stop button mid-stream → fetch aborts, Stop hides, Send reappears, answer area shows partial text
- [ ] 7.6 Ask 3+ questions → history pills appear in the rail; clicking a pill refills input and re-submits
- [ ] 7.7 Mobile PWA: reinstall PWA and verify AI Search shortcut lands on `/quick-ask`
- [ ] 7.8 Invoke **bookworm-template-audit** — pass exact files and what changed
- [ ] 7.9 Invoke **bookworm-pre-commit**

---

## Open Questions

1. **Source card tappable links**: Should result cards in `#qa-sources-panel` navigate to
   `/?note=<id>` (full app, leaving quick-ask)? Or stay read-only? Tappable is more
   useful but back-navigation from the full SPA to quick-ask requires the browser back
   button, which should work. **Recommendation**: make them tappable in v1.

2. **LLM answer Markdown rendering**: The streamed answer is set via `textContent`
   (raw text). If the model returns Markdown (bold, bullets, headers), users see raw
   asterisks. **Recommendation**: plain text for v1 — no new dependency. Revisit with
   a micro-renderer (e.g. `marked.min.js` from static/) in v2 if team requests it.

3. **Offline banner**: When `navigator.onLine === false`, `qaSubmit()` should show an
   inline "AI search needs a connection" message rather than silently failing.
   The plan includes this check in step 4.8 — confirm the message placement
   (inline below the input, or replace the answer area placeholder).

4. **Update the AI widget install guide copy in `base.html`**: The guide at ~line 910
   says "The AI search panel opens instantly." After this change the shortcut goes to
   a dedicated page, not a panel. Minor copy update recommended — do as a separate
   commit after the feature is stable.

5. **`enctype` in `share_target`**: Included explicitly as
   `"application/x-www-form-urlencoded"` for maximum browser compatibility.
   Verify on an Android device running Chrome ≥ 94 after PWA reinstall.

6. **Session history scope**: `localStorage` is per-device, per-browser. Acceptable
   for v1. If cross-device persistence is needed later, it would require a new
   `user_qa_history` table (DB migration) and a `GET /qa/history` / `POST /qa/history`
   endpoint. Scope that as a separate feature.
