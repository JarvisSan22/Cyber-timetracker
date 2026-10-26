// @ts-check
/** Transcript tab of the side panel (M5): every line of the tab's video, following the playhead.
 * Lines come from storage.session (the content script sends them through the worker); the current line
 * and the seek / mine commands go over a port to the tab's content script. Words are coloured by their
 * Anki status like the subtitle bar, for the rows on screen. */

import { segments, TRANSCRIPT_PORT, transcriptKey } from "../shared/transcript.js";
import { formatTime } from "../shared/subtitles.js";
import { markWords, wordStyleVars } from "../shared/known.js";
import { lookupAt } from "../shared/dictionary/index.js";
import { loadSettings } from "../shared/settings.js";

const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));

/** @typedef {import("../shared/transcript.js").TranscriptRow} TranscriptRow */
/** @typedef {{videoId: string, title: string, lang: string, rows: TranscriptRow[]}} Transcript */

const view = {
  /** @type {number | null} */
  tabId: null,
  /** @type {Transcript | null} */
  data: null,
  /** @type {chrome.runtime.Port | null} */
  port: null,
  index: -1,
  follow: true,
  /** @type {import("../shared/settings.js").Settings | null} */
  settings: null,
  /** @type {import("../shared/known.js").KnownList | null} */
  known: null,
  /** row index -> number of words not in Anki (rows already coloured) */
  /** @type {Map<number, number>} */
  newCounts: new Map(),
  /** rows waiting to be coloured, worked through one at a time */
  /** @type {number[]} */
  queue: [],
  marking: false,
  /** bumped on every new list, so work for an old list stops */
  generation: 0,
  /** @type {(() => void) | null} */
  onMine: null,
  /** Line a Shift-click selects from (the last line clicked). */
  anchor: -1,
  /** Lines selected for one card, inclusive; null: none. */
  /** @type {null | {first: number, last: number}} */
  selection: null,
};

/** More lines than this make a clip too long for a card. */
const MAX_LINES = 10;

/** Rows coming into view get their words coloured. */
const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) if (entry.isIntersecting) enqueue(Number(/** @type {HTMLElement} */ (entry.target).dataset.i));
  },
  { rootMargin: "300px 0px" },
);

/**
 * Called once by the side panel.
 * @param {{onMine: () => void}} options onMine: a line was sent to be mined (the panel shows the Card tab)
 */
export function initTranscript({ onMine }) {
  view.onMine = onMine;
  const list = $("t-list");
  list.addEventListener("click", (/** @type {MouseEvent} */ e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const row = /** @type {HTMLElement | null} */ (target.closest(".t-row"));
    if (!row) return;
    const index = Number(row.dataset.i);
    if (target.closest(".t-mine")) {
      const sel = view.selection;
      if (sel && index >= sel.first && index <= sel.last) mineSelection();
      else mineLines(index, index);
    } else if (e.shiftKey && (view.anchor >= 0 || view.index >= 0)) {
      // Select from the last clicked line (or the current one) to this one; the video stays where it is.
      const anchor = view.anchor >= 0 ? view.anchor : view.index;
      const first = Math.min(anchor, index);
      select({ first, last: Math.min(Math.max(anchor, index), first + MAX_LINES - 1) });
    } else {
      view.anchor = index;
      select(null);
      send({ type: "seek", index });
    }
  });
  // Shift-click would also select the page's text.
  list.addEventListener("mousedown", (/** @type {MouseEvent} */ e) => e.shiftKey && e.preventDefault());
  $("t-sel-mine").addEventListener("click", () => mineSelection());
  $("t-sel-clear").addEventListener("click", () => select(null));
  // Scrolling by hand stops following the video until "Follow" is pressed again.
  for (const type of ["wheel", "touchmove"]) list.addEventListener(type, () => setFollow(false), { passive: true });
  $("t-follow").addEventListener("click", () => setFollow(true));
  $("t-new-only").addEventListener("change", () => applyFilter());

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "session" && view.tabId !== null && changes[transcriptKey(view.tabId)]) {
      setData(changes[transcriptKey(view.tabId)].newValue ?? null);
    }
    if (area === "local" && changes.knownWords) {
      view.known = changes.knownWords.newValue ?? null;
      recolour();
    }
    if (area === "sync" && changes.settings) loadSettings().then(applySettings);
  });
  loadSettings().then(applySettings);
  chrome.storage.local.get("knownWords").then((s) => {
    view.known = s.knownWords ?? null;
    recolour();
  });
}

/** The panel now shows this browser tab. @param {number | null} tabId */
export async function showTranscriptFor(tabId) {
  if (tabId === view.tabId) return;
  view.tabId = tabId;
  disconnect();
  const data = tabId === null ? null : (await chrome.storage.session.get(transcriptKey(tabId)))[transcriptKey(tabId)] ?? null;
  if (tabId === view.tabId) setData(data);
}

/** @typedef {{tabId: number | null, data: Transcript | null, settings: import("../shared/settings.js").Settings | null}} TranscriptState */
/** @type {((state: TranscriptState) => void)[]} */
const listeners = [];

