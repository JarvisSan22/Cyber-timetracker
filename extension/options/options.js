// @ts-check
import { ask, MSG } from "../shared/messages.js";
import { bindForm, fillForm } from "../shared/bind.js";
import { loadSettings, saveSettings, originPattern, DEFAULTS } from "../shared/settings.js";
import { applyTheme, loadPresets } from "../shared/theme.js";
import { BRAND_SVG } from "../shared/brand.js";
import { importLanguage, installed, removeLanguage } from "../shared/dictionary/db.js";
import { WORD_STYLES } from "../shared/known.js";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

const settings = await loadSettings();
const presets = await loadPresets();

$("brand-mark").innerHTML = BRAND_SVG;
$("ext-id").textContent = chrome.runtime.id;

const modeSelect = /** @type {HTMLSelectElement} */ ($("theme-mode"));
for (const [name, preset] of Object.entries(presets.themes)) modeSelect.add(new Option(preset.label, name));

// Word colour choices (Known words), filled before the form is bound so the saved choice shows.
for (const select of /** @type {NodeListOf<HTMLSelectElement>} */ (document.querySelectorAll("select[data-word-styles]"))) {
  for (const [key, style] of Object.entries(WORD_STYLES)) select.add(new Option(style.label, key));
}

let savedTimer = 0;
bindForm(document, settings, async (path) => {
  await saveSettings(settings);
  $("saved").hidden = false;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => ($("saved").hidden = true), 1200);
  if (path === "theme.mode" || path === "tracker.url") refreshTheme();
});

function refreshTheme() {
  ask(MSG.THEME_REFRESH).then((theme) => applyTheme(document.documentElement, theme)).catch(() => {});
}
refreshTheme();

/**
 * @param {string} id result element
 * @param {"ok" | "error" | "busy"} kind
 * @param {string} text
 */
function result(id, kind, text) {
  const el = $(id);
  el.className = `result ${kind}`;
  el.textContent = text;
}

/**
 * Ask Chrome for access to a URL the user typed. Must run straight from the click (user gesture).
 * @param {string} url
 */
async function allowOrigin(url) {
  const origin = originPattern(url);
  if (!origin) throw new Error(`Not a valid http(s) URL: ${url || "(empty)"}`);
  // No permissions.contains() first: any await before request() can lose the click's user gesture.
  // request() returns true at once, without a prompt, when access is already granted.
  if (!(await chrome.permissions.request({ origins: [origin] }))) throw new Error(`Chrome permission for ${origin} was not granted.`);
}

/**
 * Wire a button: disable while running, show the result.
 * @param {string} buttonId
 * @param {string} resultId
 * @param {string} busyText
 * @param {() => Promise<string>} run
 */
function action(buttonId, resultId, busyText, run) {
  const button = /** @type {HTMLButtonElement} */ ($(buttonId));
  button.addEventListener("click", async () => {
    button.disabled = true;
    result(resultId, "busy", busyText);
    try {
      result(resultId, "ok", await run());
    } catch (e) {
      result(resultId, "error", /** @type {Error} */ (e).message);
    } finally {
      button.disabled = false;
    }
  });
}

// --- Netflix pictures: tab screenshots need <all_urls> (or a fresh activeTab grant) ---

const ALL_SITES = { origins: ["<all_urls>"] };

async function showScreenshotAccess() {
  const granted = await chrome.permissions.contains(ALL_SITES);
  result("screenshot-result", granted ? "ok" : "", granted ? "Allowed: Netflix cards get a picture." : "Not allowed: Netflix pictures only right after Alt+M or the toolbar icon.");
}
showScreenshotAccess();

// request() straight from the click, with no await before it (user gesture).
action("screenshot-allow", "screenshot-result", "Waiting for Chrome…", async () => {
  if (!(await chrome.permissions.request(ALL_SITES))) throw new Error("Not granted.");
  return "Allowed: Netflix cards get a picture.";
});
action("screenshot-remove", "screenshot-result", "Removing…", async () => {
  await chrome.permissions.remove(ALL_SITES);
  return "Removed: Netflix pictures only right after Alt+M or the toolbar icon.";
});

