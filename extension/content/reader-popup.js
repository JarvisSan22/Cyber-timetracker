// @ts-check
/** Page reader popup (M8): dictionary entries for the hovered word, its Anki status and "Make card". Lives in
 * a Shadow DOM root on the page so the page's CSS cannot reach it; styles in styles/reader.css. */

const MAX_ENTRIES = 4;
const MAX_SENSES = 5;
/** Page events stopped at the popup, so a site's own handlers (shortcuts, click tracking) never see them. */
const SHIELDED_EVENTS = ["click", "dblclick", "mousedown", "mouseup", "pointerdown", "pointerup", "keydown", "keyup", "keypress", "wheel", "contextmenu"];
const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * @param {string} tag
 * @param {Record<string, any>} [props]
 * @param {...(Node | string | null | undefined | false)} children
 */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key === "class") el.className = value;
    else if (key in el) /** @type {any} */ (el)[key] = value;
    else el.setAttribute(key, value);
  }
  for (const child of children) if (child) el.append(child);
  return el;
}

function brandSvg() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 512 512");
  const hex = document.createElementNS(SVG_NS, "polygon");
  hex.setAttribute("points", "256,86 403.2,171 403.2,341 256,426 108.8,341 108.8,171");
  const ring = document.createElementNS(SVG_NS, "circle");
  for (const [k, v] of Object.entries({ cx: 256, cy: 256, r: 80 })) ring.setAttribute(k, String(v));
  for (const el of [hex, ring]) {
    el.setAttribute("fill", "none");
    el.setAttribute("stroke", "currentColor");
    el.setAttribute("stroke-width", "44");
  }
  svg.append(hex, ring);
  return svg;
}

/**
 * The status line under the word, like the side panel's badge.
 * @param {{status: string | null, interval?: number, deck?: string, mined?: boolean}} answer
 * @returns {HTMLElement | null}
 */
function badge(answer) {
  if (!answer.status) return null;
  if (answer.status === "unknown") return h("div", { class: "badge unknown" }, "New word · not in your Anki decks");
  const days = answer.interval ?? 0;
  const where = { known: `Known · ${days} d`, learning: `Learning · ${days} d`, new: "In Anki, not studied yet" }[answer.status] ?? answer.status;
  return answer.mined
    ? h("div", { class: "badge mined" }, `Already mined · ${where}`)
    : h("div", { class: `badge ${answer.status}` }, `${where} · ${answer.deck ?? ""}`);
}

/** @param {import("../shared/dictionary/index.js").Entry} entry */
function entryView(entry) {
  const head = h(
    "div",
    { class: "head" },
    h("span", { class: "term" }, entry.term),
    entry.reading && entry.reading !== entry.term ? h("span", { class: "reading" }, entry.reading) : null,
    entry.pitch.length ? h("span", { class: "pitch" }, entry.pitch.map((p) => `[${p}]`).join(" ")) : null,
  );
  const list = h("ol");
  for (const sense of entry.senses.slice(0, MAX_SENSES)) {
    list.append(h("li", {}, sense.pos.length ? h("span", { class: "pos" }, sense.pos.join(", ")) : null, sense.glosses.join("; ")));
  }
  return h("div", { class: "entry" }, head, entry.note ? h("p", { class: "note" }, entry.note) : null, list);
}

/**
 * @param {{onMakeCard: () => void, onClose: () => void}} handlers
 * @param {CSSStyleSheet[]} sheets
 */
export function createReaderPopup(handlers, sheets) {
  const host = h("div", { id: "cyber-miner-reader" });
  host.hidden = true;
  const root = host.attachShadow({ mode: "open" });
  root.adoptedStyleSheets = sheets;
  for (const type of SHIELDED_EVENTS) root.addEventListener(type, (e) => e.stopPropagation());

  const body = h("div", { class: "body" });
  const surface = h("span", { class: "surface" });
  const lang = h("span", { class: "lang" });
  const make = h("button", { class: "make", type: "button", title: "Open the card side panel with this sentence and word", onclick: () => handlers.onMakeCard() }, brandSvg(), "Make card");
  const close = h("button", { class: "close", type: "button", title: "Close (Esc)", onclick: () => handlers.onClose() }, "✕");
  const top = h("div", { class: "top" }, h("span", { class: "brand" }, brandSvg()), lang, surface, close);
  const foot = h("div", { class: "foot" }, make);
  const panel = h("div", { class: "panel", "data-augmented-ui": "tl-clip br-clip border" }, top, body, foot);
  root.append(panel);

  /**
   * Put the popup under the word, or above it when there is no room below; inside the window.
   * @param {DOMRect | null} rect
   */
  function place(rect) {
    host.hidden = false;
    if (!rect) return; // a message about the last spot: stay there
    const gap = 6;
    const w = panel.offsetWidth;
    const hgt = panel.offsetHeight;
    const left = Math.max(8, Math.min(rect.left, innerWidth - w - 8));
    const below = rect.bottom + gap;
    const top = below + hgt <= innerHeight - 8 || rect.top - gap - hgt < 8 ? below : rect.top - gap - hgt;
    host.style.setProperty("--x", `${left}px`);
    host.style.setProperty("--y", `${Math.max(8, Math.min(top, innerHeight - hgt - 8))}px`);
  }

  return {
    host,
    get visible() {
      return !host.hidden;
    },

    /**
     * @param {{lang: string, result: import("../shared/dictionary/index.js").LookupResult, status: string | null, interval?: number, deck?: string, mined?: boolean}} answer
     * @param {string} text the matched text on the page
     * @param {DOMRect} rect where it is
     */
    show(answer, text, rect) {
      lang.textContent = answer.lang.toUpperCase();
      surface.textContent = text;
      surface.lang = answer.lang;
      body.lang = answer.lang;
      body.replaceChildren(badge(answer) ?? "", ...answer.result.entries.slice(0, MAX_ENTRIES).map(entryView));
      body.scrollTop = 0;
      foot.hidden = false;
      panel.classList.remove("message", "error");
      place(rect);
    },

    /**
     * A one-line note in the popup (no dictionary, side panel would not open).
     * @param {string} text
     * @param {DOMRect | null} rect null: keep the popup where it is
     * @param {boolean} [error]
     */
    showMessage(text, rect, error = false) {
      lang.textContent = "";
      surface.textContent = "";
      body.replaceChildren(h("p", { class: "empty" }, text));
      foot.hidden = true;
      panel.classList.add("message");
      panel.classList.toggle("error", error);
      place(rect);
    },

    hide() {
      host.hidden = true;
    },

    /** The point is on the popup. @param {number} x @param {number} y */
    contains(x, y) {
      if (host.hidden) return false;
      const r = panel.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    },

    /** Theme tokens (same names as the tracker) on the host. @param {Record<string, string>} vars */
    setTheme(vars) {
      for (const [key, value] of Object.entries(vars)) host.style.setProperty(`--${key}`, value);
    },
  };
}
