// @ts-check
/** Netflix data the page hook copies: subtitle tracks from the player manifest, title from /metadata.
 * Pure functions (tested in Node); the adapter is content/sites/netflix.js. */

import { baseLang } from "./subtitles.js";

/** Text formats we can parse, best first. imsc1.1 is often the only text format for Japanese and Chinese. */
export const TEXT_FORMATS = ["imsc1.1", "dfxp-ls-sdh", "simplesdh", "webvtt-lssdh-ios8"];

/** Netflix lists these subtitle formats when the hook adds them to the manifest request. */
export const EXTRA_PROFILES = ["imsc1.1", "dfxp-ls-sdh", "webvtt-lssdh-ios8", "simplesdh"];

/**
 * @typedef {import("./subtitles.js").Track & {id: string, url: string, format: string, image: boolean}} NetflixTrack
 */

/** First download URL of a ttDownloadables entry (newer manifests: urls[]; older: downloadUrls{cdn: url}). */
function urlOf(/** @type {any} */ d) {
  if (!d) return "";
  if (Array.isArray(d.urls)) return d.urls.find((/** @type {any} */ u) => u?.url)?.url ?? "";
  if (d.downloadUrls) return Object.values(d.downloadUrls).find(Boolean) ?? "";
  return "";
}

/**
 * Tracks from a manifest's `timedtexttracks`, ordered so the best one per language comes first:
 * plain subtitles, then closed captions (sound descriptions), then image-only tracks (not readable).
 * "Off" and forced-narrative tracks are left out.
 * @param {any[]} timedtexttracks
 * @returns {NetflixTrack[]}
 */
export function netflixTracks(timedtexttracks) {
  /** @type {NetflixTrack[]} */
  const tracks = (timedtexttracks ?? [])
    .filter((t) => t && t.language && !t.isNoneTrack && !t.isForcedNarrative)
    .map((t) => {
      const dl = t.ttDownloadables ?? t.downloadables ?? {};
      const format = TEXT_FORMATS.find((f) => urlOf(dl[f])) ?? "";
      return {
        languageCode: t.language,
        kind: t.rawTrackType === "closedcaptions" || t.trackType === "ASSISTIVE" ? "cc" : "",
        name: t.languageDescription || t.language,
        id: String(t.new_track_id ?? t.id ?? `${t.language}-${t.rawTrackType}`),
        url: format ? urlOf(dl[format]) : "",
        format,
        image: !format,
      };
    });
  const rank = (/** @type {NetflixTrack} */ t) => (t.image ? 2 : t.kind === "cc" ? 1 : 0);
  return tracks.sort((a, b) => rank(a) - rank(b));
}

/**
 * The text track for the translation language, or null.
 * @param {NetflixTrack[]} tracks ordered by netflixTracks
 * @param {string} lang "en"
 */
export function translationTrack(tracks, lang) {
  return tracks.find((t) => baseLang(t.languageCode) === lang && !t.image) ?? null;
}

/**
 * Card title and show from a /metadata response: "Frieren S1E3" / "Frieren" for an episode, the film's
 * title for a film. Null when the response is not about this video.
 * @param {any} metadata
 * @param {string} movieId the id in /watch/<id>
 * @returns {{title: string, show: string} | null}
 */
export function netflixTitle(metadata, movieId) {
  const video = metadata?.video;
  if (!video?.title) return null;
  const id = String(movieId);
  if (video.type === "show") {
    for (const season of video.seasons ?? []) {
      const ep = (season.episodes ?? []).find((/** @type {any} */ e) => String(e.id ?? e.episodeId) === id);
      if (ep) return { title: `${video.title} S${season.seq}E${ep.seq}`, show: video.title };
    }
    return null;
  }
  return String(video.id) === id ? { title: video.title, show: video.title } : null;
}

/**
 * The parsed JSON the hook saw is a player manifest with subtitle tracks: {movieId, timedtexttracks}
 * (newer manifests call the list textTracks).
 * @param {any} obj
 */
export function asManifest(obj) {
  const r = obj?.result ?? obj;
  const tracks = r?.timedtexttracks ?? r?.textTracks;
  return Array.isArray(tracks) && r.movieId !== undefined ? { movieId: String(r.movieId), timedtexttracks: tracks } : null;
}
