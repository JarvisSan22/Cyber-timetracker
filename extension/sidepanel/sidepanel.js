// @ts-check
/** Card editor in Chrome's side panel: shows the active tab's draft, picks the target word, sends to Anki. */

import { ask, MSG, draftKey } from "../shared/messages.js";
import { applyTheme } from "../shared/theme.js";
import { BRAND_SVG } from "../shared/brand.js";
import { fallbackWordAt } from "../shared/wordpick.js";
import { formatTimeTenths } from "../shared/subtitles.js";
import { forgetInstalled, hasDictionary, lookupAt } from "../shared/dictionary/index.js";
import { bestEntry } from "../shared/known.js";
import { LANGUAGES, loadSettings } from "../shared/settings.js";
import { hasTranscript, initTranscript, onTranscriptShown, showTranscriptFor } from "./transcript.js";

const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
const audioEl = /** @type {HTMLAudioElement} */ ($("audio"));

/**
 * @typedef {object} DraftRecord
 * @property {number} draftId
 * @property {number} tabId
 * @property {import("../shared/card.js").CardDraft} draft
 * @property {{deck: string, audio: {state: string, seconds?: number, message?: string}, pick?: {start: number, end?: number},
 *   lines?: {start_ms: number, end_ms: number, count: number}, clip?: {from: number, to: number, played?: [number, number]},
 *   textRev?: number, prefixAdded?: number}} meta
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
  /** Sentence version from the content script (grows when a line is added). */
  textRev: 0,
  /** Latest known-words badge request (older answers are dropped). */
  badgeToken: 0,
  /** @type {"card" | "transcript"} */
  tab: "card",
  /** Picture picked from the choices (null: the one taken when mining). */
  /** @type {{data: string, ext: string} | null} */
  chosenPicture: null,
};

$("brand-mark").innerHTML = BRAND_SVG;
ask(MSG.THEME_REFRESH).then((theme) => applyTheme(document.documentElement, theme)).catch(() => {});

// --- which tab, which draft ---

const windowId = (await chrome.windows.getCurrent()).id;

async function followActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  state.tabId = tab?.id ?? null;
  await showTranscriptFor(state.tabId);
  await loadDraft();
  showTab(state.record || !hasTranscript() ? "card" : "transcript");
}

// --- Card / Transcript tabs ---

/** @param {"card" | "transcript"} tab */
function showTab(tab) {
  state.tab = tab;
  for (const button of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll("#tabs button"))) {
    button.classList.toggle("active", button.dataset.tab === tab);
  }
  $("transcript").hidden = tab !== "transcript";
  $("empty").hidden = tab !== "card" || Boolean(state.record);
  $("editor").hidden = tab !== "card" || !state.record;
  if (tab === "transcript") onTranscriptShown();
}
$("tabs").addEventListener("click", (/** @type {MouseEvent} */ e) => {
  const button = /** @type {HTMLElement} */ (e.target).closest("button");
  if (button?.dataset.tab) showTab(/** @type {"card" | "transcript"} */ (button.dataset.tab));
});
initTranscript({ onMine: () => showTab("card") });

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
  const hadRecord = Boolean(state.record);
  state.record = record;
  $("lang").hidden = !record;
  // A new card opens the Card tab; sending or discarding it goes back to the transcript.
  if (record && isNew) showTab("card");
  else if (!record && hadRecord && hasTranscript()) showTab("transcript");
  else showTab(state.tab);
  if (!record) return;
  if (isNew) fillForm(record);
  else if ((record.meta.textRev ?? 0) !== state.textRev) takeNewText(record);
  showMedia(record);
  showClip(record);
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
  state.chosenPicture = null;
  $("shot-choices").dataset.key = "";
  state.textRev = meta.textRev ?? 0;
  $("dup").hidden = true;
  $("known-badge").hidden = true;
  $("error").hidden = true;
  $("lookup").hidden = true;
  $("sentence-edit").hidden = true;
  $("sentence").hidden = false;
  if (meta.pick) pick(meta.pick.start, meta.pick.end);
}

