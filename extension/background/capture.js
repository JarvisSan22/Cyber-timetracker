// @ts-check
/** Video frame from a tab screenshot, for players whose <video> cannot be drawn on a canvas (Netflix DRM). */

import { isBlack } from "../shared/frame.js";

/** @param {Blob} blob */
async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * Capture the visible tab, crop to the picture and scale to `width` like the YouTube canvas frames.
 * Null when the frame is black (hardware DRM on Windows).
 * @param {{windowId: number, rect: {left: number, top: number, width: number, height: number}, viewportWidth: number, width: number, quality: number}} options
 *   rect and viewportWidth in CSS pixels of the page; quality 0..1
 * @returns {Promise<{data: string, ext: string} | null>}
 */
export async function captureTabFrame({ windowId, rect, viewportWidth, width, quality }) {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
  const shot = await createImageBitmap(await (await fetch(dataUrl)).blob());
  // Screenshot pixels per CSS pixel (device pixel ratio and page zoom).
  const ratio = shot.width / viewportWidth;
  const sx = Math.max(0, Math.round(rect.left * ratio));
  const sy = Math.max(0, Math.round(rect.top * ratio));
  const sw = Math.min(shot.width - sx, Math.round(rect.width * ratio));
  const sh = Math.min(shot.height - sy, Math.round(rect.height * ratio));
  if (sw <= 0 || sh <= 0) return null;
  const scale = Math.min(1, width / sw);
  const canvas = new OffscreenCanvas(Math.round(sw * scale), Math.round(sh * scale));
  const ctx = /** @type {OffscreenCanvasRenderingContext2D} */ (canvas.getContext("2d"));
  ctx.drawImage(shot, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  shot.close();
  if (isBlack(ctx.getImageData(0, 0, canvas.width, canvas.height).data)) return null;
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
  return { data: await blobToBase64(blob), ext: "jpg" };
}
