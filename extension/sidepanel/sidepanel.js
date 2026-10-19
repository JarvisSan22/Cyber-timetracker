// @ts-check
/** Card editor in Chrome's side panel: shows the active tab's draft, picks the target word, sends to Anki. */

import { ask, MSG, draftKey } from "../shared/messages.js";
import { applyTheme } from "../shared/theme.js";
import { BRAND_SVG } from "../shared/brand.js";
import { fallbackWordAt } from "../shared/wordpick.js";
import { forgetInstalled, hasDictionary, lookupAt } from "../shared/dictionary/index.js";

const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));

/**
 * @typedef {object} DraftRecord
 * @property {number} draftId
 * @property {number} tabId
 * @property {import("../shared/card.js").CardDraft} draft
 * @property {{deck: string, audio: {state: string, seconds?: number, message?: string}, pick?: {start: number, end?: number}}} meta
 */

const state = {
  /** @type {number | null} */
  tabId: null,
  /** @type {DraftRecord | null} */
  record: null,
  sentence: "",
  /** @type {{start: number, end: number} | null} */
  selection: null,
  lookupToken: 0,
  /** @type {number[]} pitch of the dictionary entry in use (ja) */
  pitch: [],
};

$("brand-mark").innerHTML = BRAND_SVG;
ask(MSG.THEME_REFRESH).then((theme) => applyTheme(document.documentElement, theme)).catch(() => {});

// --- which tab, which draft ---

const windowId = (await chrome.windows.getCurrent()).id;

async function followActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  state.tabId = tab?.id ?? null;
  await loadDraft();
}

async function loadDraft() {
  const record = state.tabId === null ? null : (await chrome.storage.session.get(draftKey(state.tabId)))[draftKey(state.tabId)] ?? null;
  show(record);
}

chrome.tabs.onActivated.addListener((info) => {
  if (info.windowId === windowId) followActiveTab();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && state.tabId !== null && changes[draftKey(state.tabId)]) show(changes[draftKey(state.tabId)].newValue ?? null);
  if (area === "local" && changes.dictsChanged) forgetInstalled();
  if (area === "local" && changes.trackerTheme) ask(MSG.THEME_REFRESH).then((t) => applyTheme(document.documentElement, t)).catch(() => {});
});
await followActiveTab();

// --- render ---

/** @param {DraftRecord | null} record */
function show(record) {
  const isNew = record?.draftId !== state.record?.draftId;
  state.record = record;
  $("empty").hidden = Boolean(record);
  $("editor").hidden = !record;
  $("lang").hidden = !record;
  if (!record) return;
  if (isNew) fillForm(record);
  showMedia(record);
}

/** @param {DraftRecord} record */
function fillForm(record) {
  const { draft, meta } = record;
  $("lang").textContent = draft.lang.toUpperCase();
  $("sentence").lang = draft.lang;
  setSentence(draft.sentence);
  $("word").value = draft.word ?? "";
  $("reading").value = draft.wordReading ?? "";
  $("reading").placeholder = { ja: "食[た]べる", zh: "xuéxí", it: "" }[draft.lang] ?? "";
  $("definition").value = (draft.definitions ?? []).join("\n");
  $("translation").value = draft.translation ?? "";
  $("notes").value = draft.notes ?? "";
  $("deck").textContent = `Deck: ${meta.deck} · ${draft.source ?? ""}`;
  state.pitch = [];
  $("dup").hidden = true;
  $("error").hidden = true;
  $("lookup").hidden = true;
  $("sentence-edit").hidden = true;
  $("sentence").hidden = false;
  if (meta.pick) pick(meta.pick.start, meta.pick.end);
}

