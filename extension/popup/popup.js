// @ts-check
import { ask, MSG } from "../shared/messages.js";
import { loadSettings, saveSettings } from "../shared/settings.js";
import { applyTheme } from "../shared/theme.js";
import { BRAND_SVG } from "../shared/brand.js";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

/**
 * @param {string} name
 * @param {{ok: boolean, version?: number, error?: string}} status
 * @param {string} okText
 */
function show(name, status, okText) {
  $(`${name}-led`).className = `led ${status.ok ? "ok" : "bad"}`;
  $(`${name}-detail`).textContent = status.ok ? okText : status.error ?? "Not connected";
}

$("brand-mark").innerHTML = BRAND_SVG;
$("open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());
// Window id fetched up front: sidePanel.open() must run straight from the click (user gesture), no await first.
let windowId = -1;
chrome.windows.getCurrent().then((w) => (windowId = w.id ?? -1));
$("open-sidebar").addEventListener("click", () => {
  chrome.sidePanel.open({ windowId }).then(() => window.close(), () => {});
});

ask(MSG.THEME_REFRESH).then((theme) => applyTheme(document.documentElement, theme)).catch(() => {});
function refresh() {
  return ask(MSG.STATUS).then((st) => {
    show("anki", st.anki, `Connected · AnkiConnect v${st.anki.version}`);
    show("tracker", st.tracker, "Connected");
    $("today").textContent = String(st.today);
    $("pending").hidden = !st.pending;
    $("pending-count").textContent = `${st.pending} card${st.pending === 1 ? "" : "s"}`;
  });
}

$("retry").addEventListener("click", async () => {
  const button = /** @type {HTMLButtonElement} */ ($("retry"));
  button.disabled = true;
  try {
    const r = await ask(MSG.PENDING_RETRY);
    $("retry-result").className = "result ok";
    $("retry-result").textContent = `Sent ${r.sent}.`;
  } catch (e) {
    $("retry-result").className = "result error";
    $("retry-result").textContent = /** @type {Error} */ (e).message;
  } finally {
    button.disabled = false;
    refresh().catch(() => {});
  }
});

refresh()
  .catch((e) => {
    show("anki", { ok: false, error: e.message }, "");
    show("tracker", { ok: false, error: e.message }, "");
  });

// --- watch session of the active tab ---

const LANG_NAMES = { ja: "Japanese", zh: "Chinese", it: "Italian" };
/** @type {number | null} */
let activeTabId = null;
let clockBase = 0; // elapsed ms at the last status, ticking locally while watching
let clockAt = 0;
let ticking = false;

function clockText(/** @type {number} */ ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

async function refreshWatch() {
  if (activeTabId === null) return;
  const st = await ask(MSG.WATCH_STATUS, { tabId: activeTabId }).catch(() => null);
  if (!st) return;
  /** @type {HTMLInputElement} */ ($("watch-ignore")).checked = st.ignored;
  const lang = /** @type {any} */ (LANG_NAMES)[st.lang] ?? st.lang ?? "";
  const waiting = st.waiting ? ` · ${st.waiting} waiting for the tracker` : "";
  const text = {
    watching: `Watching · ${lang}${st.offline ? " · offline, sent later" : ""}`,
    paused: `Paused · ${lang}`,
    unmapped: `${lang}: no tracker project set (Options)`,
    error: st.message ?? "Tracker error",
    idle: st.ignored ? "Not tracked" : "No session (starts after 10 s of a ja/zh/it video)",
  }[/** @type {string} */ (st.state)] ?? st.state;
  $("watch-detail").textContent = text + waiting;
  $("watch-led").className = `led ${st.state === "watching" ? "ok" : st.state === "error" || st.state === "unmapped" ? "bad" : ""}`;
  clockBase = st.elapsedMs ?? 0;
  clockAt = Date.now();
  ticking = st.state === "watching";
  $("watch-clock").textContent = st.elapsedMs !== undefined ? clockText(clockBase) : "";
}

setInterval(() => {
  if (ticking) $("watch-clock").textContent = clockText(clockBase + Date.now() - clockAt);
}, 1000);
setInterval(() => refreshWatch(), 10000);

$("watch-ignore").addEventListener("change", async (e) => {
  if (activeTabId === null) return;
  await ask(MSG.WATCH_IGNORE, { tabId: activeTabId, ignore: /** @type {HTMLInputElement} */ (e.target).checked }).catch(() => {});
  refreshWatch();
});

chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  activeTabId = tab?.id ?? null;
  refreshWatch();
});

// --- subtitle bar position ---

// Shown only while the bar has been moved; open video tabs follow the settings change.
loadSettings().then((settings) => {
  const button = /** @type {HTMLButtonElement} */ ($("reset-position"));
  button.hidden = !settings.overlay.position;
  button.addEventListener("click", async () => {
    const fresh = await loadSettings();
    fresh.overlay.position = null;
    await saveSettings(fresh);
    button.hidden = true;
  });
});
