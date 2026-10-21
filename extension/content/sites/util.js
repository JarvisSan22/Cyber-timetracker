// @ts-check
/** Small helpers shared by the site adapters. */

/**
 * Resolve on the next `type` event of the element, or after `timeoutMs` anyway.
 * @param {EventTarget} target
 * @param {string} type
 * @param {number} timeoutMs
 */
export function once(target, type, timeoutMs) {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      target.removeEventListener(type, done);
      resolve(undefined);
    };
    const timer = setTimeout(done, timeoutMs);
    target.addEventListener(type, done);
  });
}

/** @param {number} ms */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