/** @param {DraftRecord} record */
function showMedia({ draft, meta }) {
  const shot = $("shot");
  const src = draft.picture ? `data:image/jpeg;base64,${draft.picture.data}` : "";
  if (src && shot.querySelector("img")?.src !== src) {
    const img = document.createElement("img");
    img.src = src;
    img.alt = "";
    shot.replaceChildren(img);
  } else if (!src) {
    shot.replaceChildren(meta.audio.state === "recording" ? "Capturing…" : "No picture (frame not readable)");
  }
  const audio = $("audio");
  const ready = meta.audio.state === "ready" && draft.audio;
  const audioSrc = ready ? `data:audio/mpeg;base64,${/** @type {any} */ (draft.audio).data}` : "";
  if (audio.getAttribute("src") !== audioSrc) {
    if (audioSrc) audio.src = audioSrc;
    else audio.removeAttribute("src");
  }
  audio.hidden = !ready;
  $("audio-state").textContent = ready
    ? `${meta.audio.seconds?.toFixed(1) ?? ""} s`
    : { recording: "Recording…", encoding: "Encoding MP3…", error: meta.audio.message ?? "No audio" }[meta.audio.state] ?? "";
  const busy = meta.audio.state === "recording" || meta.audio.state === "encoding";
  $("rerecord").disabled = busy;
  $("send").disabled = busy;
}

// --- sentence and word picking ---

/** @param {string} text */
function setSentence(text) {
  state.sentence = text;
  state.selection = null;
  const box = $("sentence");
  box.replaceChildren();
  let i = 0;
  for (const ch of text) {
    const span = document.createElement("span");
    span.textContent = ch;
    span.dataset.i = String(i);
    i += ch.length;
    box.append(span);
  }
}

function paintSelection() {
  const sel = state.selection;
  for (const span of $("sentence").children) {
    const i = Number(span.dataset.i);
    span.classList.toggle("sel", Boolean(sel && i >= sel.start && i < sel.end));
  }
}

/** @param {EventTarget | null} el */
function offsetOf(el) {
  const span = /** @type {HTMLElement | null} */ (el instanceof HTMLElement ? el.closest("#sentence > span") : null);
  return span ? Number(span.dataset.i) : null;
}

/** @param {number} i */
function charEnd(i) {
  return i + ([...state.sentence.slice(i)][0]?.length ?? 1);
}

/** @type {number | null} */
let dragFrom = null;
$("sentence").addEventListener("pointerdown", (/** @type {PointerEvent} */ e) => {
  dragFrom = offsetOf(e.target);
  if (dragFrom !== null) {
    state.selection = { start: dragFrom, end: charEnd(dragFrom) };
    paintSelection();
  }
});
$("sentence").addEventListener("pointermove", (/** @type {PointerEvent} */ e) => {
  if (dragFrom === null || !(e.buttons & 1)) return;
  const at = offsetOf(document.elementFromPoint(e.clientX, e.clientY));
  if (at === null) return;
  state.selection = { start: Math.min(dragFrom, at), end: charEnd(Math.max(dragFrom, at)) };
  paintSelection();
});
window.addEventListener("pointerup", (e) => {
  if (dragFrom === null) return;
  const at = offsetOf(document.elementFromPoint(e.clientX, e.clientY)) ?? dragFrom;
  const from = dragFrom;
  dragFrom = null;
  if (at === from) pick(from);
  else pick(Math.min(from, at), charEnd(Math.max(from, at)));
});

/**
 * Click (no end): longest dictionary word from that character. Drag (end): exactly that text.
 * @param {number} start
 * @param {number} [end]
 */
async function pick(start, end) {
  const record = state.record;
  if (!record) return;
  const lang = record.draft.lang;
  const token = ++state.lookupToken;
  const result = await lookupAt(lang, state.sentence, start, end).catch(() => null);
  if (token !== state.lookupToken) return;
  const range = result ? { start: result.start, end: result.end } : end !== undefined ? { start, end } : fallbackWordAt(state.sentence, start, lang);
  if (!range) return;
  state.selection = range;
  paintSelection();
  const text = state.sentence.slice(range.start, range.end);
  showLookup(result, text, await hasDictionary(lang));
  if (result?.entries.length) useEntry(result.entries[0]);
  else {
    $("word").value = text;
    $("reading").value = lang === "ja" ? text : "";
  }
}

/**
 * @param {import("../shared/dictionary/index.js").LookupResult | null} result
 * @param {string} text
 * @param {boolean} installed
 */
function showLookup(result, text, installed) {
  const box = $("lookup");
  box.hidden = false;
  if (!result?.entries.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = installed
      ? `“${text}” — no dictionary entry. Type the definition below.`
      : `“${text}” — no dictionary imported for this language (Options → Dictionaries). Type the definition below.`;
    box.replaceChildren(p);
    return;
  }
  box.replaceChildren(...result.entries.map(entryView));
}

