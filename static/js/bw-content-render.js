/**
 * bw-content-render.js — BookWorm content rendering helpers
 *
 * Provides:
 *   window._bwApplyCodeHighlighting(el)  — wraps <pre><code> blocks with
 *       the .bw-code-block header/copy-button UI and runs highlight.js.
 *
 *   Tab-block click delegate — handles .bw-tab-btn clicks to switch panels
 *       inside .bw-tabs blocks. Works on any page that renders saved content.
 *
 * Loaded by base.html (app shell) AND the public share pages.
 * No dependencies other than highlight.js (loaded separately, optional).
 */

/* ── Code highlighting ───────────────────────────────────────────────────── */

window._bwApplyCodeHighlighting = function (el) {
  if (!el) return;
  // Never mutate a contenteditable surface — injected divs become literal text.
  if (el.isContentEditable || el.closest('[contenteditable="true"]')) return;

  const COPY_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none"'
    + ' stroke="currentColor" stroke-width="2.5" aria-hidden="true">'
    + '<rect x="9" y="9" width="13" height="13" rx="2"/>'
    + '<path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
  const CHECK_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none"'
    + ' stroke="currentColor" stroke-width="2.5" aria-hidden="true">'
    + '<polyline points="20 6 9 17 4 12"/></svg>';
  const HDR_COPY   = () => COPY_SVG + '<span>Copy</span>';
  const HDR_COPIED = () => CHECK_SVG + '<span>Copied!</span>';

  function _doCopy(codeEl, btn) {
    const code = codeEl.innerText || codeEl.textContent || '';
    const done = () => {
      btn.classList.add('bw-copied');
      btn.innerHTML = HDR_COPIED();
      setTimeout(() => {
        btn.classList.remove('bw-copied');
        btn.innerHTML = HDR_COPY();
      }, 2000);
    };
    const fallback = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = code;
        ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
        document.body.appendChild(ta);
        ta.focus(); ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      } catch (_) { /* silent */ }
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(code).catch(fallback).finally(done);
    } else { fallback(); done(); }
  }

  el.querySelectorAll('pre code').forEach(codeEl => {
    if (codeEl.closest('.bw-code-block')) return; // already wrapped

    const pre = codeEl.parentElement;

    // 1️⃣ Detect language from existing class (e.g. "language-python")
    let langLabel = '';
    const langCls = [...codeEl.classList].find(c => c.startsWith('language-'));
    if (langCls) langLabel = langCls.replace('language-', '');

    // 0️⃣ Heuristic pre-pass — override stale/wrong language classes
    {
      const _hr = (codeEl.textContent || '').trimStart();
      let _hg = '';
      if (/^[a-z][\w-]*\s*:\s*$/m.test(_hr) && /^\s{2,}[a-z][\w-]*\s*:/m.test(_hr) && !/[(){};]/.test(_hr))
        _hg = 'yaml';
      else if (/^---/.test(_hr.trimStart()))
        _hg = 'yaml';
      else if (/^(FROM|RUN|CMD|COPY|ADD|EXPOSE|WORKDIR|ENV|ENTRYPOINT|LABEL|ARG|HEALTHCHECK|SHELL)\s/m.test(_hr))
        _hg = 'dockerfile';
      else if (/^(Sub |Function |End Sub|End Function|Dim |Private Sub|Public Sub|Private Function|Public Function|Option Explicit)/m.test(_hr) ||
               /\b(ActiveSheet\b|ActiveWorkbook\b|Worksheets\(|Range\(|Cells\(|MsgBox )/.test(_hr))
        _hg = 'vbnet';
      else if (/(\$\w+\s*=|Write-Host|Get-\w+|Set-\w+|New-\w+|Invoke-\w+)/.test(_hr))
        _hg = 'powershell';
      if (_hg) {
        const _ho = [...codeEl.classList].find(c => c.startsWith('language-'));
        if (_ho) codeEl.classList.remove(_ho);
        codeEl.classList.add('language-' + _hg);
        langLabel = _hg;
      }
    }

    // 2️⃣ Apply hljs syntax highlighting
    const _hljs_noise = new Set(['plaintext', 'undefined', 'txt', '', 'text']);
    if (typeof hljs !== 'undefined') {
      try { hljs.highlightElement(codeEl); } catch (_) {}
      // Read back detected language
      if (!langLabel || _hljs_noise.has(langLabel)) {
        const det = [...codeEl.classList].find(c => {
          if (!c.startsWith('language-')) return false;
          const lang = c.replace('language-', '');
          return !_hljs_noise.has(lang);
        });
        if (det) langLabel = det.replace('language-', '');
      }
    }

    // Pin spacing so no inherited stylesheet overrides it
    codeEl.style.lineHeight = '1.45';
    codeEl.style.whiteSpace = 'pre';

    // Trim trailing newline that marked.js appends
    (function _trimTrailingNewline(el) {
      const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      let last = null;
      while (tw.nextNode()) last = tw.currentNode;
      if (last) last.data = last.data.replace(/\n+$/, '');
    })(codeEl);

    // 3️⃣ Heuristic fallbacks when hljs can't determine language
    if (!langLabel || _hljs_noise.has(langLabel)) {
      const raw = (codeEl.textContent || '').trimStart();
      if (/^(cd |ls |mkdir |echo |export |git |npm |pip |uv |python |node |curl |wget |set |rmdir |del |copy |move |touch |chmod |chown |sudo |docker |kubectl |bash |sh )/i.test(raw))
        langLabel = 'shell';
      else if (/^(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|WITH|FROM) /i.test(raw))
        langLabel = 'sql';
      else if (/^\s*<[a-zA-Z]/.test(raw))
        langLabel = 'html';
      else if (/^\s*\{/.test(raw) && raw.includes(':'))
        langLabel = 'json';
    }

    // 4️⃣ Build .bw-code-block wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'bw-code-block';

    const header = document.createElement('div');
    header.className = 'bw-code-header';

    const lbl = document.createElement('span');
    lbl.className   = 'bw-lang-label';
    lbl.textContent = langLabel || 'code';

    const hdrBtn = document.createElement('button');
    hdrBtn.className = 'bw-copy-btn';
    hdrBtn.type      = 'button';
    hdrBtn.title     = 'Copy code to clipboard';
    hdrBtn.setAttribute('aria-label', 'Copy code');
    hdrBtn.innerHTML = HDR_COPY();
    hdrBtn.addEventListener('click', e => { e.stopPropagation(); _doCopy(codeEl, hdrBtn); });

    header.appendChild(lbl);
    header.appendChild(hdrBtn);
    wrapper.appendChild(header);
    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);
  });
};

/* ── Tab-block click delegate ────────────────────────────────────────────── */
// Delegated at document level so it works whether tabs were rendered on load
// or injected later (e.g. HTMX swap). No need to re-attach after each swap.
(function _initTabDelegate() {
  function _tabSwitch(block, idx) {
    block.querySelectorAll('.bw-tab-btn').forEach(b => {
      b.classList.toggle('bw-tab-active', parseInt(b.dataset.tabIdx, 10) === idx);
    });
    block.querySelectorAll('.bw-tab-panel').forEach(p => {
      const active = parseInt(p.dataset.tabIdx, 10) === idx;
      p.classList.toggle('bw-tab-panel-active', active);
      p.style.display = active ? '' : 'none';
    });
  }

  document.addEventListener('click', e => {
    const btn = e.target.closest('.bw-tab-btn');
    if (!btn) return;
    const block = btn.closest('.bw-tabs');
    if (!block) return;
    // On editable surfaces the editor owns the click; don't double-fire.
    if (block.closest('[contenteditable="true"]')) return;
    e.preventDefault();
    _tabSwitch(block, parseInt(btn.dataset.tabIdx, 10));
  });
}());

/* ── hljs theme sync helper (used by share pages) ───────────────────────── */
// window._bwSyncHljsTheme() — call once on load and whenever dark class changes.
window._bwSyncHljsTheme = function () {
  const dark  = document.documentElement.classList.contains('dark');
  const light = document.getElementById('hljs-light');
  const darkEl = document.getElementById('hljs-dark');
  if (light)  light.disabled  =  dark;
  if (darkEl) darkEl.disabled = !dark;
};
