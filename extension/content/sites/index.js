// @ts-check
/** Picks the site adapter for this page. app.js only talks to the adapter, never to a site directly. */

import { youtube } from "./youtube.js";
import { netflix } from "./netflix.js";

/**
 * @typedef {object} VideoInfo
 * @property {string} videoId
 * @property {string} title shown in the card's Source and the tracker session
 * @property {string} show channel (YouTube) or series; the show:: tag
 * @property {import("../../shared/subtitles.js").Track[]} tracks
 * @property {string} [spokenLang] language of the audio playing, when the site tells (Netflix)
 */

/**
 * @typedef {object} SubtitleRequest
 * @property {string} lang target language (ja, zh, it)
 * @property {string} translationLang
 * @property {(cues: import("../../shared/subtitles.js").Cue[]) => void} onPrimary
 * @property {(cues: import("../../shared/subtitles.js").Cue[]) => void} onTranslation
 * @property {(e: Error) => void} onError
 */

/**
 * @typedef {object} SiteAdapter
 * @property {string} site
 * @property {() => boolean} isWatchPage
 * @property {() => string} currentVideoId
 * @property {(fn: () => void) => void} onNavigate the page switched to another video (or away)
 * @property {() => HTMLElement | null} getPlayerElement
 * @property {() => HTMLVideoElement | null} getVideo
 * @property {() => boolean} isAd
 * @property {(player: HTMLElement) => boolean} controlsHidden
 * @property {() => Promise<VideoInfo | null>} info
 * @property {(video: VideoInfo, target: import("../../shared/subtitles.js").Track, request: SubtitleRequest) => () => void} subtitles
 *   start loading; calls back as tracks arrive; returns a function that stops the callbacks
 * @property {(ms: number) => Promise<void>} seek resolves once the video is at the new time
 * @property {(videoId: string, ms: number) => string} sourceUrl
 * @property {string} nativeCaptionsCss
 * @property {"element" | "tab"} audio how the clip is recorded: the <video>'s own audio, or the tab's audio
 *   shared through Chrome's "Share this tab" prompt (DRM players, where the element gives none)
 * @property {"canvas" | "tab"} frame how the card picture is taken: the <video> drawn on a canvas, or a
 *   screenshot of the tab cropped to the video (DRM players, where the canvas comes out black)
 * @property {string} [cleanFrameCss] for "tab": hides the player's controls while the screenshot is taken
 */

/** @returns {SiteAdapter | null} */
export function pickAdapter(hostname = location.hostname) {
  if (hostname === "www.youtube.com") return youtube;
  if (hostname === "www.netflix.com") return netflix;
  return null;
}
