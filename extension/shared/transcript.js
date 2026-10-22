// @ts-check
/** Transcript rows for the side panel: every subtitle line with its translation. Pure functions. */

import { overlappingText, sentenceText } from "./subtitles.js";

/** storage.session key of a tab's transcript (written by the worker, read by the side panel). */
export const transcriptKey = (/** @type {number} */ tabId) => `transcript:${tabId}`;

/** Port name between the side panel and the content script of a tab. */
export const TRANSCRIPT_PORT = "transcript";

/**
 * @typedef {object} TranscriptRow
 * @property {number} i index in the mined track (what the content script calls a cue index)
 * @property {number} start_ms
 * @property {number} end_ms
 * @property {string} sentence the line as one sentence (offsets match word marks)
 * @property {string} translation
 */

/**
 * @param {import("./subtitles.js").Cue[]} primary
 * @param {import("./subtitles.js").Cue[]} translation
 * @param {string} lang
 * @returns {TranscriptRow[]}
 */
export function transcriptRows(primary, translation, lang) {
  return primary.map((cue, i) => ({
    i,
    start_ms: cue.start_ms,
    end_ms: cue.end_ms,
    sentence: sentenceText(cue.text, lang),
    translation: overlappingText(translation, cue),
  }));
}

/**
 * The sentence cut into plain text and marked words, for rendering a line with word colours.
 * @param {string} sentence
 * @param {{start: number, end: number, status: string}[]} marks sorted, not overlapping
 * @returns {{text: string, status?: string}[]}
 */
export function segments(sentence, marks) {
  /** @type {{text: string, status?: string}[]} */
  const out = [];
  let at = 0;
  for (const m of marks) {
    if (m.start < at) continue;
    if (m.start > at) out.push({ text: sentence.slice(at, m.start) });
    out.push({ text: sentence.slice(m.start, m.end), status: m.status });
    at = m.end;
  }
  if (at < sentence.length) out.push({ text: sentence.slice(at) });
  return out;
}
