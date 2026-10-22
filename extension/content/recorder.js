// @ts-check
/** Screenshot and audio clip straight from the <video> element (YouTube is not DRM-protected).
 * Seeking goes through the site adapter: some players break when currentTime is set directly. */

import { isBlack } from "../shared/frame.js";

/** @param {Blob} blob */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Current frame as JPEG, scaled to `width`. Null when the frame cannot be read (DRM, not loaded).
 * @param {HTMLVideoElement} video
 * @param {number} width
 * @param {number} quality 0..1
 * @returns {Promise<{data: string, ext: string} | null>}
 */
export async function captureFrame(video, width, quality) {
  if (!video.videoWidth) return null;
  const scale = Math.min(1, width / video.videoWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
  try {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    if (isBlack(ctx.getImageData(0, 0, canvas.width, canvas.height).data)) return null;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    return blob ? { data: await blobToBase64(blob), ext: "jpg" } : null;
  } catch {
    return null; // tainted canvas (protected video)
  }
}


/**
 * Replay [startMs, endMs] in real time and record the element's audio. Leaves the video paused.
 * Runs to the end time even if the page pauses the video on the way (YouTube's player sometimes does
 * after a seek): it presses play again, a few times at most.
 * @param {HTMLVideoElement} video
 * @param {number} startMs
 * @param {number} endMs
 * @param {{seek: (ms: number) => Promise<void>, isCancelled?: () => boolean, audioTracks?: MediaStreamTrack[],
 *   frames?: {count: number, grab: () => Promise<{data: string, ext: string} | null>}}} options
 *   audioTracks: record these (the shared tab's audio) instead of the element's own audio;
 *   frames: also grab this many pictures, spread evenly over the clip, while it plays (picture choices)
 * @returns {Promise<{data: string, mime: string, fromMs: number, toMs: number, frames: {data: string, ext: string, atMs: number}[]}>}
 *   base64 WebM/Opus, the span actually played, and the pictures grabbed on the way
 */
export async function recordRange(video, startMs, endMs, { seek, isCancelled = () => false, audioTracks, frames }) {
  const own = audioTracks ? null : /** @type {MediaStream} */ (/** @type {any} */ (video).captureStream());
  const audio = audioTracks ?? /** @type {MediaStream} */ (own).getAudioTracks();
  if (!audio.length) {
    own?.getTracks().forEach((t) => t.stop());
    throw new Error("This video gives no audio to record.");
  }
  const mime = "audio/webm;codecs=opus";
  const recorder = new MediaRecorder(new MediaStream(audio), { mimeType: mime, audioBitsPerSecond: 128000 });
  /** @type {Blob[]} */
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((resolve) => recorder.addEventListener("stop", resolve, { once: true }));

  const rate = video.playbackRate;
  video.playbackRate = 1;
  video.pause();
  await seek(startMs);
  const fromMs = video.currentTime * 1000;
  recorder.start();
  let restarts = 0;
  // Moments for the picture choices: the middle of each of `count` equal parts of the clip.
  const count = frames?.count ?? 0;
  const frameTimes = Array.from({ length: count }, (_, k) => startMs + ((k + 0.5) / count) * (endMs - startMs));
  /** @type {{data: string, ext: string, atMs: number}[]} */
  const grabbed = [];
  try {
    await video.play().catch(() => {});
    const deadline = performance.now() + (endMs - startMs) + 8000;
    while (video.currentTime * 1000 < endMs && !video.ended && performance.now() < deadline && !isCancelled()) {
      if (video.paused && restarts < 5) {
        restarts++;
        await video.play().catch(() => {});
      }
      if (frames && frameTimes.length && video.currentTime * 1000 >= frameTimes[0]) {
        frameTimes.shift();
        const atMs = Math.round(video.currentTime * 1000);
        const picture = await frames.grab().catch(() => null);
        if (picture) grabbed.push({ ...picture, atMs });
      }
      await new Promise((r) => setTimeout(r, 20));
    }
  } finally {
    video.pause();
    recorder.stop();
    video.playbackRate = rate;
  }
  const toMs = video.currentTime * 1000;
  await stopped;
  own?.getTracks().forEach((t) => t.stop()); // a shared tab stream stays open for the next card
  if (isCancelled()) throw new Error("Recording cancelled");
  return { data: await blobToBase64(new Blob(chunks, { type: mime })), mime, fromMs, toMs, frames: grabbed };
}

/**
 * Play [startMs, endMs] once without recording (replay key).
 * @param {HTMLVideoElement} video
 * @param {number} startMs
 * @param {number} endMs
 * @param {(ms: number) => Promise<void>} seek
 */
export async function playRange(video, startMs, endMs, seek) {
  await seek(startMs);
  await video.play();
  const limit = performance.now() + (endMs - startMs) + 4000;
  while (video.currentTime * 1000 < endMs && !video.paused && performance.now() < limit) await new Promise((r) => setTimeout(r, 30));
  video.pause();
}
