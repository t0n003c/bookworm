'use strict';
/* ─────────────────────────────────────────────────────────────────────────────
   bw-spellcheck.js — custom spell-check suggestions for the note editor.

   Strategy:
   • Keep native spellcheck="true" for red underlines (the browser does this
     for free; no JS needed).
   • On right-click in the textarea OR the WYSIWYG contenteditable, extract the
     word at the cursor, check it against our dictionary, and show a small
     suggestion popup with up to 6 fixes (Levenshtein distance ≤ 2).
   • Clicking a suggestion replaces the word in place.
   • The native OS context menu is suppressed ONLY when we have suggestions to
     show; otherwise it passes through normally.
───────────────────────────────────────────────────────────────────────────── */

// ── Dictionary ────────────────────────────────────────────────────────────────
// ~1 500 high-frequency English words + common business / meeting vocab.
// Stored as a single string to keep the literal compact; split into a Set once.
const _WORDS_RAW = `
a able about above accept access account across action actions active actually
add address after again against age ago agree ahead all allow almost alone along
already also although always among and another answer any anyone anything
appropriate are area around ask asking at available away back based be because
become been before being below best better between both bring brought build
building business but by call came can carry case change changes check clear
close come comes common complete concern consider continue cost could create
current customer data day deal decided decision depend describe detail develop
different direct discuss do done during each early easy enough entire especially
ever every everyone everything except expected experience explain fact few find
first follow for found from front full further get give goal good got great group
had have help here high home how idea if implement important include increase
information instead into item its keep know large last later learn leave level
like likely list long make many may mean meet meeting members might model more
most move much need network never new next no not now number of off offer on one
only open order other our out over own part people per plan please point possible
present problem provide pull put reach read ready receive report resources result
review right schedule second see send service set show since so some soon start
status still stop strategy such support system take team than that the their them
then there these they think through time to together toward try under until update
use user value very want was well were where while will with within without would
yet

able about achieve action active actual address additional after agenda agree all
allow analysis apply approve assign audit available base baseline benefit best
block brief budget business call case change clarify close collaborate commit
communication complete compliance concern confirm consider consolidate context
continue cost criteria cross data deadline decision deliverable department detail
develop direction document drive due each effort ensure escalate estimate evaluate
every expectation feedback final flag follow forecast framework functional get
give goal governance handle high impact implement improve include increase inform
integrate key knowledge launch lead learn level leverage limit link list low
maintain manage measure meeting milestone next note objective offer ongoing open
output owner part performance pilot plan policy present priority process project
provide quality question reach recommendation reduce report require resolve
resource review risk rollout schedule scope secure send service set share
solution stakeholder status streamline strategy success summary support target
task team test threshold timeline track transition update validate value verify
weekly

accommodate accurate achieve acknowledgment acquisition action active actually
additional adequate adjacent administrator advantage affect agree aligned already
among analyze announcement annual apologize apparent application appropriate
approval approximately assessment associate attempt attendance available because
behavior benefit brief calendar challenge clarify collaborate committee
communication comparison completion compliance concern conflict consideration
continue deadline decisions delivered demonstrate department discussion distribute
effective efficiency emphasis encourage environment escalation essential establish
evaluation evidence expectations experience facilitate feedback following function
generally handle identify immediately implementation important improve including
indicate information initial initiative internal invite management monitor
necessary notice objective opportunity organization outcome overall participant
performance planning present previously priority procedure professional progress
project promote provide qualification quality receive recommendation recurring
reference relevant reminder responsible result review schedule specific standard
strategy structure submission support system target timeline training transition
update validate valuable various weekly whether

absence academy accept accessible accommodate accomplish accurate acknowledge
acquisition actually additionally address adequate adjust administrator advance
affect affirmative agenda aggressive agreement alignment allocate although analyze
announcement apologize appearance application appointment appreciate approach
approval approximately argument arrangement assessment associate attendance audit
available

abbreviate above absence absolutely acceptable accomplished accountable accurate
achieve acknowledge action adequate address adjacent adjust administration
advantage advocacy affect agree alignment allow already always analysis announce
apologize appear applicable approach approval approximately area arrange assert
assume attach attend available avoid basis beneficial binding bring build calendar
capacity challenge check clarify close commitment communicate compare complete
concern confirm consideration continue criteria data deadline decision deliver
demonstrate department design detail develop direct discuss document due effort
eligible enable engage ensure estimate evaluate evidence expectation facilitate
feedback final fiscal flag follow framework function generate goal govern handle
identify implement improve include indicate input integrate issue key launch lead
manage measure milestone monitor need note notify objective offer onboard
ongoing open organize outcome plan present priority process promote provide
quality reach receive recommend reduce report require resolve respond result
review risk schedule share specific stakeholder status strategy success support
target task team timeline track update validate verify

receive separate believe achieve committee occurrence calendar immediately
occasionally necessary particularly relevant schedule whether experience recommend
describe environment beginning appearance reference decision management efficient
performance opportunity available responsible completely necessary colleague
although acknowledge accessible approximately calendar recommend definitely
already achieve receive separate occur necessary calendar believe
received separated believed achieved occurred necessary calendared
beginning appearing referencing decisions managing efficiently performing
opportunities available responsibility completely necessarily colleague
although acknowledging access approximately calendars recommending definitely

ability absence academy accept access account accuracy achieve acknowledgment
acquiring action adjust administrator adoption advantage affect agency agreement
ahead alignment allow alongside already also analyze annual answer apologize
appear application appointment approach approval archive area arrange assessment
assist attach attempt audit authority available
`;

