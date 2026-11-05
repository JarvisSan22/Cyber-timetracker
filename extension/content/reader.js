// @ts-check
/** Page reader (M8): hold the modifier key (Shift by default) and hover written text on any page for the
 * dictionary entry and the word's status in Anki; "Make card" opens the side panel with the sentence and the
 * word picked, like a click on the subtitle bar. Never on the subtitle bar, the site's own captions, form
 * fields or editable text. Lookups go through the worker: the dictionaries are in the extension's IndexedDB. */

import { ask, MSG } from "../shared/messages.js";
import { loadSettings } from "../shared/settings.js";
import { collapseSpaces, sentenceAround } from "../shared/reader.js";
import { createReaderPopup } from "./reader-popup.js";

/** Elements whose text is never read: our own UI, subtitles (ours and the sites'), form fields, editors. */
const EXCLUDED = [
  "#cyber-miner-overlay",
  "#cyber-miner-reader",
  ".ytp-caption-window-container",
  ".caption-window",
  ".player-timedtext",
  "input",
  "textarea",
  "select",
  "[contenteditable]:not([contenteditable='false'])",
  "script",
  "style",
  "noscript",
  "rt",
  "rp",
].join(",");
/** Text in these is skipped when the block's text is put together (furigana, code that is not shown). */
const SKIPPED = new Set(["RT", "RP", "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);
/** How far around the hovered text node the block's text is read (characters each way). */
const CONTEXT = 1200;
const HIGHLIGHT = "cyber-miner-reader";

/** @typedef {{node: Text, start: number}} Piece  a text node and where its text starts in the block */

const state = {
  /** @type {import("../shared/settings.js").Settings | null} */
  settings: null,
  x: -1,
  y: -1,
  frame: 0,
  token: 0,
  /** Sentence and offset of what the popup shows (same spot again: nothing to do). */
  shownKey: "",
  /** @type {{lang: string, sentence: string, start: number, end: number} | null} */
  current: null,
  hideTimer: 0,
};

/** @type {ReturnType<typeof createReaderPopup>} */
let popup;

export async function start() {
  state.settings = await loadSettings();
  popup = createReaderPopup({ onMakeCard: makeCard, onClose: hide }, await loadSheets());
  document.documentElement.append(popup.host);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, await pageSheet()];
  applyTheme();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.settings)
      loadSettings().then((s) => {
        state.settings = s;
        if (!s.reader.enabled) hide();
      });
    if (area === "local" && changes.trackerTheme) applyTheme();
    if (area === "local" && changes.knownWords) state.shownKey = ""; // status may have changed
  });
  document.addEventListener("mousemove", onMove, { passive: true, capture: true });
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("mousedown", (e) => {
    if (popup.visible && !e.composedPath().includes(popup.host)) hide();
  }, true);
  window.addEventListener("scroll", () => popup.visible && hide(), { passive: true, capture: true });
  window.addEventListener("blur", () => hide());
}

function applyTheme() {
  ask(MSG.THEME_REFRESH)
    .then((theme) => popup.setTheme(theme.vars))
    .catch(() => {});
}

/** The modifier from Options is held during this event. @param {MouseEvent | KeyboardEvent} e */
function held(e) {
  const key = state.settings?.reader.modifier ?? "shift";
  return key === "alt" ? e.altKey : key === "ctrl" ? e.ctrlKey : e.shiftKey;
}

/** @param {MouseEvent} e */
function onMove(e) {
  if (!chrome.runtime?.id) return; // extension reloaded: this script is orphaned
  state.x = e.clientX;
  state.y = e.clientY;
  if (!state.settings?.reader.enabled) return;
  if (popup.visible && popup.contains(e.clientX, e.clientY)) {
    clearTimeout(state.hideTimer);
    return;
  }
  if (held(e)) {
    clearTimeout(state.hideTimer);
    if (!state.frame) state.frame = requestAnimationFrame(() => ((state.frame = 0), scan()));
  } else if (popup.visible && !state.hideTimer) {
    // Moved away without the key: close, unless the pointer is on its way into the popup.
    state.hideTimer = setTimeout(() => {
      state.hideTimer = 0;
      if (!popup.contains(state.x, state.y)) hide();
    }, 350);
  }
}

