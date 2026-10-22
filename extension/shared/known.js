// @ts-check
/** Known words from Anki: cleaning field text into words, word statuses, and marking the words of a
 * subtitle line. Pure functions (tested in Node); the worker builds the list (background/known.js). */

/** @typedef {"new" | "learning" | "known"} AnkiStatus  card not studied yet / younger than mature / mature */
/** @typedef {AnkiStatus | "unknown"} WordStatus  "unknown": in no chosen deck */

/**
 * One word's best card: [status, interval in days, deck].
 * @typedef {[AnkiStatus, number, string]} KnownEntry
 */

/** @typedef {{builtAt: string, cards: number, words: Record<string, Record<string, KnownEntry>>}} KnownList */

const RANK = { new: 0, learning: 1, known: 2 };

/**
 * Looks a word status can take in the bar: text colour from the theme, or an underline.
 * @type {Record<string, {label: string, color: string, decoration: string}>}
 */
export const WORD_STYLES = {
  none: { label: "No colour", color: "inherit", decoration: "none" },
  accent: { label: "Accent colour", color: "var(--accent)", decoration: "none" },
  accent2: { label: "Second accent", color: "var(--accent-2)", decoration: "none" },
  warn: { label: "Warning colour", color: "var(--warn)", decoration: "none" },
  danger: { label: "Red", color: "var(--danger)", decoration: "none" },
  muted: { label: "Dimmed", color: "var(--muted)", decoration: "none" },
  underline: { label: "Dotted underline", color: "inherit", decoration: "underline dotted var(--accent-2) 2px" },
  underlineAccent: { label: "Accent underline", color: "inherit", decoration: "underline solid var(--accent) 2px" },
};

/**
 * CSS variables for the bar from the chosen looks: --w-<status>-color / --w-<status>-deco.
 * @param {Record<string, string>} colors status -> WORD_STYLES key
 * @returns {Record<string, string>}
 */
export function wordStyleVars(colors) {
  /** @type {Record<string, string>} */
  const vars = {};
  for (const status of ["unknown", "learning", "known"]) {
    const style = WORD_STYLES[colors[status]] ?? WORD_STYLES.none;
    vars[`w-${status}-color`] = style.color;
    vars[`w-${status}-deco`] = style.decoration;
  }
  return vars;
}

/**
 * Status of a card from AnkiConnect cardsInfo: type 0 = new; interval in days (negative: seconds,
 * still in learning steps).
 * @param {{type: number, interval: number}} card
 * @param {number} matureDays
 * @returns {AnkiStatus}
 */
export function cardStatus(card, matureDays) {
  if (card.type === 0) return "new";
  return card.interval >= matureDays ? "known" : "learning";
}

/**
 * Words in a field value: HTML, Anki furigana (食[た]べる), sound tags and pitch markup removed; several
 * words separated by commas, slashes or 、 become several.
 * @param {string} value
 * @param {string} lang
 */
export function fieldWords(value, lang) {
  const text = value
    .replace(/\[sound:[^\]]*\]/g, "")
    .replace(/<br\s*\/?>/gi, ",")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&[a-z]+;|&#\d+;/gi, "")
    .replace(/\[[^\]]*\]/g, "") // furigana readings
    .replace(/[（(][^）)]*[）)]/g, ""); // notes in brackets
  return text
    .split(/[,，、;；/／・\n]+/)
    .map((w) => normalizeWord(w, lang))
    .filter((w) => w && w.length <= 30);
}

