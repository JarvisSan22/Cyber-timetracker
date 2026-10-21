// @ts-check
/** The tab's own audio through Chrome's "Share this tab" prompt (getDisplayMedia), for players whose
 * <video> gives no audio to record (Netflix DRM). Asked once per page; the stream is kept until the tab
 * closes or reloads, or the user presses "Stop sharing". Only the audio track is kept. */

/** @type {MediaStream | null} */
let stream = null;
/** @type {Promise<MediaStream> | null} */
let pending = null;

export function tabAudioReady() {
  return Boolean(stream?.getAudioTracks().some((t) => t.readyState === "live"));
}

/**
 * The shared tab stream; shows Chrome's prompt the first time. Call it straight from a click in the page:
 * Chrome only shows the prompt shortly after a user gesture.
 * @returns {Promise<MediaStream>}
 */
export function requestTabAudio() {
  if (stream && tabAudioReady()) return Promise.resolve(stream);
  if (pending) return pending;
  const options = /** @type {any} */ ({
    video: true, // required by Chrome; stopped right away
    audio: { suppressLocalAudioPlayback: false }, // keep hearing the video
    preferCurrentTab: true, // simple "Share this tab?" prompt
    selfBrowserSurface: "include",
    surfaceSwitching: "exclude",
    systemAudio: "exclude",
  });
  pending = navigator.mediaDevices
    .getDisplayMedia(options)
    .then((s) => {
      for (const t of s.getVideoTracks()) t.stop();
      if (!s.getAudioTracks().length) {
        s.getTracks().forEach((t) => t.stop());
        throw new Error('No audio shared: tick "Also share tab audio" in Chrome\'s prompt');
      }
      stream = s;
      return s;
    })
    .catch((/** @type {Error} */ e) => {
      if (e.name === "InvalidStateError") throw new Error("Click ⌬ or a word on the subtitle bar once to share this tab's audio");
      if (e.name === "NotAllowedError") throw new Error("Tab audio not shared: click ⌬ and allow \"Share this tab\" to record");
      throw e;
    })
    .finally(() => (pending = null));
  return pending;
}