/** @param {KeyboardEvent} e */
function onKey(e) {
  if (!state.settings?.reader.enabled) return;
  if (e.key === "Escape" && popup.visible) return hide();
  // Shift for a capital letter while typing is not a lookup.
  const target = e.composedPath()[0];
  if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
  const key = { shift: "Shift", alt: "Alt", ctrl: "Control" }[state.settings.reader.modifier] ?? "Shift";
  // The key pressed with the pointer already resting on a word.
  if (e.key === key && !e.repeat && state.x >= 0 && !popup.contains(state.x, state.y)) scan();
}

function hide() {
  clearTimeout(state.hideTimer);
  state.hideTimer = 0;
  state.shownKey = "";
  state.current = null;
  state.token++;
  popup?.hide();
  /** @type {any} */ (CSS).highlights?.delete(HIGHLIGHT);
}

// --- what is under the pointer ---

/**
 * The character under the point: its text node and offset, or null when the point is not on text.
 * @param {number} x
 * @param {number} y
 * @returns {{node: Text, offset: number} | null}
 */
function charAt(x, y) {
  const doc = /** @type {any} */ (document);
  let node = null;
  let offset = 0;
  if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(x, y);
    if (pos) ({ offsetNode: node, offset } = pos);
  } else if (doc.caretRangeFromPoint) {
    const range = doc.caretRangeFromPoint(x, y);
    if (range) ({ startContainer: node, startOffset: offset } = range);
  }
  if (!(node instanceof Text) || !node.data.length) return null;
  // The caret falls between characters: the one under the pointer is after it or, on its right half,
  // before it. Either way the point must be inside that character's box (the caret API also answers for
  // empty space next to text).
  for (const i of [offset, offset - 1]) {
    if (i < 0 || i >= node.data.length) continue;
    const range = document.createRange();
    range.setStart(node, i);
    range.setEnd(node, i + 1);
    for (const r of range.getClientRects()) {
      if (x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 1 && y <= r.bottom + 1) return { node, offset: i };
    }
  }
  return null;
}

/** Nearest ancestor laid out as a block (paragraph, list item, cell, heading…). @param {Node} node */
function blockOf(node) {
  let el = node.parentElement;
  while (el && el !== document.body) {
    const display = getComputedStyle(el).display;
    if (!display.startsWith("inline") && !display.startsWith("ruby") && display !== "contents") return el;
    el = el.parentElement;
  }
  return el ?? document.body;
}

/**
 * The block's text around the hovered node, as pieces that map back to the page. Line wraps and indents in
 * the HTML count as spaces; <br> is a line break.
 * @param {Element} block
 * @param {Text} target
 * @returns {{raw: string, pieces: Piece[], at: number}} at: where the target node starts in raw
 */
function blockText(block, target) {
  /** @type {(Text | "br")[]} */
  const parts = [];
  let targetIndex = -1;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) =>
      n instanceof Element
        ? SKIPPED.has(n.tagName)
          ? NodeFilter.FILTER_REJECT
          : n.tagName === "BR"
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_SKIP
        : NodeFilter.FILTER_ACCEPT,
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n === target) targetIndex = parts.length;
    parts.push(n instanceof Text ? n : "br");
  }
  // Only the text near the target: a huge block (a page with no paragraphs) stays cheap.
  let from = targetIndex;
  let to = targetIndex;
  for (let len = 0; from > 0 && len < CONTEXT; ) len += partLength(parts[--from]);
  for (let len = 0; to < parts.length - 1 && len < CONTEXT; ) len += partLength(parts[++to]);
  let raw = "";
  /** @type {Piece[]} */
  const pieces = [];
  let at = 0;
  for (let i = from; i <= to; i++) {
    const part = parts[i];
    if (part === "br") {
      raw += "\n";
      continue;
    }
    if (part === target) at = raw.length;
    pieces.push({ node: part, start: raw.length });
    raw += part.data.replace(/\s/g, " ");
  }
  return { raw, pieces, at };
}

/** @param {Text | "br"} part */
const partLength = (part) => (part === "br" ? 1 : part.data.length);

/**
 * Page position of a character of the block's raw text.
 * @param {Piece[]} pieces
 * @param {number} index
 */
function pointOf(pieces, index) {
  let piece = pieces[0];
  for (const p of pieces) {
    if (p.start > index) break;
    piece = p;
  }
  return { node: piece.node, offset: Math.min(index - piece.start, piece.node.data.length) };
}

// --- look up and show ---

