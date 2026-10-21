// @ts-check
/** Overlay inside the video player: subtitle bar (clickable words), status chip and toast (Shadow DOM).
 * The card editor lives in Chrome's side panel (sidepanel/), so nothing here covers the video.
 * Built with h() instead of innerHTML: YouTube enforces Trusted Types. */

import { lineOffsets } from "../shared/wordpick.js";
import { clampPosition, positionFromPointer } from "../shared/position.js";

/** Hold this long without moving to pick the bar up; moving further first is a text drag. */
const HOLD_MS = 400;
const HOLD_SLOP_PX = 6;

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
 * @property {(pos: {x: number, y: number}) => void} onMoved the bar was dragged to a new spot
 * @property {() => void} onResetPosition ⟲ on the bar
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
  const resetBtn = h("button", { class: "reset-btn", title: "Back to the default position", onclick: () => handlers.onResetPosition() }, "⟲");
  const bar = h(
    "div",
    { class: "bar empty", "data-augmented-ui": "tl-clip br-clip border" },
    h("div", { class: "lines" }, primary, translation),
    mineBtn,
    resetBtn,
    h("span", { class: "hold-meter" }),
  );

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
    if (from === null || justMoved) return; // releasing a moved bar is not a word pick
    const to = offsetOf(root.elementFromPoint(e.clientX, e.clientY)) ?? from;
    if (to === from) handlers.onPickWord({ start: from });
    else {
      const last = Math.max(from, to);
      const lastChar = /** @type {HTMLElement} */ (primary.querySelector(`span[data-i="${last}"]`))?.textContent ?? "x";
      handlers.onPickWord({ start: Math.min(from, to), end: last + lastChar.length });
    }
  });

  // Press and hold the bar to move it. A quick click or a quick drag still picks words (handlers above).
  /** @type {null | {timer: number, x0: number, y0: number, id: number, moving: boolean, grab: {x: number, y: number}}} */
  let hold = null;
  let justMoved = false;
  /** @type {{x: number, y: number} | null} */
  let position = null;

  const playerBox = () => host.getBoundingClientRect(); // the host fills the player

  /** @param {{x: number, y: number} | null} pos */
  function applyPosition(pos) {
    position = pos;
    bar.classList.toggle("custom", Boolean(pos));
    if (pos) {
      bar.style.setProperty("--x", String(pos.x));
      bar.style.setProperty("--y", String(pos.y));
    }
  }

  function cancelHold() {
    if (!hold) return;
    clearTimeout(hold.timer);
    if (hold.moving && bar.hasPointerCapture(hold.id)) bar.releasePointerCapture(hold.id);
    bar.classList.remove("holding", "moving");
    hold = null;
    for (const [type, fn] of windowListeners) window.removeEventListener(type, fn, true);
  }

  // While the bar is held, moves and the release are followed on the whole window (capture phase): a
  // player can take the pointer for its own element (Netflix does), and then the bar itself gets no moves.
  /** @param {PointerEvent} e */
  function onMove(e) {
    if (!hold || e.pointerId !== hold.id) return;
    if (!hold.moving) {
      if (Math.hypot(e.clientX - hold.x0, e.clientY - hold.y0) > HOLD_SLOP_PX) cancelHold(); // a text drag
      return;
    }
    e.preventDefault();
    e.stopPropagation(); // the page does not see a drag over the video
    applyPosition(positionFromPointer(e.clientX, e.clientY, hold.grab, playerBox(), bar.getBoundingClientRect()));
  }
  /** @param {PointerEvent} e */
  function onUp(e) {
    if (!hold || e.pointerId !== hold.id) return;
    justMoved = hold.moving;
    if (justMoved) e.stopPropagation();
    if (justMoved && position) handlers.onMoved(position);
    cancelHold();
  }
  /** @type {[string, (e: any) => void][]} */
  const windowListeners = [
    ["pointermove", onMove],
    ["pointerup", onUp],
    ["pointercancel", () => cancelHold()],
  ];

  bar.addEventListener("pointerdown", (/** @type {PointerEvent} */ e) => {
    if (e.button !== 0 || /** @type {HTMLElement} */ (e.target).closest(".mine-btn, .reset-btn")) return;
    cancelHold();
    justMoved = false;
    const box = bar.getBoundingClientRect();
    const id = e.pointerId;
    hold = { x0: e.clientX, y0: e.clientY, id, moving: false, grab: { x: e.clientX - box.left, y: e.clientY - box.top }, timer: 0 };
    for (const [type, fn] of windowListeners) window.addEventListener(type, fn, true);
    bar.classList.add("holding");
    hold.timer = setTimeout(() => {
      if (!hold || hold.id !== id) return;
      hold.moving = true;
      downAt = null; // the press became a move, not a word pick
      bar.classList.remove("holding");
      bar.classList.add("moving");
      try {
        bar.setPointerCapture(id); // keep following a fast pointer that leaves the bar
      } catch {
        // the pointer is already gone; the window listeners still follow it
      }
    }, HOLD_MS);
  });

  // The player changes size (theater mode, fullscreen, window): keep a moved bar inside it.
  new ResizeObserver(() => {
    if (position && !hold?.moving) applyPosition(clampPosition(position, playerBox(), bar.getBoundingClientRect()));
  }).observe(host);

  return {
    host,

    /**
     * Saved spot of the bar (% of the player), or null for the default spot above YouTube's controls.
     * @param {{x: number, y: number} | null} pos
     */
    setPosition(pos) {
      if (hold?.moving) return; // the user is dragging it right now
      applyPosition(pos ? clampPosition(pos, playerBox(), bar.getBoundingClientRect()) : null);
    },

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
