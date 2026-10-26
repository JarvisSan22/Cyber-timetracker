// @ts-check
/** Condensed audio (M7): record every subtitle line of the video, skip the long pauses between them,
 * and join the MP3 parts into one file. Each span is recorded like a card clip (recordRange, real time)
 * and encoded by the offscreen document, so messages stay small and a failed span is redone on its own. */

import { condensedMs, planSpans } from "../shared/condense.js";
import { recordRange } from "./recorder.js";

/** A span grows no longer than this: one recording and one MP3 message each. */
export const MAX_SPAN_MS = 60_000;
/** A span that ended this much before its end time was cut short (page paused it, seek went wrong). */
const SHORT_MS = 300;
const ATTEMPTS = 3;

/** @param {string} b64 */
function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * @param {() => boolean} isAd
 * @param {() => boolean} isCancelled
 */
async function waitWhileAd(isAd, isCancelled) {
  while (isAd() && !isCancelled()) await new Promise((r) => setTimeout(r, 500));
}

/**
 * Record the condensed audio of `cues`. Leaves the video paused wherever the last span ended; the caller
 * puts it back.
 * @param {object} options
 * @param {HTMLVideoElement} options.video
 * @param {{start_ms: number, end_ms: number}[]} options.cues the primary subtitle lines
 * @param {{padBeforeMs: number, padAfterMs: number, mergeGapMs: number}} options.settings
 * @param {(ms: number) => Promise<void>} options.seek
 * @param {() => boolean} options.isAd an ad is playing (YouTube): wait, and redo a span it cut into
 * @param {() => boolean} options.isCancelled
 * @param {MediaStreamTrack[]} [options.audioTracks] the shared tab's audio (Netflix)
 * @param {(webm: string) => Promise<string>} options.encode base64 WebM to base64 MP3
 * @param {(p: {span: number, spans: number, msLeft: number}) => void} [options.onProgress]
 * @param {typeof recordRange} [options.record]
 * @returns {Promise<Blob>} one MP3
 */
export async function condenseAudio({ video, cues, settings, seek, isAd, isCancelled, audioTracks, encode, onProgress = () => {}, record = recordRange }) {
  const spans = planSpans(cues, { ...settings, maxSpanMs: MAX_SPAN_MS });
  if (!spans.length) throw new Error("No subtitle lines to record");
  // Recording stops early when an ad starts, so the span is redone after it instead of keeping ad audio.
  const stop = () => isCancelled() || isAd();
  const durationMs = () => (Number.isFinite(video.duration) ? video.duration * 1000 : Infinity);
  /** @type {Uint8Array[]} */
  const parts = [];
  onProgress({ span: 0, spans: spans.length, msLeft: condensedMs(spans) });
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    let clip = null;
    for (let attempt = 1; attempt <= ATTEMPTS && !clip; attempt++) {
      await waitWhileAd(isAd, isCancelled);
      if (isCancelled()) throw new Error("Recording cancelled");
      try {
        const got = await record(video, span.startMs, span.endMs, { seek, isCancelled: stop, audioTracks });
        const short = got.toMs < Math.min(span.endMs, durationMs()) - SHORT_MS;
        if (!short || attempt === ATTEMPTS) clip = got; // keep a short one rather than fail the whole video
      } catch (e) {
        if (isCancelled() || (!isAd() && attempt === ATTEMPTS)) throw e;
      }
    }
    if (!clip) throw new Error("Ads kept interrupting the recording");
    parts.push(base64ToBytes(await encode(clip.data)));
    onProgress({ span: i + 1, spans: spans.length, msLeft: condensedMs(spans.slice(i + 1)) });
  }
  return new Blob(/** @type {BlobPart[]} */ (parts), { type: "audio/mpeg" });
}

/** File name for the download: the video title without characters file systems refuse. */
export function condensedFileName(/** @type {string} */ title) {
  const clean = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  return `${clean || "video"} (condensed).mp3`;
}
