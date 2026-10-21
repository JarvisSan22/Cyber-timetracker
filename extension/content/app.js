// @ts-check
/** Content script app on YouTube watch pages: finds the target subtitle track, shows the overlay, mines cards. */

import { youtube } from "./sites/youtube.js";
import { onTimedtext } from "./bridge.js";
import { createOverlay } from "./overlay.js";
import { captureFrame, recordRange, playRange } from "./recorder.js";
import { createWatcher } from "./watcher.js";
import { ask, MSG } from "../shared/messages.js";
import { loadSettings, saveSettings } from "../shared/settings.js";
import {
  baseLang, cueIndexAt, cueShowing, describeTimedtextUrl, formatTime, joinCues, overlappingText, parseJson3,
  pickTargetTrack, sentenceText, translationUrl,
} from "../shared/subtitles.js";

const adapter = youtube;

/** @typedef {import("../shared/subtitles.js").Cue} Cue */

const state = {
  /** @type {import("../shared/settings.js").Settings | null} */
  settings: null,
  /** @type {import("./sites/youtube.js").VideoInfo | null} */
  video: null,
  /** @type {import("../shared/subtitles.js").Track | null} */
  target: null,
  lang: "",
  /** @type {Cue[]} */
  primary: [],
  /** @type {Cue[]} */
  translation: [],
  primaryUrl: "",
  /** @type {"blur" | "show" | "hide"} */
  translationMode: "blur",
  active: false,
  setupToken: 0,
  /** The line(s) being mined: the draft lives in the worker (side panel reads it); we own recording.
   * first/last index the mined cues in `primary`; startMs/endMs is the clip, adjustable from the side bar. */
  /** @type {null | {draftId: number, draft: any, first: number, last: number, startMs: number, endMs: number, quick: boolean, textRev: number}} */
  mining: null,
  recordToken: 0,
  /** Replaying a line (Alt+R): our own play/pause, not watching. */
  replaying: false,
};

/** @type {ReturnType<typeof createOverlay>} */
let overlay;
const watcher = createWatcher({
  send: (event, info) => ask(MSG.WATCH, { event, ...info }).catch(() => {}),
  getVideo: () => adapter.getVideo(),
  isAd: () => adapter.isAd(),
  // Making a card is study time too: the session keeps running while the video is paused for it.
  isBusy: () => state.mining !== null || state.replaying,
  idleStopMs: () => (state.settings?.tracker.idleStopMin ?? 10) * 60_000,
});
const pageStyle = new CSSStyleSheet();

export async function start() {
  state.settings = await loadSettings();
  overlay = createOverlay(
    {
      onMine: () => {
        openSidebar();
        mine({ quick: false });
      },
      onPickWord: (pick) => {
        openSidebar();
        mine({ quick: false, pick });
      },
      onOpenNote: (noteId) => ask(MSG.OPEN_NOTE, { noteId }).catch(() => {}),
      onMoved: (pos) => savePosition(pos),
      onResetPosition: () => savePosition(null),
    },
    await loadSheets(),
  );
  overlay.setPosition(state.settings.overlay.position);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, pageStyle, await fontSheet()];
  applyTheme();

  onTimedtext((url, body) => handleTimedtext(url, body));
  document.addEventListener("yt-navigate-finish", () => setupVideo());
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === MSG.COMMAND) runCommand(msg.command);
    if (msg?.type === MSG.RERECORD && state.mining?.draftId === msg.draftId) adjustAndRecord(msg.adjust ?? {});
    if (msg?.type === MSG.DRAFT_CLOSED && state.mining?.draftId === msg.draftId) stopMining();
    if (msg?.type === MSG.TOAST) overlay.showToast(msg.text, { error: msg.error, noteId: msg.noteId });
    if (msg?.type === MSG.SETTINGS_CHANGED) loadSettings().then((s) => (state.settings = s));
    return false;
  });
  chrome.storage.onChanged.addListener((changes) => {
    // Also how a move in another tab, or "Reset subtitle position" in the popup, reaches this tab.
    if (changes.settings)
      loadSettings().then((s) => {
        state.settings = s;
        overlay.setPosition(s.overlay.position);
      });
    if (changes.trackerTheme) applyTheme();
  });
  document.addEventListener("keydown", onKey, true);
  setInterval(tick, 100);
  setInterval(() => watcher.tick(), 1000);
  // Leaving YouTube in this tab (or reloading) ends the session now, not at the next browser start.
  window.addEventListener("pagehide", () => watcher.detach());
  setupVideo();
}

