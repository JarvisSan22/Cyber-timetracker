import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  baseLang, cueIndexAt, cueShowing, describeTimedtextUrl, formatTime, overlappingText, parseJson3, pickTargetTrack, sentenceText,
  translationUrl,
} from "../shared/subtitles.js";

const fixture = (name) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

test("json3 manual track: skips empty events, joins segments, keeps line breaks", () => {
  const cues = parseJson3(fixture("youtube-ja-manual.json3.json"), "ja", "primary");
  assert.deepEqual(
    cues.map((c) => [c.start_ms, c.end_ms, c.text]),
    [
      [1500, 3800, "今日は魔法の\n練習をします"],
      [4000, 5800, "よろしくお願いします"],
      [9000, 11000, "食べられなかった"],
    ],
  );
  assert.equal(cues[0].lang, "ja");
  assert.equal(cues[0].role, "primary");
});

test("json3 auto-generated track: append events dropped, overlapping lines clipped", () => {
  const cues = parseJson3(fixture("youtube-ja-asr.json3.json"), "ja", "primary");
  assert.deepEqual(cues.map((c) => [c.start_ms, c.end_ms, c.text]), [
    [320, 2910, "えっと今日はですね"],
    [2910, 9010, "天気がいい"],
  ]);
});

test("cue lookup: showing line, previous line between lines, nothing before the first", () => {
  const cues = parseJson3(fixture("youtube-ja-manual.json3.json"), "ja", "primary");
  assert.equal(cueIndexAt(cues, 1000), -1);
  assert.equal(cueShowing(cues, 2000).text, "今日は魔法の\n練習をします");
  assert.equal(cueShowing(cues, 6000), null);
  assert.equal(cueIndexAt(cues, 6000), 1); // between lines: the one just shown
  assert.equal(cueIndexAt(cues, 999999), 2);
  assert.equal(cueIndexAt([], 10), -1);
});

test("translation overlapping a cue", () => {
  const cue = { start_ms: 1000, end_ms: 4000 };
  const en = [
    { start_ms: 0, end_ms: 1100, text: "before" },
    { start_ms: 1000, end_ms: 2500, text: "Today we" },
    { start_ms: 2500, end_ms: 4200, text: "practice\nmagic" },
    { start_ms: 3900, end_ms: 6000, text: "next line" },
  ];
  assert.equal(overlappingText(en, cue), "Today we practice magic");
  assert.equal(overlappingText([{ start_ms: 0, end_ms: 9000, text: "long" }], cue), "long");
  assert.equal(overlappingText([], cue), "");
});

test("sentence text joins lines per language", () => {
  assert.equal(sentenceText("今日は魔法の\n練習をします", "ja"), "今日は魔法の練習をします");
  assert.equal(sentenceText("Non lo so\nproprio", "it"), "Non lo so proprio");
});

test("track choice: spoken language (asr) wins, manual beats asr, simplified Chinese first", () => {
  const targets = ["ja", "zh", "it"];
  assert.deepEqual(pickTargetTrack([{ languageCode: "en" }, { languageCode: "ja", kind: "asr" }, { languageCode: "ja" }], targets), { languageCode: "ja" });
  assert.deepEqual(pickTargetTrack([{ languageCode: "it", kind: "asr" }, { languageCode: "ja" }], targets), { languageCode: "it", kind: "asr" });
  assert.deepEqual(pickTargetTrack([{ languageCode: "zh-Hant" }, { languageCode: "zh-Hans" }, { languageCode: "it" }], targets), { languageCode: "zh-Hans" });
  assert.deepEqual(pickTargetTrack([{ languageCode: "it" }, { languageCode: "ja" }], targets), { languageCode: "ja" });
  assert.equal(pickTargetTrack([{ languageCode: "en", kind: "asr" }], targets), null);
  assert.equal(pickTargetTrack([{ languageCode: "ja" }], ["it"]), null);
});

test("translation URL keeps the player's token; manual English track or auto-translate", () => {
  const primary = "https://www.youtube.com/api/timedtext?v=abc&lang=ja&kind=asr&fmt=json3&pot=TOKEN&c=WEB";
  const auto = new URL(translationUrl(primary, [{ languageCode: "ja", kind: "asr" }], "en"));
  assert.equal(auto.searchParams.get("tlang"), "en");
  assert.equal(auto.searchParams.get("lang"), "ja");
  assert.equal(auto.searchParams.get("pot"), "TOKEN");
  const manual = new URL(translationUrl(primary.replace("fmt=json3", "fmt=srv3"), [{ languageCode: "en-GB" }], "en"));
  assert.equal(manual.searchParams.get("lang"), "en-GB");
  assert.equal(manual.searchParams.has("kind"), false);
  assert.equal(manual.searchParams.has("tlang"), false);
  assert.equal(manual.searchParams.get("fmt"), "json3");
});

test("describe timedtext URLs", () => {
  assert.deepEqual(describeTimedtextUrl("/api/timedtext?v=abc&lang=ja&kind=asr&fmt=json3"), { videoId: "abc", lang: "ja", translated: false, kind: "asr", fmt: "json3" });
  assert.equal(describeTimedtextUrl("https://www.youtube.com/api/timedtext?v=abc&lang=ja&tlang=en").lang, "en");
  assert.equal(describeTimedtextUrl("https://www.youtube.com/api/timedtext?v=abc&lang=ja&tlang=en").translated, true);
});

test("small helpers", () => {
  assert.equal(baseLang("zh-Hans"), "zh");
  assert.equal(baseLang("IT"), "it");
  assert.equal(formatTime(761000), "12:41");
  assert.equal(formatTime(3723000), "1:02:03");
  assert.equal(formatTime(-5), "0:00");
});
