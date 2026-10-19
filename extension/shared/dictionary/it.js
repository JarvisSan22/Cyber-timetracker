// @ts-check
/** Italian lookup: the clicked word, its lemma through inflected forms (parlavamo -> parlare) and
 * attached pronouns stripped (parlarlo -> parlare, dimmelo -> di' -> dire). */

const LETTER = /[\p{L}\p{M}]/u;

/** Attached (enclitic) pronouns, longest first. */
const CLITICS = [
  "gliela", "glielo", "glieli", "gliele", "gliene",
  "mela", "melo", "meli", "mele", "mene", "tela", "telo", "teli", "tele", "tene",
  "sela", "selo", "seli", "sele", "sene", "cela", "celo", "celi", "cele", "cene",
  "vela", "velo", "veli", "vele", "vene", "gli",
  "lo", "la", "li", "le", "ne", "mi", "ti", "si", "ci", "vi",
];

/**
 * The word around `offset`: letters, plus a trailing apostrophe for elisions (l', dell', di').
 * @param {string} sentence
 * @param {number} offset
 */
export function wordAt(sentence, offset) {
  if (!LETTER.test(sentence[offset] ?? "")) return null;
  let start = offset;
  let end = offset + 1;
  while (start > 0 && LETTER.test(sentence[start - 1])) start--;
  while (end < sentence.length && LETTER.test(sentence[end])) end++;
  if (sentence[end] === "'" || sentence[end] === "’") end++;
  return { start, end };
}

/**
 * Lemma candidates for a written word, most direct first: [word, how it was found].
 * @param {string} word lowercase, apostrophe normalised to '
 * @returns {[string, string][]}
 */
export function cliticCandidates(word) {
  /** @type {[string, string][]} */
  const out = [];
  for (const clitic of CLITICS) {
    if (!word.endsWith(clitic) || word.length - clitic.length < 2) continue;
    const base = word.slice(0, -clitic.length);
    const note = `+ ${clitic}`;
    out.push([base, note]);
    if (base.endsWith("r")) out.push([`${base}e`, note]); // parlar(lo) -> parlare
    // Short imperatives double the pronoun's consonant: dimmelo = di' + m + melo, fallo = fa' + l + lo.
    if (base.length > 2 && base[base.length - 1] === clitic[0]) {
      out.push([`${base.slice(0, -1)}'`, note], [base.slice(0, -1), note]);
    }
  }
  return out;
}

/**
 * @param {import("./ja.js").DictStore} store
 * @param {string} sentence
 * @param {number} offset
 * @param {number} [end]
 * @returns {Promise<import("./index.js").LookupResult | null>}
 */
export async function lookupIt(store, sentence, offset, end) {
  const span = end !== undefined ? { start: offset, end } : wordAt(sentence, offset);
  if (!span) return null;
  const written = sentence.slice(span.start, span.end).toLowerCase().replace(/’/g, "'");
  const plain = written.replace(/'$/, "");

  /** @type {[string, string][]} words to look up, with how they relate to what was written */
  const tries = [[written, ""], [plain, ""], ...cliticCandidates(plain)];
  const forms = await store.getForms("it", tries.map((t) => t[0]));
  // Lemmas reached through inflected forms (andiamo -> andare), including forms of a stripped base.
  for (const [word, how] of [...tries]) {
    for (const [lemma, note] of forms.get(word) ?? []) tries.push([lemma, [how, note ? `${word}: ${note}` : `form of ${lemma}`].filter(Boolean).join(" · ")]);
  }
  const ids = await store.getIds("it", [...new Set(tries.map((t) => t[0]))]);

  /** @type {import("./index.js").Entry[]} */
  const results = [];
  const seen = new Set();
  for (const [word, how] of tries) {
    const found = (ids.get(word) ?? []).filter((id) => !seen.has(id));
    if (!found.length) continue;
    found.forEach((id) => seen.add(id));
    for (const e of await store.getEntries("it", found)) {
      results.push({
        term: e.w,
        reading: "",
        furigana: "",
        pitch: [],
        senses: e.g.map((/** @type {string} */ g) => ({ pos: [e.pos], glosses: [g] })),
        note: how || undefined,
      });
      // Compound entries (dimmelo) name their lemma: show its meaning too.
      if (e.l && !tries.some((t) => t[0] === e.l)) tries.push([e.l, `in ${e.w}`]);
    }
    if (results.length >= 8) break;
  }
  // Lemmas found from compound entries were added to `tries` after the key fetch: fetch them now.
  const late = tries.filter((t) => !ids.has(t[0]));
  if (late.length && results.length < 8) {
    const more = await store.getIds("it", late.map((t) => t[0]));
    for (const [word, how] of late) {
      const found = (more.get(word) ?? []).filter((id) => !seen.has(id));
      found.forEach((id) => seen.add(id));
      for (const e of found.length ? await store.getEntries("it", found) : []) {
        results.push({ term: e.w, reading: "", furigana: "", pitch: [], senses: e.g.map((/** @type {string} */ g) => ({ pos: [e.pos], glosses: [g] })), note: how });
      }
    }
  }
  return results.length ? { start: span.start, end: span.end, entries: results.slice(0, 8) } : null;
}