/** AnkiConnect on a non-default address needs its own host permission. */
async function allowAnki() {
  if (settings.anki.url !== DEFAULTS.anki.url && !settings.anki.url.startsWith("http://localhost:8765")) await allowOrigin(settings.anki.url);
}

action("anki-connect", "anki-result", "Waiting for Anki… (allow Cyber Miner in the Anki dialog if it appears)", async () => {
  await allowAnki();
  const r = await ask(MSG.ANKI_CONNECT);
  const missing = settings.languages.targets
    .map((lang) => settings.anki.decks[/** @type {"ja" | "zh" | "it"} */ (lang)])
    .filter((deck) => !r.decks.includes(deck));
  return [
    `Connected to AnkiConnect v${r.version}.`,
    r.noteTypeExists ? `Note type "${settings.anki.noteType}" found.` : `Note type "${settings.anki.noteType}" missing.`,
    missing.length ? `Decks missing: ${missing.join(", ")}.` : "All decks found.",
    !r.noteTypeExists || missing.length ? 'Press "Set up decks + note type".' : "",
  ]
    .filter(Boolean)
    .join("\n");
});

action("anki-setup", "anki-result", "Setting up Anki…", async () => {
  await allowAnki();
  const r = await ask(MSG.ANKI_SETUP);
  const noteType = { created: "created", updated: "updated with missing fields", ok: "already there" }[/** @type {"created" | "updated" | "ok"} */ (r.noteType)];
  return [
    r.createdDecks.length ? `Created decks: ${r.createdDecks.join(", ")}.` : "Decks already there.",
    `Note type "${settings.anki.noteType}" ${noteType}.`,
    `Card style: ${r.theme}. Fonts copied to Anki's media folder.`,
  ].join("\n");
});

action("anki-theme", "anki-result", "Pushing theme…", async () => {
  await allowAnki();
  const r = await ask(MSG.ANKI_PUSH_THEME);
  return `Cards now use "${r.theme}". Reopen the card preview in Anki to see it.`;
});

action("anki-test", "anki-result", "Sending test note…", async () => {
  await allowAnki();
  const r = await ask(MSG.ANKI_TEST_NOTE);
  return `Test note ${r.noteId} added to ${r.deck} and opened in Anki's browser.`;
});

action("tracker-test", "tracker-result", "Contacting Cyber Tracker…", async () => {
  await allowOrigin(settings.tracker.url);
  const r = await ask(MSG.TRACKER_TEST);
  refreshTheme();
  if (r.theme) return `Connected. Tracker theme: ${r.theme.label}.`;
  return `Connected, but this tracker is older than Cyber Miner (${r.themeError}).\nUpdate it (git pull + docker compose up -d --build) for the theme and card counts.`;
});

// --- Dictionaries ---

const DICT_LANGS = { ja: "Japanese", zh: "Chinese", it: "Italian" };

/** Built files listed by scripts/fetch-dicts.py in dicts/manifest.json ({} when not built yet). */
async function builtDicts() {
  try {
    const res = await fetch(chrome.runtime.getURL("dicts/manifest.json"));
    return res.ok ? await res.json() : {};
  } catch {
    return {};
  }
}

