/* home-page-uploads-tags.js — Tag CRUD for the Uploads Homespace page.
   Companion to home-page-uploads.js (loaded after it via base.html).
   Shares state: _uplPid, _uplFiles, _uplAllTags (read/write), _uplRender,
                 _uplRenderFilterTabs, _uplEsc, _uplJsStr (all from main file).
*/
'use strict';

// ── Load + render tags for open detail panel ──────────────────────────────────

async function _uplLoadTags(src, id) {
  try {
    const r = await fetch(`/home/uploads/${_uplPid}/files/${src}/${id}/tags`);
    if (!r.ok) return;
    const data = await r.json();
    _uplRenderTags(src, id, data.tags || []);
  } catch { /* silent */ }
}

function _uplRenderTags(src, id, tags) {
  const el = document.getElementById('upl-tags-area');
  if (!el) return;

  const pills = tags.map(t => `
    <span class="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full
                 bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300">
      ${_uplEsc(t)}
      <button onclick="_uplRemoveTag('${_uplJsStr(src)}',${id},'${_uplJsStr(t)}')"
              class="hover:text-red-500 transition leading-none">&times;</button>
    </span>`).join('');

  const listId = `upl-tags-list-${id}`;
  const opts   = _uplAllTags.filter(t => !tags.includes(t))
                             .map(t => `<option value="${_uplEsc(t)}">`).join('');

  el.innerHTML = `
    <div class="flex flex-wrap gap-1 mb-2">${pills ||
      '<span class="text-[10px] text-gray-400">No tags yet</span>'}</div>
    <div class="flex gap-1">
      <input id="upl-tag-input-${id}" list="${listId}" placeholder="Add tag\u2026"
             class="flex-1 border border-gray-200 dark:border-zinc-700 rounded-lg px-2 py-1
                    text-[10px] bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
                    focus:outline-none focus:ring-1 focus:ring-[#0053e2]"
             onkeydown="if(event.key==='Enter'){event.preventDefault();_uplAddTag('${_uplJsStr(src)}',${id})}" />
      <datalist id="${listId}">${opts}</datalist>
      <button onclick="_uplAddTag('${_uplJsStr(src)}',${id})"
              class="px-2 py-1 text-[10px] rounded-lg bg-[#0053e2] text-white
                     hover:bg-[#003eb3] transition">+</button>
    </div>`;
}

// ── Add / remove tag ──────────────────────────────────────────────────────────

async function _uplAddTag(src, id) {
  const input = document.getElementById(`upl-tag-input-${id}`);
  const tag   = (input ? input.value : '').trim().toLowerCase();
  if (!tag || tag.length > 50) return;
  if (input) input.value = '';
  try {
    const r = await fetch(`/home/uploads/${_uplPid}/files/${src}/${id}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag }),
    });
    if (!r.ok) return;
    const data = await r.json();
    const f = _uplFiles.find(x => x.src === src && x.id === id);
    if (f) f.tags = data.tags;
    _uplRenderTags(src, id, data.tags);
    _uplLoadAllTags();  // refresh autocomplete + filter pills
    _uplRender();       // update card tag pips
  } catch { /* silent */ }
}

async function _uplRemoveTag(src, id, tag) {
  try {
    const r = await fetch(
      `/home/uploads/${_uplPid}/files/${src}/${id}/tags/${encodeURIComponent(tag)}`,
      { method: 'DELETE' }
    );
    if (!r.ok) return;
    const data = await r.json();
    const f    = _uplFiles.find(x => x.src === src && x.id === id);
    if (f) f.tags = data.tags;
    _uplRenderTags(src, id, data.tags);
    _uplLoadAllTags();
    _uplRender();
  } catch { /* silent */ }
}

// ── Text file preview (called from _uplRenderDetail in main file) ────────────

async function _uplFetchTextPreview(url) {
  const el = document.getElementById('upl-text-preview');
  if (!el) return;
  try {
    const r    = await fetch(url);
    const text = await r.text();
    const safe = _uplEsc(text.slice(0, 4_000));
    const more = text.length > 4_000
      ? '<p class="text-[9px] text-gray-400 mt-1">…truncated to 4 000 chars</p>' : '';
    el.innerHTML = `<pre class="text-[10px] text-gray-700 dark:text-zinc-300 whitespace-pre-wrap
                              break-words font-mono">${safe}</pre>${more}`;
  } catch {
    el.innerHTML = '<p class="text-[10px] text-gray-400 italic">Preview unavailable.</p>';
  }
}

// ── Load all user tags (autocomplete + filter bar pills) ──────────────────────

async function _uplLoadAllTags() {
  try {
    const r = await fetch(`/home/uploads/${_uplPid}/tags`);
    if (!r.ok) return;
    const data  = await r.json();
    _uplAllTags = data.tags || [];
    _uplRenderFilterTabs();  // refresh tag filter pills in the tab bar
  } catch { /* silent */ }
}
