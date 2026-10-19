// @ts-check
/** Offscreen document: turns a recorded WebM/Opus clip into MP3 (lamejs, loaded as a classic script). */

import { encodeMp3 } from "../shared/mp3.js";

/** @param {string} base64 */
function fromBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** @param {Uint8Array} bytes */
function toBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== "offscreen" || msg.type !== "encode-mp3") return false;
  (async () => {
    // Decoding resamples to the context's rate; mono is plenty for a sentence.
    const ctx = new OfflineAudioContext(1, 1, 44100);
    const audio = await ctx.decodeAudioData(fromBase64(msg.data));
    const mp3 = encodeMp3(/** @type {any} */ (globalThis).lamejs, audio, msg.kbps);
    return { data: toBase64(mp3), ext: "mp3", seconds: audio.duration };
  })().then(
    (result) => sendResponse({ result }),
    (e) => sendResponse({ error: `MP3 encoding failed: ${e?.message ?? e}` }),
  );
  return true;
});
