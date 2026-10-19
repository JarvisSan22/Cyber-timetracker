// @ts-check
/** Japanese lookup: longest match from the clicked character, with conjugations traced back to the
 * dictionary form (食べられなかった -> 食べる), the way Yomitan does it. */

/**
 * @typedef {{ getIds(lang: string, keys: string[]): Promise<Map<string, number[]>>,
 *             getEntries(lang: string, ids: number[]): Promise<any[]>,
 *             getForms(lang: string, forms: string[]): Promise<Map<string, [string, string][]>>,
 *             getPitch(term: string, reading: string): Promise<number[]> }} DictStore
 */

// --- deinflection rules ---
// A rule turns an inflected ending back into a less inflected one: [from, to, rulesIn, rulesOut, reason].
// rulesIn: what the inflected word must be able to be (its own conjugation class), rulesOut: the class of
// the result. "te" and "masu" are intermediate classes; v1/v5/vk/vs/adj-i are dictionary parts of speech.

/** Godan endings: dictionary, a-, i-, e-, o-stem, te, ta. */
const GODAN = [
  ["う", "わ", "い", "え", "お", "って", "った"],
  ["く", "か", "き", "け", "こ", "いて", "いた"],
  ["ぐ", "が", "ぎ", "げ", "ご", "いで", "いだ"],
  ["す", "さ", "し", "せ", "そ", "して", "した"],
  ["つ", "た", "ち", "て", "と", "って", "った"],
  ["ぬ", "な", "に", "ね", "の", "んで", "んだ"],
  ["ぶ", "ば", "び", "べ", "ぼ", "んで", "んだ"],
  ["む", "ま", "み", "め", "も", "んで", "んだ"],
  ["る", "ら", "り", "れ", "ろ", "って", "った"],
];

/** 来る and する stems, in kana and (for 来る) kanji. */
const KURU = { dict: ["くる", "来る"], a: ["こ", "来"], i: ["き", "来"], e: ["くれ", "来れ"], o: ["こよ", "来よ"] };

/** @type {[string, string, string[], string[], string][]} */
const RULES = [];

/**
 * Add one suffix for every verb class.
 * @param {string} reason
 * @param {"a" | "i" | "e" | "te" | "ta"} stem which stem the suffix attaches to
 * @param {string} suffix
 * @param {string[]} rulesIn class of the inflected word
 */
function verbs(reason, stem, suffix, rulesIn) {
  const col = { a: 1, i: 2, e: 3, te: 5, ta: 6 }[stem];
  for (const row of GODAN) RULES.push([row[col] + suffix, row[0], rulesIn, ["v5"], reason]);
  if (stem === "te" || stem === "ta") {
    RULES.push([(stem === "te" ? "て" : "た") + suffix, "る", rulesIn, ["v1"], reason]);
    RULES.push(["って" + suffix, "く", rulesIn, ["v5"], reason]); // 行く -> 行って
    for (let k = 0; k < 2; k++) RULES.push([KURU.i[k] + (stem === "te" ? "て" : "た") + suffix, KURU.dict[k], rulesIn, ["vk"], reason]);
    RULES.push([(stem === "te" ? "して" : "した") + suffix, "する", rulesIn, ["vs"], reason]);
    return;
  }
  RULES.push([suffix, "る", rulesIn, ["v1"], reason]);
  for (let k = 0; k < 2; k++) RULES.push([KURU[stem][k] + suffix, KURU.dict[k], rulesIn, ["vk"], reason]);
  RULES.push([{ a: "し", i: "し", e: "すれ" }[stem] + suffix, "する", rulesIn, ["vs"], reason]);
}

verbs("negative", "a", "ない", ["adj-i"]);
verbs("negative", "a", "ず", []);
verbs("negative", "a", "ずに", []);
verbs("negative", "a", "ん", []);
verbs("polite", "i", "ます", ["masu"]);
verbs("want", "i", "たい", ["adj-i"]);
verbs("imperative", "i", "なさい", []);
verbs("too much", "i", "すぎる", ["v1"]);
verbs("looks like", "i", "そう", []);
verbs("while", "i", "ながら", []);
verbs("conditional", "e", "ば", []);
verbs("te", "te", "", ["te"]);
verbs("past", "ta", "", []);
verbs("conditional", "ta", "ら", []);
verbs("and so on", "ta", "り", []);

