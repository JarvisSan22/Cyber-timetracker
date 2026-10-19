// @ts-check
/** Calls into page-hook.js (the page's JS world) over window.postMessage. */

const TAG = "__cyberMiner";
let nextId = 1;
/** @type {Map<number, {resolve: (v: any) => void, reject: (e: Error) => void}>} */
const pending = new Map();
/** @type {((url: string, body: string) => void)[]} */
const timedtextListeners = [];

window.addEventListener("message", (event) => {
  const msg = event.data;
  if (event.source !== window || !msg || msg[TAG] !== true || msg.dir !== "to-content") return;
  if (msg.type === "timedtext") {
    for (const fn of timedtextListeners) fn(msg.url, msg.body);
  } else if (msg.type === "reply" && pending.has(msg.id)) {
    const { resolve, reject } = /** @type {any} */ (pending.get(msg.id));
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error));
    else resolve(msg.result);
  }
});

/**
 * @param {string} command
 * @param {object} [args]
 * @param {number} [timeoutMs]
 */
export function callPage(command, args = {}, timeoutMs = 5000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    window.postMessage({ [TAG]: true, dir: "to-page", id, command, args }, location.origin);
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`Page did not answer "${command}"`));
    }, timeoutMs);
  });
}

/** @param {(url: string, body: string) => void} fn */
export function onTimedtext(fn) {
  timedtextListeners.push(fn);
}