async function renderDicts() {
  const [built, have] = await Promise.all([builtDicts(), installed().catch(() => ({}))]);
  const list = $("dict-list");
  list.replaceChildren();
  for (const [lang, name] of Object.entries(DICT_LANGS)) {
    const file = built[lang];
    const inDb = have[lang];
    const row = document.createElement("article");
    row.className = "dict-row";
    const title = Object.assign(document.createElement("div"), { className: "dict-name" });
    title.append(Object.assign(document.createElement("b"), { textContent: name }), ` ${file?.name ? `· ${file.name}` : ""}`);
    const status = Object.assign(document.createElement("div"), { className: "dict-status" });
    status.textContent = inDb
      ? `Imported ${new Date(inDb.importedAt).toLocaleDateString()} · ${inDb.version} · ${inDb.rows.toLocaleString()} rows${file && file.version !== inDb.version ? " · newer file available" : ""}`
      : file
        ? `Not imported · file ready (${(file.bytes / 1e6).toFixed(1)} MB, ${file.version})`
        : `Not built · run python3 scripts/fetch-dicts.py ${lang}`;
    const progress = Object.assign(document.createElement("progress"), { max: 1, value: 0, hidden: true });
    const importBtn = Object.assign(document.createElement("button"), { type: "button", textContent: inDb ? "Re-import" : "Import", disabled: !file });
    const removeBtn = Object.assign(document.createElement("button"), { type: "button", className: "secondary", textContent: "Remove", disabled: !inDb });
    importBtn.addEventListener("click", async () => {
      importBtn.disabled = removeBtn.disabled = true;
      progress.hidden = false;
      status.textContent = "Importing…";
      try {
        const r = await importLanguage(lang, (done, total) => {
          progress.value = done / total;
          status.textContent = `Importing… ${Math.round((100 * done) / total)}%`;
        });
        status.textContent = `Imported ${r.rows.toLocaleString()} rows.`;
        await chrome.storage.local.set({ dictsChanged: Date.now() }); // tells an open side panel
      } catch (e) {
        status.textContent = /** @type {Error} */ (e).message;
      }
      renderDicts();
    });
    removeBtn.addEventListener("click", async () => {
      await removeLanguage(lang);
      await chrome.storage.local.set({ dictsChanged: Date.now() });
      renderDicts();
    });
    const actions = Object.assign(document.createElement("div"), { className: "dict-actions" });
    actions.append(importBtn, removeBtn);
    row.append(title, status, progress, actions);
    list.append(row);
  }
  $("dict-credits").textContent = Object.values(built)
    .map((/** @type {any} */ d) => `${d.attribution} (${d.license})`)
    .join(" · ");
}
renderDicts();

// --- Tracker projects per language ---

const PROJECT_NAMES = { ja: "Japanese", zh: "Chinese", it: "Italian" };
/** Project names that mean the language, for picking an existing project automatically. */
const PROJECT_ALIASES = {
  ja: ["japanese", "日本語", "nihongo", "にほんご"],
  zh: ["chinese", "中文", "中国語", "汉语", "漢語", "mandarin", "普通话"],
  it: ["italian", "italiano", "イタリア語"],
};

async function loadProjects() {
  if (!settings.tracker.url) return;
  /** @type {{id: number, name: string, archived: boolean}[]} */
  let projects;
  try {
    projects = await ask(MSG.TRACKER_PROJECTS);
  } catch {
    return; // not reachable yet: the hint stays
  }
  const rows = $("project-rows");
  rows.replaceChildren();
  // A language with no project yet gets the project named after it (Japanese, 日本語, …).
  const matched = [];
  for (const [lang, aliases] of Object.entries(PROJECT_ALIASES)) {
    const projectsByLang = /** @type {any} */ (settings.tracker.projects);
    if (projectsByLang[lang]) continue;
    const match = projects.find((p) => !p.archived && aliases.includes(p.name.trim().toLowerCase()));
    if (match) {
      projectsByLang[lang] = match.id;
      matched.push(`${/** @type {any} */ (PROJECT_NAMES)[lang]} → ${match.name}`);
    }
  }
  if (matched.length) {
    await saveSettings(settings);
    result("project-result", "ok", `Picked existing projects: ${matched.join(", ")}.`);
  }
  for (const [lang, name] of Object.entries(PROJECT_NAMES)) {
    const row = Object.assign(document.createElement("div"), { className: "project-row" });
    const label = Object.assign(document.createElement("span"), { className: "project-lang", textContent: name });
    const select = document.createElement("select");
    select.dataset.field = `tracker.projects.${lang}`;
    select.add(new Option("— not logged —", "0"));
    for (const p of projects.filter((p) => !p.archived)) select.add(new Option(p.name, String(p.id)));
    row.append(label, select);
    if (!projects.some((p) => /** @type {any} */ (PROJECT_ALIASES)[lang].includes(p.name.trim().toLowerCase()))) {
      const create = Object.assign(document.createElement("button"), { type: "button", className: "secondary", textContent: `Create "${name}"` });
      create.addEventListener("click", async () => {
        create.disabled = true;
        try {
          const project = await ask(MSG.TRACKER_CREATE_PROJECT, { name });
          /** @type {any} */ (settings.tracker.projects)[lang] = project.id;
          await saveSettings(settings);
          result("project-result", "ok", `Created "${name}" with the language starter tags.`);
          loadProjects();
        } catch (e) {
          result("project-result", "error", /** @type {Error} */ (e).message);
          create.disabled = false;
        }
      });
      row.append(create);
    }
    rows.append(row);
  }
  fillForm(rows, settings);
}
loadProjects();