/**
 * Remember where the subtitle bar was moved to (null = back to the default spot). One position for
 * every video, synced between machines with the other settings.
 * @param {{x: number, y: number} | null} pos
 */
async function savePosition(pos) {
  const settings = await loadSettings();
  settings.overlay.position = pos;
  await saveSettings(settings);
  if (!pos) overlay.setPosition(null);
}

async function loadSheets() {
  const sheets = [];
  for (const path of ["vendor/augmented-ui.min.css", "styles/overlay.css"]) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(await (await fetch(chrome.runtime.getURL(path))).text());
    sheets.push(sheet);
  }
  return sheets;
}

/** @font-face rules only work at document level, not inside a shadow root. */
async function fontSheet() {
  const sheet = new CSSStyleSheet();
  const url = (/** @type {string} */ f) => chrome.runtime.getURL(`vendor/fonts/${f}`);
  sheet.replaceSync(
    [500, 600, 700]
      .map((w) => `@font-face { font-family: "Rajdhani"; font-weight: ${w}; src: url("${url(`rajdhani-latin-${w}.woff2`)}") format("woff2"); }`)
      .join("\n") + `\n@font-face { font-family: "Share Tech Mono"; src: url("${url("share-tech-mono-latin-400.woff2")}") format("woff2"); }`,
  );
  return sheet;
}

function applyTheme() {
  ask(MSG.THEME_REFRESH)
    .then((theme) => overlay.setTheme(theme.vars))
    .catch(() => {});
}

// --- video and tracks ---

async function setupVideo() {
  const token = ++state.setupToken;
  watcher.detach();
  deactivate();
  state.video = null;
  state.target = null;
  state.primary = [];
  state.translation = [];
  state.primaryUrl = "";
  stopMining();
  if (!adapter.isWatchPage()) return;

  const video = await adapter.info();
  if (token !== state.setupToken || !video) return;
  state.video = video;
  const settings = /** @type {import("../shared/settings.js").Settings} */ (state.settings);
  const target = pickTargetTrack(video.tracks, settings.languages.targets);
  const player = adapter.getPlayerElement();
  if (player) overlay.mount(player);
  ankiStatus();
  if (!target) {
    overlay.setVisible(true);
    overlay.setLine("", "", "");
    overlay.setStatus({ text: video.tracks.length ? "No ja/zh/it subtitles" : "No subtitles", flash: true });
    return;
  }
  state.target = target;
  state.lang = baseLang(target.languageCode);
  overlay.setStatus({ text: `${state.lang}${target.kind === "asr" ? " auto" : ""} · loading`, flash: true });
  activate();
  watcher.attach({ videoId: video.videoId, title: video.title, lang: state.lang, site: adapter.site });

  // The player may have fetched the track before we loaded.
  for (const { url, body } of await adapter.capturedSoFar().catch(() => [])) handleTimedtext(url, body);
  if (!state.primary.length) await adapter.enableTrack(target).catch((e) => overlay.setStatus({ text: e.message, flash: true }));
}

function activate() {
  state.active = true;
  pageStyle.replaceSync(adapter.nativeCaptionsCss);
  overlay.setVisible(true);
  overlay.setTranslationMode(state.translationMode);
}

function deactivate() {
  state.active = false;
  pageStyle.replaceSync("");
  overlay?.setLine("", "", "");
}

/**
 * @param {string} url
 * @param {string} body
 */
