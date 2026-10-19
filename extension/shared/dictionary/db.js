// @ts-check
/** IndexedDB dictionary store: import from extension/dicts/<lang>.jsonl.gz, and the DictStore used for lookups. */

const DB_NAME = "cyber-miner-dict";
const STORES = {
  entries: ["lang", "id"],
  keys: ["lang", "k"],
  forms: ["lang", "f"],
  pitch: ["w", "r"],
  meta: "lang",
};

/** @type {Promise<IDBDatabase> | null} */
let opening = null;

/** @returns {Promise<IDBDatabase>} */
export function openDb() {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      for (const [name, keyPath] of Object.entries(STORES)) req.result.createObjectStore(name, { keyPath });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opening;
}

/**
 * @template T
 * @param {IDBRequest<T>} req
 * @returns {Promise<T>}
 */
function done(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** @param {IDBTransaction} tx */
function finished(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

/** Everything of one language in a [lang, ...] keyed store. */
const langRange = (/** @type {string} */ lang) => IDBKeyRange.bound([lang], [lang, []]);

/** @returns {Promise<Record<string, any>>} imported dictionaries by language */
export async function installed() {
  const db = await openDb();
  const rows = await done(db.transaction("meta").objectStore("meta").getAll());
  return Object.fromEntries(rows.map((r) => [r.lang, r]));
}

/** @param {string} lang */
export async function removeLanguage(lang) {
  const db = await openDb();
  const tx = db.transaction(["entries", "keys", "forms", "pitch", "meta"], "readwrite");
  for (const name of ["entries", "keys", "forms"]) tx.objectStore(name).delete(langRange(lang));
  if (lang === "ja") tx.objectStore("pitch").clear();
  tx.objectStore("meta").delete(lang);
  await finished(tx);
}

/**
 * Import extension/dicts/<lang>.jsonl.gz (streamed: never the whole file in memory).
 * @param {string} lang
 * @param {(done: number, total: number) => void} onProgress
 */
export async function importLanguage(lang, onProgress) {
  const res = await fetch(chrome.runtime.getURL(`dicts/${lang}.jsonl.gz`));
  if (!res.ok || !res.body) throw new Error(`dicts/${lang}.jsonl.gz not found. Run: python3 scripts/fetch-dicts.py ${lang}`);
  await removeLanguage(lang);
  const db = await openDb();
  const lines = res.body.pipeThrough(new DecompressionStream("gzip")).pipeThrough(new TextDecoderStream());
  /** @type {any} */
  let header = null;
  let total = 1;
  let count = 0;
  /** @type {any[]} */
  let batch = [];

  const flush = async () => {
    const tx = db.transaction(["entries", "keys", "forms", "pitch"], "readwrite");
    const stores = { e: tx.objectStore("entries"), k: tx.objectStore("keys"), f: tx.objectStore("forms"), p: tx.objectStore("pitch") };
    for (const o of batch) {
      const { t, ...row } = o;
      /** @type {any} */ (stores)[t].put(t === "p" ? row : { lang, ...row });
    }
    await finished(tx);
    count += batch.length;
    batch = [];
    onProgress(count, total);
  };

  let rest = "";
  const reader = lines.getReader();
  for (;;) {
    const { value, done: end } = await reader.read();
    const text = rest + (value ?? "");
    const parts = text.split("\n");
    rest = end ? "" : /** @type {string} */ (parts.pop());
    for (const line of parts) {
      if (!line) continue;
      const o = JSON.parse(line);
      if (o.t === "h") {
        header = o;
        total = Object.values(o.counts ?? {}).reduce((a, b) => a + Number(b), 0) || 1;
        if (o.lang !== lang) throw new Error(`dicts/${lang}.jsonl.gz holds "${o.lang}"`);
        continue;
      }
      batch.push(o);
      if (batch.length >= 5000) await flush();
    }
    if (end) break;
  }
  if (batch.length) await flush();
  if (!header) throw new Error(`dicts/${lang}.jsonl.gz has no header line`);
  const { t, ...meta } = header;
  const tx = db.transaction("meta", "readwrite");
  tx.objectStore("meta").put({ ...meta, lang, rows: count, importedAt: new Date().toISOString() });
  await finished(tx);
  return { rows: count, name: header.name, version: header.version };
}

/** @type {import("./ja.js").DictStore} */
export const idbStore = {
  async getIds(lang, list) {
    const db = await openDb();
    const store = db.transaction("keys").objectStore("keys");
    const rows = await Promise.all(list.map((k) => done(store.get([lang, k]))));
    return new Map(rows.filter(Boolean).map((r) => [r.k, r.i]));
  },
  async getEntries(lang, ids) {
    const db = await openDb();
    const store = db.transaction("entries").objectStore("entries");
    return (await Promise.all(ids.map((id) => done(store.get([lang, id]))))).filter(Boolean);
  },
  async getForms(lang, list) {
    const db = await openDb();
    const store = db.transaction("forms").objectStore("forms");
    const rows = await Promise.all(list.map((f) => done(store.get([lang, f]))));
    return new Map(rows.filter(Boolean).map((r) => [r.f, r.l]));
  },
  async getPitch(term, reading) {
    const db = await openDb();
    const row = await done(db.transaction("pitch").objectStore("pitch").get([term, reading]));
    return row?.p ?? [];
  },
};
