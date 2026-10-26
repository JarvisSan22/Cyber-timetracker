// @ts-check
/** Condensed audio (M7): record every subtitle line of the video and skip the long pauses between them.
 * Each span is recorded like a card clip (recordRange, real time) and encoded by the offscreen document;
 * the MP3 parts go to the side panel one by one, which writes them into the file the user picked. */

import { condensedMs, MAX_SPAN_MS, planSpans } from "../shared/condense.js";
import { recordRange } from "./recorder.js";

/** A span that ended this much before its end time was cut short (page paused it, seek went wrong). */
const SHORT_MS = 300;
const ATTEMPTS = 3;

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
 * @param {(mp3: string) => void} options.onPart each span's MP3 (base64), in order; joined they make one file
 * @param {(p: {span: number, spans: number, msLeft: number}) => void} [options.onProgress]
 * @param {typeof recordRange} [options.record]
 */
export async function condenseAudio({ video, cues, settings, seek, isAd, isCancelled, audioTracks, encode, onPart, onProgress = () => {}, record = recordRange }) {
  const spans = planSpans(cues, { ...settings, maxSpanMs: MAX_SPAN_MS });
  if (!spans.length) throw new Error("No subtitle lines to record");
  // Recording stops early when an ad starts, so the span is redone after it instead of keeping ad audio.
  const stop = () => isCancelled() || isAd();
  const durationMs = () => (Number.isFinite(video.duration) ? video.duration * 1000 : Infinity);
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
    const mp3 = await encode(clip.data);
    if (isCancelled()) throw new Error("Recording cancelled");
    onPart(mp3);
    onProgress({ span: i + 1, spans: spans.length, msLeft: condensedMs(spans.slice(i + 1)) });
  }
}