async function handleTimedtext(url, body) {
  const video = state.video;
  const target = state.target;
  if (!video || !target) return;
  const info = describeTimedtextUrl(url);
  if (info.videoId !== video.videoId || info.translated || baseLang(info.lang) !== state.lang) return;
  if (state.primary.length && state.primaryUrl === url) return;

  let cues = tryParse(body, "primary");
  if (!cues) cues = await refetchJson3(url, "primary");
  if (!cues?.length || state.video !== video) return;
  state.primary = cues;
  state.primaryUrl = url;
  overlay.setStatus({ text: `${state.lang}${target.kind === "asr" ? " auto" : ""} · ${cues.length} lines`, flash: true });
  loadTranslation(url, video);
}

/**
 * @param {string} body
 * @param {"primary" | "translation"} role
 * @param {string} [lang]
 */
function tryParse(body, role, lang = state.lang) {
  try {
    return parseJson3(body, lang, role);
  } catch {
    return null; // not json3 (srv3/XML) or empty
  }
}

/**
 * @param {string} url
 * @param {"primary" | "translation"} role
 * @param {string} [lang]
 */
async function refetchJson3(url, role, lang = state.lang) {
  const u = new URL(url);
  u.searchParams.set("fmt", "json3");
  const res = await fetch(u, { credentials: "include" }).catch(() => null);
  if (!res?.ok) return null;
  return tryParse(await res.text(), role, lang);
}

/**
 * @param {string} primaryUrl
 * @param {import("./sites/youtube.js").VideoInfo} video
 */
async function loadTranslation(primaryUrl, video) {
  const settings = /** @type {import("../shared/settings.js").Settings} */ (state.settings);
  const lang = settings.languages.translation;
  if (lang === state.lang) return;
  const cues = await refetchJson3(translationUrl(primaryUrl, video.tracks, lang), "translation", lang);
  if (state.video === video && cues) state.translation = cues;
}

// --- display ---

let lastAnkiCheck = 0;
function ankiStatus() {
  if (Date.now() - lastAnkiCheck < 30000) return;
  lastAnkiCheck = Date.now();
  ask(MSG.STATUS)
    .then((st) => overlay.setStatus({ anki: st.anki.ok }))
    .catch(() => overlay.setStatus({ anki: false }));
}

function tick() {
  if (!state.active) return;
  const video = adapter.getVideo();
  const player = adapter.getPlayerElement();
  if (!video || !player) return;
  if (!player.contains(overlay.host)) overlay.mount(player);
  overlay.setControlsHidden(player.classList.contains("ytp-autohide"));
  if (adapter.isAd()) {
    overlay.setLine("", "", state.lang);
    return;
  }
  const cue = cueShowing(state.primary, video.currentTime * 1000);
  overlay.setLine(cue?.text ?? "", cue ? overlappingText(state.translation, cue) : "", state.lang);
}

// --- keys and commands ---

/** @param {KeyboardEvent} e */
function onKey(e) {
  if (!state.active || e.ctrlKey || e.metaKey || e.altKey) return;
  const el = /** @type {HTMLElement} */ (e.composedPath()[0]);
  if (el?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el?.tagName)) return;
  const key = e.key.toLowerCase();
  if (key === "a" || key === "d") {
    e.preventDefault();
    e.stopPropagation();
    stepLine(key === "a" ? -1 : 1);
  }
}

/** @param {string} command */
function runCommand(command) {
  // The worker already opened the side panel for mine-card (the hotkey is the user gesture).
  if (command === "mine-card") mine({ quick: false });
  else if (command === "quick-mine") mine({ quick: true });
  else if (command === "replay-line") replayLine();
  else if (command === "toggle-translation") cycleTranslation();
}

function cycleTranslation() {
  const order = /** @type {const} */ (["blur", "show", "hide"]);
  state.translationMode = order[(order.indexOf(state.translationMode) + 1) % order.length];
  overlay.setTranslationMode(state.translationMode);
  overlay.setStatus({ text: `translation: ${state.translationMode}`, flash: true });
}

/** Index of the line to act on: the one showing, or the last one before now. */
function currentIndex() {
  const video = adapter.getVideo();
  return video ? cueIndexAt(state.primary, video.currentTime * 1000 + 50) : -1;
}

/** @param {number} delta */
function stepLine(delta) {
  if (!state.primary.length) return;
  const i = Math.max(0, Math.min(state.primary.length - 1, currentIndex() + delta));
  adapter.seek(state.primary[i].start_ms);
}

