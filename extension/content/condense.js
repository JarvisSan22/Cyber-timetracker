// @ts-check
/** Condensed audio (M7): record every subtitle line of the video and skip the long pauses between them.
 * Each span is recorded like a card clip (recordRange, real time) and encoded by the offscreen document;
 * the MP3 parts go to the side panel one by one, which writes them into the file the user picked. */

import { condensedMs, MAX_SPAN_MS, planSpans } from "../shared/condense.js";
import { recordRange } from "./recorder.js";

/** A span that ended this much before its end time was cut short (page paused it, seek went wrong). */
const SHORT_MS = 300;
const ATTEMPTS = 3;
/** Redos after an ad or a jump by the user, before giving up. */
const MAX_REDOS = 20;

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
 * @param {() => boolean} [options.takeJump] true once after the user moved the video (player's own seek bar):
 *   the span is stopped and redone from its start
 * @param {MediaStreamTrack[]} [options.audioTracks] the shared tab's audio (Netflix)
 * @param {(webm: string) => Promise<string>} options.encode base64 WebM to base64 MP3
 * @param {(mp3: string) => void} options.onPart each span's MP3 (base64), in order; joined they make one file
 * @param {(p: {span: number, spans: number, msLeft: number}) => void} [options.onProgress]
 * @param {typeof recordRange} [options.record]
 */
export async function condenseAudio({ video, cues, settings, seek, isAd, isCancelled, takeJump = () => false, audioTracks, encode, onPart, onProgress = () => {}, record = recordRange }) {
  const spans = planSpans(cues, { ...settings, maxSpanMs: MAX_SPAN_MS });
  if (!spans.length) throw new Error("No subtitle lines to record");
  // Recording stops early when an ad starts or the user moves the video, and the span is redone after it.
  let jumped = false;
  const stop = () => isCancelled() || isAd() || (jumped ||= takeJump());
  const durationMs = () => (Number.isFinite(video.duration) ? video.duration * 1000 : Infinity);
  let redos = 0;
  const redo = () => {
    if (++redos > MAX_REDOS) throw new Error("Recording was interrupted too many times");
  };
  onProgress({ span: 0, spans: spans.length, msLeft: condensedMs(spans) });
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    let clip = null;
    for (let attempt = 1; !clip; ) {
      await waitWhileAd(isAd, isCancelled);
      if (isCancelled()) throw new Error("Recording cancelled");
      jumped = false;
      try {
        const got = await record(video, span.startMs, span.endMs, { seek, isCancelled: stop, audioTracks });
        if (jumped || isAd()) {
          redo();
          continue;
        }
        const short = got.toMs < Math.min(span.endMs, durationMs()) - SHORT_MS;
        if (!short || attempt >= ATTEMPTS) clip = got; // keep a short one rather than fail the whole video
        attempt++;
      } catch (e) {
        if (isCancelled()) throw e;
        if (jumped || isAd()) redo();
        else if (attempt++ >= ATTEMPTS) throw e;
      }
    }
    const mp3 = await encode(clip.data);
    if (isCancelled()) throw new Error("Recording cancelled");
    onPart(mp3);
    onProgress({ span: i + 1, spans: spans.length, msLeft: condensedMs(spans.slice(i + 1)) });
  }
}
