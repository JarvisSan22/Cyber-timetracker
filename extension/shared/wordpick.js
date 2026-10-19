// @ts-check
/** Picking a word in a sentence by click position, and mapping subtitle lines to sentence offsets. */

const KANJI = /[\p{Script=Han}々〆ヶ]/u;
const HIRAGANA = /\p{Script=Hiragana}/u;
const KATAKANA = /[\p{Script=Katakana}ー]/u;
const LETTER = /[\p{L}\p{M}\p{N}]/u;

/** @param {string} ch */
function scriptClass(ch) {
  if (KANJI.test(ch)) return "kanji";
  if (KATAKANA.test(ch)) return "katakana";
  if (HIRAGANA.test(ch)) return "hiragana";
  if (LETTER.test(ch)) return "letter";
  return "";
}

/**
 * Word around a clicked character when no dictionary is loaded: a run of the same script for Japanese
 * and Chinese (魔法の -> 魔法), letters between spaces and apostrophes for Italian (l'amico -> amico).
 * @param {string} sentence
 * @param {number} at string (UTF-16) offset of the clicked character
 * @param {string} lang
 * @returns {{start: number, end: number} | null} string offsets
 */
export function fallbackWordAt(sentence, at, lang) {
  if (at < 0 || at >= sentence.length) return null;
  const chars = [...sentence];
  const offset = [...sentence.slice(0, at)].length;
  const cls = scriptClass(chars[offset]);
  if (!cls) return null;
  // Chinese has no kana runs to lean on; one character is the honest guess without a dictionary.
  if (lang === "zh" && cls === "kanji") return toCodeUnits(chars, offset, offset + 1);
  let start = offset;
  let end = offset + 1;
  while (start > 0 && scriptClass(chars[start - 1]) === cls) start--;
  while (end < chars.length && scriptClass(chars[end]) === cls) end++;
  return toCodeUnits(chars, start, end);
}

/**
 * Code-point indexes -> string (UTF-16) offsets, which is what slice() and the card use.
 * @param {string[]} chars
 * @param {number} start
 * @param {number} end
 */
function toCodeUnits(chars, start, end) {
  const before = chars.slice(0, start).join("").length;
  return { start: before, end: before + chars.slice(start, end).join("").length };
}

/**
 * The cue's lines split into characters, each with its offset in sentenceText() (lines joined with ""
 * for ja/zh, " " otherwise). Lets the subtitle bar turn a clicked character into a sentence offset.
 * @param {string} text cue text with "\n" between lines
 * @param {string} lang
 * @returns {{ch: string, i: number}[][]}
 */
export function lineOffsets(text, lang) {
  const sep = lang === "ja" || lang === "zh" ? "" : " ";
  let i = 0;
  return text
    .split("\n")
    .map((line, n) => {
      if (n > 0) i += sep.length;
      return [...line].map((ch) => {
        const at = i;
        i += ch.length;
        return { ch, i: at };
      });
    });
}
