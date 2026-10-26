// @ts-check
/** Content script app on video pages: finds the target subtitle track, shows the overlay, mines cards.
 * Site-specific parts sit behind the adapter (content/sites/). */

import { pickAdapter } from "./sites/index.js";
import { createOverlay } from "./overlay.js";
import { captureFrame, recordRange, playRange } from "./recorder.js";
import { createWatcher } from "./watcher.js";
import { pictureRect } from "../shared/frame.js";
import { wordStyleVars } from "../shared/known.js";
import { TRANSCRIPT_PORT, transcriptRows } from "../shared/transcript.js";
import { requestTabAudio } from "./tabaudio.js";
import { condenseAudio } from "./condense.js";
import { CONDENSE_PORT } from "../shared/condense.js";
import { ask, MSG } from "../shared/messages.js";
import { LANGUAGES, loadSettings, saveSettings } from "../shared/settings.js";
import {
  baseLang, cueIndexAt, cueShowing, formatTime, joinCues, overlappingText, pickTargetTrack, sentenceText,
} from "../shared/subtitles.js";

const adapter = /** @type {import("./sites/index.js").SiteAdapter} */ (pickAdapter());

/** @typedef {import("../shared/subtitles.js").Cue} Cue */

const state = {
  /** @type {import("../shared/settings.js").Settings | null} */
  settings: null,
  /** @type {import("./sites/index.js").VideoInfo | null} */
  video: null,
  /** @type {import("../shared/subtitles.js").Track | null} */
  target: null,
  lang: "",
  /** @type {Cue[]} */
  primary: [],
  /** @type {Cue[]} */
  translation: [],
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
  /** Recording the condensed audio of the whole video (M7); mining and line keys wait for it. */
  /** @type {null | {cancelled: boolean}} */
  condensing: null,
  /** The line the bar's word colours were asked for (known words). */
  markedLine: "",
  /** Last position sent to the side panel's transcript ("index:playing"). */
  sentPosition: "",
};

/** @type {ReturnType<typeof createOverlay>} */
let overlay;
const watcher = createWatcher({
  send: (event, info) => ask(MSG.WATCH, { event, ...info }).catch(() => {}),
  getVideo: () => adapter.getVideo(),
  isAd: () => adapter.isAd(),
  // Making a card is study time too: the session keeps running while the video is paused for it.
  isBusy: () => state.mining !== null || state.replaying || state.condensing !== null,
  idleStopMs: () => (state.settings?.tracker.idleStopMin ?? 10) * 60_000,
});
const pageStyle = new CSSStyleSheet();
/** Setup steps in the page console, so a site that changed shows where it stops. */
const log = (/** @type {any[]} */ ...args) => console.info("[Cyber Miner]", ...args);
/** Stops the subtitle callbacks of the previous video. */
let stopSubtitles = () => {};