function replayLine() {
  const video = adapter.getVideo();
  const i = currentIndex();
  if (!video || i < 0) return;
  state.replaying = true;
  playRange(video, state.primary[i].start_ms, state.primary[i].end_ms).finally(() => (state.replaying = false));
}

// --- mining ---

/**
 * Ask the worker to open the side panel. Called first thing in a click handler: Chrome only opens it
 * while the click still counts as a user gesture.
 */
function openSidebar() {
  ask(MSG.OPEN_SIDEBAR).catch(() =>
    overlay.showToast("Press Alt+M or open the side panel from the ⌬ toolbar popup", { error: true }),
  );
}

/**
 * Pause on the current line, take the picture, hand the draft to the worker (the side panel shows it),
 * then record the audio. Quick mine skips the side panel and sends straight away.
 * @param {{quick: boolean, pick?: {start: number, end?: number}}} options
 */
async function mine({ quick, pick }) {
  const video = adapter.getVideo();
  const settings = state.settings;
  if (!state.active || !video || !settings || !state.video) {
    overlay?.showToast("No ja/zh/it subtitles on this video", { error: true });
    return;
  }
  if (adapter.isAd()) return;
  if (!state.primary.length) {
    overlay.showToast("Subtitles still loading", { error: true });
    return;
  }
  const i = currentIndex();
  if (i < 0) {
    overlay.showToast("No line yet", { error: true });
    return;
  }
  const cue = state.primary[i];
  const lang = /** @type {"ja" | "zh" | "it"} */ (state.lang);
  video.pause();
  // The side panel is hidden in video fullscreen.
  if (!quick && document.fullscreenElement) await document.exitFullscreen().catch(() => {});
  stopMining();
  const draft = {
    lang,
    sentence: sentenceText(cue.text, lang),
    translation: overlappingText(state.translation, cue),
    source: `${state.video.title} · ${formatTime(cue.start_ms)}`,
    sourceUrl: adapter.sourceUrl(state.video.videoId, cue.start_ms),
    site: adapter.site,
    show: state.video.author,
    /** @type {{data: string, ext: string} | undefined} */
    picture: undefined,
    /** @type {{data: string, ext: string} | undefined} */
    audio: undefined,
  };
  const picture = await captureFrame(video, settings.cards.screenshotWidth, settings.cards.jpegQuality);
  if (picture) draft.picture = picture;

  const startMs = Math.max(0, cue.start_ms - settings.cards.padBeforeMs);
  const endMs = cue.end_ms + settings.cards.padAfterMs;
  let draftId = 0;
  if (!quick) {
    const meta = {
      deck: settings.anki.decks[lang],
      audio: { state: "recording" },
      pick: pick ?? null,
      lines: { start_ms: cue.start_ms, end_ms: cue.end_ms, count: 1 },
      clip: { from: startMs, to: endMs },
      textRev: 0,
    };
    draftId = (await ask(MSG.DRAFT_START, { draft, meta })).draftId;
  }
  const mining = { draftId, draft, first: i, last: i, startMs, endMs, quick, textRev: 0 };
  state.mining = mining;
  const ok = await recordAudio();
  if (quick && state.mining === mining) {
    if (!ok) overlay.showToast("Quick mine: no audio, card sent without it", { error: true });
    await quickSend(mining);
  }
}

