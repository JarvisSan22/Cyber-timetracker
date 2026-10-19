// @ts-check
import { ask, MSG } from "../shared/messages.js";
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
