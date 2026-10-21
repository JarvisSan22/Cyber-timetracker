import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseTtml, parseVtt, parseSubtitleFile, ttmlTime } from "../shared/subformats.js";
import { asManifest, netflixTitle, netflixTracks, translationTrack } from "../shared/netflix.js";
import { pickTargetTrack } from "../shared/subtitles.js";

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

test("TTML time expressions", () => {
  const rates = { tickRate: 10000000, frameRate: 25 };
  assert.equal(ttmlTime("12345670000t", rates), 1234567);
  assert.equal(ttmlTime("00:01:02.5", rates), 62500);
  assert.equal(ttmlTime("00:00:01:05", rates), 1200);
  assert.equal(ttmlTime("1.5s", rates), 1500);
  assert.equal(ttmlTime("250ms", rates), 250);
  assert.ok(Number.isNaN(ttmlTime("soon", rates)));
});

test("IMSC with ruby: furigana dropped, base kept, layout whitespace ignored, sorted", () => {
  const cues = parseTtml(fixture("netflix-ja.imsc.xml"), "ja", "primary");
  assert.equal(cues.length, 2); // zero-length cue dropped
  assert.deepEqual(cues[0], { start_ms: 1000, end_ms: 2500, text: "一番目", lang: "ja", role: "primary" });
  assert.equal(cues[1].start_ms, 1234567);
  assert.equal(cues[1].end_ms, 1267890);
  assert.equal(cues[1].text, "魔法は好きだ\n（フリーレン）お茶&お菓子");
});

test("DFXP with prefixes, clock and frame times, entities", () => {
  const cues = parseTtml(fixture("netflix-en.dfxp.xml"), "en", "translation");
  assert.equal(cues[0].text, "Frames");
  assert.equal(cues[0].start_ms, Math.round(1000 + (12 / (24 * 1000 / 1001)) * 1000));
  assert.equal(cues[0].end_ms - cues[0].start_ms, 2000);
  assert.deepEqual(cues[1], { start_ms: 1234567, end_ms: 1236000, text: "I like magic.\nIt's ❤ fun", lang: "en", role: "translation" });
});

test("WebVTT: settings, tags and ruby text stripped", () => {
  const cues = parseVtt(fixture("netflix.vtt"), "ja-JP", "primary");
  assert.deepEqual(cues[0], { start_ms: 1000, end_ms: 2500, text: "漢字です\n二行目", lang: "ja", role: "primary" });
  assert.deepEqual(cues[1], { start_ms: 62000, end_ms: 63000, text: "A & B", lang: "ja", role: "primary" });
  assert.equal(parseSubtitleFile(fixture("netflix.vtt"), "ja", "primary").length, 2);
  assert.equal(parseSubtitleFile(fixture("netflix-en.dfxp.xml"), "en", "translation").length, 2);
  assert.throws(() => parseSubtitleFile("{}", "en", "primary"));
});

const timedtexttracks = [
  { language: "ja", languageDescription: "Japanese (CC)", rawTrackType: "closedcaptions", new_track_id: "jcc", ttDownloadables: { "imsc1.1": { urls: [{ url: "https://cdn/jcc" }] } } },
  { language: "ja", languageDescription: "Japanese", rawTrackType: "subtitles", new_track_id: "jsub", ttDownloadables: { "imsc1.1": { urls: [{ url: "https://cdn/jsub" }] }, "webvtt-lssdh-ios8": { urls: [{ url: "https://cdn/jvtt" }] } } },
  { language: "zh-Hans", languageDescription: "Chinese (Simplified)", rawTrackType: "subtitles", new_track_id: "zimg", ttDownloadables: { "nflx-cmisc": { downloadUrls: { 1: "https://cdn/zimg" } } } },
  { language: "zh-Hant", languageDescription: "Chinese (Traditional)", rawTrackType: "subtitles", new_track_id: "ztxt", ttDownloadables: { "dfxp-ls-sdh": { downloadUrls: { 1: "https://cdn/ztxt" } } } },
  { language: "en", languageDescription: "English", rawTrackType: "subtitles", new_track_id: "en", ttDownloadables: { "webvtt-lssdh-ios8": { downloadUrls: { 9: "https://cdn/en" } } } },
  { language: "it", languageDescription: "Italian (forced)", isForcedNarrative: true, ttDownloadables: {} },
  { isNoneTrack: true, language: "", ttDownloadables: {} },
];

test("manifest tracks: best format, subtitles before CC before image-only, off/forced dropped", () => {
  const tracks = netflixTracks(timedtexttracks);
  assert.deepEqual(tracks.map((t) => t.id), ["jsub", "ztxt", "en", "jcc", "zimg"]);
  assert.equal(tracks[0].url, "https://cdn/jsub");
  assert.equal(tracks[0].format, "imsc1.1");
  assert.equal(tracks[1].url, "https://cdn/ztxt");
  assert.equal(tracks[3].kind, "cc");
  assert.equal(tracks[4].image, true);
  assert.equal(translationTrack(tracks, "en")?.url, "https://cdn/en");
  assert.equal(translationTrack(tracks, "fr"), null);
  assert.deepEqual(asManifest({ result: { movieId: 81, timedtexttracks } })?.movieId, "81");
  assert.equal(asManifest({ result: {} }), null);
  // Newer manifests: textTracks and downloadables.
  const newer = asManifest({ result: { movieId: 82, textTracks: [{ language: "ja", rawTrackType: "subtitles", downloadables: { "webvtt-lssdh-ios8": { urls: [{ url: "https://cdn/new" }] } } }] } });
  assert.equal(netflixTracks(newer.timedtexttracks)[0].url, "https://cdn/new");
});

test("the spoken language decides the target track on Netflix", () => {
  const tracks = netflixTracks(timedtexttracks);
  assert.equal(pickTargetTrack(tracks, ["ja", "zh", "it"], "ja")?.id, "jsub");
  // Chinese: the readable traditional track beats an image-only simplified one.
  assert.equal(pickTargetTrack(tracks, ["ja", "zh", "it"], "zh-Hans")?.id, "ztxt");
  assert.equal(pickTargetTrack(tracks, ["ja", "zh", "it"], "en"), null);
  assert.equal(pickTargetTrack(tracks, ["zh", "ja"])?.id, "ztxt"); // unknown audio: language order
});

test("title from /metadata", () => {
  const show = { video: { id: 1, type: "show", title: "Frieren", seasons: [{ seq: 1, episodes: [{ id: 101, seq: 1 }, { id: 103, seq: 3 }] }] } };
  assert.deepEqual(netflixTitle(show, "103"), { title: "Frieren S1E3", show: "Frieren" });
  assert.equal(netflixTitle(show, "999"), null);
  assert.deepEqual(netflixTitle({ video: { id: 7, type: "movie", title: "Perfect Days" } }, "7"), { title: "Perfect Days", show: "Perfect Days" });
  assert.equal(netflixTitle({}, "7"), null);
});
