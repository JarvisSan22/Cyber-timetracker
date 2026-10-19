// @ts-check
/** YouTube site adapter. Everything YouTube-specific lives here and in page-hook.js. */

import { callPage } from "../bridge.js";

/**
 * @typedef {object} VideoInfo
 * @property {string} videoId
 * @property {string} title
 * @property {string} author
 * @property {import("../../shared/subtitles.js").Track[]} tracks
 */

export const youtube = {
  site: "youtube",

  /** Watch pages only (not Shorts, home or search). */
  isWatchPage: () => location.pathname === "/watch" && new URL(location.href).searchParams.has("v"),

  currentVideoId: () => new URL(location.href).searchParams.get("v") ?? "",

  /** @returns {HTMLElement | null} */
  getPlayerElement: () => document.getElementById("movie_player"),

  /** @returns {HTMLVideoElement | null} */
  getVideo: () => document.querySelector("#movie_player video.html5-main-video") ?? document.querySelector("#movie_player video"),

  isAd: () => Boolean(document.getElementById("movie_player")?.classList.contains("ad-showing")),

  /**
   * Player info for the video in the address bar; waits until the player has switched to it.
   * @returns {Promise<VideoInfo | null>}
   */
  async info() {
    const want = youtube.currentVideoId();
    for (let i = 0; i < 40; i++) {
      const info = /** @type {VideoInfo | null} */ (await callPage("info").catch(() => null));
      if (info && info.videoId === want) return info;
      await new Promise((r) => setTimeout(r, 250));
    }
    return null;
  },

  /** @param {import("../../shared/subtitles.js").Track} track */
  enableTrack: (track) => callPage("enableTrack", { languageCode: track.languageCode, kind: track.kind ?? "" }, 8000),

  /** @returns {Promise<{url: string, body: string}[]>} */
  capturedSoFar: () => callPage("dump"),

  /** @param {number} ms */
  async seek(ms) {
    const video = youtube.getVideo();
    if (video) video.currentTime = ms / 1000;
  },

  /**
   * @param {string} videoId
   * @param {number} ms
   */
  sourceUrl: (videoId, ms) => `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${Math.floor(ms / 1000)}s`,

  /** Native captions are hidden while our overlay shows the same lines. */
  nativeCaptionsCss: ".ytp-caption-window-container { display: none !important; }",
};
