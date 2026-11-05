// @ts-check
/** Page reader (M8): the sentence around a hovered character and the language to look it up in.
 * Pure functions (tested in Node); the content script is content/reader.js. */

/** Ends a sentence. "." only ends one when a space or the end of the text follows (not 3.5, not e.g.x). */
const ENDERS = "。！？!?…";
/** Closing quotes and brackets that belong to the sentence they end. */
const CLOSERS = "」』）)】〉》\"'”’»";
/** Longest sentence handed to the dictionary and put on a card. */
export const MAX_SENTENCE = 200;

/** @param {string} text @param {number} i */
function endsAt(text, i) {
  const ch = text[i];
  if (ch === "\n") return true;
  if (ENDERS.includes(ch)) return true;
  if (ch === ".") return i + 1 >= text.length || /\s/.test(text[i + 1]) || CLOSERS.includes(text[i + 1]);
  return false;
}

/**
 * The sentence holding `offset` in a block of text, and the offset inside it. Whitespace around it is
 * trimmed; a very long one is cut to MAX_SENTENCE characters around the offset.
 * @param {string} text
 * @param {number} offset
 * @returns {{sentence: string, offset: number}}
 */
export function sentenceAround(text, offset) {
  const at = Math.max(0, Math.min(offset, text.length - 1));
  let start = at;
  while (start > 0 && !endsAt(text, start - 1)) start--;
  // The text before is a run of closers right after an ender (「…。」): those belong to the previous one.
  while (start < at && CLOSERS.includes(text[start])) start++;
  let end = at;
  while (end < text.length && !endsAt(text, end)) end++;
  if (end < text.length && text[end] !== "\n") {
    end++; // keep the ender
    while (end < text.length && (ENDERS.includes(text[end]) || CLOSERS.includes(text[end]))) end++;
  }
  while (start < at && /\s/.test(text[start])) start++;
  while (end > at + 1 && /\s/.test(text[end - 1])) end--;
  if (end - start > MAX_SENTENCE) {
    const half = Math.floor(MAX_SENTENCE / 2);
    const from = Math.max(start, Math.min(at - half, end - MAX_SENTENCE));
    start = from;
    end = from + MAX_SENTENCE;
  }
  return { sentence: text.slice(start, end), offset: at - start };
}

const KANA = /[぀-ゟ゠-ヿ]/;
const HAN = /\p{Script=Han}/u;
const LATIN = /\p{Script=Latin}/u;

/**
 * Which of the user's languages to look the hovered character up in, or null for none.
 * Kana anywhere in the sentence: Japanese. A Latin letter: Italian. Han only: the page's lang attribute
 * decides between Japanese and Chinese, else the first of them in the targets.
 * @param {string} sentence
 * @param {number} offset
 * @param {string[]} targets languages chosen in Options ("ja", "zh", "it")
 * @param {string} [pageLang] document.documentElement.lang
 * @returns {"ja" | "zh" | "it" | null}
 */
export function pickLang(sentence, offset, targets, pageLang = "") {
  const ch = sentence[offset] ?? "";
  const has = (/** @type {string} */ l) => targets.includes(l);
  if (LATIN.test(ch)) return has("it") ? "it" : null;
  if (KANA.test(ch)) return has("ja") ? "ja" : null;
  if (!HAN.test(ch)) return null;
  if (KANA.test(sentence) && has("ja")) return "ja";
  const page = pageLang.toLowerCase().split("-")[0];
  if ((page === "ja" || page === "zh") && has(page)) return page;
  const cjk = targets.find((l) => l === "ja" || l === "zh");
  return /** @type {"ja" | "zh" | undefined} */ (cjk) ?? null;
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}　-〿＀-￯]/u;

/**
 * Page text as shown: runs of whitespace (HTML line wraps, indents) become one space, and a space between
 * two CJK characters goes (a line wrap in the HTML source of a Japanese paragraph). `map[i]` is where
 * character i of the result was in the input, so a match can be found on the page again.
 * @param {string} text
 * @returns {{text: string, map: number[]}}
 */
export function collapseSpaces(text) {
  let out = "";
  /** @type {number[]} */
  const map = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\n") {
      while (out.endsWith(" ")) (out = out.slice(0, -1)), map.pop();
      if (out.endsWith("\n")) continue;
      out += "\n";
      map.push(i);
      continue;
    }
    if (/\s/.test(ch)) {
      let j = i;
      while (j + 1 < text.length && /\s/.test(text[j + 1]) && text[j + 1] !== "\n") j++;
      const prev = out[out.length - 1];
      const next = text[j + 1];
      const between = prev !== undefined && next !== undefined && CJK.test(prev) && CJK.test(next);
      if (prev !== undefined && prev !== "\n" && next !== undefined && next !== "\n" && !between) {
        out += " ";
        map.push(i);
      }
      i = j;
      continue;
    }
    out += ch;
    map.push(i);
  }
  return { text: out, map };
}
