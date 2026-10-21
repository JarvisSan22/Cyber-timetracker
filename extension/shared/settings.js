// @ts-check
/** Extension settings: defaults, deep merge, and chrome.storage.sync load/save. */

export const LANGUAGES = /** @type {const} */ ({
  ja: "Japanese",
  zh: "Chinese",
  it: "Italian",
});

export const DEFAULTS = {
  anki: {
    url: "http://127.0.0.1:8765",
    apiKey: "",
    noteType: "Cyber Sentence",
    decks: { ja: "Mining::Japanese", zh: "Mining::Chinese", it: "Mining::Italian" },
  },
  languages: {
    targets: ["ja", "zh", "it"],
    translation: "en",
  },
  cards: {
    padBeforeMs: 250,
    padAfterMs: 500,
    mp3Kbps: 96,
    screenshotWidth: 720,
    jpegQuality: 0.8,
  },
  tracker: {
    url: "",
    logWatchTime: true,
    countCards: true,
    // Tracker project id per mined language (0 = not set: nothing is logged for that language).
    projects: { ja: 0, zh: 0, it: 0 },
    // Tags put on watch sessions, comma separated, created in the project if missing.
    watchTags: { youtube: "Watching, YouTube", netflix: "Watching, Netflix" },
    // A watch session stops after this long paused.
    idleStopMin: 10,
  },
  theme: {
    // "tracker" follows Cyber Tracker's live theme; otherwise a preset name from shared/themes.json.
    mode: "tracker",
  },
  overlay: {
    // Where the subtitle bar was moved to: {x, y} in % of the player (shared/position.js); null = default spot.
    /** @type {{x: number, y: number} | null} */
    position: null,
    // Translation line under the subtitle: "blur" (shows on hover), "show" (always) or "hide".
    // Alt+S switches it for the current page; this is how every page starts.
    /** @type {"blur" | "show" | "hide"} */
    translation: "blur",
  },
};

/** @typedef {typeof DEFAULTS} Settings */

const STORAGE_KEY = "settings";

/**
 * Merge stored values over defaults. Unknown keys are dropped, arrays and plain values replace defaults.
 * @template T
 * @param {T} defaults
 * @param {any} stored
 * @returns {T}
 */
export function mergeDefaults(defaults, stored) {
  if (!isPlainObject(defaults)) {
    if (stored === undefined || stored === null) return defaults;
    if (Array.isArray(defaults)) return /** @type {T} */ (Array.isArray(stored) ? [...stored] : [...defaults]);
    return typeof stored === typeof defaults ? stored : defaults;
  }
  const out = /** @type {any} */ ({});
  for (const [key, value] of Object.entries(/** @type {object} */ (defaults))) {
    out[key] = mergeDefaults(value, isPlainObject(stored) ? stored[key] : undefined);
  }
  return out;
}

/** @param {unknown} value */
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @returns {Promise<Settings>} */
export async function loadSettings() {
  const stored = await chrome.storage.sync.get(STORAGE_KEY);
  return mergeDefaults(DEFAULTS, stored[STORAGE_KEY]);
}

/** @param {Settings} settings */
export async function saveSettings(settings) {
  await chrome.storage.sync.set({ [STORAGE_KEY]: mergeDefaults(DEFAULTS, settings) });
}

/**
 * Read a dotted path ("anki.decks.ja").
 * @param {any} obj
 * @param {string} path
 */
export function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/**
 * Write a dotted path in place.
 * @param {any} obj
 * @param {string} path
 * @param {unknown} value
 */
export function setPath(obj, path, value) {
  const keys = path.split(".");
  const last = /** @type {string} */ (keys.pop());
  const parent = keys.reduce((o, k) => (o[k] ??= {}), obj);
  parent[last] = value;
}

/**
 * Origin pattern for chrome.permissions ("http://192.168.0.50:8686/*"), or null for a bad URL.
 * @param {string} url
 */
export function originPattern(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return `${u.protocol}//${u.host}/*`;
  } catch {
    return null;
  }
}

/**
 * URL without trailing slash, so `${base}/api/...` is always right.
 * @param {string} url
 */
export function baseUrl(url) {
  return url.trim().replace(/\/+$/, "");
}