export async function start() {
  state.settings = await loadSettings();
  state.translationMode = state.settings.overlay.translation;
  overlay = createOverlay(
    {
      onMine: () => {
        openSidebar();
        shareTabAudio();
        mine({ quick: false });
      },
      onPickWord: (pick) => {
        openSidebar();
        shareTabAudio();
        mine({ quick: false, pick });
      },
      onOpenNote: (noteId) => ask(MSG.OPEN_NOTE, { noteId }).catch(() => {}),
      onMoved: (pos) => savePosition(pos),
      onResetPosition: () => savePosition(null),
    },
    await loadSheets(),
  );
  overlay.host.classList.add(`site-${adapter.site}`); // default spot differs per site (control bar height)
  overlay.setPosition(state.settings.overlay.position);
  overlay.setTheme(wordStyleVars(state.settings.known.colors));
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, pageStyle, await fontSheet()];
  applyTheme();

  adapter.onNavigate(() => setupVideo());
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
        // A new choice in Options applies at once; an Alt+S switch stays until then.
        if (s.overlay.translation !== state.settings?.overlay.translation) {
          state.translationMode = s.overlay.translation;
          overlay.setTranslationMode(state.translationMode);
        }
        state.settings = s;
        overlay.setPosition(s.overlay.position);
        overlay.setTheme(wordStyleVars(s.known.colors));
      });
    if (changes.trackerTheme) applyTheme();
    // New known-words list (rebuilt, or a card mined) or the setting changed: colour the line again.
    if (changes.knownWords || changes.settings) state.markedLine = "";
  });
  document.addEventListener("keydown", onKey, true);
  chrome.runtime.onConnect.addListener(onTranscriptPort);
  chrome.runtime.onConnect.addListener(onCondensePort);
  setInterval(tick, 100);
  setInterval(() => watcher.tick(), 1000);
  // Leaving the site in this tab (or reloading) ends the session now, not at the next browser start.
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
  if (state.condensing) state.condensing.cancelled = true;
  state.video = null;
  state.target = null;
  state.primary = [];
  state.translation = [];
  stopSubtitles();
  ask(MSG.TRANSCRIPT_CLEAR).catch(() => {});
  state.sentPosition = "";
  stopMining();
  if (!adapter.isWatchPage()) return;

  log(`${adapter.site}: setting up ${adapter.currentVideoId()}`);
  const video = await adapter.info();
  if (token !== state.setupToken) return;
  if (!video) {
    log(`${adapter.site}: no video info from the player (subtitle list not found)`);
    overlay.setStatus({ text: "No subtitle list from the player", flash: true });
    return;
  }
  log("video", { title: video.title, show: video.show, spoken: video.spokenLang, tracks: video.tracks.map((t) => `${t.languageCode}${t.kind ? `/${t.kind}` : ""}${t.image ? "/image" : ""}`) });
  state.video = video;
  const settings = /** @type {import("../shared/settings.js").Settings} */ (state.settings);
  const target = pickTargetTrack(video.tracks, settings.languages.targets, video.spokenLang);
  const player = adapter.getPlayerElement();
  if (player) overlay.mount(player);
  else log("player element not found");
  ankiStatus();
  if (!target) {
    overlay.setVisible(true);
    overlay.setLine("", "", "");
    const spoken = video.spokenLang && !settings.languages.targets.includes(baseLang(video.spokenLang));
    overlay.setStatus({ text: spoken ? `Audio is ${video.spokenLang}, not ${settings.languages.targets.join("/")}` : video.tracks.length ? "No ja/zh/it subtitles" : "No subtitles", flash: true });
    return;
  }
  state.target = target;
  state.lang = baseLang(target.languageCode);
  log("target track", target.languageCode, target.kind || "");
  overlay.setStatus({ text: `${state.lang}${target.kind === "asr" ? " auto" : ""} · loading`, flash: true });
  activate();
  watcher.attach({ videoId: video.videoId, title: video.title, lang: state.lang, site: adapter.site });

  stopSubtitles = adapter.subtitles(video, target, {
    lang: state.lang,
    translationLang: settings.languages.translation,
    onPrimary: (cues) => {
      log(`${cues.length} ${state.lang} lines`);
      state.primary = cues;
      overlay.setStatus({ text: `${state.lang}${target.kind === "asr" ? " auto" : ""} · ${cues.length} lines`, flash: true });
      publishTranscript();
    },
    onTranslation: (cues) => {
      log(`${cues.length} translation lines`);
      state.translation = cues;
      publishTranscript();
    },
    onError: (e) => {
      log("subtitles failed:", e.message);
      overlay.setStatus({ text: e.message, flash: true });
    },
  });
}

// --- transcript in the side panel (M5) ---

/** The video's lines for the side panel's Transcript tab (stored by the worker per tab). */
function publishTranscript() {
  const video = state.video;
  if (!video || !state.primary.length) return;
  const transcript = { videoId: video.videoId, title: video.title, lang: state.lang, rows: transcriptRows(state.primary, state.translation, state.lang) };
  ask(MSG.TRANSCRIPT_SET, { transcript }).catch(() => {});
}

/** Side panels showing this tab's transcript: they get the current line, and send seek / mine. */
/** @type {Set<chrome.runtime.Port>} */
const transcriptPorts = new Set();

/** @param {chrome.runtime.Port} port */
function onTranscriptPort(port) {
  if (port.name !== TRANSCRIPT_PORT) return;
  transcriptPorts.add(port);
  port.onDisconnect.addListener(() => transcriptPorts.delete(port));
  port.onMessage.addListener((/** @type {{type: string, index: number, last?: number}} */ msg) => {
    const cue = state.primary[msg.index];
    if (!cue || !state.active || busyCondensing()) return;
    if (msg.type === "seek") adapter.seek(cue.start_ms);
    if (msg.type === "mine") mine({ quick: false, cueIndex: msg.index, lastIndex: msg.last });
  });
  state.sentPosition = ""; // the new panel gets the position at the next tick
}

