// @ts-check
/** Page reader (M8) in the worker: registers the hover script on every site while it is switched on, and
 * answers its lookups (the dictionaries live in the extension's IndexedDB, out of a web page's reach). */

import { hasDictionary, lookupAt } from "../shared/dictionary/index.js";
import { bestEntry } from "../shared/known.js";
import { pickLang } from "../shared/reader.js";
import { getKnown } from "./known.js";

const SCRIPT_ID = "cyber-miner-reader";
const SCRIPT_FILE = "content/reader-main.js";
export const READER_ORIGINS = ["http://*/*", "https://*/*"];

/** Whether Chrome gave the extension access to every site (asked when the reader is switched on). */
export function hasSiteAccess() {
  return chrome.permissions.contains({ origins: READER_ORIGINS });
}

/**
 * Register the reader for every page while it is on and allowed; unregister it otherwise.
 * Tabs open before it was switched on get it through `injectInto`.
 * @param {import("../shared/settings.js").Settings} settings
 * @returns {Promise<boolean>} registered
 */
export function syncReaderScript(settings) {
  // One at a time: the popup's call and the settings change arrive together, and registering the same
  // id twice throws.
  const run = syncing.then(() => sync(settings));
  syncing = run.catch(() => false);
  return run;
}
/** @type {Promise<unknown>} */
let syncing = Promise.resolve();

/** @param {import("../shared/settings.js").Settings} settings */
async function sync(settings) {
  const want = settings.reader.enabled && (await hasSiteAccess());
  const have = (await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] })).length > 0;
  if (want && !have) {
    await chrome.scripting.registerContentScripts([
      { id: SCRIPT_ID, js: [SCRIPT_FILE], matches: READER_ORIGINS, runAt: "document_idle", persistAcrossSessions: true },
    ]);
  } else if (!want && have) {
    await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  }
  return want;
}

/**
 * Start the reader in an already-open tab (the script guards against running twice).
 * @param {number} tabId
 */
export async function injectInto(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: [SCRIPT_FILE] }).catch(() => {});
}

/** @type {Map<string, any>} */
const cache = new Map();
/** Forget cached answers (new known-words list, dictionary imported). */
export function forgetLookups() {
  cache.clear();
}

/**
 * Dictionary entry for the hovered character, with the word's status in your Anki decks.
 * @param {import("../shared/settings.js").Settings} settings
 * @param {{sentence: string, offset: number, pageLang?: string}} msg
 */
export async function readerLookup(settings, { sentence, offset, pageLang }) {
  const lang = pickLang(sentence, offset, settings.languages.targets, pageLang);
  if (!lang) return null;
  const key = `${lang}\n${offset}\n${sentence}`;
  if (cache.has(key)) return cache.get(key);
  const installed = await hasDictionary(lang);
  const result = installed ? await lookupAt(lang, sentence, offset) : null;
  /** @type {{lang: string, result: any, installed: boolean, status: string | null, interval?: number, deck?: string, mined?: boolean}} */
  const answer = { lang, result, installed, status: null };
  if (result?.entries.length && settings.known.enabled) {
    const list = await getKnown();
    if (list) {
      const surface = sentence.slice(result.start, result.end);
      const entry = bestEntry(list.words[lang], [surface, ...result.entries.map((/** @type {any} */ e) => e.term)], lang);
      if (!entry) answer.status = "unknown";
      else {
        const [status, interval, deck] = entry;
        Object.assign(answer, { status, interval, deck });
        answer.mined = Object.values(settings.anki.decks).some((d) => deck === d || deck.startsWith(`${d}::`));
      }
    }
  }
  cache.set(key, answer);
  if (cache.size > 300) cache.delete(/** @type {string} */ (cache.keys().next().value));
  return answer;
}