async function scan() {
  const settings = state.settings;
  if (!settings?.reader.enabled || !chrome.runtime?.id) return;
  const { x, y } = state;
  const el = document.elementFromPoint(x, y);
  if (!el || el.closest(EXCLUDED)) return;
  const hit = charAt(x, y);
  if (!hit || hit.node.parentElement?.closest(EXCLUDED)) return;
  if (!/[\p{L}\p{M}]/u.test(hit.node.data[hit.offset])) return;

  const { raw, pieces, at } = blockText(blockOf(hit.node), hit.node);
  const { text, map } = collapseSpaces(raw);
  const rawIndex = at + hit.offset;
  const index = Math.max(0, map.findIndex((i) => i >= rawIndex));
  const { sentence, offset } = sentenceAround(text, index);
  const sentenceStart = index - offset; // in text
  const key = `${offset}\n${sentence}`;
  if (key === state.shownKey) return;

  const token = ++state.token;
  /** @type {any} */
  const answer = await ask(MSG.READER_LOOKUP, { sentence, offset, pageLang: document.documentElement.lang }).catch(() => null);
  if (token !== state.token) return;
  if (!answer) return; // not a language you study
  if (!answer.result?.entries.length) {
    // No word starts here. Without a dictionary, say so once instead of staying silent.
    if (answer.installed) return;
    state.shownKey = key;
    popup.showMessage(`No ${answer.lang.toUpperCase()} dictionary imported (Options → Dictionaries)`, charRect(hit));
    return;
  }

  const { start, end } = answer.result;
  // Back from the sentence to the page: sentence offsets -> collapsed text -> raw text -> text nodes.
  const from = pointOf(pieces, map[sentenceStart + start]);
  const to = pointOf(pieces, map[sentenceStart + end - 1] + 1);
  const range = document.createRange();
  try {
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
  } catch {
    range.setStart(hit.node, hit.offset);
    range.setEnd(hit.node, hit.offset + 1);
  }
  const highlights = /** @type {any} */ (CSS).highlights;
  if (highlights && typeof Highlight !== "undefined") highlights.set(HIGHLIGHT, new Highlight(range));

  state.shownKey = key;
  state.current = { lang: answer.lang, sentence, start, end };
  popup.show(answer, sentence.slice(start, end), range.getBoundingClientRect());
}

/** @param {{node: Text, offset: number}} hit */
function charRect(hit) {
  const range = document.createRange();
  range.setStart(hit.node, hit.offset);
  range.setEnd(hit.node, hit.offset + 1);
  return range.getBoundingClientRect();
}

// --- card ---

/** "Make card": side panel first (while the click is a user gesture), then the draft it shows. */
function makeCard() {
  const current = state.current;
  const settings = state.settings;
  if (!current || !settings) return;
  ask(MSG.OPEN_SIDEBAR).catch(() => popup.showMessage("Open the side panel from the ⌬ toolbar popup", null, true));
  const lang = /** @type {"ja" | "zh" | "it"} */ (current.lang);
  ask(MSG.DRAFT_START, {
    draft: {
      lang,
      sentence: current.sentence,
      source: document.title || location.hostname,
      sourceUrl: location.href,
      site: location.hostname,
    },
    meta: {
      deck: settings.anki.decks[lang],
      // A page has no audio or picture: the side panel hides those parts.
      audio: { state: "none" },
      pick: { start: current.start, end: current.end },
      textRev: 0,
    },
  })
    .then(() => hide())
    .catch((e) => popup.showMessage(e instanceof Error ? e.message : String(e), null, true));
}

// --- styles ---

async function loadSheets() {
  const sheets = [];
  for (const path of ["vendor/augmented-ui.min.css", "styles/reader.css"]) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(await (await fetch(chrome.runtime.getURL(path))).text());
    sheets.push(sheet);
  }
  return sheets;
}

/** Fonts (@font-face only works at document level) and the colour of the hovered word on the page. */
async function pageSheet() {
  const sheet = new CSSStyleSheet();
  const url = (/** @type {string} */ f) => chrome.runtime.getURL(`vendor/fonts/${f}`);
  sheet.replaceSync(
    [500, 600, 700]
      .map((w) => `@font-face { font-family: "Rajdhani"; font-weight: ${w}; src: url("${url(`rajdhani-latin-${w}.woff2`)}") format("woff2"); }`)
      .join("\n") +
      `\n@font-face { font-family: "Share Tech Mono"; src: url("${url("share-tech-mono-latin-400.woff2")}") format("woff2"); }` +
      `\n::highlight(${HIGHLIGHT}) { background-color: rgba(252, 238, 10, 0.35); color: inherit; }`,
  );
  return sheet;
}