/** Tell the panels which line is current, only when it or the play state changed. */
function sendPosition() {
  if (!transcriptPorts.size) return;
  const video = adapter.getVideo();
  const index = video ? currentIndex() : -1;
  const playing = Boolean(video && !video.paused);
  const key = `${state.video?.videoId}:${index}:${playing}`;
  if (key === state.sentPosition) return;
  state.sentPosition = key;
  for (const port of transcriptPorts) port.postMessage({ type: "position", videoId: state.video?.videoId, index, playing });
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
  overlay.setControlsHidden(adapter.controlsHidden(player));
  if (adapter.isAd()) {
    overlay.setLine("", "", state.lang);
    return;
  }
  const cue = cueShowing(state.primary, video.currentTime * 1000);
  overlay.setLine(cue?.text ?? "", cue ? overlappingText(state.translation, cue) : "", state.lang);
  sendPosition();
  const text = cue?.text ?? "";
  if (text !== state.markedLine) {
    state.markedLine = text;
    if (text) markLine(text);
  }
}

/**
 * Colour the bar's words by their Anki status (unknown / learning / known). The worker splits the line
 * with the dictionary; the next lines are asked for too, so they are ready when they show.
 * @param {string} text
 */
function markLine(text) {
  if (!state.settings?.known.enabled) {
    overlay.setMarks(text, []);
    return;
  }
  const lang = state.lang;
  const ask1 = (/** @type {string} */ t) => ask(MSG.KNOWN_MARKS, { lang, sentence: sentenceText(t, lang) });
  ask1(text)
    .then((marks) => overlay.setMarks(text, marks ?? []))
    .catch(() => {});
  const i = state.primary.findIndex((c) => c.text === text);
  for (const next of state.primary.slice(i + 1, i + 3)) ask1(next.text).catch(() => {});
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
  if (!state.primary.length || busyCondensing()) return;
  const i = Math.max(0, Math.min(state.primary.length - 1, currentIndex() + delta));
  adapter.seek(state.primary[i].start_ms);
}

function replayLine() {
  const video = adapter.getVideo();
  const i = currentIndex();
  if (!video || i < 0 || busyCondensing()) return;
  state.replaying = true;
  playRange(video, state.primary[i].start_ms, state.primary[i].end_ms, adapter.seek).finally(() => (state.replaying = false));
}

// --- condensed audio (M7) ---

/** True (and says so on the bar) while the condensed audio is recording: it owns play, pause and seek. */
function busyCondensing() {
  if (state.condensing) overlay?.showToast("Recording condensed audio: cancel it in the side panel first", { error: true });
  return state.condensing !== null;
}

/**
 * The side panel opens one port per recording: "start" begins it, "cancel" or closing the port stops it.
 * Progress and the MP3 parts go back on the same port; the panel writes the parts into the chosen file.
 * @param {chrome.runtime.Port} port
 */
function onCondensePort(port) {
  if (port.name !== CONDENSE_PORT) return;
  /** @type {{cancelled: boolean} | null} */
  let job = null;
  const post = (/** @type {object} */ msg) => {
    try {
      port.postMessage(msg);
    } catch {
      if (job) job.cancelled = true; // the panel is gone: nowhere to write the file
    }
  };
  port.onDisconnect.addListener(() => job && (job.cancelled = true));
  port.onMessage.addListener((/** @type {{type: string}} */ msg) => {
    if (msg.type === "cancel" && job) job.cancelled = true;
    if (msg.type === "start" && !job) {
      job = { cancelled: false };
      condense(job, post);
    }
  });
}

/**
 * Record the whole video's lines (long pauses left out) as MP3 parts for the side panel.
 * @param {{cancelled: boolean}} job
 * @param {(msg: object) => void} post
 */