// Potential, passive, causative: the result is itself an ichidan verb, so it chains on (食べられなかった).
for (const row of GODAN) {
  RULES.push([row[3] + "る", row[0], ["v1"], ["v5"], "potential"]);
  RULES.push([row[1] + "れる", row[0], ["v1"], ["v5"], "passive"]);
  RULES.push([row[1] + "せる", row[0], ["v1"], ["v5"], "causative"]);
  RULES.push([row[1] + "される", row[0], ["v1"], ["v5"], "causative passive"]);
  RULES.push([row[4] + "う", row[0], [], ["v5"], "volitional"]);
  RULES.push([row[3], row[0], [], ["v5"], "imperative"]);
}
RULES.push(
  ["られる", "る", ["v1"], ["v1"], "potential or passive"],
  ["れる", "る", ["v1"], ["v1"], "potential"], // ら抜き: 食べれる
  ["させる", "る", ["v1"], ["v1"], "causative"],
  ["よう", "る", [], ["v1"], "volitional"],
  ["ろ", "る", [], ["v1"], "imperative"],
  ["よ", "る", [], ["v1"], "imperative"],
  ["こられる", "くる", ["v1"], ["vk"], "potential or passive"],
  ["来られる", "来る", ["v1"], ["vk"], "potential or passive"],
  ["これる", "くる", ["v1"], ["vk"], "potential"],
  ["来れる", "来る", ["v1"], ["vk"], "potential"],
  ["こさせる", "くる", ["v1"], ["vk"], "causative"],
  ["来させる", "来る", ["v1"], ["vk"], "causative"],
  ["こよう", "くる", [], ["vk"], "volitional"],
  ["来よう", "来る", [], ["vk"], "volitional"],
  ["こい", "くる", [], ["vk"], "imperative"],
  ["来い", "来る", [], ["vk"], "imperative"],
  ["される", "する", ["v1"], ["vs"], "passive"],
  ["させる", "する", ["v1"], ["vs"], "causative"],
  ["できる", "する", ["v1"], ["vs"], "potential"],
  ["しよう", "する", [], ["vs"], "volitional"],
  ["しろ", "する", [], ["vs"], "imperative"],
  ["せよ", "する", [], ["vs"], "imperative"],
  ["せず", "する", [], ["vs"], "negative"],
  // 勉強する -> 勉強 (a noun that takes する)
  ["する", "", ["vs"], ["vs"], "する verb"],
  // Polite endings back to ます
  ["ません", "ます", [], ["masu"], "negative"],
  ["ました", "ます", [], ["masu"], "past"],
  ["ませんでした", "ます", [], ["masu"], "negative past"],
  ["ましょう", "ます", [], ["masu"], "volitional"],
  ["まして", "ます", [], ["masu"], "te"],
  // て + auxiliary
  ["ている", "て", ["v1"], ["te"], "progressive"],
  ["てる", "て", ["v1"], ["te"], "progressive"],
  ["でいる", "で", ["v1"], ["te"], "progressive"],
  ["でる", "で", ["v1"], ["te"], "progressive"],
  ["てしまう", "て", ["v5"], ["te"], "completely"],
  ["でしまう", "で", ["v5"], ["te"], "completely"],
  ["ちゃう", "て", ["v5"], ["te"], "completely"],
  ["じゃう", "で", ["v5"], ["te"], "completely"],
  ["ておく", "て", ["v5"], ["te"], "in advance"],
  ["とく", "て", ["v5"], ["te"], "in advance"],
  ["てある", "て", ["v5"], ["te"], "resultative"],
  ["てくる", "て", ["vk"], ["te"], "coming"],
  ["ていく", "て", ["v5"], ["te"], "going"],
  ["てくれる", "て", ["v1"], ["te"], "for me"],
  ["てあげる", "て", ["v1"], ["te"], "for someone"],
  ["てもらう", "て", ["v5"], ["te"], "have done"],
  ["てみる", "て", ["v1"], ["te"], "try"],
  // i-adjectives
  ["くない", "い", ["adj-i"], ["adj-i"], "negative"],
  ["かった", "い", [], ["adj-i"], "past"],
  ["くて", "い", ["te"], ["adj-i"], "te"],
  ["く", "い", [], ["adj-i"], "adverb"],
  ["ければ", "い", [], ["adj-i"], "conditional"],
  ["かったら", "い", [], ["adj-i"], "conditional"],
  ["さ", "い", [], ["adj-i"], "noun"],
  ["そう", "い", [], ["adj-i"], "looks like"],
  ["すぎる", "い", ["v1"], ["adj-i"], "too much"],
);