/** @param {DraftRecord} record */
function showMedia({ draft, meta }) {
  const shot = $("shot");
  const picture = state.chosenPicture ?? draft.picture;
  const src = picture ? `data:image/jpeg;base64,${picture.data}` : "";
  showChoices(draft);
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
  $("player").hidden = !ready;
  $("audio-state").hidden = Boolean(ready);
  $("audio-state").textContent = ready
    ? ""
    : { recording: "Recording…", encoding: "Encoding MP3…", error: meta.audio.message ?? "No audio" }[meta.audio.state] ?? "";
  paintPlayer();
  const busy = meta.audio.state === "recording" || meta.audio.state === "encoding";
  $("rerecord").disabled = busy;
  $("send").disabled = busy;
}

/**
 * Thumbnails under the picture: the mining moment and the frames grabbed while the clip replayed.
 * Clicking one makes it the card's picture.
 * @param {DraftRecord["draft"]} draft
 */
function showChoices(draft) {
  const box = $("shot-choices");
  /** @type {{data: string, ext: string, atMs?: number}[]} */
  const original = Boolean(draft.picture); // first thumbnail = the picture taken when mining
  const choices = [...(draft.picture ? [draft.picture] : []), .../** @type {any[]} */ (/** @type {any} */ (draft).pictureChoices ?? [])];
  box.hidden = choices.length < (original ? 2 : 1);
  if (box.hidden) return;
  const chosen = (state.chosenPicture ?? draft.picture)?.data;
  const key = choices.map((c) => c.data.length).join(",");
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    box.replaceChildren(
      ...choices.map((choice, n) => {
        const button = document.createElement("button");
        button.type = "button";
        button.title = original && n === 0 ? "When you mined" : `At ${formatTimeTenths(choice.atMs ?? 0)}`;
        const img = document.createElement("img");
        img.src = `data:image/jpeg;base64,${choice.data}`;
        img.alt = "";
        button.append(img);
        button.addEventListener("click", () => {
          state.chosenPicture = original && n === 0 ? null : { data: choice.data, ext: choice.ext };
          if (state.record) showMedia(state.record);
        });
        return button;
      }),
    );
  }
  [...box.children].forEach((button, n) => button.classList.toggle("chosen", choices[n].data === chosen));
}

/**
 * A line was added on the page: new sentence and translation, selection kept on the same word.
 * @param {DraftRecord} record
 */
function takeNewText(record) {
  const shift = record.meta.prefixAdded ?? 0;
  const keep = state.selection;
  state.textRev = record.meta.textRev ?? 0;
  setSentence(record.draft.sentence);
  if (keep) {
    state.selection = { start: keep.start + shift, end: keep.end + shift };
    paintSelection();
  }
  $("translation").value = record.draft.translation ?? "";
}

/** "Line 12:41.2–12:51.0 · clip 12:40.9–12:51.5 (10.6 s)", with a warning when the replay stopped early. */
function showClip(/** @type {DraftRecord} */ { meta }) {
  const box = $("clip-info");
  box.replaceChildren();
  if (!meta.lines || !meta.clip) return;
  const t = formatTimeTenths;
  const lines = meta.lines.count > 1 ? `${meta.lines.count} lines` : "Line";
  box.append(
    `${lines} ${t(meta.lines.start_ms)}–${t(meta.lines.end_ms)} · clip ${t(meta.clip.from)}–${t(meta.clip.to)} (${((meta.clip.to - meta.clip.from) / 1000).toFixed(1)} s)`,
  );
  const played = meta.clip.played;
  if (played && played[1] < meta.clip.to - 300) {
    box.append(Object.assign(document.createElement("span"), { className: "warn", textContent: ` · replay stopped at ${t(played[1])}` }));
  }
}

// --- audio player ---

function paintPlayer() {
  const duration = Number.isFinite(audioEl.duration) ? audioEl.duration : 0;
  const at = audioEl.currentTime;
  $("fill").style.width = duration ? `${Math.min(100, (at / duration) * 100)}%` : "0";
  $("time").textContent = `${at.toFixed(1)} / ${duration.toFixed(1)} s`;
  const playing = !audioEl.paused && !audioEl.ended;
  $("play").textContent = playing ? "❚❚" : "▶";
  $("play").classList.toggle("playing", playing);
  $("play").setAttribute("aria-label", playing ? "Pause" : "Play");
}
for (const type of ["timeupdate", "play", "pause", "ended", "loadedmetadata", "emptied"]) audioEl.addEventListener(type, paintPlayer);
$("play").addEventListener("click", () => {
  if (audioEl.paused || audioEl.ended) audioEl.play().catch(() => {});
  else audioEl.pause();
});
$("track").addEventListener("click", (/** @type {MouseEvent} */ e) => {
  const box = $("track").getBoundingClientRect();
  if (!Number.isFinite(audioEl.duration) || !box.width) return;
  audioEl.currentTime = Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)) * audioEl.duration;
});
// Space plays/pauses unless typing in a field.
document.addEventListener("keydown", (e) => {
  const el = /** @type {HTMLElement} */ (e.target);
  if (e.key !== " " || $("player").hidden || ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(el.tagName)) return;
  e.preventDefault();
  $("play").click();
});

