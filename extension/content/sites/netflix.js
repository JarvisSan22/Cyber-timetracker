// @ts-check
/** Netflix site adapter. Everything Netflix-specific lives here, in hooks/netflix.js and shared/netflix.js.
 * Subtitles: the hook copies the player manifest; both tracks are downloaded from its URLs, no track switching. */

import { callPage, onCaptured } from "../bridge.js";
import { asManifest, netflixTitle, netflixTracks, translationTrack } from "../../shared/netflix.js";
import { baseLang } from "../../shared/subtitles.js";
import { parseSubtitleFile } from "../../shared/subformats.js";
import { once, sleep } from "./util.js";

/** @typedef {import("../../shared/netflix.js").NetflixTrack} NetflixTrack */

/** movieId -> manifest data the hook copied */
/** @type {Map<string, {tracks: NetflixTrack[], originalAudio: string, audioLangs: string[]}>} */
const manifests = new Map();
/** Copied /metadata responses, newest last. */
/** @type {any[]} */
const metadata = [];

/** @param {string} url @param {string} body */
function handleCaptured(url, body) {
  try {
    if (url === "netflix:manifest") {
      const data = JSON.parse(body);
      const m = asManifest(data);
      if (!m) return;
      const audio = /** @type {{language: string, original: boolean}[]} */ (data.audio ?? []);
      const original = audio.find((a) => a.original)?.language ?? "";
      manifests.set(m.movieId, { tracks: netflixTracks(m.timedtexttracks), originalAudio: original, audioLangs: audio.map((a) => a.language) });
      console.info("[Cyber Miner] netflix manifest for", m.movieId, `${m.timedtexttracks.length} subtitle tracks`);
    } else if (url.includes("/metadata?")) {
      metadata.push(JSON.parse(body));
      if (metadata.length > 10) metadata.shift();
    }
  } catch {
    // ignore a body we cannot read
  }
}
onCaptured(handleCaptured);

let replayed = false;
/** Data copied before this script loaded. */
async function replayEarly() {
  if (replayed) return;
  replayed = true;
  const early = /** @type {{url: string, body: string}[]} */ (await callPage("dump").catch(() => []));
  for (const { url, body } of early) handleCaptured(url, body);
}

/** The title from /metadata, else the player's title bar (only in the page while the controls show). */
function titleFor(/** @type {string} */ movieId) {
  for (let i = metadata.length - 1; i >= 0; i--) {
    const t = netflixTitle(metadata[i], movieId);
    if (t) return t;
  }
  const el = document.querySelector('[data-uia="video-title"]');
  const show = el?.querySelector("h4")?.textContent?.trim() ?? "";
  const rest = [...(el?.querySelectorAll("span") ?? [])].map((s) => s.textContent?.trim()).filter(Boolean).join(" ");
  if (show) return { title: rest ? `${show} ${rest}` : show, show };
  return null;
}

/**
 * @param {string} url
 * @param {string} lang
 * @param {"primary" | "translation"} role
 */
