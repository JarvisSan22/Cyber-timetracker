// @ts-check
/** Subtitle file formats besides YouTube's json3: TTML (Netflix DFXP and IMSC 1.1) and WebVTT.
 * Pure functions with a small tag tokenizer instead of DOMParser, so they run in Node tests as well. */

import { baseLang } from "./subtitles.js";

/** @typedef {import("./subtitles.js").Cue} Cue */

const ENTITIES = /** @type {Record<string, string>} */ ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " });

/** @param {string} s */
export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** @param {string} attrs */
function parseAttrs(attrs) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const m of attrs.matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1]] = m[3] ?? m[4] ?? "";
  return out;
}

/** Local name of a possibly prefixed XML name: "tts:ruby" -> "ruby", "tt:p" -> "p". */
const local = (/** @type {string} */ name) => name.slice(name.indexOf(":") + 1);

/** @param {Record<string, string>} attrs @param {string} name local attribute name */
function attr(attrs, name) {
  for (const [k, v] of Object.entries(attrs)) if (local(k) === name) return v;
  return undefined;
}

/**
 * TTML time expression to ms: "1234567t" (ticks), "00:01:02.345", "00:01:02:12" (frames), "62.3s", "500ms".
 * @param {string} value
 * @param {{tickRate: number, frameRate: number}} rates
 */
export function ttmlTime(value, { tickRate, frameRate }) {
  const v = value.trim();
  let m = /^([\d.]+)(h|m|s|ms|f|t)$/.exec(v);
  if (m) {
    const n = parseFloat(m[1]);
    return { h: n * 3600000, m: n * 60000, s: n * 1000, ms: n, f: (n / frameRate) * 1000, t: (n / tickRate) * 1000 }[m[2]] ?? NaN;
  }
  m = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)(?::(\d+(?:\.\d+)?))?$/.exec(v);
  if (m) return (+m[1] * 3600 + +m[2] * 60 + parseFloat(m[3])) * 1000 + (m[4] ? (parseFloat(m[4]) / frameRate) * 1000 : 0);
  return NaN;
}