/** Key a word is stored and looked up by. @param {string} word @param {string} lang */
export function normalizeWord(word, lang) {
  const w = word.trim().replace(/^[\s"'“”‘’«»「」『』.!?。！？…~〜]+|[\s"'“”‘’«»「」『』.!?。！？…~〜]+$/g, "");
  return lang === "it" ? w.toLowerCase().replace(/’/g, "'") : w.replace(/\s+/g, "");
}

/**
 * Keep the best card for a word: known beats learning beats new; then the longer interval.
 * @param {Record<string, KnownEntry>} words
 * @param {string} word
 * @param {KnownEntry} entry
 */
export function mergeWord(words, word, entry) {
  const had = words[word];
  if (!had || RANK[entry[0]] > RANK[had[0]] || (RANK[entry[0]] === RANK[had[0]] && entry[1] > had[1])) words[word] = entry;
}

/**
 * Best entry among several spellings of one word (what was written, its dictionary forms).
 * @param {Record<string, KnownEntry> | undefined} words
 * @param {string[]} forms
 * @param {string} lang
 * @returns {KnownEntry | null}
 */
export function bestEntry(words, forms, lang) {
  /** @type {KnownEntry | null} */
  let best = null;
  for (const form of forms) {
    const e = words?.[normalizeWord(form, lang)];
    if (e && (!best || RANK[e[0]] > RANK[best[0]] || (RANK[e[0]] === RANK[best[0]] && e[1] > best[1]))) best = e;
  }
  return best;
}

// Grammar words are left uncoloured: they are rarely in a vocabulary deck, and marking every particle
// as unknown would hide the words that matter.
const JA_GRAMMAR_POS = new Set(["prt", "aux", "aux-v", "aux-adj", "cop", "cop-da", "conj"]);
const IT_GRAMMAR_POS = new Set(["article", "prep", "conj", "pron", "det", "particle", "contraction", "prep_phrase", "character", "punct"]);
const ZH_GRAMMAR = new Set("的了是在我你他她它们这那不也就都和有吗呢吧啊么个着过把被很".split(""));

/**
 * @param {import("./dictionary/index.js").LookupResult} match
 * @param {string} surface
 * @param {string} lang
 */
export function isGrammarWord(match, surface, lang) {
  const first = match.entries[0];
  const pos = first ? first.senses.flatMap((s) => s.pos) : [];
  if (lang === "ja") {
    if (/^[぀-ゟ]$/.test(surface)) return true; // one hiragana
    return pos.length > 0 && pos.every((p) => JA_GRAMMAR_POS.has(p));
  }
  if (lang === "it") return surface.length <= 2 || (pos.length > 0 && pos.every((p) => IT_GRAMMAR_POS.has(p)));
  if (lang === "zh") return surface.length === 1 && ZH_GRAMMAR.has(surface);
  return false;
}

/** A letter or CJK character (not space, punctuation or a digit). @param {string} ch */
const isWordChar = (ch) => /[\p{L}\p{M}]/u.test(ch);

/**
 * @typedef {object} WordMark
 * @property {number} start offsets in the sentence
 * @property {number} end
 * @property {WordStatus} status
 * @property {string} [deck] the card's deck when in Anki
 * @property {number} [interval] days
 */

/**
 * The words of a sentence with their Anki status, for colouring the subtitle bar. Each position takes the
 * dictionary's longest match (as a click does); grammar words and text the dictionary does not know are
 * left out.
 * @param {string} sentence
 * @param {string} lang
 * @param {(sentence: string, offset: number) => Promise<import("./dictionary/index.js").LookupResult | null>} lookup
 * @param {Record<string, KnownEntry> | undefined} words this language's known list
 * @returns {Promise<WordMark[]>}
 */
export async function markWords(sentence, lang, lookup, words) {
  /** @type {WordMark[]} */
  const marks = [];
  let i = 0;
  while (i < sentence.length) {
    if (!isWordChar(sentence[i])) {
      i++;
      continue;
    }
    const match = await lookup(sentence, i);
    if (!match || match.end <= i || !match.entries.length) {
      // Not in the dictionary: skip the character (ja/zh) or the whole word (it).
      if (lang === "it") while (i < sentence.length && isWordChar(sentence[i])) i++;
      else i++;
      continue;
    }
    const surface = sentence.slice(match.start, match.end);
    if (!isGrammarWord(match, surface, lang)) {
      const entry = bestEntry(words, [surface, ...match.entries.map((e) => e.term)], lang);
      marks.push(
        entry
          ? { start: match.start, end: match.end, status: entry[0], interval: entry[1], deck: entry[2] }
          : { start: match.start, end: match.end, status: "unknown" },
      );
    }
    i = Math.max(match.end, i + 1);
  }
  return marks;
}