async function condense(job, post) {
  const video = adapter.getVideo();
  const settings = state.settings;
  const info = state.video;
  if (state.condensing) return post({ type: "error", message: "Already recording condensed audio" });
  if (state.mining) return post({ type: "error", message: "Finish or discard the card first" });
  if (!state.active || !video || !settings || !info) return post({ type: "error", message: "No ja/zh/it subtitles on this video" });
  if (!state.primary.length) return post({ type: "error", message: "Subtitles still loading" });
  state.condensing = job;
  const back = { ms: video.currentTime * 1000, paused: video.paused };
  try {
    const audioTracks = adapter.audio === "tab" ? (await requestTabAudio()).getAudioTracks() : undefined;
    await condenseAudio({
      video,
      cues: state.primary,
      settings: settings.condense,
      seek: adapter.seek,
      isAd: () => adapter.isAd(),
      isCancelled: () => job.cancelled,
      audioTracks,
      encode: async (data) => (await ask(MSG.ENCODE_MP3, { data, kbps: settings.condense.mp3Kbps })).data,
      onPart: (data) => post({ type: "part", data }),
      onProgress: (p) => post({ type: "progress", ...p }),
    });
    post({ type: "done" });
  } catch (e) {
    const message = /** @type {Error} */ (e).message;
    if (!job.cancelled) log("condensed audio failed:", message);
    post(job.cancelled ? { type: "cancelled" } : { type: "error", message });
  } finally {
    state.condensing = null;
    if (state.video === info) {
      await adapter.seek(back.ms).catch(() => {});
      if (!back.paused) video.play().catch(() => {});
    }
  }
}

// --- mining ---

/** Sites that record the tab's audio: show Chrome's "Share this tab" prompt now, while the click counts
 * as a user gesture (once per page; later calls reuse the stream). recordAudio waits for it. */
function shareTabAudio() {
  if (adapter.audio === "tab") requestTabAudio().catch(() => {}); // the error shows when recording
}

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
 * @param {{quick: boolean, pick?: {start: number, end?: number}, cueIndex?: number, lastIndex?: number}} options
 *   cueIndex: a line picked in the transcript (else the line at the playhead); lastIndex: the last of
 *   several lines selected there (one card for all of them)
 */
async function mine({ quick, pick, cueIndex, lastIndex }) {
  const video = adapter.getVideo();
  const settings = state.settings;
  if (!state.active || !video || !settings || !state.video) {
    overlay?.showToast("No ja/zh/it subtitles on this video", { error: true });
    return;
  }
  if (adapter.isAd() || busyCondensing()) return;
  if (!state.primary.length) {
    overlay.showToast("Subtitles still loading", { error: true });
    return;
  }
  // From the transcript: go to that line first (the picture is taken there).
  if (cueIndex !== undefined) {
    video.pause();
    await adapter.seek(state.primary[cueIndex].start_ms + 50);
  }
  const i = cueIndex ?? currentIndex();
  if (i < 0) {
    overlay.showToast("No line yet", { error: true });
    return;
  }
  const last = Math.min(state.primary.length - 1, Math.max(i, lastIndex ?? i));
  // One line, or the lines selected in the transcript, as one sentence.
  const cue = joinCues(state.primary.slice(i, last + 1), state.lang);
  const lang = /** @type {"ja" | "zh" | "it"} */ (state.lang);
  video.pause();
  // The side panel is hidden in video fullscreen.
  if (!quick && document.fullscreenElement) await document.exitFullscreen().catch(() => {});
  stopMining();
  const draft = {
    lang,
    sentence: cue.sentence,
    translation: overlappingText(state.translation, cue),
    source: `${state.video.title} · ${formatTime(cue.start_ms)}`,
    sourceUrl: adapter.sourceUrl(state.video.videoId, cue.start_ms),
    site: adapter.site,
    show: state.video.show,
    /** @type {{data: string, ext: string} | undefined} */
    picture: undefined,
    /** @type {{data: string, ext: string} | undefined} */
    audio: undefined,
  };
  const picture = await takePicture(video, settings);
  if (picture) draft.picture = picture;

  const startMs = Math.max(0, cue.start_ms - settings.cards.padBeforeMs);
  const endMs = cue.end_ms + settings.cards.padAfterMs;
  let draftId = 0;
  if (!quick) {
    const meta = {
      deck: settings.anki.decks[lang],
      audio: { state: "recording" },
      pick: pick ?? null,
      lines: { start_ms: cue.start_ms, end_ms: cue.end_ms, count: last - i + 1 },
      clip: { from: startMs, to: endMs },
      textRev: 0,
    };
    draftId = (await ask(MSG.DRAFT_START, { draft, meta })).draftId;
  }
  const mining = { draftId, draft, first: i, last, startMs, endMs, quick, textRev: 0 };
  state.mining = mining;
  const ok = await recordAudio();
  if (quick && state.mining === mining) {
    if (!ok) overlay.showToast("Quick mine: no audio, card sent without it", { error: true });
    await quickSend(mining);
  }
}

