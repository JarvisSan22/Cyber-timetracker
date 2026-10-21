// @ts-check
/** Screenshot helpers shared by the page (canvas frames) and the worker (tab captures). Pure functions. */

/**
 * Where the picture really is inside a <video> element: the element can be wider or taller than the
 * picture (object-fit: contain leaves black bars). All in CSS pixels.
 * @param {{left: number, top: number, width: number, height: number}} box the element's rectangle
 * @param {number} videoWidth intrinsic size
 * @param {number} videoHeight
 */
export function pictureRect(box, videoWidth, videoHeight) {
  if (!videoWidth || !videoHeight || !box.width || !box.height) return { ...box };
  const scale = Math.min(box.width / videoWidth, box.height / videoHeight);
  const width = videoWidth * scale;
  const height = videoHeight * scale;
  return { left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2, width, height };
}

/**
 * An (almost) all-black frame: DRM output or a video still loading. Samples ~2000 pixels.
 * @param {Uint8ClampedArray} rgba
 */
export function isBlack(rgba) {
  const step = Math.max(4, Math.floor(rgba.length / 4 / 2000) * 4);
  for (let i = 0; i < rgba.length; i += step) if (rgba[i] + rgba[i + 1] + rgba[i + 2] > 30) return false;
  return true;
}