async function download(url, lang, role) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Subtitle download failed (${res.status})`);
  return parseSubtitleFile(await res.text(), lang, role);
}

let watchedUrl = location.pathname;
/** Audio language the current setup used; a change (user picked another audio track) sets up again. */
let setupAudio = "";

/**
 * Language of the audio playing. The player picks its track a moment after the manifest arrives, so this
 * waits for an answer (up to 5 s), and only trusts a language the manifest lists for this video.
 * @param {{originalAudio: string, audioLangs: string[]}} manifest
 */
async function spokenLanguage(manifest) {
  const listed = (/** @type {string} */ l) => !manifest.audioLangs.length || manifest.audioLangs.some((a) => baseLang(a) === baseLang(l));
  for (let i = 0; i < 20; i++) {
    const playing = /** @type {string} */ (await callPage("audioLang").catch(() => ""));
    if (playing && listed(playing)) return { lang: playing, from: "player" };
    if (playing) console.info("[Cyber Miner] netflix: player audio", playing, "is not in this video's audio list", manifest.audioLangs);
    await sleep(250);
  }
  return { lang: manifest.originalAudio, from: "original audio" };
}

/** @type {import("./index.js").SiteAdapter} */
export const netflix = {
  site: "netflix",

  isWatchPage: () => /^\/watch\/\d+/.test(location.pathname),

  currentVideoId: () => /^\/watch\/(\d+)/.exec(location.pathname)?.[1] ?? "",

  /** Netflix is a single-page app with no navigation event of its own: watch the address. */
  onNavigate(fn) {
    setInterval(() => {
      if (location.pathname === watchedUrl) return;
      watchedUrl = location.pathname;
      fn();
    }, 500);
    // Another audio track picked in Netflix's menu: the target language may change with it.
    setInterval(async () => {
      if (!setupAudio || !netflix.isWatchPage()) return;
      const playing = /** @type {string} */ (await callPage("audioLang").catch(() => ""));
      if (playing && baseLang(playing) !== baseLang(setupAudio)) {
        console.info("[Cyber Miner] netflix: audio changed to", playing);
        setupAudio = "";
        fn();
      }
    }, 3000);
  },

  getPlayerElement: () =>
    document.querySelector(".watch-video--player-view") ?? document.querySelector(".watch-video") ?? netflix.getVideo()?.parentElement ?? null,

  getVideo: () => document.querySelector(".watch-video video") ?? document.querySelector("video"),

  isAd: () => Boolean(document.querySelector('[data-uia^="ads-info"], [data-uia="ad-break-countdown"]')),

  /** The control bar is only in the page while it shows. */
  controlsHidden: (player) => !player.querySelector('[data-uia="controls-standard"]'),

  /** Waits for the manifest of the video in the address bar (the player loads it at the start). */
  async info() {
    await replayEarly();
    const want = netflix.currentVideoId();
    for (let i = 0; i < 60 && !manifests.has(want); i++) await sleep(250);
    const manifest = manifests.get(want);
    if (!manifest) console.info("[Cyber Miner] netflix: no manifest for", want, "; manifests seen:", [...manifests.keys()]);
    if (!manifest || netflix.currentVideoId() !== want) return null;
    // /metadata usually arrives with the manifest; give it a moment.
    for (let i = 0; i < 8 && !titleFor(want); i++) await sleep(250);
    const title = titleFor(want) ?? { title: document.title.replace(/\s*[-|]\s*Netflix\s*$/i, "") || "Netflix", show: "" };
    const spoken = await spokenLanguage(manifest);
    if (netflix.currentVideoId() !== want) return null;
    console.info(`[Cyber Miner] netflix: audio ${spoken.lang || "unknown"} (${spoken.from}); audio tracks:`, manifest.audioLangs.join(", "));
    setupAudio = spoken.lang;
    return { videoId: want, ...title, tracks: manifest.tracks, spokenLang: spoken.lang };
  },

  subtitles(video, target, { lang, translationLang, onPrimary, onTranslation, onError }) {
    let live = true;
    const track = /** @type {NetflixTrack} */ (target);
    (async () => {
      if (track.image || !track.url) throw new Error("Image subtitles: cannot be read");
      const cues = await download(track.url, lang, "primary");
      if (!live) return;
      if (!cues.length) throw new Error("Subtitle file is empty");
      onPrimary(cues);
      if (translationLang === lang) return;
      const other = translationTrack(/** @type {NetflixTrack[]} */ (video.tracks), translationLang);
      if (!other) return;
      const translated = await download(other.url, translationLang, "translation");
      if (live) onTranslation(translated);
    })().catch((e) => live && onError(e));
    return () => {
      live = false;
    };
  },

  /** Through Netflix's own player (setting currentTime breaks it); resolves when the video has seeked. */
  async seek(ms) {
    const video = netflix.getVideo();
    if (!video) return;
    const seeked = once(video, "seeked", 3000);
    await callPage("seek", { ms });
    await seeked;
  },

  sourceUrl: (videoId, ms) => `https://www.netflix.com/watch/${encodeURIComponent(videoId)}?t=${Math.floor(ms / 1000)}`,

  nativeCaptionsCss: ".player-timedtext { display: none !important; }",

  /** DRM: the <video> gives no audio and a canvas no picture, so the tab's audio is shared and the worker
   * screenshots the tab. */
  audio: "tab",
  frame: "tab",
  /** Everything in the player that is neither the video nor a box around it (controls, title, dimming). */
  cleanFrameCss: ".watch-video *:not(video):not(:has(video)) { visibility: hidden !important; }",
};
