// @ts-check
/** Condensed audio box on the Transcript tab (M7): the time estimate, Start, progress and Cancel.
 * Start asks where to save (Chrome's save dialog opens in the folder used last time, Downloads the first
 * time), then the tab's content script records span by span and sends the MP3 parts over a port; they are
 * written straight into the file. Cancel, an error or closing the panel removes the half-written file. */

import { CONDENSE_PORT, condensedFileName, condensedMs, MAX_SPAN_MS, planSpans } from "../shared/condense.js";
import { guardCommands, onTranscriptChange } from "./transcript.js";

const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));

/** The save dialog remembers its last folder per id. */
const PICKER_ID = "cyber-miner-condensed";

/** @typedef {import("./transcript.js").TranscriptState} TranscriptState */

/**
 * @typedef {object} Job
 * @property {chrome.runtime.Port} port
 * @property {number} tabId
 * @property {any} handle FileSystemFileHandle
 * @property {any} writable FileSystemWritableFileStream
 * @property {Promise<void>} writes the parts written so far, in order
 * @property {string} file
 * @property {number} bytes
 * @property {boolean} over
 */

/** @type {Job | null} */
let job = null;
let flashTimer = 0;
/** @type {TranscriptState} */
let current = { tabId: null, data: null, settings: null };

export function initCondense() {
  $("c-start").addEventListener("click", start);
  $("c-cancel").addEventListener("click", () => job?.port.postMessage({ type: "cancel" }));
  // Jumping to or mining a line moves the video the recording is playing: ask first.
  guardCommands((msg, tabId) => {
    if (!job || job.tabId !== tabId) return true;
    const what = msg.type === "seek" ? "jump to this line" : "mine this line";
    if (!confirm(`Condensed audio is still recording.\n\nStop the recording and ${what}? The unfinished MP3 is deleted.`)) return false;
    msg.stopCondense = true;
    return true;
  });
  onTranscriptChange((state) => {
    current = state;
    render();
  });
}

const minutes = (/** @type {number} */ ms) => (ms < 60_000 ? "<1 min" : `${Math.round(ms / 60_000)} min`);

function render() {
  const rows = current.data?.rows ?? [];
  $("c-box").hidden = !job && !rows.length;
  $("c-start").disabled = Boolean(job) || !rows.length || !current.settings;
  $("c-running").hidden = !job;
  if (job || !current.settings) return;
  const spans = planSpans(rows, { ...current.settings.condense, maxSpanMs: MAX_SPAN_MS });
  const videoMs = rows.at(-1)?.end_ms ?? 0;
  $("c-info").textContent = rows.length ? `≈ ${minutes(condensedMs(spans))} to record · ${minutes(videoMs)} video` : "";
}

/** @param {string} text @param {boolean} [error] */
function status(text, error = false) {
  $("c-status").hidden = !text;
  $("c-status").textContent = text;
  $("c-status").classList.toggle("error", error);
}

/** @param {string} b64 */
function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function start() {
  const { tabId, data } = current;
  if (job || tabId === null || !data?.rows.length) return;
  const picker = /** @type {any} */ (window).showSaveFilePicker;
  if (!picker) return status("This Chrome cannot save files from the side panel", true);
  let handle;
  try {
    // Straight from the click: Chrome only opens the dialog during a user gesture.
    handle = await picker({
      id: PICKER_ID,
      startIn: "downloads",
      suggestedName: condensedFileName(data.title),
      types: [{ description: "MP3 audio", accept: { "audio/mpeg": [".mp3"] } }],
    });
  } catch (e) {
    if (/** @type {Error} */ (e).name !== "AbortError") status(/** @type {Error} */ (e).message, true);
    return;
  }
  let writable;
  try {
    writable = await handle.createWritable();
  } catch (e) {
    return status(`Cannot write ${handle.name}: ${/** @type {Error} */ (e).message}`, true);
  }
  /** @type {chrome.runtime.Port} */
  let port;
  try {
    port = chrome.tabs.connect(tabId, { name: CONDENSE_PORT });
  } catch {
    await writable.abort().catch(() => {});
    return status("Reload the video tab and try again", true);
  }
  const mine = /** @type {Job} */ ({ port, tabId, handle, writable, writes: Promise.resolve(), file: handle.name, bytes: 0, over: false });
  job = mine;
  status("Starting…");
  $("c-fill").style.width = "0";
  $("c-info").textContent = data.title;
  render();
  port.onMessage.addListener((/** @type {any} */ msg) => onMessage(mine, msg));
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    finish(mine, "The video tab was closed or reloaded", true);
  });
  port.postMessage({ type: "start" });
}

/** @param {Job} mine @param {any} msg */
function onMessage(mine, msg) {
  if (mine.over) return;
  if (msg.type === "part") {
    const bytes = base64ToBytes(msg.data);
    mine.bytes += bytes.length;
    mine.writes = mine.writes.then(() => mine.writable.write(bytes));
    mine.writes.catch((/** @type {Error} */ e) => {
      mine.port.postMessage({ type: "cancel" });
      finish(mine, `Writing the file failed: ${e.message}`, true);
    });
  } else if (msg.type === "progress") {
    $("c-fill").style.width = `${(100 * msg.span) / Math.max(1, msg.spans)}%`;
    status(`Recording ${msg.span} / ${msg.spans} · ${minutes(msg.msLeft)} left · keep the video tab playing with sound`);
  } else if (msg.type === "jumped") {
    // The video was moved from the player: make the warning hard to miss for a few seconds.
    const warn = $("c-warn");
    warn.classList.add("flash");
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => warn.classList.remove("flash"), 4000);
  } else if (msg.type === "done") {
    finish(mine, "", false);
  } else if (msg.type === "cancelled") {
    finish(mine, "Cancelled", false);
  } else if (msg.type === "error") {
    finish(mine, msg.message, true);
  }
}

/**
 * Close the file (done) or throw it away (cancelled, error).
 * @param {Job} mine @param {string} message "" when the recording is complete @param {boolean} error
 */
async function finish(mine, message, error) {
  if (mine.over) return;
  mine.over = true;
  if (job === mine) job = null;
  try {
    mine.port.disconnect();
  } catch {}
  render();
  if (!message) {
    try {
      await mine.writes;
      await mine.writable.close();
      return status(`Saved ${mine.file} (${(mine.bytes / 1e6).toFixed(1)} MB)`);
    } catch (e) {
      message = `Writing the file failed: ${/** @type {Error} */ (e).message}`;
      error = true;
    }
  }
  await mine.writable.abort().catch(() => {});
  await mine.handle.remove?.().catch(() => {}); // the save dialog already made an empty file
  status(message, error);
}