/** Called now and whenever the tab, its lines or the settings change (condensed audio box). */
export function onTranscriptChange(/** @type {(state: TranscriptState) => void} */ fn) {
  listeners.push(fn);
  fn({ tabId: view.tabId, data: view.data, settings: view.settings });
}

function notify() {
  for (const fn of listeners) fn({ tabId: view.tabId, data: view.data, settings: view.settings });
}

export function hasTranscript() {
  return Boolean(view.data?.rows.length);
}

/** @param {import("../shared/settings.js").Settings} settings */
function applySettings(settings) {
  const recolourNeeded = JSON.stringify(settings.known) !== JSON.stringify(view.settings?.known);
  view.settings = settings;
  for (const [key, value] of Object.entries(wordStyleVars(settings.known.colors))) $("transcript").style.setProperty(`--${key}`, value);
  const mode = settings.overlay.translation;
  for (const el of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll(".t-tr"))) {
    el.hidden = mode === "hide";
    el.classList.toggle("blur", mode === "blur");
  }
  if (recolourNeeded) recolour();
  notify();
}

/** @param {Transcript | null} data */
function setData(data) {
  const sameVideo = data && view.data && data.videoId === view.data.videoId;
  view.data = data;
  view.generation++;
  view.newCounts.clear();
  view.queue = [];
  if (!sameVideo) {
    view.index = -1;
    view.anchor = -1;
    view.selection = null;
    setFollow(true);
  }
  render();
  connect(); // a reloaded page drops the port; a new video may come from a new page
  notify();
}

function render() {
  const data = view.data;
  const list = $("t-list");
  observer.disconnect();
  $("t-empty").hidden = Boolean(data?.rows.length);
  $("t-title").textContent = data?.title ?? "";
  $("t-count").textContent = data ? `${data.rows.length} lines · ${data.lang.toUpperCase()}` : "";
  if (!data) {
    list.replaceChildren();
    return;
  }
  const mode = view.settings?.overlay.translation ?? "blur";
  list.replaceChildren(
    ...data.rows.map((row) => {
      const li = el("li", "t-row");
      li.dataset.i = String(row.i);
      const line = el("div", "t-line", row.sentence);
      line.lang = data.lang;
      const tr = el("div", `t-tr${mode === "blur" ? " blur" : ""}`, row.translation);
      tr.hidden = mode === "hide" || !row.translation;
      const side = el("div", "t-side");
      const count = el("span", "t-new");
      count.hidden = true;
      const mine = el("button", "t-mine", "⌬");
      /** @type {HTMLButtonElement} */ (mine).type = "button";
      mine.title = "Mine this line";
      side.append(count, mine);
      const text = el("div", "t-text");
      text.append(line, tr);
      li.append(el("span", "t-time", formatTime(row.start_ms)), text, side);
      observer.observe(li);
      return li;
    }),
  );
  if (view.index >= 0) highlight(view.index);
  select(view.selection);
  applyFilter();
}

/**
 * @param {string} tag
 * @param {string} className
 * @param {string} [text]
 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

// --- the tab's content script ---

function connect() {
  if (view.port || view.tabId === null || !view.data) return;
  try {
    const port = chrome.tabs.connect(view.tabId, { name: TRANSCRIPT_PORT });
    port.onMessage.addListener((/** @type {{type: string, videoId: string, index: number}} */ msg) => {
      if (msg.type === "position" && msg.videoId === view.data?.videoId) highlight(msg.index);
    });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError; // no content script there (yet)
      if (view.port === port) view.port = null;
    });
    view.port = port;
  } catch {
    view.port = null;
  }
}

function disconnect() {
  view.port?.disconnect();
  view.port = null;
}

/** @typedef {{type: "seek" | "mine", index: number, last?: number, stopCondense?: boolean}} Command */

/** Asked before each command is sent; false drops it (the condensed audio box asks to stop its recording). */
/** @type {(msg: Command, tabId: number | null) => boolean} */
let beforeSend = () => true;

export function guardCommands(/** @type {(msg: Command, tabId: number | null) => boolean} */ fn) {
  beforeSend = fn;
}

/** @param {Command} msg @returns {boolean} false when the command was dropped */
function send(msg) {
  if (!beforeSend(msg, view.tabId)) return false;
  connect();
  try {
    view.port?.postMessage(msg);
  } catch {
    view.port = null;
  }
  return true;
}

// --- selecting several lines for one card ---

/** @param {null | {first: number, last: number}} sel */
function select(sel) {
  view.selection = sel;
  for (const li of /** @type {NodeListOf<HTMLElement>} */ ($("t-list").querySelectorAll(".t-row.selected"))) li.classList.remove("selected");
  $("t-selection").hidden = !sel;
  if (!sel) return;
  for (let i = sel.first; i <= sel.last; i++) $("t-list").querySelector(`.t-row[data-i="${i}"]`)?.classList.add("selected");
  const n = sel.last - sel.first + 1;
  $("t-sel-count").textContent = `${n} line${n === 1 ? "" : "s"} selected${n === MAX_LINES ? " (most for one card)" : ""}`;
}