/** Record (or re-record) the mining line's audio and pass it to the side panel. True when the MP3 is ready. */
async function recordAudio() {
  const mining = state.mining;
  const video = adapter.getVideo();
  const settings = state.settings;
  if (!mining || !video || !settings) return false;
  const token = ++state.recordToken;
  const returnTo = video.currentTime;
  const isCancelled = () => state.recordToken !== token || state.mining !== mining;
  /** @param {object} meta @param {object} [draft] */
  const update = (meta, draft, extra = {}) =>
    mining.quick ? Promise.resolve() : ask(MSG.DRAFT_UPDATE, { draftId: mining.draftId, meta: { audio: meta, ...extra }, draft }).catch(() => {});
  const wanted = { from: mining.startMs, to: mining.endMs };
  update({ state: "recording" }, undefined, { clip: wanted });
  try {
    const clip = await recordRange(video, mining.startMs, mining.endMs, { isCancelled });
    video.currentTime = returnTo;
    update({ state: "encoding" });
    const mp3 = await ask(MSG.ENCODE_MP3, { data: clip.data, kbps: settings.cards.mp3Kbps });
    if (isCancelled()) return false;
    mining.draft.audio = { data: mp3.data, ext: "mp3" };
    // `played` is what the video really played; shorter than `wanted` means the replay was cut.
    await update({ state: "ready", seconds: mp3.seconds }, { audio: mining.draft.audio }, { clip: { ...wanted, played: [clip.fromMs, clip.toMs] } });
    return true;
  } catch (e) {
    if (isCancelled()) return false;
    video.currentTime = returnTo;
    update({ state: "error", message: /** @type {Error} */ (e).message });
    return false;
  }
}

/**
 * Side bar asked for a different clip: shift start/end, or take in the previous/next subtitle line
 * (sentence and translation grow with it). Then record again.
 * @param {{start?: number, end?: number, addPrev?: boolean, addNext?: boolean}} adjust ms deltas / flags
 */
async function adjustAndRecord(adjust) {
  const mining = state.mining;
  const settings = state.settings;
  if (!mining || !settings) return;
  let prefixAdded = 0;
  let linesChanged = false;
  if (adjust.addPrev && mining.first > 0) {
    mining.first--;
    // The side bar shifts the selected word by what was put in front of the sentence.
    const sep = state.lang === "ja" || state.lang === "zh" ? "" : " ";
    prefixAdded = sentenceText(state.primary[mining.first].text, state.lang).length + sep.length;
    mining.startMs = Math.min(mining.startMs, Math.max(0, state.primary[mining.first].start_ms - settings.cards.padBeforeMs));
    linesChanged = true;
  }
  if (adjust.addNext && mining.last < state.primary.length - 1) {
    mining.last++;
    mining.endMs = Math.max(mining.endMs, state.primary[mining.last].end_ms + settings.cards.padAfterMs);
    linesChanged = true;
  }
  if (adjust.start) mining.startMs = Math.max(0, Math.min(mining.endMs - 500, mining.startMs + adjust.start));
  if (adjust.end) mining.endMs = Math.max(mining.startMs + 500, mining.endMs + adjust.end);

  const cues = state.primary.slice(mining.first, mining.last + 1);
  const joined = joinCues(cues, state.lang);
  if (linesChanged) {
    mining.draft.sentence = joined.sentence;
    mining.draft.translation = overlappingText(state.translation, { start_ms: joined.start_ms, end_ms: joined.end_ms });
    mining.textRev++;
  }
  await ask(MSG.DRAFT_UPDATE, {
    draftId: mining.draftId,
    draft: linesChanged ? { sentence: mining.draft.sentence, translation: mining.draft.translation } : undefined,
    meta: {
      lines: { start_ms: joined.start_ms, end_ms: joined.end_ms, count: cues.length },
      clip: { from: mining.startMs, to: mining.endMs },
      textRev: mining.textRev,
      prefixAdded,
    },
  }).catch(() => {});
  recordAudio();
}

/** @param {{draft: any, quick: boolean}} mining */
async function quickSend(mining) {
  try {
    const r = await ask(MSG.MINE_CARD, { draft: mining.draft, allowDuplicate: false });
    if (r.duplicate) overlay.showToast("Already in deck — Alt+M to send it from the side panel anyway", { error: true });
    else if (r.queued) overlay.showToast(`Anki closed · card saved (${r.pending} waiting)`, { error: true });
    else overlay.showToast(`Card mined · ${r.today} today`, { noteId: r.noteId });
  } catch (e) {
    overlay.showToast(/** @type {Error} */ (e).message, { error: true });
  } finally {
    if (state.mining === mining) state.mining = null;
  }
}

/** Forget the current line (cancels a recording in progress). */
function stopMining() {
  state.recordToken++;
  state.mining = null;
}
