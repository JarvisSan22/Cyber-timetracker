// @ts-check
/** Condensed audio (M7): which parts of the video to record so the long pauses between lines are left out. Pure functions. */

/** Port between the side panel and the tab's content script for one condensed audio recording. */
export const CONDENSE_PORT = "condense";

/** A span grows no longer than this: one recording and one MP3 message each. */
export const MAX_SPAN_MS = 60_000;

/**
 * @typedef {object} CondenseOptions
 * @property {number} padBeforeMs audio kept before each line
 * @property {number} padAfterMs audio kept after each line
 * @property {number} mergeGapMs gaps shorter than this stay in the recording; longer ones are skipped
 * @property {number} maxSpanMs a span grows no longer than this (one recording + one MP3 message each)
 */

/**
 * @typedef {object} Span
 * @property {number} startMs
 * @property {number} endMs
 * @property {number} firstCue index of the first line in the span
 * @property {number} lastCue index of the last line in the span
 */

/**
 * Lines (sorted by start) to spans to record. Spans never overlap, so no audio is recorded twice;
 * a single line longer than maxSpanMs stays one span.
 * @param {{start_ms: number, end_ms: number}[]} cues
 * @param {CondenseOptions} options
 * @returns {Span[]}
 */
export function planSpans(cues, { padBeforeMs, padAfterMs, mergeGapMs, maxSpanMs }) {
  /** @type {Span[]} */
  const spans = [];
  cues.forEach((cue, i) => {
    const last = spans.at(-1);
    const start = Math.max(0, cue.start_ms - padBeforeMs, last?.endMs ?? 0);
    const end = cue.end_ms + padAfterMs;
    if (end <= start) {
      if (last) last.lastCue = i; // line already inside the previous span
      return;
    }
    if (last && start - last.endMs < mergeGapMs && end - last.startMs <= maxSpanMs) {
      last.endMs = end;
      last.lastCue = i;
    } else {
      spans.push({ startMs: start, endMs: end, firstCue: i, lastCue: i });
    }
  });
  return spans;
}

/** Length of the condensed audio, which is also about how long recording takes (real time). */
export const condensedMs = (/** @type {Span[]} */ spans) => spans.reduce((n, s) => n + s.endMs - s.startMs, 0);

/** File name for the save dialog: the video title without characters file systems refuse. */
export function condensedFileName(/** @type {string} */ title) {
  const clean = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  return `${clean || "video"} (condensed).mp3`;
}
