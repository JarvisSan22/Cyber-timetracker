// @ts-check
/** Subtitle cues: parsers, lookup by time, and choosing which track to mine. Pure functions (tested in Node). */

/**
 * @typedef {object} Cue
 * @property {number} start_ms
 * @property {number} end_ms
 * @property {string} text  lines joined with "\n"
 * @property {string} lang  base language ("ja", "zh", "it", "en")
 * @property {"primary" | "translation"} role
 * @property {number} [last_word_ms] start of the last word (auto-generated tracks carry word timings)
 */

/** Room for the last word after its start time, when a line has to be cut short. */
const LAST_WORD_MS = 600;

/**
 * @typedef {object} Track
 * @property {string} languageCode "ja", "zh-Hans", "it", "en"
 * @property {string} [kind]       "asr" for auto-generated
 * @property {string} [name]
 * @property {boolean} [image]     subtitles as pictures only (some Netflix tracks): cannot be read
 */

/** "zh-Hans" -> "zh", "pt-BR" -> "pt". */
export function baseLang(/** @type {string} */ code) {
  return (code || "").toLowerCase().split(/[-_]/)[0];
}

/**
 * YouTube json3 timed text: {events: [{tStartMs, dDurationMs, segs: [{utf8}]}]}.
 * Auto-generated (ASR) tracks add newline-only "append" events and word-level segments; both join fine.
 * @param {string | object} body
 * @param {string} lang
 * @param {"primary" | "translation"} role
 * @returns {Cue[]}
 */