/** Collapse whitespace inside lines, drop empty lines. @param {string} text */
function tidy(text) {
  return text
    .replace(/​/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t\r]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * @param {Cue[]} cues
 */
function finish(cues) {
  return cues.filter((c) => c.text && c.end_ms > c.start_ms).sort((a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms);
}

/**
 * TTML subtitles (Netflix dfxp-ls-sdh, imsc1.1). Ruby text (furigana) is dropped, ruby base kept: the
 * card's sentence is plain text, our own furigana goes on the target word only. Ruby is marked either
 * on the span (tts:ruby="text") or on a style it references (Netflix IMSC).
 * @param {string} xml
 * @param {string} lang
 * @param {"primary" | "translation"} role
 * @returns {Cue[]}
 */
export function parseTtml(xml, lang, role) {
  const root = /<(?:\w+:)?tt\b([^>]*)>/.exec(xml);
  if (!root) throw new Error("Not TTML");
  const rootAttrs = parseAttrs(root[1]);
  const [num, den] = (attr(rootAttrs, "frameRateMultiplier") ?? "1 1").split(/\s+/).map(Number);
  const frameRate = (parseFloat(attr(rootAttrs, "frameRate") ?? "") || 30) * ((num || 1) / (den || 1));
  const rates = { tickRate: parseFloat(attr(rootAttrs, "tickRate") ?? "") || 10000000, frameRate };

  // Styles whose ruby role is "text" (the furigana), possibly through a referenced style.
  /** @type {Map<string, {ruby?: string, refs: string[]}>} */
  const styles = new Map();
  for (const m of xml.matchAll(/<(?:\w+:)?style\b([^>]*?)\/?>/g)) {
    const a = parseAttrs(m[1]);
    const id = a["xml:id"] ?? attr(a, "id");
    if (id) styles.set(id, { ruby: attr(a, "ruby"), refs: (attr(a, "style") ?? "").split(/\s+/).filter(Boolean) });
  }
  /** @param {string} id @param {number} [depth] @returns {string | undefined} */
  const styleRuby = (id, depth = 0) => {
    const s = styles.get(id);
    if (!s || depth > 5) return undefined;
    return s.ruby ?? s.refs.map((r) => styleRuby(r, depth + 1)).find(Boolean);
  };
  /** @param {Record<string, string>} a */
  const isRubyText = (a) => {
    const ruby = attr(a, "ruby") ?? (attr(a, "style") ?? "").split(/\s+/).map((id) => styleRuby(id)).find(Boolean);
    return ruby === "text" || ruby === "textContainer";
  };

  const bodyAt = xml.search(/<(?:\w+:)?body\b/);
  const body = bodyAt < 0 ? "" : xml.slice(bodyAt);
  /** @type {Cue[]} */
  const cues = [];
  /** @type {null | {start: number, end: number, text: string}} */
  let p = null;
  let skipDepth = 0; // > 0 inside ruby text
  /** Open elements inside the <p>: whether each one started skipping. */
  /** @type {boolean[]} */
  const stack = [];
  const base = baseLang(lang);
  const layoutSpace = base === "ja" || base === "zh" ? "" : " ";
  for (const m of body.matchAll(/<(\/?)([\w:.-]+)([^>]*?)(\/?)>|([^<]+)/g)) {
    const [, close, rawName, rawAttrs, selfClose, text] = m;
    if (text !== undefined) {
      // Line breaks in the file are layout, not text (<br/> is): whitespace between tags goes, the rest is a
      // space (none in Japanese and Chinese).
      if (p && !skipDepth && !/^\s*\n\s*$/.test(text)) p.text += decodeEntities(text.replace(/\s*\n\s*/g, layoutSpace));
      continue;
    }
    const name = local(rawName);
    if (name === "p") {
      if (close) {
        if (p) cues.push({ start_ms: Math.round(p.start), end_ms: Math.round(p.end), text: tidy(p.text), lang: base, role });
        p = null;
        stack.length = 0;
        skipDepth = 0;
      } else {
        const a = parseAttrs(rawAttrs);
        const start = ttmlTime(attr(a, "begin") ?? "", rates);
        let end = ttmlTime(attr(a, "end") ?? "", rates);
        if (Number.isNaN(end)) end = start + ttmlTime(attr(a, "dur") ?? "", rates);
        p = Number.isNaN(start) || Number.isNaN(end) ? null : { start, end, text: "" };
        if (p && selfClose) p = null;
      }
      continue;
    }
    if (!p) continue;
    if (name === "br") {
      if (!skipDepth) p.text += "\n";
      continue;
    }
    if (selfClose) continue;
    if (close) {
      if (stack.pop()) skipDepth--;
    } else {
      const skips = isRubyText(parseAttrs(rawAttrs)) || name === "rt" || name === "rp";
      stack.push(skips);
      if (skips) skipDepth++;
    }
  }
  return finish(cues);
}

/** "00:01:02.345" or "01:02.345" to ms. @param {string} v */
function vttTime(v) {
  const m = /^(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})$/.exec(v.trim());
  return m ? ((+(m[1] ?? 0) * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4] : NaN;
}

/**
 * WebVTT (Netflix webvtt-lssdh-ios8). Tags are stripped; <rt>/<rp> (ruby text) dropped.
 * @param {string} text
 * @param {string} lang
 * @param {"primary" | "translation"} role
 * @returns {Cue[]}
 */
export function parseVtt(text, lang, role) {
  const src = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (!src.startsWith("WEBVTT")) throw new Error("Not WebVTT");
  /** @type {Cue[]} */
  const cues = [];
  const base = baseLang(lang);
  for (const block of src.split(/\n{2,}/)) {
    const lines = block.split("\n");
    const at = lines.findIndex((l) => l.includes("-->"));
    if (at < 0) continue;
    const [from, rest] = lines[at].split("-->");
    const start = vttTime(from);
    const end = vttTime(rest.trim().split(/\s+/)[0]);
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    const body = lines
      .slice(at + 1)
      .join("\n")
      .replace(/<(rt|rp)\b[^>]*>[\s\S]*?<\/\1>/g, "")
      .replace(/<[^>]+>/g, "");
    cues.push({ start_ms: start, end_ms: end, text: tidy(decodeEntities(body)), lang: base, role });
  }
  return finish(cues);
}

/**
 * Parse whichever of the two formats the body is.
 * @param {string} body
 * @param {string} lang
 * @param {"primary" | "translation"} role
 */
export function parseSubtitleFile(body, lang, role) {
  return body.replace(/^﻿/, "").trimStart().startsWith("WEBVTT") ? parseVtt(body, lang, role) : parseTtml(body, lang, role);
}
