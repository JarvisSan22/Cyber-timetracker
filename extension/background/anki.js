// @ts-check
/** AnkiConnect client (API version 6). Runs in the service worker. */

import { FIELDS, FONT_MEDIA, noteTypeModel, cardCss, FRONT, BACK } from "../shared/card.js";

export class AnkiError extends Error {}

/**
 * Call one AnkiConnect action.
 * @param {{url: string, apiKey?: string}} anki
 * @param {string} action
 * @param {object} [params]
 * @param {number} [timeoutMs]
 */
export async function invoke(anki, action, params = {}, timeoutMs = 10000) {
  /** @type {Record<string, unknown>} */
  const body = { action, version: 6, params };
  if (anki.apiKey) body.key = anki.apiKey;
  let res;
  try {
    res = await fetch(anki.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new AnkiError(`Anki is not reachable at ${anki.url}. Is Anki open with the AnkiConnect add-on installed?`);
  }
  if (res.status === 403) throw new AnkiError("Anki has not allowed Cyber Miner yet. Press Connect in Options and allow it in the Anki dialog.");
  if (res.status === 401) throw new AnkiError("AnkiConnect rejected the API key. Check Options > Anki > API key.");
  if (!res.ok) throw new AnkiError(`AnkiConnect answered HTTP ${res.status}`);
  const reply = await res.json();
  if (reply.error) throw new AnkiError(`AnkiConnect ${action}: ${reply.error}`);
  return reply.result;
}

/**
 * Ask Anki to allow this extension's origin (Anki shows a dialog the first time), then read the basics.
 * @param {{url: string, apiKey?: string, noteType: string}} anki
 */
export async function connect(anki) {
  // Anki waits for the user to click the dialog, so give it time.
  const perm = await invoke(anki, "requestPermission", {}, 120000);
  if (perm.permission !== "granted") throw new AnkiError("Anki denied access. Allow Cyber Miner in the Anki dialog and try again.");
  // The classic endpoint says "requireApikey", newer AnkiConnect code "requireApiKey".
  if ((perm.requireApikey || perm.requireApiKey) && !anki.apiKey) throw new AnkiError("AnkiConnect needs an API key: enter it in Options > Anki.");
  const [version, decks, models] = await Promise.all([
    invoke(anki, "version"),
    invoke(anki, "deckNames"),
    invoke(anki, "modelNames"),
  ]);
  return { version, decks, noteTypeExists: models.includes(anki.noteType) };
}

/** Quick check for the popup; never asks for permission. */
export async function status(/** @type {{url: string, apiKey?: string}} */ anki) {
  try {
    return { ok: true, version: await invoke(anki, "version", {}, 1500) };
  } catch (e) {
    return { ok: false, error: /** @type {Error} */ (e).message };
  }
}

/**
 * @param {{url: string, apiKey?: string}} anki
 * @param {string[]} names
 */
export async function ensureDecks(anki, names) {
  const existing = new Set(await invoke(anki, "deckNames"));
  const created = [];
  for (const name of names) {
    if (!existing.has(name)) {
      await invoke(anki, "createDeck", { deck: name });
      created.push(name);
    }
  }
  return created;
}

/**
 * Create the note type, or add fields an older version of it lacks.
 * @param {{url: string, apiKey?: string, noteType: string}} anki
 * @param {import("../shared/theme.js").Theme} theme
 * @returns {Promise<"created" | "updated" | "ok">}
 */
export async function ensureNoteType(anki, theme) {
  const models = await invoke(anki, "modelNames");
  if (!models.includes(anki.noteType)) {
    await invoke(anki, "createModel", noteTypeModel(anki.noteType, theme));
    return "created";
  }
  const have = new Set(await invoke(anki, "modelFieldNames", { modelName: anki.noteType }));
  const missing = FIELDS.filter((f) => !have.has(f));
  for (const fieldName of missing) {
    await invoke(anki, "modelFieldAdd", { modelName: anki.noteType, fieldName, index: FIELDS.indexOf(fieldName) });
  }
  return missing.length ? "updated" : "ok";
}

/**
 * Rewrite the card CSS and templates (theme change or a newer extension version).
 * @param {{url: string, apiKey?: string, noteType: string}} anki
 * @param {import("../shared/theme.js").Theme} theme
 */
export async function pushTheme(anki, theme) {
  await invoke(anki, "updateModelStyling", { model: { name: anki.noteType, css: cardCss(theme) } });
  await invoke(anki, "updateModelTemplates", {
    model: { name: anki.noteType, templates: { Recognition: { Front: FRONT, Back: BACK } } },
  });
}

/**
 * Copy the card fonts into Anki's media folder.
 * @param {{url: string, apiKey?: string}} anki
 * @param {(path: string) => Promise<ArrayBuffer>} readFile
 */
export async function storeFonts(anki, readFile) {
  for (const font of FONT_MEDIA) {
    await invoke(anki, "storeMediaFile", { filename: font.file, data: toBase64(await readFile(font.src)) });
  }
}

/**
 * @param {{url: string, apiKey?: string}} anki
 * @param {object} note from buildNote()
 * @returns {Promise<{canAdd: boolean, error?: string}>}
 */
export async function checkNote(anki, note) {
  const [result] = await invoke(anki, "canAddNotesWithErrorDetail", { notes: [note] });
  return result;
}

/**
 * @param {{url: string, apiKey?: string}} anki
 * @param {object} note from buildNote()
 * @returns {Promise<number>} note id
 */
export async function addNote(anki, note) {
  return invoke(anki, "addNote", { note });
}

/** @param {{url: string, apiKey?: string}} anki @param {number} noteId */
export async function openInBrowser(anki, noteId) {
  return invoke(anki, "guiBrowse", { query: `nid:${noteId}` });
}

/** @param {ArrayBuffer} buffer */
export function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
