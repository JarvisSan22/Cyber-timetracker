// @ts-check
/** YouTube site adapter. Everything YouTube-specific lives here and in hooks/youtube.js. */

import { callPage, onCaptured } from "../bridge.js";
import { baseLang, describeTimedtextUrl, parseJson3, translationUrl } from "../../shared/subtitles.js";
import { once } from "./util.js";

/** @typedef {import("../../shared/subtitles.js").Cue} Cue */
/** @typedef {import("./index.js").VideoInfo} VideoInfo */
/** @typedef {import("./index.js").SubtitleRequest} SubtitleRequest */

/** The subtitle request now running; captured responses go to it. */
/** @type {null | ((url: string, body: string) => Promise<void>)} */
let current = null;
onCaptured((url, body) => current?.(url, body));

/**
 * @param {string} body
 * @param {string} lang
 * @param {"primary" | "translation"} role
 */
function tryParse(body, lang, role) {
  try {
    return parseJson3(body, lang, role);
  } catch {
    return null; // not json3 (srv3/XML) or empty
  }
}

/**
 * @param {string} url
 * @param {string} lang
 * @param {"primary" | "translation"} role
 */
async function refetchJson3(url, lang, role) {
  const u = new URL(url);
  u.searchParams.set("fmt", "json3");
  const res = await fetch(u, { credentials: "include" }).catch(() => null);
  if (!res?.ok) return null;
  return tryParse(await res.text(), lang, role);
}

/** @type {import("./index.js").SiteAdapter} */
export const youtube = {
  site: "youtube",

  /** Watch pages only (not Shorts, home or search). */
  isWatchPage: () => location.pathname === "/watch" && new URL(location.href).searchParams.has("v"),

  currentVideoId: () => new URL(location.href).searchParams.get("v") ?? "",

  /** @param {() => void} fn */
  onNavigate: (fn) => document.addEventListener("yt-navigate-finish", fn),

  getPlayerElement: () => document.getElementById("movie_player"),

  getVideo: () => document.querySelector("#movie_player video.html5-main-video") ?? document.querySelector("#movie_player video"),

  isAd: () => Boolean(document.getElementById("movie_player")?.classList.contains("ad-showing")),

  /** YouTube's control bar is hidden (the subtitle bar can sit lower). */
  controlsHidden: (player) => player.classList.contains("ytp-autohide"),

  /** Player info for the video in the address bar; waits until the player has switched to it. */
  async info() {
    const want = youtube.currentVideoId();
    for (let i = 0; i < 40; i++) {
      const info = /** @type {VideoInfo | null} */ (await callPage("info").catch(() => null));
      if (info && info.videoId === want) return info;
      await new Promise((r) => setTimeout(r, 250));
    }
    return null;
  },

  /**
   * Load the target track (the player fetches it with its own token once we switch to it; we copy the
   * response) and its machine translation (tlang on the same URL).
   */
  subtitles(video, target, { lang, translationLang, onPrimary, onTranslation, onError }) {
    let primaryUrl = "";
    /** @param {string} url @param {string} body */
    const handle = async (url, body) => {
      const info = describeTimedtextUrl(url);
      if (info.videoId !== video.videoId || info.translated || baseLang(info.lang) !== lang) return;
      if (primaryUrl === url) return;
      const cues = tryParse(body, lang, "primary") ?? (await refetchJson3(url, lang, "primary"));
      if (!cues?.length || current !== handle) return;
      primaryUrl = url;
      onPrimary(cues);
      if (translationLang === lang) return;
      const translated = await refetchJson3(translationUrl(url, video.tracks, translationLang), translationLang, "translation");
      if (translated && current === handle) onTranslation(translated);
    };
    current = handle;

    (async () => {
      // The player may have fetched the track before we loaded.
      const early = /** @type {{url: string, body: string}[]} */ (await callPage("dump").catch(() => []));
      await Promise.all(early.map(({ url, body }) => handle(url, body)));
      if (current !== handle || primaryUrl) return;
      await callPage("enableTrack", { languageCode: target.languageCode, kind: target.kind ?? "" }, 8000);
    })().catch((e) => current === handle && onError(e));

    return () => {
      if (current === handle) current = null;
    };
  },

  /** Seek and wait until the frame is there. */
  async seek(ms) {
    const video = youtube.getVideo();
    if (!video) return;
    const seeked = once(video, "seeked", 3000);
    video.currentTime = Math.max(0, ms) / 1000;
    await seeked;
  },

  sourceUrl: (videoId, ms) => `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${Math.floor(ms / 1000)}s`,

  /** Native captions are hidden while our overlay shows the same lines. */
  nativeCaptionsCss: ".ytp-caption-window-container { display: none !important; }",

  audio: "element",
  frame: "canvas",
};
