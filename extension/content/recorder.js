// @ts-check
/** Screenshot and audio clip straight from the <video> element (YouTube is not DRM-protected). */

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
    if (isBlack(ctx, canvas.width, canvas.height)) return null;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    return blob ? { data: await blobToBase64(blob), ext: "jpg" } : null;
  } catch {
    return null; // tainted canvas (protected video)
  }
}

/**
 * A frame that is (almost) all black: DRM output or a video still loading.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w
 * @param {number} h
 */
function isBlack(ctx, w, h) {
  const { data } = ctx.getImageData(0, 0, w, h);
  const step = Math.max(4, Math.floor(data.length / 4 / 2000) * 4); // ~2000 samples
  for (let i = 0; i < data.length; i += step) if (data[i] + data[i + 1] + data[i + 2] > 30) return false;
  return true;
}

/**
 * @param {HTMLVideoElement} video
 * @param {string} type
 */
function once(video, type) {
  return new Promise((resolve) => video.addEventListener(type, resolve, { once: true }));
}

/**
 * Replay [startMs, endMs] in real time and record the element's audio. Leaves the video paused at endMs.
 * @param {HTMLVideoElement} video
 * @param {number} startMs
 * @param {number} endMs
 * @param {{isCancelled?: () => boolean}} [options]
 * @returns {Promise<{data: string, mime: string}>} base64 WebM/Opus
 */
export async function recordRange(video, startMs, endMs, { isCancelled = () => false } = {}) {
  const stream = /** @type {MediaStream} */ (/** @type {any} */ (video).captureStream());
  const audio = stream.getAudioTracks();
  if (!audio.length) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error("This video gives no audio to record.");
  }
  const mime = "audio/webm;codecs=opus";
  const recorder = new MediaRecorder(new MediaStream(audio), { mimeType: mime, audioBitsPerSecond: 128000 });
  /** @type {Blob[]} */
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = once(/** @type {any} */ (recorder), "stop");

  const rate = video.playbackRate;
  video.playbackRate = 1;
  video.pause();
  video.currentTime = Math.max(0, startMs) / 1000;
  await once(video, "seeked");
  recorder.start();
  try {
    await video.play();
    const limit = performance.now() + (endMs - startMs) + 4000;
    while (video.currentTime * 1000 < endMs && !video.ended && !video.paused && performance.now() < limit && !isCancelled()) {
      await new Promise((r) => setTimeout(r, 20));
    }
  } finally {
    video.pause();
    recorder.stop();
    video.playbackRate = rate;
  }
  await stopped;
  stream.getTracks().forEach((t) => t.stop());
  if (isCancelled()) throw new Error("Recording cancelled");
  return { data: await blobToBase64(new Blob(chunks, { type: mime })), mime };
}

/**
 * Play [startMs, endMs] once without recording (replay key).
 * @param {HTMLVideoElement} video
 * @param {number} startMs
 * @param {number} endMs
 */
export async function playRange(video, startMs, endMs) {
  video.currentTime = Math.max(0, startMs) / 1000;
  await once(video, "seeked");
  await video.play();
  const limit = performance.now() + (endMs - startMs) + 4000;
  while (video.currentTime * 1000 < endMs && !video.paused && performance.now() < limit) await new Promise((r) => setTimeout(r, 30));
  video.pause();
}
