// @ts-check
/** Two-way binding between form controls and a settings object, without a framework.
 *
 *   <input data-field="anki.url">                         text / number / select
 *   <input type="checkbox" data-field="tracker.countCards"> boolean
 *   <input type="checkbox" data-field="languages.targets" value="ja">  member of an array
 */

import { getPath, setPath } from "./settings.js";

/**
 * Fill the controls from the object.
 * @param {ParentNode} root
 * @param {object} state
 */
export function fillForm(root, state) {
  for (const el of root.querySelectorAll("[data-field]")) {
    const input = /** @type {HTMLInputElement} */ (el);
    const value = getPath(state, /** @type {string} */ (input.dataset.field));
    if (input.type === "checkbox") {
      input.checked = Array.isArray(value) ? value.includes(input.value) : Boolean(value);
    } else {
      input.value = value ?? "";
    }
  }
}

/**
 * Read one control's value into the object.
 * @param {HTMLInputElement} input
 * @param {object} state
 */
export function readControl(input, state) {
  const path = /** @type {string} */ (input.dataset.field);
  const current = getPath(state, path);
  let value;
  if (input.type === "checkbox" && Array.isArray(current)) {
    value = input.checked ? [...new Set([...current, input.value])] : current.filter((v) => v !== input.value);
  } else if (input.type === "checkbox") {
    value = input.checked;
  } else if (input.type === "number") {
    value = input.valueAsNumber;
    if (Number.isNaN(value)) return false;
  } else if (typeof current === "number") {
    value = Number(input.value); // <select> of numbers
    if (Number.isNaN(value)) return false;
  } else {
    value = input.value.trim();
  }
  setPath(state, path, value);
  return true;
}

/**
 * Keep the object in sync with the controls and call onChange after each change.
 * @param {ParentNode} root
 * @param {object} state
 * @param {(path: string) => void} onChange
 */
export function bindForm(root, state, onChange) {
  fillForm(root, state);
  root.addEventListener("change", (event) => {
    const input = /** @type {HTMLInputElement} */ (event.target);
    if (!input.dataset?.field) return;
    if (readControl(input, state)) onChange(input.dataset.field);
  });
}
