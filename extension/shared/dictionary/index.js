// @ts-check
/** Dictionary lookup used by the side panel: picks the language module and the IndexedDB store. */

import { lookupJa } from "./ja.js";
import { lookupZh } from "./zh.js";
import { lookupIt } from "./it.js";
import { idbStore, installed } from "./db.js";

/**
 * @typedef {object} Sense
 * @property {string[]} pos   parts of speech
 * @property {string[]} glosses
 */

/**
 * @typedef {object} Entry
 * @property {string} term        dictionary form (食べる, 学习, dire)
 * @property {string} reading     kana (ja), pinyin with tone marks (zh), "" (it)
 * @property {string} furigana    Anki furigana syntax for ja (食[た]べる), else ""
 * @property {number[]} pitch     downstep positions (ja), else []
 * @property {Sense[]} senses
 * @property {string} [note]      e.g. "negative · past · potential" or "+ lo · form of parlare"
 */

/**
 * @typedef {object} LookupResult
 * @property {number} start   matched text in the sentence (string offsets)
 * @property {number} end
 * @property {Entry[]} entries
 */

const LOOKUPS = { ja: lookupJa, zh: lookupZh, it: lookupIt };

/** @type {Promise<Record<string, any>> | null} */
let installedCache = null;

/** @param {string} lang */
export async function hasDictionary(lang) {
  installedCache ??= installed().catch(() => ({}));
  return lang in (await installedCache);
}

/** Call after importing or removing a dictionary. */
export function forgetInstalled() {
  installedCache = null;
}

/**
 * Longest dictionary word starting at `offset` (exactly [offset, end) when the user dragged).
 * Null when no dictionary for the language is installed or nothing matches.
 * @param {string} lang
 * @param {string} sentence
 * @param {number} offset
 * @param {number} [end]
 * @returns {Promise<LookupResult | null>}
 */
export async function lookupAt(lang, sentence, offset, end) {
  const lookup = /** @type {any} */ (LOOKUPS)[lang];
  if (!lookup || !(await hasDictionary(lang))) return null;
  return lookup(idbStore, sentence, offset, end);
}
