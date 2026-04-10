/**
 * bw-paste-as.js
 * Notion-style "Paste as" popup for pasted URLs in the note editor.
 * Options: URL · Mention · Bookmark · Embed
 *
 * Works in both editors:
 *   - #note-content      (raw markdown textarea)
 *   - #md-live-preview   (WYSIWYG contenteditable)
 *
 * Registered with capture:true so it fires before the image-paste
 * handler in note_form.html; bails immediately if clipboard contains
 * an image file so the two handlers never conflict.
 *
 * Exposed as window.bwPasteAs = { init }
 * Called by an inline <script> at the bottom of note_form.html.
 */
(function () {
  'use strict';

  // ── URL detection ──────────────────────────────────────────────────────────
  const URL_RE = /^https?:\/\/[^\s]{4,}$/i;
  const _isUrl   = t  => URL_RE.test(t.trim());
  const _domain  = u  => { try { return new URL(u).hostname.replace(/^www\./,''); } catch { return u; } };

  /** Returns a clean embed src for YouTube or Vimeo; null for everything else. */
  function _embedSrc(url) {
    let m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}`;
    m = url.match(/vimeo\.com\/(\d+)/);
    if (m) return `https://player.vimeo.com/video/${m[1]}`;
    return null;
  }

  // ── State ──────────────────────────────────────────────────────────────────
  let _popup      = null;   // DOM element, built once and reused
  let _url        = '';     // URL currently being pasted
  let _isCE       = false;  // true = contenteditable, false = textarea
  let _savedRange = null;   // cloned CE Range snapshot
  let _savedTaPos  = null;   // textarea selectionStart at paste time
  let _savedTaEnd  = null;   // textarea selectionEnd  at paste time (may differ when text was selected)
  let _urlPreviewEl = null;   // header URL preview span — updated on each open
  let _mouseX      = 0;      // last known mouse X (viewport-relative)
  let _mouseY      = 0;      // last known mouse Y (viewport-relative)

  // Track mouse continuously so the popup can follow the actual cursor
  // even when paste is triggered by Ctrl+V (keyboard, no click coords).
  document.addEventListener('mousemove', e => {
    _mouseX = e.clientX;
    _mouseY = e.clientY;
  }, { passive: true });

  // ── Option definitions ──────────────────────────────────────────────────────────────────
  const OPTIONS = [
    { key: 'url',      icon: '🔗', label: 'URL',      desc: 'Hyperlink · opens in new tab'          },
    { key: 'mention',  icon: '@',  label: 'Mention',  desc: 'Inline reference · @domain'            },
    { key: 'bookmark', icon: '🔖', label: 'Bookmark', desc: 'Preview card · save for later'         },
    { key: 'embed',    icon: '▶',  label: 'Embed',    desc: 'Inline media · video or preview'        },
  ];

  // Per-option accent palette (light + dark)
  const _ACCENTS = {
    url:      { bg:'#eff6ff', fg:'#0053e2', hover:'#dbeafe', darkBg:'#172554', darkFg:'#60a5fa', darkHover:'#1e3a5f' },
    mention:  { bg:'#f5f3ff', fg:'#7c3aed', hover:'#ede9fe', darkBg:'#2e1065', darkFg:'#a78bfa', darkHover:'#3b0764' },
    bookmark: { bg:'#fffbeb', fg:'#d97706', hover:'#fef3c7', darkBg:'#451a03', darkFg:'#fbbf24', darkHover:'#78350f' },
    embed:    { bg:'#eff6ff', fg:'#1d4ed8', hover:'#dbeafe', darkBg:'#172554', darkFg:'#93c5fd', darkHover:'#1e3a5f' },
  };

  // ── CSS animation (injected once into <head>) ───────────────────────────────────
  function _injectStyles() {
    if (document.getElementById('bw-pa-styles')) return;
    const s = document.createElement('style');
    s.id = 'bw-pa-styles';
    s.textContent = [
      '@keyframes bwPaIn{from{opacity:0;transform:translateY(8px) scale(.96)}',
      'to{opacity:1;transform:translateY(0) scale(1)}}',
      '#bw-paste-as-popup.bw-pa-open{animation:bwPaIn .2s cubic-bezier(.16,1,.3,1) both}',
      '#bw-paste-as-popup [data-bw-icon]{transition:transform .16s cubic-bezier(.34,1.56,.64,1)}',
      '#bw-paste-as-popup [data-paste-opt]:hover [data-bw-icon]{transform:scale(1.13)}',
    ].join('');
    document.head.appendChild(s);
  }

  // ── Popup DOM ──────────────────────────────────────────────────────────────────
  function _buildPopup() {
    if (_popup) return _popup;
    _injectStyles();
    const FF = '-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif';

    _popup = document.createElement('div');
    _popup.id = 'bw-paste-as-popup';
    _popup.setAttribute('role', 'menu');
    _popup.setAttribute('aria-label', 'Paste as');
    _popup.style.cssText = [
      'position:fixed;z-index:10000;display:none;visibility:hidden;',
      'border-radius:14px;padding:0;min-width:256px;overflow:hidden;',
      `font-family:${FF};`,
    ].join('');

    // ── Header ─────────────────────────────────────────────
    const hdr = document.createElement('div');
    hdr.dataset.bwPaHdr = '1';
    hdr.style.cssText = 'padding:10px 14px 8px;';

    const hdrLabel = document.createElement('p');
    hdrLabel.textContent = 'Paste as';
    hdrLabel.dataset.bwPaLabel = '1';
    hdrLabel.style.cssText = [
      'margin:0 0 4px;font-size:.63rem;font-weight:700;',
      'letter-spacing:.1em;text-transform:uppercase;',
    ].join('');

    _urlPreviewEl = document.createElement('span');
    _urlPreviewEl.dataset.bwPaUrl = '1';
    _urlPreviewEl.style.cssText = [
      'display:block;font-size:.72rem;',
      'font-family:ui-monospace,"SFMono-Regular","Cascadia Code",monospace;',
      'overflow:hidden;white-space:nowrap;text-overflow:ellipsis;max-width:228px;',
    ].join('');

    hdr.appendChild(hdrLabel);
    hdr.appendChild(_urlPreviewEl);
    _popup.appendChild(hdr);

    // ── Divider ────────────────────────────────────────────
    const divider = document.createElement('div');
    divider.dataset.bwPaDivider = '1';
    divider.style.cssText = 'height:1px;margin:0 10px;';
    _popup.appendChild(divider);

    // ── Option buttons ───────────────────────────────────────
    const optWrap = document.createElement('div');
    optWrap.style.cssText = 'padding:6px 8px 4px;';

    OPTIONS.forEach((opt, idx) => {
      const acc = _ACCENTS[opt.key];
      const isDark = () => document.documentElement.classList.contains('dark');

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.pasteOpt = opt.key;
      btn.setAttribute('role', 'menuitem');
      btn.setAttribute('tabindex', idx === 0 ? '0' : '-1');
      btn.style.cssText = [
        'display:flex;align-items:center;gap:12px;',
        'width:100%;padding:8px 10px;border-radius:10px;',
        'border:none;background:transparent;cursor:pointer;',
        `text-align:left;font-family:${FF};`,
        'transition:background .12s ease;',
      ].join('');

      // Coloured icon pill
      const iconEl = document.createElement('span');
      iconEl.dataset.bwIcon = opt.key;
      iconEl.style.cssText = [
        'width:36px;height:36px;border-radius:10px;flex-shrink:0;',
        'display:flex;align-items:center;justify-content:center;',
        `font-size:${opt.key === 'mention' ? '1.05rem' : '.95rem'};font-weight:800;`,
        `background:${acc.bg};color:${acc.fg};`,
      ].join('');
      iconEl.textContent = opt.icon;

      // Text block
      const textWrap = document.createElement('span');
      textWrap.style.cssText = 'flex:1;min-width:0;';

      const nameEl = document.createElement('span');
      nameEl.dataset.bwName = opt.key;
      nameEl.textContent = opt.label;
      nameEl.style.cssText = 'display:block;font-size:.83rem;font-weight:600;line-height:1.3;';

      const descEl = document.createElement('span');
      descEl.dataset.bwDesc = opt.key;
      descEl.textContent = opt.desc;
      descEl.style.cssText = 'display:block;font-size:.71rem;line-height:1.4;margin-top:1px;opacity:.75;';

      textWrap.appendChild(nameEl);
      textWrap.appendChild(descEl);
      btn.appendChild(iconEl);
      btn.appendChild(textWrap);

      btn.addEventListener('mouseenter', () => _focusBtn(btn));
      btn.addEventListener('mouseleave', () => _unfocusBtn(btn));
      btn.addEventListener('click', () => _choose(opt.key));
      optWrap.appendChild(btn);
    });

    _popup.appendChild(optWrap);

    // ── Footer ────────────────────────────────────────────
    const footer = document.createElement('div');
    footer.dataset.bwPaFooter = '1';
    footer.style.cssText = 'padding:6px 14px 10px;text-align:center;border-top:1px solid;';

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.dataset.bwPaDismiss = '1';
    dismissBtn.style.cssText = [
      `background:none;border:none;cursor:pointer;font-family:${FF};`,
      'font-size:.69rem;display:inline-flex;align-items:center;gap:6px;',
      'padding:3px 8px;border-radius:6px;transition:background .1s;opacity:.7;',
    ].join('');

    const kbdEl = document.createElement('kbd');
    kbdEl.dataset.bwPaKbd = '1';
    kbdEl.textContent = 'Esc';
    kbdEl.style.cssText = [
      `font-family:${FF};font-size:.62rem;font-weight:600;`,
      'padding:1px 6px;border-radius:5px;border:1px solid;',
      'line-height:1.7;display:inline-block;letter-spacing:.02em;',
    ].join('');

    const footerText = document.createElement('span');
    footerText.textContent = 'paste as plain text';

    dismissBtn.appendChild(kbdEl);
    dismissBtn.appendChild(footerText);
    dismissBtn.addEventListener('click', _dismiss);
    footer.appendChild(dismissBtn);
    _popup.appendChild(footer);

    _popup.addEventListener('keydown', _onKey);
    document.body.appendChild(_popup);
    return _popup;
  }

  function _applyDarkMode() {
    if (!_popup) return;
    const dark = document.documentElement.classList.contains('dark');

    // Shell
    _popup.style.background = dark ? 'rgba(24,24,27,.97)' : 'rgba(255,255,255,.97)';
    _popup.style.border     = dark ? '1px solid #3f3f46'  : '1px solid rgba(0,0,0,.08)';
    _popup.style.boxShadow  = dark
      ? '0 0 0 1px rgba(255,255,255,.05),0 4px 6px rgba(0,0,0,.4),0 20px 40px rgba(0,0,0,.55)'
      : '0 0 0 1px rgba(0,0,0,.05),0 4px 6px rgba(0,0,0,.07),0 20px 40px rgba(0,0,0,.11)';

    // Header
    const label = _popup.querySelector('[data-bw-pa-label]');
    if (label) label.style.color = dark ? '#71717a' : '#9ca3af';
    if (_urlPreviewEl) _urlPreviewEl.style.color = dark ? '#52525b' : '#c4c9d4';

    // Dividers
    _popup.querySelectorAll('[data-bw-pa-divider],[data-bw-pa-footer]').forEach(el => {
      el.style.borderTopColor = dark ? '#3f3f46' : '#f3f4f6';
      if (el.dataset.bwPaDivider) el.style.background = dark ? '#3f3f46' : '#f3f4f6';
    });

    // Per-option accent colours
    _popup.querySelectorAll('[data-bw-icon]').forEach(el => {
      const a = _ACCENTS[el.dataset.bwIcon];
      if (!a) return;
      el.style.background = dark ? a.darkBg : a.bg;
      el.style.color      = dark ? a.darkFg : a.fg;
    });
    _popup.querySelectorAll('[data-bw-name]').forEach(el => {
      el.style.color = dark ? '#f4f4f5' : '#111827';
    });
    _popup.querySelectorAll('[data-bw-desc]').forEach(el => {
      el.style.color = dark ? '#a1a1aa' : '#374151';
    });

    // Footer dismiss button + kbd
    const kbd = _popup.querySelector('[data-bw-pa-kbd]');
    if (kbd) {
      kbd.style.borderColor = dark ? '#52525b' : '#d1d5db';
      kbd.style.background  = dark ? '#27272a'  : '#f9fafb';
      kbd.style.color       = dark ? '#a1a1aa'  : '#6b7280';
    }
    const dismissBtn = _popup.querySelector('[data-bw-pa-dismiss]');
    if (dismissBtn) dismissBtn.style.color = dark ? '#71717a' : '#9ca3af';
  }

  function _showPopup(anchorX, anchorY) {
    const p = _buildPopup();
    // Render off-screen first so we can measure real dimensions
    p.style.visibility = 'hidden';
    p.style.display    = 'block';
    _applyDarkMode();

    const pw = p.offsetWidth  || 220;
    const ph = p.offsetHeight || 250;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const GAP = 12;

    // Prefer showing below-right of the anchor; flip when it would overflow
    let left = anchorX + GAP;
    let top  = anchorY + GAP;
    if (left + pw > vw - 8) left = anchorX - pw - GAP;
    if (top  + ph > vh - 8) top  = anchorY - ph - GAP;
    // Final clamp so it never goes off-screen
    left = Math.max(8, Math.min(left, vw - pw - 8));
    top  = Math.max(8, Math.min(top,  vh - ph - 8));

    p.style.left       = left + 'px';
    p.style.top        = top  + 'px';
    // Populate header URL preview
    if (_urlPreviewEl) {
      _urlPreviewEl.textContent = _url.length > 44 ? _url.slice(0, 42) + '…' : _url;
    }

    p.style.visibility = 'visible';
    // Restart slide-up animation each open
    p.classList.remove('bw-pa-open');
    void p.offsetWidth;
    p.classList.add('bw-pa-open');

    const first = p.querySelector('[data-paste-opt]');
    if (first) _focusBtn(first);
    setTimeout(() => document.addEventListener('pointerdown', _onOutside, { once: true }), 0);
  }

  function _hidePopup() { if (_popup) _popup.style.display = 'none'; }

  function _focusBtn(btn) {
    const dark = document.documentElement.classList.contains('dark');
    _popup.querySelectorAll('[data-paste-opt]').forEach(b => {
      b.style.background = 'transparent';
      b.tabIndex = -1;
    });
    const acc = _ACCENTS[btn.dataset.pasteOpt];
    btn.style.background = dark ? (acc?.darkHover || '#3f3f46') : (acc?.hover || '#eff6ff');
    btn.tabIndex = 0;
    btn.focus();
  }

  function _unfocusBtn(btn) {
    btn.style.background = 'transparent';
  }

  function _onKey(e) {
    const opts = [..._popup.querySelectorAll('[data-paste-opt]')];
    const cur  = opts.findIndex(b => b === document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      _focusBtn(opts[(cur + 1) % opts.length]);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      _focusBtn(opts[(cur - 1 + opts.length) % opts.length]);
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      _dismiss();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (cur >= 0) _choose(OPTIONS[cur].key);
    }
  }

  function _onOutside(e) {
    if (_popup && !_popup.contains(e.target)) _dismiss();
  }

  // ── Insertion helpers ──────────────────────────────────────────────────────

  /** Restore saved CE range and exec-insert HTML. */
  function _insertCE(html) {
    const pv = document.getElementById('md-live-preview');
    if (!pv) return;
    // Restore selection BEFORE focus so the browser doesn't reset the
    // cursor to end-of-document when the contenteditable regains focus.
    const sel = window.getSelection();
    if (sel && _savedRange) {
      sel.removeAllRanges();
      sel.addRange(_savedRange);
    }
    // preventScroll stops the page jumping to the cursor on focus.
    pv.focus({ preventScroll: true });
    document.execCommand('insertHTML', false, html);
    pv.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /** Insert text at saved textarea caret, replacing any prior selection. */
  function _insertTA(text) {
    const ta  = document.getElementById('note-content');
    if (!ta) return;
    const pos = _savedTaPos ?? ta.selectionStart;
    const end = _savedTaEnd ?? pos;
    ta.focus({ preventScroll: true });
    // Restore the full start→end range so insertText replaces highlighted text
    // instead of inserting alongside it and leaving the cursor in the wrong spot.
    ta.setSelectionRange(pos, end);
    document.execCommand('insertText', false, text);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // ── Option handlers ────────────────────────────────────────────────────────

  function _choose(key) {
    _hidePopup();
    const url = _url;
    const dom = _domain(url);

    if (_isCE) {
      switch (key) {
        case 'url':
          _insertCE(
            `<a href="${url}" target="_blank" rel="noopener noreferrer">${dom}</a>`
          );
          break;

        case 'mention':
          _insertCE(_mentionHtml(url, dom));
          _fetchAndAppendTitle(url);
          break;

        case 'bookmark':
          _insertCE(_bookmarkHtml(url, dom));
          break;

        case 'embed': {
          const src = _embedSrc(url);
          _insertCE(src ? _embedHtml(src) : _embedFallbackHtml(url, dom));
          break;
        }
      }
    } else {
      // ── Markdown textarea ───────────────────────────────────────────────
      switch (key) {
        case 'url':
          _insertTA(`[${dom}](${url})`);
          break;

        case 'mention':
          _insertTA(_mentionHtml(url, dom));
          break;

        case 'bookmark':
          _insertTA(_bookmarkHtml(url, dom));
          break;

        case 'embed': {
          const src = _embedSrc(url);
          _insertTA(src ? _embedHtml(src) : _embedFallbackHtml(url, dom));
          break;
        }
      }
    }
  }

  /**
   * Known brand display-names + primary/text colours for the mention pill.
   * key = lowercase bare domain name (no www, no TLD).
   */
  const _BRAND_MAP = {
    amazon:        ['Amazon',         '#ff9900', '#111'],
    apple:         ['Apple',          '#555555', '#fff'],
    claude:        ['Claude',         '#d97757', '#fff'],
    discord:       ['Discord',        '#5865f2', '#fff'],
    dropbox:       ['Dropbox',        '#0061ff', '#fff'],
    facebook:      ['Facebook',       '#1877f2', '#fff'],
    figma:         ['Figma',          '#f24e1e', '#fff'],
    github:        ['GitHub',         '#24292e', '#fff'],
    gitlab:        ['GitLab',         '#fc6d26', '#fff'],
    gmail:         ['Gmail',          '#ea4335', '#fff'],
    google:        ['Google',         '#4285f4', '#fff'],
    huggingface:   ['HuggingFace',    '#ff9d00', '#111'],
    instagram:     ['Instagram',      '#e1306c', '#fff'],
    linkedin:      ['LinkedIn',       '#0077b5', '#fff'],
    medium:        ['Medium',         '#000000', '#fff'],
    microsoft:     ['Microsoft',      '#00a4ef', '#fff'],
    netflix:       ['Netflix',        '#e50914', '#fff'],
    notion:        ['Notion',         '#000000', '#fff'],
    npm:           ['npm',            '#cc3534', '#fff'],
    openai:        ['OpenAI',         '#10a37f', '#fff'],
    paypal:        ['PayPal',         '#003087', '#fff'],
    pinterest:     ['Pinterest',      '#e60023', '#fff'],
    reddit:        ['Reddit',         '#ff4500', '#fff'],
    shopify:       ['Shopify',        '#5c8e00', '#fff'],
    slack:         ['Slack',          '#4a154b', '#fff'],
    snapchat:      ['Snapchat',       '#f7c900', '#111'],
    spotify:       ['Spotify',        '#1db954', '#fff'],
    stackoverflow: ['Stack Overflow', '#f48024', '#fff'],
    stripe:        ['Stripe',         '#635bff', '#fff'],
    tiktok:        ['TikTok',         '#010101', '#fff'],
    twitch:        ['Twitch',         '#9146ff', '#fff'],
    twitter:       ['Twitter',        '#1da1f2', '#fff'],
    vercel:        ['Vercel',         '#000000', '#fff'],
    vimeo:         ['Vimeo',          '#1ab7ea', '#fff'],
    walmart:       ['Walmart',        '#0053e2', '#fff'],
    wikipedia:     ['Wikipedia',      '#000000', '#fff'],
    x:             ['X',              '#000000', '#fff'],
    youtube:       ['YouTube',        '#ff0000', '#fff'],
    zoom:          ['Zoom',           '#2d8cff', '#fff'],
  };

  /**
   * Parse a raw domain string into branded display parts.
   * 'www.youtube.com' → { name:'YouTube', tld:'.com', color:'#ff0000', textColor:'#fff' }
   */
  function _brandDomain(dom) {
    const bare  = dom.replace(/^www\./, '');
    const parts = bare.split('.');
    const key   = parts[0].toLowerCase();
    const tld   = '.' + parts.slice(1).join('.');
    const info  = _BRAND_MAP[key];
    if (info) return { name: info[0], tld, color: info[1], textColor: info[2] };
    // Fallback: title-case the key, Walmart blue avatar
    return { name: key.charAt(0).toUpperCase() + key.slice(1), tld, color: '#0053e2', textColor: '#fff' };
  }

  /**
   * Fetch the page title for a mention URL and insert it as a CSS-classed span
   * immediately after the most recently inserted mention pill in the CE.
   *
   * Strategy:
   *  1. YouTube / Vimeo → browser-native fetch() to their oEmbed APIs (CORS-open,
   *     browser proxy handled automatically — avoids Walmart NTLM proxy issues).
   *  2. Anything else → server-side /notes/url-title endpoint (stdlib urllib).
   * Silent no-op on any failure.
   */
  function _fetchAndAppendTitle(url) {
    const ce = document.getElementById('md-live-preview');
    if (!ce) return;

    // Grab the pill we just inserted — it's the last [data-bw-mention] in the CE.
    const pills = ce.querySelectorAll('[data-bw-mention]');
    const pill  = pills[pills.length - 1];
    if (!pill) return;

    const _apply = (title) => {
      if (!title || !pill.isConnected) return;
      const span = document.createElement('span');
      span.className   = 'bw-mn-ttl';
      span.textContent = title;
      pill.insertAdjacentElement('afterend', span);
      // Sync CE → TA so the title persists on next save
      if (typeof window._bwSyncPreviewToMd === 'function') window._bwSyncPreviewToMd();
    };

    // ── 1. oEmbed: YouTube & Vimeo (browser fetch, CORS allowed) ────────────
    const ytMatch = url.match(
      /(?:youtube\.com\/(?:watch\?.*v=|shorts\/)|youtu\.be\/)([\w-]+)/i
    );
    const vmMatch = !ytMatch && url.match(
      /vimeo\.com\/(\d+)/i
    );

    if (ytMatch || vmMatch) {
      const oembedUrl = ytMatch
        ? `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
        : `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`;

      fetch(oembedUrl)
        .then(r => r.ok ? r.json() : null)
        .then(d => _apply(d?.title || ''))
        .catch(() =>
          // oEmbed blocked? fall through to server endpoint
          fetch('/notes/url-title?url=' + encodeURIComponent(url))
            .then(r => r.ok ? r.json() : {})
            .then(d => _apply(d?.title || ''))
            .catch(() => {})
        );
      return;
    }

    // ── 2. Server-side fallback for everything else ────────────────────────
    fetch('/notes/url-title?url=' + encodeURIComponent(url))
      .then(r => r.ok ? r.json() : {})
      .then(d => _apply(d?.title || ''))
      .catch(() => {});
  }

  /** Branded mention pill — colours via CSS classes, only avatar bg is inline */
  function _mentionHtml(url, dom) {
    const brand = _brandDomain(dom);
    return [
      `<a href="${url}" target="_blank" rel="noopener noreferrer" data-bw-mention="1"`,
      ` style="display:inline-flex;align-items:center;gap:5px;`,
      `vertical-align:middle;border-radius:999px;padding:1px 8px 1px 3px;">`,
      // Brand-coloured avatar circle — bg/fg are brand-specific, not theme-specific
      `<span style="display:inline-flex;align-items:center;justify-content:center;`,
      `width:18px;height:18px;border-radius:50%;flex-shrink:0;`,
      `background:${brand.color};color:${brand.textColor};font-size:.55rem;font-weight:800;">`,
      `${brand.name[0]}</span>`,
      // Name + TLD — colours managed by .bw-mn-lbl / .bw-mn-tld CSS rules
      `<span style="font-size:.85rem;line-height:1;white-space:nowrap;">`,
      `<span class="bw-mn-lbl">${brand.name}</span>`,
      `<span class="bw-mn-tld" style="font-size:.8em;">${brand.tld}</span>`,
      `</span>`,
      `</a>`,
    ].join('');
  }

  /** Amber bookmark card — colours via CSS, only structural layout is inline */
  function _bookmarkHtml(url, dom) {
    return [
      `<a href="${url}" target="_blank" rel="noopener noreferrer" data-bw-bookmark="1"`,
      ` style="display:block;border-width:1px;border-left-width:4px;`,
      `border-radius:8px;padding:10px 14px;margin:6px 0;font-size:.85rem;">`,
      `<span class="bw-bm-label" style="display:block;font-size:.65rem;font-weight:700;`,
      `letter-spacing:.07em;text-transform:uppercase;margin-bottom:5px;">\uD83D\uDD16 Bookmark</span>`,
      `<span style="display:block;font-weight:600;margin-bottom:2px;">${dom}</span>`,
      `<span class="bw-bm-url" style="display:block;font-size:.73rem;overflow-wrap:anywhere;">${url}</span>`,
      `</a>`,
    ].join('');
  }

  /** Blue embed fallback card — colours via CSS, layout inline */
  function _embedFallbackHtml(url, dom) {
    const initial = dom[0]?.toUpperCase() ?? '\u2022';

    let pathPreview = '';
    try {
      const u   = new URL(url);
      const raw = (u.pathname + u.search).replace(/^\//, '');
      if (raw) pathPreview = '/' + (raw.length > 52 ? raw.slice(0, 50) + '\u2026' : raw);
    } catch { /* invalid URL — skip path */ }

    return [
      `<div data-bw-embed="1" style="border-radius:8px;overflow:hidden;margin:6px 0;">`,
      `<div class="bw-emb-head" style="padding:4px 12px;font-size:.65rem;font-weight:700;`,
      `color:#fff;letter-spacing:.07em;text-transform:uppercase;">▶ Embed</div>`,
      `<a href="${url}" target="_blank" rel="noopener noreferrer"`,
      ` style="display:flex;align-items:center;gap:10px;padding:10px 14px;">`,
      `<span class="bw-emb-icon" style="flex-shrink:0;width:36px;height:36px;border-radius:8px;`,
      `display:flex;align-items:center;justify-content:center;font-size:.85rem;font-weight:800;">`,
      `${initial}</span>`,
      `<span style="min-width:0;">`,
      `<span class="bw-emb-title" style="display:block;font-weight:600;font-size:.85rem;margin-bottom:2px;">${dom}</span>`,
      pathPreview
        ? `<span class="bw-emb-path" style="display:block;font-size:.72rem;overflow-wrap:anywhere;">${pathPreview}</span>`
        : '',
      `</span></a></div>`,
    ].join('');
  }

  /** 16:9 iframe player — YouTube / Vimeo */
  function _embedHtml(src) {
    return [
      `<figure style="margin:8px 0;border-radius:8px;overflow:hidden;`,
      `position:relative;padding-top:56.25%;background:#000;">`,
      `<iframe src="${src}"`,
      // Use explicit offsets instead of inset shorthand for DOMPurify CSS compat
      ` style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;"`,
      ` allowfullscreen`,
      ` allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture">`,
      `</iframe></figure>`,
    ].join('');
  }

  /** Dismissed — insert the raw URL text as-is. */
  function _dismiss() {
    document.removeEventListener('pointerdown', _onOutside);
    _hidePopup();
    _isCE ? _insertCE(_url) : _insertTA(_url);
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  /**
   * Register paste listeners on both editors.
   * Uses capture:true to fire before the image handler in note_form.html
   * and stopImmediatePropagation so only one of the two handlers runs.
   */
  function init() {
    const ta = document.getElementById('note-content');
    const pv = document.getElementById('md-live-preview');
    if (!ta || !pv) return;

    function _handle(e, isCE) {
      const text  = (e.clipboardData || window.clipboardData)?.getData('text/plain') || '';
      if (!_isUrl(text)) return;                                   // not a URL — let default paste happen
      const items = Array.from(e.clipboardData?.items || []);
      if (items.some(i => i.type.startsWith('image/'))) return;   // image takes priority

      e.preventDefault();
      e.stopImmediatePropagation();

      _url  = text.trim();
      _isCE = isCE;

      if (isCE) {
        const sel = window.getSelection();
        _savedRange  = (sel && sel.rangeCount) ? sel.getRangeAt(0).cloneRange() : null;
        _savedTaPos  = null;
        _savedTaEnd  = null;
      } else {
        _savedTaPos  = ta.selectionStart;
        _savedTaEnd  = ta.selectionEnd;   // preserve end so highlighted text gets replaced
        _savedRange  = null;
      }

      // Use the live mouse position — accurate for both Ctrl+V and right-click
      // paste, and works even when the caret range is collapsed (zero-size rect).
      _showPopup(_mouseX, _mouseY);
    }

    pv.addEventListener('paste', e => _handle(e, true),  { capture: true });
    ta.addEventListener('paste', e => _handle(e, false), { capture: true });
  }

  window.bwPasteAs = { init };
})();