/**
 * @typedef {object} Candidate
 * @property {string} term
 * @property {string[]} rules required class of the dictionary entry ([] = any)
 * @property {string[]} reasons outermost first
 */

/**
 * Every possible less-inflected form of `text`, the text itself first.
 * @param {string} text
 * @returns {Candidate[]}
 */
export function deinflect(text) {
  /** @type {Candidate[]} */
  const results = [{ term: text, rules: [], reasons: [] }];
  const seen = new Set([`${text}|`]);
  for (let i = 0; i < results.length && results.length < 400; i++) {
    const { term, rules, reasons } = results[i];
    for (const [from, to, rulesIn, rulesOut, reason] of RULES) {
      if (rules.length && !rulesIn.some((r) => rules.includes(r))) continue;
      if (!term.endsWith(from) || term.length - from.length + to.length <= 0) continue;
      const next = term.slice(0, term.length - from.length) + to;
      const key = `${next}|${rulesOut.join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ term: next, rules: rulesOut, reasons: [...reasons, reason] });
    }
  }
  return results;
}

/** JMdict part-of-speech code -> deinflection class. */
function posClass(/** @type {string} */ pos) {
  if (pos.startsWith("v5")) return "v5";
  if (pos === "v1" || pos === "v1-s") return "v1";
  if (pos === "vk") return "vk";
  if (pos === "vs" || pos.startsWith("vs-")) return "vs";
  if (pos === "adj-i" || pos === "adj-ix") return "adj-i";
  return "";
}

/** @param {any} entry @param {string[]} rules */
function entryFits(entry, rules) {
  if (!rules.length) return true;
  return entry.s.some((/** @type {{p: string[]}} */ sense) => sense.p.some((p) => rules.includes(posClass(p))));
}

const KATAKANA = /[ァ-ヶ]/g;
/** カタカナ -> かたかな (some words are written in katakana in subtitles but listed in kana). */
export function toHiragana(/** @type {string} */ text) {
  return text.replace(KATAKANA, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

const KANJI = /[\p{Script=Han}々〆ヶ]/u;

/**
 * Anki furigana for a word: 食べる + たべる -> 食[た]べる, お茶 + おちゃ -> お 茶[ちゃ].
 * Falls back to whole-word ruby when the kana in the word cannot be lined up with the reading.
 * @param {string} term
 * @param {string} reading
 */
export function furigana(term, reading) {
  if (!reading || !KANJI.test(term)) return term;
  /** @type {{text: string, kanji: boolean}[]} */
  const parts = [];
  for (const ch of term) {
    const kanji = KANJI.test(ch);
    const last = parts[parts.length - 1];
    if (last && last.kanji === kanji) last.text += ch;
    else parts.push({ text: ch, kanji });
  }
  const pattern = parts.map((p) => (p.kanji ? "(.+?)" : `(${escapeRegex(toHiragana(p.text))})`)).join("");
  const m = new RegExp(`^${pattern}$`, "u").exec(toHiragana(reading));
  if (!m) return `${term}[${reading}]`;
  return parts
    .map((p, i) => (p.kanji ? `${i > 0 ? " " : ""}${p.text}[${m[i + 1]}]` : p.text))
    .join("");
}

/** @param {string} s */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const MAX_LENGTH = 16;

/**
 * Longest dictionary word starting at `offset` (or exactly [offset, end) when the user dragged).
 * @param {DictStore} store
 * @param {string} sentence
 * @param {number} offset
 * @param {number} [end]
 * @returns {Promise<import("./index.js").LookupResult | null>}
 */
export async function lookupJa(store, sentence, offset, end) {
  const lengths = end !== undefined ? [end - offset] : range(Math.min(MAX_LENGTH, sentence.length - offset), 1);
  // Gather every candidate for every length, then fetch all keys in one go.
  const perLength = lengths.map((len) => {
    const text = sentence.slice(offset, offset + len);
    const variants = new Set([text, toHiragana(text)]);
    return { len, candidates: [...variants].flatMap(deinflect) };
  });
  const allTerms = [...new Set(perLength.flatMap((p) => p.candidates.map((c) => c.term)))];
  const ids = await store.getIds("ja", allTerms);

  for (const { len, candidates } of perLength) {
    /** @type {{entry: any, candidate: Candidate}[]} */
    const hits = [];
    const wanted = [...new Set(candidates.flatMap((c) => ids.get(c.term) ?? []))];
    if (!wanted.length) continue;
    const entries = new Map((await store.getEntries("ja", wanted)).map((e) => [e.id, e]));
    for (const candidate of candidates) {
      for (const id of ids.get(candidate.term) ?? []) {
        const entry = entries.get(id);
        if (entry && entryFits(entry, candidate.rules) && !hits.some((h) => h.entry.id === id)) hits.push({ entry, candidate });
      }
    }
    if (!hits.length) continue;
    hits.sort(
      (a, b) =>
        a.candidate.reasons.length - b.candidate.reasons.length || b.entry.c - a.entry.c || a.entry.id - b.entry.id,
    );
    const formatted = await Promise.all(hits.slice(0, 8).map((h) => formatEntry(store, h.entry, h.candidate)));
    return { start: offset, end: offset + len, entries: formatted };
  }
  return null;
}

/** @param {number} from @param {number} to */
function range(from, to) {
  const out = [];
  for (let n = from; n >= to; n--) out.push(n);
  return out;
}

/**
 * @param {DictStore} store
 * @param {any} entry {k: [[text, common]], r: [[text, common, appliesToKanji]], s: [{p, g}]}
 * @param {Candidate} candidate
 * @returns {Promise<import("./index.js").Entry>}
 */
async function formatEntry(store, entry, candidate) {
  const kanjiForms = entry.k.map((/** @type {any[]} */ k) => k[0]);
  const kanaForms = entry.r.map((/** @type {any[]} */ r) => r[0]);
  // Show the word as matched: a kanji spelling with its reading, or the kana spelling as written.
  const matchedKanji = kanjiForms.includes(candidate.term) ? candidate.term : null;
  const matchedKana = kanaForms.includes(candidate.term) || kanaForms.includes(toHiragana(candidate.term));
  const term = matchedKanji ?? (matchedKana ? candidate.term : kanjiForms[0] ?? kanaForms[0]);
  const readingRow = matchedKanji
    ? entry.r.find((/** @type {any[]} */ r) => r[2].includes("*") || r[2].includes(matchedKanji))
    : entry.r[0];
  const reading = matchedKana ? toHiragana(candidate.term) : readingRow?.[0] ?? "";
  const notes = [];
  if (candidate.reasons.length) notes.push(candidate.reasons.slice().reverse().join(" · "));
  if (!matchedKanji && kanjiForms.length) notes.push(`also written ${kanjiForms.slice(0, 3).join("、")}`);
  return {
    term,
    reading,
    furigana: matchedKanji ? furigana(term, reading) : "",
    pitch: await store.getPitch(matchedKanji ?? kanjiForms[0] ?? reading, reading).catch(() => []),
    senses: entry.s.map((/** @type {{p: string[], g: string[]}} */ s) => ({ pos: s.p, glosses: s.g })),
    note: notes.join(" — ") || undefined,
  };
}