/** Set of known correctly-spelled words (all lower-case). */
const _DICT = new Set(_WORDS_RAW.trim().split(/\s+/).filter(Boolean));

// ── Levenshtein distance ───────────────────────────────────────────────────────
function _lev(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = Uint8Array.from({length: b.length + 1}, (_, i) => i);
  const curr = new Uint8Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev.set(curr);
  }
  return prev[b.length];
}

/** Return up to `limit` dictionary suggestions for `word` within `maxDist`. */
function _suggest(word, maxDist = 2, limit = 6) {
  const w = word.toLowerCase();
  if (_DICT.has(w)) return [];           // correctly spelled — no suggestions
  if (w.length < 3)  return [];           // too short to bother

  const hits = [];
  for (const dw of _DICT) {
    if (Math.abs(dw.length - w.length) > maxDist) continue;  // fast skip
    const d = _lev(w, dw);
    if (d <= maxDist) hits.push([d, dw]);
  }
  hits.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));

  // Preserve original capitalisation
  const cap = word[0] === word[0].toUpperCase();
  return hits.slice(0, limit).map(([, s]) =>
    cap ? s[0].toUpperCase() + s.slice(1) : s
  );
}

// ── Popup ──────────────────────────────────────────────────────────────────────
let _popup = null;

function _closePopup() {
  if (_popup) { _popup.remove(); _popup = null; }
}

