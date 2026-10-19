// @ts-check
/** Overlay inside the video player: subtitle bar (clickable words), status chip and toast (Shadow DOM).
 * The card editor lives in Chrome's side panel (sidepanel/), so nothing here covers the video.
 * Built with h() instead of innerHTML: YouTube enforces Trusted Types. */

import { lineOffsets } from "../shared/wordpick.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * @param {string} tag
 * @param {Record<string, any>} [props]
 * @param {(Node | string | null | undefined | false)[]} children
 * @returns {any}
 */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key === "class") el.className = value;
    else if (key in el && key !== "list") /** @type {any} */ (el)[key] = value;
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

/** Stop clicks and keys inside our UI from reaching YouTube's player and shortcuts. */
const SHIELDED_EVENTS = ["click", "dblclick", "mousedown", "mouseup", "pointerdown", "pointerup", "keydown", "keyup", "keypress", "wheel", "contextmenu"];

/**
 * @typedef {object} OverlayHandlers
 * @property {() => void} onMine ⌬ button
 * @property {(pick: {start: number, end?: number}) => void} onPickWord click (start) or drag (start, end) on the line
 * @property {(noteId: number) => void} onOpenNote
 */

/**
 * @param {OverlayHandlers} handlers
 * @param {CSSStyleSheet[]} sheets
 */
export function createOverlay(handlers, sheets) {
  const host = h("div", { id: "cyber-miner-overlay" });
  const root = host.attachShadow({ mode: "open" });
  root.adoptedStyleSheets = sheets;
  for (const type of SHIELDED_EVENTS) root.addEventListener(type, (e) => e.stopPropagation());

  // --- subtitle bar ---
  const primary = h("div", { class: "primary" });
  const translation = h("div", { class: "translation blur" });
  const mineBtn = h("button", { class: "mine-btn", title: "Mine this line (Alt+M)", onclick: () => handlers.onMine() }, brandSvg());
  const bar = h("div", { class: "bar empty", "data-augmented-ui": "tl-clip br-clip border" }, h("div", { class: "lines" }, primary, translation), mineBtn);

  // --- status chip ---
  const ankiLed = h("span", { class: "led", title: "Anki" });
  const chipText = h("span", {}, "");
  const chip = h("div", { class: "chip" }, h("span", { class: "brand" }, "⌬"), ankiLed, chipText);

  const toast = h("div", { class: "toast", hidden: true });
  let toastTimer = 0;

  root.append(bar, chip, toast);

  // Click a character: mine with the word from there. Drag across characters: mine with exactly those.
  /** @type {number | null} */
  let downAt = null;
  const offsetOf = (/** @type {EventTarget | null} */ t) => {
    const span = t instanceof HTMLElement ? t.closest("span[data-i]") : null;
    return span ? Number(/** @type {HTMLElement} */ (span).dataset.i) : null;
  };
  primary.addEventListener("pointerdown", (/** @type {PointerEvent} */ e) => {
    downAt = offsetOf(e.target);
  });
  primary.addEventListener("pointerup", (/** @type {PointerEvent} */ e) => {
    const from = downAt;
    downAt = null;
    if (from === null) return;
    const to = offsetOf(root.elementFromPoint(e.clientX, e.clientY)) ?? from;
    if (to === from) handlers.onPickWord({ start: from });
    else {
      const last = Math.max(from, to);
      const lastChar = /** @type {HTMLElement} */ (primary.querySelector(`span[data-i="${last}"]`))?.textContent ?? "x";
      handlers.onPickWord({ start: Math.min(from, to), end: last + lastChar.length });
    }
  });

  return {
    host,

    /** @param {HTMLElement} player */
    mount(player) {
      if (host.parentElement !== player) player.append(host);
    },

    /** @param {Record<string, string>} vars */
    setTheme(vars) {
      for (const [key, value] of Object.entries(vars)) host.style.setProperty(`--${key}`, value);
    },

    /** @param {boolean} visible */
    setVisible(visible) {
      host.hidden = !visible;
    },

    /** @param {boolean} hidden YouTube's control bar is hidden (move the bar down) */
    setControlsHidden(hidden) {
      host.classList.toggle("controls-hidden", hidden);
    },

    /**
     * @param {string} text primary line ("" hides the bar)
     * @param {string} translated
     * @param {string} lang
     */
    setLine(text, translated, lang) {
      if (primary.dataset.text !== text || primary.dataset.lang !== lang) {
        primary.dataset.text = text;
        primary.dataset.lang = lang;
        // One span per character, carrying its offset in the mined sentence, so clicks map to words.
        primary.replaceChildren(
          ...lineOffsets(text, lang).flatMap((line, n) => [
            ...(n ? [h("br")] : []),
            ...line.map(({ ch, i }) => h("span", { "data-i": String(i) }, ch)),
          ]),
        );
      }
      if (translation.textContent !== translated) translation.textContent = translated;
      primary.className = `primary ${lang}`;
      bar.classList.toggle("empty", !text);
    },

    /** @param {"blur" | "show" | "hide"} mode */
    setTranslationMode(mode) {
      translation.hidden = mode === "hide";
      translation.classList.toggle("blur", mode === "blur");
    },

    /**
     * @param {{anki?: boolean | null, text?: string, flash?: boolean}} status
     */
    setStatus({ anki, text, flash }) {
      if (anki !== undefined) ankiLed.className = `led ${anki === null ? "" : anki ? "ok" : "bad"}`;
      if (text !== undefined) chipText.textContent = text;
      if (flash) {
        chip.classList.add("show");
        setTimeout(() => chip.classList.remove("show"), 3000);
      }
    },

    /**
     * @param {string} text
     * @param {{error?: boolean, noteId?: number}} [options]
     */
    showToast(text, { error = false, noteId } = {}) {
      toast.className = `toast${error ? " error" : ""}`;
      toast.replaceChildren(h("span", {}, text));
      if (noteId) toast.append(h("button", { onclick: () => handlers.onOpenNote(noteId) }, "Open in Anki"));
      toast.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => (toast.hidden = true), error ? 6000 : 3500);
    },
  };
}