/**
 * The card picture, the same size and format on every site: the <video> drawn on a canvas, or (DRM
 * players) a tab screenshot cropped to the picture, taken with our bar and the player's controls hidden.
 * @param {HTMLVideoElement} video
 * @param {import("../shared/settings.js").Settings} settings
 */
async function takePicture(video, settings) {
  if (adapter.frame !== "tab") return grabFrame(video, settings);
  cleanFrame(true);
  try {
    // Let the page repaint without them, and settle after the side panel or fullscreen exit resized it.
    await new Promise((r) => setTimeout(r, 300));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return await grabFrame(video, settings);
  } finally {
    cleanFrame(false);
  }
}

/**
 * Tab screenshots: hide our bar and the player's controls (on) or show them again (off).
 * @param {boolean} on
 */
function cleanFrame(on) {
  overlay.setVisible(!on);
  pageStyle.replaceSync(on ? `${adapter.nativeCaptionsCss}\n${adapter.cleanFrameCss ?? ""}` : state.active ? adapter.nativeCaptionsCss : "");
}

/**
 * The frame on screen now, the site's way (canvas or tab screenshot), without hiding anything first.
 * @param {HTMLVideoElement} video
 * @param {import("../shared/settings.js").Settings} settings
 * @returns {Promise<{data: string, ext: string} | null>}
 */
async function grabFrame(video, settings) {
  const { screenshotWidth: width, jpegQuality: quality } = settings.cards;
  if (adapter.frame !== "tab") return captureFrame(video, width, quality);
  try {
    const box = video.getBoundingClientRect();
    const rect = pictureRect({ left: box.left, top: box.top, width: box.width, height: box.height }, video.videoWidth, video.videoHeight);
    const picture = await ask(MSG.CAPTURE_FRAME, { rect, viewportWidth: window.innerWidth, width, quality });
    if (!picture) log("screenshot was black (DRM): card without picture");
    return picture;
  } catch (e) {
    const message = /** @type {Error} */ (e).message;
    log("screenshot failed:", message);
    // Chrome allows tab screenshots only with access to all sites (Options) or right after the hotkey.
    if (/activeTab/.test(message)) overlay.showToast("No picture: allow Netflix pictures in Cyber Miner's options", { error: true });
    return null;
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
    const audioTracks = adapter.audio === "tab" ? (await requestTabAudio()).getAudioTracks() : undefined;
    if (isCancelled()) return false;
    // Picture choices from the replay (side bar only): 4 frames; tab screenshots are limited to 2 a
    // second, so fewer on a short clip, and the bar and controls stay hidden while it plays.
    const tabFrames = adapter.frame === "tab";
    const count = mining.quick ? 0 : tabFrames ? Math.max(1, Math.min(4, Math.floor((mining.endMs - mining.startMs) / 600))) : 4;
    const frames = count ? { count, grab: () => grabFrame(video, settings) } : undefined;
    if (frames && tabFrames) cleanFrame(true);
    let clip;
    try {
      clip = await recordRange(video, mining.startMs, mining.endMs, { seek: adapter.seek, isCancelled, audioTracks, frames });
    } finally {
      if (frames && tabFrames) cleanFrame(false);
    }
    await adapter.seek(returnTo * 1000);
    update({ state: "encoding" });
    const mp3 = await ask(MSG.ENCODE_MP3, { data: clip.data, kbps: settings.cards.mp3Kbps });
    if (isCancelled()) return false;
    mining.draft.audio = { data: mp3.data, ext: "mp3" };
    // `played` is what the video really played; shorter than `wanted` means the replay was cut.
    await update(
      { state: "ready", seconds: mp3.seconds },
      { audio: mining.draft.audio, pictureChoices: clip.frames },
      { clip: { ...wanted, played: [clip.fromMs, clip.toMs] } },
    );
    return true;
  } catch (e) {
    if (isCancelled()) return false;
    log("recording failed:", /** @type {Error} */ (e).message);
    await adapter.seek(returnTo * 1000);
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
    else overlay.showToast(`Card mined · ${r.today} ${LANGUAGES[/** @type {"ja" | "zh" | "it"} */ (r.lang)] ?? ""} today`, { noteId: r.noteId });
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