function _showPopup(x, y, suggestions, onPick) {
  _closePopup();
  if (!suggestions.length) return;

  const dark = document.documentElement.classList.contains('dark');
  const p = document.createElement('div');
  p.id = 'bw-spell-popup';
  p.setAttribute('role', 'listbox');
  p.setAttribute('aria-label', 'Spelling suggestions');
  Object.assign(p.style, {
    position   : 'fixed',
    zIndex     : '99999',
    left       : x + 'px',
    top        : y + 'px',
    background : dark ? '#27272a' : '#ffffff',
    border     : dark ? '1px solid #52525b' : '1px solid #d1d5db',
    borderRadius: '8px',
    boxShadow  : '0 4px 16px rgba(0,0,0,.18)',
    padding    : '4px 0',
    minWidth   : '160px',
    fontFamily : 'sans-serif',
    fontSize   : '13px',
  });

  // Header
  const hdr = document.createElement('div');
  hdr.textContent = 'Suggestions';
  Object.assign(hdr.style, {
    padding    : '4px 12px 4px',
    fontSize   : '11px',
    fontWeight : '600',
    color      : dark ? '#a1a1aa' : '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: '.05em',
    userSelect : 'none',
  });
  p.appendChild(hdr);

  suggestions.forEach(word => {
    const btn = document.createElement('div');
    btn.textContent = word;
    btn.setAttribute('role', 'option');
    btn.setAttribute('tabindex', '0');
    Object.assign(btn.style, {
      padding : '6px 14px',
      cursor  : 'pointer',
      color   : dark ? '#f4f4f5' : '#111827',
    });
    btn.addEventListener('mouseenter', () => {
      btn.style.background = dark ? '#3f3f46' : '#f3f4f6';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = '';
    });
    const pick = () => { onPick(word); _closePopup(); };
    btn.addEventListener('click', pick);
    btn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') pick(); });
    p.appendChild(btn);
  });

  document.body.appendChild(p);
  _popup = p;

  // Nudge left/up if it clips the viewport
  const rect = p.getBoundingClientRect();
  if (rect.right  > window.innerWidth)  p.style.left = Math.max(0, x - rect.width) + 'px';
  if (rect.bottom > window.innerHeight) p.style.top  = Math.max(0, y - rect.height) + 'px';
}

// ── Word extraction ────────────────────────────────────────────────────────────
/** Extract the word around a character offset in plain text. */
function _wordAt(text, pos) {
  const WORD = /[a-zA-Z']/;
  let start = pos, end = pos;
  while (start > 0 && WORD.test(text[start - 1])) start--;
  while (end < text.length && WORD.test(text[end])) end++;
  return { word: text.slice(start, end), start, end };
}

// ── Textarea handler ──────────────────────────────────────────────────────────
function _onTextareaContext(e) {
  const ta = e.currentTarget;
  const pos = ta.selectionStart;
  const { word, start, end } = _wordAt(ta.value, pos);
  if (!word || word.length < 3) return;

  const suggestions = _suggest(word);
  if (!suggestions.length) return;

  e.preventDefault();
  _showPopup(e.clientX, e.clientY, suggestions, replacement => {
    const before = ta.value.slice(0, start);
    const after  = ta.value.slice(end);
    ta.value = before + replacement + after;
    ta.setSelectionRange(start, start + replacement.length);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus();
  });
}

// ── Contenteditable handler ───────────────────────────────────────────────────
function _wordAtCaret() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const node  = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return null;

  const text = node.textContent;
  const pos  = range.startOffset;
  const { word, start, end } = _wordAt(text, pos);
  if (!word) return null;
  return { word, node, start, end };
}

function _onEditableContext(e) {
  const info = _wordAtCaret();
  if (!info) return;
  const suggestions = _suggest(info.word);
  if (!suggestions.length) return;

  e.preventDefault();
  _showPopup(e.clientX, e.clientY, suggestions, replacement => {
    const range = document.createRange();
    range.setStart(info.node, info.start);
    range.setEnd(info.node,   info.end);
    range.deleteContents();
    range.insertNode(document.createTextNode(replacement));
    const sel = window.getSelection();
    sel.collapse(info.node, info.start + replacement.length);
    info.node.parentElement?.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

// ── Attach / detach ───────────────────────────────────────────────────────────
/** Call this after the note-form is injected into the DOM. */
window.bwSpellInit = function () {
  const ta      = document.getElementById('note-content');
  const preview = document.getElementById('md-live-preview');

  if (ta) {
    ta.removeEventListener('contextmenu', _onTextareaContext);
    ta.addEventListener('contextmenu', _onTextareaContext);
  }
  if (preview) {
    preview.removeEventListener('contextmenu', _onEditableContext);
    preview.addEventListener('contextmenu', _onEditableContext);
  }
};

// Close popup on any outside interaction
document.addEventListener('mousedown', e => {
  if (_popup && !_popup.contains(e.target)) _closePopup();
});
document.addEventListener('keydown',   e => { if (e.key === 'Escape') _closePopup(); });
document.addEventListener('scroll',    _closePopup, true);
