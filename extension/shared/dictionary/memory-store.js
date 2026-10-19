// @ts-check
/** In-memory DictStore built from the same JSON lines as the .jsonl.gz files (used by the Node tests). */

/** @param {Record<string, object[]>} linesByLang {ja: [...], zh: [...], it: [...]} */
export function memoryStore(linesByLang) {
  const keys = new Map();
  const entries = new Map();
  const forms = new Map();
  const pitch = new Map();
  for (const [lang, lines] of Object.entries(linesByLang)) {
    for (const o of /** @type {any[]} */ (lines)) {
      if (o.t === "e") entries.set(`${lang}|${o.id}`, o);
      else if (o.t === "k") keys.set(`${lang}|${o.k}`, o.i);
      else if (o.t === "f") forms.set(`${lang}|${o.f}`, o.l);
      else if (o.t === "p") pitch.set(`${o.w}|${o.r}`, o.p);
    }
  }
  /** @type {import("./ja.js").DictStore} */
  const store = {
    async getIds(lang, list) {
      return new Map(list.filter((k) => keys.has(`${lang}|${k}`)).map((k) => [k, keys.get(`${lang}|${k}`)]));
    },
    async getEntries(lang, ids) {
      return ids.map((id) => entries.get(`${lang}|${id}`)).filter(Boolean);
    },
    async getForms(lang, list) {
      return new Map(list.filter((f) => forms.has(`${lang}|${f}`)).map((f) => [f, forms.get(`${lang}|${f}`)]));
    },
    async getPitch(term, reading) {
      return pitch.get(`${term}|${reading}`) ?? [];
    },
  };
  return store;
}
