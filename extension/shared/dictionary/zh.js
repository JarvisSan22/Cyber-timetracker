// @ts-check
/** Chinese lookup: longest CC-CEDICT word from the clicked character (simplified or traditional). */

const MAX_LENGTH = 10;
/** Glosses that make an entry a poor first choice. */
const MINOR = /^(old |archaic |)variant of|^surname |^see |^used in /;

/**
 * @param {import("./ja.js").DictStore} store
 * @param {string} sentence
 * @param {number} offset
 * @param {number} [end]
 * @returns {Promise<import("./index.js").LookupResult | null>}
 */
export async function lookupZh(store, sentence, offset, end) {
  const lengths = [];
  if (end !== undefined) lengths.push(end - offset);
  else for (let n = Math.min(MAX_LENGTH, sentence.length - offset); n >= 1; n--) lengths.push(n);
  const texts = lengths.map((len) => sentence.slice(offset, offset + len));
  const ids = await store.getIds("zh", texts);
  for (const text of texts) {
    const found = ids.get(text);
    if (!found?.length) continue;
    const entries = await store.getEntries("zh", found);
    const minor = (/** @type {any} */ e) => (e.g.every((/** @type {string} */ g) => MINOR.test(g)) ? 1 : 0);
    entries.sort((a, b) => minor(a) - minor(b) || a.id - b.id);
    return {
      start: offset,
      end: offset + text.length,
      entries: entries.slice(0, 8).map((e) => ({
        term: text,
        reading: e.py,
        furigana: "",
        pitch: [],
        senses: e.g.map((/** @type {string} */ g) => ({ pos: [], glosses: [g] })),
        note: e.s !== e.tr ? (text === e.s ? `traditional ${e.tr}` : `simplified ${e.s}`) : undefined,
      })),
    };
  }
  return null;
}
