// @ts-check
/** Where the subtitle bar sits when moved: % of the player, so one position fits a small player and
 * fullscreen alike. x = the bar's centre from the player's left, y = its bottom edge from the player's bottom. */

/** @typedef {{x: number, y: number}} BarPosition */
/** @typedef {{left: number, top: number, width: number, height: number}} Box  (a DOMRect is fine) */

/**
 * Keep the whole bar inside the player.
 * @param {BarPosition} pos
 * @param {Box} player
 * @param {{width: number, height: number}} bar
 * @returns {BarPosition}
 */
export function clampPosition(pos, player, bar) {
  if (!player.width || !player.height) return pos;
  const halfWidth = Math.min(50, (bar.width / 2 / player.width) * 100);
  const height = Math.min(100, (bar.height / player.height) * 100);
  return {
    x: round(Math.min(100 - halfWidth, Math.max(halfWidth, pos.x))),
    y: round(Math.min(100 - height, Math.max(0, pos.y))),
  };
}

/**
 * Position for the bar while it is dragged: the point of the bar that was grabbed stays under the pointer.
 * @param {number} pointerX client coordinates
 * @param {number} pointerY
 * @param {{x: number, y: number}} grab pointer position inside the bar when the hold started
 * @param {Box} player
 * @param {{width: number, height: number}} bar
 */
export function positionFromPointer(pointerX, pointerY, grab, player, bar) {
  const centre = pointerX - grab.x + bar.width / 2 - player.left;
  const bottom = player.top + player.height - (pointerY - grab.y + bar.height);
  return clampPosition({ x: (centre / player.width) * 100, y: (bottom / player.height) * 100 }, player, bar);
}

/** Two decimals are plenty for a %. */
function round(/** @type {number} */ n) {
  return Math.round(n * 100) / 100;
}