function mineSelection() {
  if (view.selection) mineLines(view.selection.first, view.selection.last);
}

/** @param {number} first @param {number} last */
function mineLines(first, last) {
  if (!send({ type: "mine", index: first, last })) return;
  select(null);
  view.onMine?.();
}

// --- current line and following ---

/** @param {number} index */
function highlight(index) {
  const list = $("t-list");
  list.querySelector(".t-row.current")?.classList.remove("current");
  view.index = index;
  const row = /** @type {HTMLElement | null} */ (list.querySelector(`.t-row[data-i="${index}"]`));
  if (!row) return;
  row.classList.add("current");
  if (view.follow && !$("transcript").hidden) row.scrollIntoView({ block: "center", behavior: "smooth" });
}

/** @param {boolean} on */
function setFollow(on) {
  view.follow = on;
  $("t-follow").classList.toggle("active", on);
  $("t-follow").setAttribute("aria-pressed", String(on));
  if (on && view.index >= 0) highlight(view.index);
}

/** Scroll to the current line when the tab is shown again. */
export function onTranscriptShown() {
  if (view.follow && view.index >= 0) highlight(view.index);
}

// --- known words ---

function colouring() {
  return Boolean(view.settings?.known.enabled && view.known && view.data);
}

/** Colours changed (new list, new settings): do the visible rows again. */
function recolour() {
  view.generation++;
  view.newCounts.clear();
  view.queue = [];
  const list = $("t-list");
  for (const li of /** @type {NodeListOf<HTMLElement>} */ (list.querySelectorAll(".t-row"))) {
    const row = view.data?.rows[Number(li.dataset.i)];
    if (!row) continue;
    li.querySelector(".t-line").textContent = row.sentence;
    /** @type {HTMLElement} */ (li.querySelector(".t-new")).hidden = true;
    observer.unobserve(li);
    observer.observe(li); // fires again for rows on screen
  }
  applyFilter();
}

/** @param {number} i */
function enqueue(i) {
  if (!colouring() || view.newCounts.has(i) || view.queue.includes(i)) return;
  view.queue.push(i);
  if (!view.marking) workQueue();
}

async function workQueue() {
  view.marking = true;
  const generation = view.generation;
  while (view.queue.length && generation === view.generation && colouring()) {
    const i = /** @type {number} */ (view.queue.shift());
    const data = /** @type {Transcript} */ (view.data);
    const row = data.rows[i];
    const known = /** @type {import("../shared/known.js").KnownList} */ (view.known);
    const marks = await markWords(row.sentence, data.lang, (s, o) => lookupAt(data.lang, s, o), known.words[data.lang]).catch(() => []);
    if (generation !== view.generation) break;
    paintRow(i, marks);
  }
  view.marking = false;
  if (view.queue.length && colouring()) workQueue();
  if ($("t-new-only").checked) updateFilterCount();
}

/**
 * @param {number} i
 * @param {import("../shared/known.js").WordMark[]} marks
 */
function paintRow(i, marks) {
  const li = /** @type {HTMLElement | null} */ ($("t-list").querySelector(`.t-row[data-i="${i}"]`));
  const row = view.data?.rows[i];
  if (!li || !row) return;
  const line = li.querySelector(".t-line");
  line.replaceChildren(...segments(row.sentence, marks).map((seg) => (seg.status ? el("span", `w-${seg.status}`, seg.text) : document.createTextNode(seg.text))));
  const unknown = marks.filter((m) => m.status === "unknown").length;
  view.newCounts.set(i, unknown);
  const count = /** @type {HTMLElement} */ (li.querySelector(".t-new"));
  count.textContent = `${unknown} new`;
  count.hidden = unknown === 0;
  if ($("t-new-only").checked) li.classList.toggle("t-hidden", unknown === 0);
}

// --- "Lines with new words" ---

function applyFilter() {
  const on = $("t-new-only").checked;
  for (const li of /** @type {NodeListOf<HTMLElement>} */ ($("t-list").querySelectorAll(".t-row"))) {
    const n = view.newCounts.get(Number(li.dataset.i));
    li.classList.toggle("t-hidden", on && n === 0);
  }
  if (on && view.data) {
    // Every line needs its count: queue them all, in order.
    for (const row of view.data.rows) enqueue(row.i);
    updateFilterCount();
  } else if (view.data) {
    $("t-count").textContent = `${view.data.rows.length} lines · ${view.data.lang.toUpperCase()}`;
  }
}

function updateFilterCount() {
  const data = view.data;
  if (!data) return;
  if (!colouring()) {
    $("t-count").textContent = "Known words are off or not read from Anki yet (Options > Known words)";
    return;
  }
  const done = view.newCounts.size;
  const withNew = [...view.newCounts.values()].filter((n) => n > 0).length;
  $("t-count").textContent = done < data.rows.length ? `Checking lines… ${done}/${data.rows.length}` : `${withNew} of ${data.rows.length} lines have new words`;
}