/** @param {import("../shared/dictionary/index.js").Entry} entry */
function entryView(entry) {
  const el = document.createElement("div");
  el.className = "entry";
  const head = document.createElement("div");
  head.className = "head";
  const term = Object.assign(document.createElement("span"), { className: "term", textContent: entry.term });
  const reading = Object.assign(document.createElement("span"), { className: "reading", textContent: entry.reading });
  head.append(term, reading);
  if (entry.pitch.length) head.append(Object.assign(document.createElement("span"), { className: "pitch", textContent: entry.pitch.map((p) => `[${p}]`).join(" ") }));
  const use = Object.assign(document.createElement("button"), { type: "button", className: "use secondary", textContent: "Use" });
  use.addEventListener("click", () => useEntry(entry));
  head.append(use);
  el.append(head);
  if (entry.note) el.append(Object.assign(document.createElement("p"), { className: "note", textContent: entry.note }));
  const list = document.createElement("ol");
  for (const sense of entry.senses.slice(0, 5)) {
    const li = document.createElement("li");
    if (sense.pos.length) li.append(Object.assign(document.createElement("span"), { className: "pos", textContent: sense.pos.join(", ") }));
    li.append(sense.glosses.join("; "));
    list.append(li);
  }
  el.append(list);
  return el;
}

/** @param {import("../shared/dictionary/index.js").Entry} entry */
function useEntry(entry) {
  $("word").value = entry.term;
  $("reading").value = entry.furigana || entry.reading;
  $("definition").value = entry.senses
    .slice(0, 3)
    .map((s) => s.glosses.join("; "))
    .join("\n");
  state.pitch = entry.pitch;
}

// A word typed by hand has no pitch from the dictionary entry.
$("word").addEventListener("input", () => (state.pitch = []));

$("edit-sentence").addEventListener("click", () => {
  const editing = $("sentence-edit").hidden;
  if (editing) {
    $("sentence-edit").value = state.sentence;
    $("sentence-edit").hidden = false;
    $("sentence").hidden = true;
    $("edit-sentence").textContent = "✓ Done";
    $("sentence-edit").focus();
  } else {
    setSentence($("sentence-edit").value.trim());
    $("sentence-edit").hidden = true;
    $("sentence").hidden = false;
    $("edit-sentence").textContent = "✎ Edit";
  }
});

// --- actions ---

$("rerecord").addEventListener("click", () => {
  const record = state.record;
  if (record) chrome.tabs.sendMessage(record.tabId, { type: MSG.RERECORD, draftId: record.draftId }).catch(() => {});
});

$("discard").addEventListener("click", () => {
  if (state.record) ask(MSG.DRAFT_CLEAR, { tabId: state.record.tabId }).catch(() => {});
});

$("send").addEventListener("click", () => send(false));
$("send-anyway").addEventListener("click", () => send(true));
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && state.record && !$("send").disabled) send(false);
});

/** @param {boolean} allowDuplicate */
async function send(allowDuplicate) {
  const record = state.record;
  if (!record) return;
  if (!$("sentence-edit").hidden) $("edit-sentence").click(); // keep an unfinished edit
  const draft = {
    ...record.draft,
    sentence: state.sentence,
    highlight: state.selection,
    word: $("word").value.trim(),
    wordReading: $("reading").value.trim(),
    definitions: $("definition").value.split("\n").map((/** @type {string} */ l) => l.trim()).filter(Boolean),
    pitch: state.pitch,
    translation: $("translation").value.trim(),
    notes: $("notes").value.trim(),
  };
  $("send").disabled = true;
  $("error").hidden = true;
  try {
    const r = await ask(MSG.MINE_CARD, { draft, allowDuplicate });
    if (r.duplicate) {
      $("dup").hidden = false;
      $("send").disabled = false;
      return;
    }
    const toast = r.queued ? { text: `Anki closed · card saved (${r.pending} waiting)`, error: true } : { text: `Card mined · ${r.today} today`, noteId: r.noteId };
    chrome.tabs.sendMessage(record.tabId, { type: MSG.TOAST, ...toast }).catch(() => {});
    await ask(MSG.DRAFT_CLEAR, { tabId: record.tabId });
  } catch (e) {
    $("error").textContent = /** @type {Error} */ (e).message;
    $("error").hidden = false;
    $("send").disabled = false;
  }
}
