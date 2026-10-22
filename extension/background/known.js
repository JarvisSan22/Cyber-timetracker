// @ts-check
/** Known words: built from the Anki decks and fields chosen in Options (the Cyber Miner decks' Word
 * field always counts), kept in storage.local, refreshed hourly and after each mined card. Marks the
 * words of subtitle lines for the bar, using the dictionaries in this extension's IndexedDB. */

import { invoke } from "./anki.js";
import { cardStatus, fieldWords, markWords, mergeWord, normalizeWord } from "../shared/known.js";
import { lookupAt } from "../shared/dictionary/index.js";

const KEY = "knownWords";
const STALE_MS = 60 * 60_000;

/** @typedef {import("../shared/known.js").KnownList} KnownList */

/** @type {KnownList | null} */
let cache = null;
/** A rebuild in progress: later callers wait for it instead of starting another. */
/** @type {Promise<KnownList> | null} */
let building = null;
/** sentence marks per language and sentence; cleared when the list changes */
/** @type {Map<string, Promise<import("../shared/known.js").WordMark[]>>} */
const marksCache = new Map();

/**
 * Where words come from: the Cyber Miner decks (Word field) plus the sources added in Options.
 * @param {import("../shared/settings.js").Settings} settings
 * @returns {{deck: string, field: string, lang: string}[]}
 */
export function knownSources(settings) {
  const own = settings.languages.targets.map((lang) => ({ deck: /** @type {any} */ (settings.anki.decks)[lang], field: "Word", lang }));
  return [...own, ...settings.known.sources].filter((s) => s.deck && s.field && s.lang);
}

/** @returns {Promise<KnownList | null>} */
export async function getKnown() {
  cache ??= (await chrome.storage.local.get(KEY))[KEY] ?? null;
  return cache;
}

/** @param {KnownList} list */
async function save(list) {
  cache = list;
  marksCache.clear();
  await chrome.storage.local.set({ [KEY]: list });
}

/**
 * Read every card of the sources from Anki (cardsInfo in batches) and rebuild the list.
 * @param {import("../shared/settings.js").Settings} settings
 */
export function buildKnown(settings) {
  building ??= readFromAnki(settings).finally(() => (building = null));
  return building;
}

/** @param {import("../shared/settings.js").Settings} settings @returns {Promise<KnownList>} */
async function readFromAnki(settings) {
  /** @type {Record<string, Record<string, import("../shared/known.js").KnownEntry>>} */
  const words = {};
  let cards = 0;
  for (const src of knownSources(settings)) {
    const ids = /** @type {number[]} */ (await invoke(settings.anki, "findCards", { query: `deck:"${src.deck.replace(/"/g, '\\"')}"` }));
    for (let i = 0; i < ids.length; i += 500) {
      const infos = /** @type {any[]} */ (await invoke(settings.anki, "cardsInfo", { cards: ids.slice(i, i + 500) }, 60000));
      for (const card of infos) {
        const value = card.fields?.[src.field]?.value;
        if (!value) continue;
        cards++;
        /** @type {import("../shared/known.js").KnownEntry} */
        const entry = [cardStatus(card, settings.known.matureDays), Math.max(0, card.interval), card.deckName];
        for (const word of fieldWords(value, src.lang)) mergeWord((words[src.lang] ??= {}), word, entry);
      }
    }
  }
  const list = { builtAt: new Date().toISOString(), cards, words };
  await save(list);
  return list;
}

/**
 * Rebuild when older than an hour (alarm, browser start). Quiet when Anki is closed.
 * @param {import("../shared/settings.js").Settings} settings
 */
export async function refreshIfStale(settings) {
  if (!settings.known.enabled) return;
  const list = await getKnown();
  if (list && Date.now() - Date.parse(list.builtAt) < STALE_MS) return;
  await buildKnown(settings).catch(() => {});
}

/**
 * A card just went to Anki: its word counts as "new" at once, without waiting for the next rebuild.
 * @param {{lang: string, word?: string}} draft
 * @param {string} deck
 */
export async function addMined(draft, deck) {
  const list = await getKnown();
  const word = normalizeWord(draft.word ?? "", draft.lang);
  if (!list || !word) return;
  mergeWord((list.words[draft.lang] ??= {}), word, ["new", 0, deck]);
  await save(list);
}

/**
 * The words of a sentence with their status, for the subtitle bar. Null without a list or dictionary.
 * @param {string} lang
 * @param {string} sentence
 */
export async function marksFor(lang, sentence) {
  const list = await getKnown();
  if (!list) return null;
  const key = `${lang}\n${sentence}`;
  let marks = marksCache.get(key);
  if (!marks) {
    marks = markWords(sentence, lang, (s, i) => lookupAt(lang, s, i), list.words[lang]);
    marksCache.set(key, marks);
    if (marksCache.size > 500) marksCache.delete(/** @type {string} */ (marksCache.keys().next().value));
  }
  return marks;
}

/**
 * Field names used by the notes of a deck (for the source picker in Options).
 * @param {import("../shared/settings.js").Settings} settings
 * @param {string} deck
 */
export async function deckFields(settings, deck) {
  const notes = /** @type {number[]} */ (await invoke(settings.anki, "findNotes", { query: `deck:"${deck.replace(/"/g, '\\"')}"` }));
  const infos = /** @type {any[]} */ (await invoke(settings.anki, "notesInfo", { notes: notes.slice(0, 50) }));
  return [...new Set(infos.flatMap((n) => Object.keys(n.fields ?? {})))];
}