// --- known words: extra Anki decks and the field holding the word ---

/** @type {string[] | null} null: Anki not reachable */
let ankiDecks = null;
/** @type {Map<string, Promise<string[]>>} */
const fieldsByDeck = new Map();
const LANG_NAMES = { ja: "Japanese", zh: "Chinese", it: "Italian" };

/** @param {string} deck */
function fieldsOf(deck) {
  if (!fieldsByDeck.has(deck)) fieldsByDeck.set(deck, ask(MSG.KNOWN_FIELDS, { deck }).catch(() => []));
  return /** @type {Promise<string[]>} */ (fieldsByDeck.get(deck));
}

/**
 * @param {HTMLSelectElement} select
 * @param {string[]} values
 * @param {string} current kept as an option even when not in `values` (Anki closed)
 * @param {string} empty
 */
function fillSelect(select, values, current, empty) {
  select.replaceChildren(new Option(empty, ""));
  for (const v of new Set([...(current ? [current] : []), ...values])) select.add(new Option(v, v));
  select.value = current;
}

async function saveKnown() {
  await saveSettings(settings);
  $("saved").hidden = false;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => ($("saved").hidden = true), 1200);
}

function renderKnownRows() {
  const rows = $("known-rows");
  rows.replaceChildren();
  if (!settings.known.sources.length) rows.append(Object.assign(document.createElement("p"), { className: "muted", textContent: "Only the Cyber Miner decks so far." }));
  settings.known.sources.forEach((source, i) => {
    const row = Object.assign(document.createElement("div"), { className: "project-row" });
    const deck = document.createElement("select");
    const field = document.createElement("select");
    const lang = document.createElement("select");
    const remove = Object.assign(document.createElement("button"), { type: "button", className: "secondary", textContent: "✕", title: "Remove" });
    fillSelect(deck, ankiDecks ?? [], source.deck, "— deck —");
    fillSelect(field, [], source.field, "— field —");
    for (const [code, name] of Object.entries(LANG_NAMES)) lang.add(new Option(name, code));
    lang.value = source.lang;
    const loadFields = async () => fillSelect(field, source.deck ? await fieldsOf(source.deck) : [], source.field, "— field —");
    loadFields();
    deck.addEventListener("change", async () => {
      source.deck = deck.value;
      source.field = "";
      await loadFields();
      saveKnown();
    });
    field.addEventListener("change", () => {
      source.field = field.value;
      saveKnown();
    });
    lang.addEventListener("change", () => {
      source.lang = lang.value;
      saveKnown();
    });
    remove.addEventListener("click", () => {
      settings.known.sources.splice(i, 1);
      saveKnown();
      renderKnownRows();
    });
    row.append(deck, field, lang, remove);
    rows.append(row);
  });
}

$("known-add").addEventListener("click", () => {
  settings.known.sources.push({ deck: "", field: "", lang: settings.languages.targets[0] ?? "ja" });
  saveKnown();
  renderKnownRows();
});

/** @param {{cards: number, words: Record<string, number | object>, builtAt: string}} list */
function knownSummary(list) {
  const counts = Object.entries(list.words)
    .map(([lang, w]) => `${/** @type {any} */ (LANG_NAMES)[lang] ?? lang} ${(typeof w === "number" ? w : Object.keys(w).length).toLocaleString()}`)
    .join(" · ");
  return `${list.cards.toLocaleString()} cards read · words: ${counts || "none"} · ${new Date(list.builtAt).toLocaleString()}`;
}

action("known-refresh", "known-result", "Reading your decks from Anki…", async () => knownSummary(await ask(MSG.KNOWN_REFRESH)));

(async () => {
  ankiDecks = await ask(MSG.KNOWN_DECKS).catch(() => null);
  renderKnownRows();
  const { knownWords } = await chrome.storage.local.get("knownWords");
  if (knownWords) result("known-result", "ok", `Last read: ${knownSummary(knownWords)}`);
  else if (!ankiDecks) result("known-result", "error", "Open Anki to pick decks and read your words.");
})();

