import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseJson3 } from "../shared/subtitles.js";
import { parseVtt } from "../shared/subformats.js";
import { segments, transcriptKey, transcriptRows } from "../shared/transcript.js";

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

test("transcript rows: one per line, sentence joined, translation by overlap", () => {
  const primary = parseJson3(fixture("youtube-ja-manual.json3.json"), "ja", "primary");
  const translation = [{ start_ms: primary[0].start_ms, end_ms: primary[0].end_ms, text: "Hello\\nthere", lang: "en", role: "translation" }];
  const rows = transcriptRows(primary, translation, "ja");
  assert.equal(rows.length, primary.length);
  assert.deepEqual(Object.keys(rows[0]), ["i", "start_ms", "end_ms", "sentence", "translation"]);
  assert.equal(rows[0].i, 0);
  assert.ok(!rows[0].sentence.includes("\\n"));
  assert.equal(rows.at(-1).i, primary.length - 1);
  assert.equal(transcriptKey(5), "transcript:5");
});

test("transcript rows from Netflix WebVTT: lines joined without a space in Japanese", () => {
  const rows = transcriptRows(parseVtt(fixture("netflix.vtt"), "ja", "primary"), [], "ja");
  assert.equal(rows[0].sentence, "漢字です二行目");
  assert.equal(rows[0].translation, "");
});

test("segments: plain text around marked words", () => {
  const s = "今日は魔法を勉強した";
  assert.deepEqual(segments(s, [{ start: 0, end: 2, status: "unknown" }, { start: 3, end: 5, status: "known" }]), [
    { text: "今日", status: "unknown" },
    { text: "は" },
    { text: "魔法", status: "known" },
    { text: "を勉強した" },
  ]);
  assert.deepEqual(segments("abc", []), [{ text: "abc" }]);
});