export function parseJson3(body, lang, role) {
  const data = typeof body === "string" ? JSON.parse(body) : body;
  /** @type {Cue[]} */
  const cues = [];
  for (const ev of data?.events ?? []) {
    if (!ev.segs) continue;
    const text = ev.segs
      .map((/** @type {{utf8?: string}} */ s) => s.utf8 ?? "")
      .join("")
      .replace(/​/g, "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n");
    if (!text) continue;
    const start = ev.tStartMs ?? 0;
    /** @type {Cue} */
    const cue = { start_ms: start, end_ms: start + (ev.dDurationMs ?? 0), text, lang: baseLang(lang), role };
    const offsets = ev.segs.map((/** @type {{tOffsetMs?: number}} */ s) => s.tOffsetMs ?? 0);
    if (offsets.some((/** @type {number} */ o) => o > 0)) cue.last_word_ms = start + Math.max(...offsets);
    cues.push(cue);
  }
  cues.sort((a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms);
  // ASR lines stay on screen while the next one builds up: end each where the next starts, but never
  // before its own last word has had time to be spoken.
  for (let i = 0; i < cues.length - 1; i++) {
    const cue = cues[i];
    const next = cues[i + 1];
    if (cue.end_ms > next.start_ms && next.start_ms > cue.start_ms) {
      cue.end_ms = Math.min(cue.end_ms, Math.max(next.start_ms, (cue.last_word_ms ?? 0) + LAST_WORD_MS));
    }
  }
  return cues;
}

/**
 * Index of the cue to mine at a time: the cue on screen, or the last one before the time if between lines.
 * -1 before the first cue.
 * @param {Cue[]} cues sorted by start
 * @param {number} timeMs
 */
export function cueIndexAt(cues, timeMs) {
  let lo = 0;
  let hi = cues.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start_ms <= timeMs) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * The cue showing right now (null between lines).
 * @param {Cue[]} cues
 * @param {number} timeMs
 */
export function cueShowing(cues, timeMs) {
  const i = cueIndexAt(cues, timeMs);
  return i >= 0 && timeMs < cues[i].end_ms ? cues[i] : null;
}

/**
 * Translation text overlapping a primary cue (several short lines are joined).
 * @param {Cue[]} translation
 * @param {Cue} cue
 */
export function overlappingText(translation, cue) {
  const mid = (cue.start_ms + cue.end_ms) / 2;
  const overlapping = translation.filter((t) => {
    const overlap = Math.min(t.end_ms, cue.end_ms) - Math.max(t.start_ms, cue.start_ms);
    // Most of the translation line must fall inside the cue, or it must cover the cue's middle.
    return overlap > 0 && (overlap >= (t.end_ms - t.start_ms) / 2 || (t.start_ms <= mid && mid < t.end_ms));
  });
  return overlapping.map((t) => t.text.replace(/\n/g, " ")).join(" ");
}

/**
 * A cue's lines as one sentence: no space for Japanese and Chinese, a space otherwise.
 * @param {string} text
 * @param {string} lang
 */
export function sentenceText(text, lang) {
  const sep = lang === "ja" || lang === "zh" ? "" : " ";
  return text.split("\n").join(sep).trim();
}

/**
 * Which track to mine. The spoken language has the auto-generated (asr) track, so an asr track in a
 * target language wins; otherwise the first manual track in the user's language order.
 * Manual tracks beat asr in the same language. Chinese prefers simplified.
 * When the site knows the spoken language (Netflix: the audio track playing), only that language counts:
 * Netflix offers subtitles in many languages, and a card needs the audio to match the sentence.
 * @param {Track[]} tracks
 * @param {string[]} targets ["ja", "zh", "it"]
 * @param {string} [spokenLang]
 * @returns {Track | null}
 */
export function pickTargetTrack(tracks, targets, spokenLang = "") {
  const inTarget = tracks.filter((t) => targets.includes(baseLang(t.languageCode)));
  if (!inTarget.length) return null;
  const spoken = inTarget.find((t) => t.kind === "asr");
  const lang = spokenLang
    ? baseLang(spokenLang)
    : spoken
      ? baseLang(spoken.languageCode)
      : targets.find((l) => inTarget.some((t) => baseLang(t.languageCode) === l));
  const sameLang = inTarget.filter((t) => baseLang(t.languageCode) === lang);
  const score = (/** @type {Track} */ t) =>
    (t.image ? -20 : 0) + (t.kind === "asr" ? 0 : 10) + (/^zh-(hans|cn|sg)$/i.test(t.languageCode) ? 2 : 0) + (t.languageCode === lang ? 1 : 0);
  return sameLang.sort((a, b) => score(b) - score(a))[0] ?? null;
}

/**
 * URL for the translation track, built from the URL the player used for the primary track (it carries
 * the player's proof-of-origin token). A manual track in the translation language is used when there is
 * one; otherwise YouTube's auto-translate (tlang).
 * @param {string} primaryUrl
 * @param {Track[]} tracks
 * @param {string} translationLang "en"
 */
export function translationUrl(primaryUrl, tracks, translationLang) {
  const url = new URL(primaryUrl);
  const manual = tracks.find((t) => baseLang(t.languageCode) === translationLang && t.kind !== "asr");
  if (manual) {
    url.searchParams.set("lang", manual.languageCode);
    url.searchParams.delete("kind");
    url.searchParams.delete("tlang");
    url.searchParams.delete("name");
  } else {
    url.searchParams.set("tlang", translationLang);
  }
  url.searchParams.set("fmt", "json3");
  return url.toString();
}

/**
 * What a captured timedtext URL is for.
 * @param {string} url
 */
export function describeTimedtextUrl(url) {
  const u = new URL(url, "https://www.youtube.com");
  return {
    videoId: u.searchParams.get("v") ?? "",
    lang: u.searchParams.get("tlang") || u.searchParams.get("lang") || "",
    translated: Boolean(u.searchParams.get("tlang")),
    kind: u.searchParams.get("kind") ?? "",
    fmt: u.searchParams.get("fmt") ?? "",
  };
}

/** 761234 -> "12:41.2" (for timing readouts). */
export function formatTimeTenths(/** @type {number} */ ms) {
  const tenths = Math.floor(Math.max(0, ms) / 100) % 10;
  return `${formatTime(ms)}.${tenths}`;
}

/**
 * Several consecutive cues as one: sentence text joined per language, span from first start to last end.
 * @param {Cue[]} cues sorted
 * @param {string} lang
 */
export function joinCues(cues, lang) {
  const sep = lang === "ja" || lang === "zh" ? "" : " ";
  return {
    start_ms: cues[0].start_ms,
    end_ms: cues[cues.length - 1].end_ms,
    sentence: cues.map((c) => sentenceText(c.text, lang)).join(sep),
  };
}

/** 761000 -> "12:41", 3723000 -> "1:02:03". */
export function formatTime(/** @type {number} */ ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