// Clip controls: +line goes at once; start/end nudges are gathered for a moment so several clicks
// record once.
/** @type {{start: number, end: number}} */
let nudge = { start: 0, end: 0 };
let nudgeTimer = 0;
/** @param {object} adjust */
function sendAdjust(adjust) {
  const record = state.record;
  if (record) chrome.tabs.sendMessage(record.tabId, { type: MSG.RERECORD, draftId: record.draftId, adjust }).catch(() => {});
}
$("clip-tools").addEventListener("click", (/** @type {MouseEvent} */ e) => {
  const button = /** @type {HTMLElement} */ (e.target).closest("button");
  if (!button) return;
  if (button.dataset.add) {
    sendAdjust(button.dataset.add === "prev" ? { addPrev: true } : { addNext: true });
    return;
  }
  nudge.start += Number(button.dataset.start ?? 0);
  nudge.end += Number(button.dataset.end ?? 0);
  clearTimeout(nudgeTimer);
  nudgeTimer = setTimeout(() => {
    sendAdjust(nudge);
    nudge = { start: 0, end: 0 };
  }, 600);
});

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
  showKnownBadge([text, ...(result?.entries.map((e) => e.term) ?? [])]);
}

/**
 * Where the picked word stands in your Anki decks: new to you, learning, known, or already mined in a
 * Cyber Miner deck (a warning only: sending still works).
 * @param {string[]} forms what was picked and its dictionary forms
 */
async function showKnownBadge(forms) {
  const badge = $("known-badge");
  const record = state.record;
  const token = ++state.badgeToken;
  const [stored, settings] = await Promise.all([chrome.storage.local.get("knownWords"), loadSettings()]);
  if (token !== state.badgeToken) return;
  const list = stored.knownWords;
  const wanted = forms.map((f) => f.trim()).filter(Boolean);
  badge.hidden = !record || !settings.known.enabled || !list || !wanted.length;
  if (badge.hidden || !record) return;
  const lang = record.draft.lang;
  const entry = bestEntry(list.words[lang], wanted, lang);
  if (!entry) {
    badge.className = "known-badge unknown";
    badge.textContent = "New word · not in your Anki decks";
    return;
  }
  const [status, days, deck] = entry;
  const where = { known: `Known · ${days} d`, learning: `Learning · ${days} d`, new: "In Anki, not studied yet" }[status];
  const mined = Object.values(settings.anki.decks).some((d) => deck === d || deck.startsWith(`${d}::`));
  badge.className = `known-badge ${mined ? "mined" : status}`;
  badge.textContent = mined ? `Already mined in ${deck} · ${where}` : `${where} · ${deck}`;
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
  showKnownBadge([entry.term]);
}

// A word typed by hand has no pitch from the dictionary entry.
$("word").addEventListener("input", () => {
  state.pitch = [];
  showKnownBadge([$("word").value]);
});

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
  const { pictureChoices: _choices, ...recorded } = /** @type {any} */ (record.draft); // the choices are not sent
  const draft = {
    ...recorded,
    picture: state.chosenPicture ?? record.draft.picture,
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
    const r = await ask(MSG.MINE_CARD, { draft, allowDuplicate, tabId: record.tabId });
    if (r.duplicate) {
      $("dup").hidden = false;
      $("send").disabled = false;
      return;
    }
    const toast = r.queued ? { text: `Anki closed · card saved (${r.pending} waiting)`, error: true } : { text: `Card mined · ${r.today} ${LANGUAGES[/** @type {"ja" | "zh" | "it"} */ (r.lang)] ?? ""} today`, noteId: r.noteId };
    chrome.tabs.sendMessage(record.tabId, { type: MSG.TOAST, ...toast }).catch(() => {});
    await ask(MSG.DRAFT_CLEAR, { tabId: record.tabId });
  } catch (e) {
    $("error").textContent = /** @type {Error} */ (e).message;
    $("error").hidden = false;
    $("send").disabled = false;
  }
}
