import { test } from "node:test";
import assert from "node:assert/strict";
import { fallbackWordAt, lineOffsets } from "../shared/wordpick.js";
import { sentenceText } from "../shared/subtitles.js";

const pick = (s, i, lang) => {
  const r = fallbackWordAt(s, i, lang);
  return r && s.slice(r.start, r.end);
};

test("fallback word: script runs for Japanese, one hanzi for Chinese, letters for Italian", () => {
  assert.equal(pick("今日は魔法の練習", 3, "ja"), "魔法");
  assert.equal(pick("今日は魔法の練習", 2, "ja"), "は");
  assert.equal(pick("コーヒーを飲む", 1, "ja"), "コーヒー");
  assert.equal(pick("我在学习中文", 2, "zh"), "学");
  assert.equal(pick("Dimmi l'amico, dai", 9, "it"), "amico");
  assert.equal(pick("Dimmi l'amico", 6, "it"), "l");
  assert.equal(pick("ciao!", 4, "it"), null);
  assert.equal(pick("ciao", 9, "it"), null);
});

test("fallback word: offsets are string offsets even with astral characters", () => {
  const s = "𠮷野家で食べる";
  const r = fallbackWordAt(s, 2, "ja"); // 𠮷 is two UTF-16 units, so 野 is at 2
  assert.equal(s.slice(r.start, r.end), "𠮷野家");
});

test("line offsets match sentenceText for each language", () => {
  for (const [text, lang] of [["今日は魔法の\n練習をします", "ja"], ["Non lo so\nproprio", "it"]]) {
    const sentence = sentenceText(text, lang);
    for (const line of lineOffsets(text, lang)) for (const { ch, i } of line) assert.equal(sentence.slice(i, i + ch.length), ch);
  }
  assert.deepEqual(lineOffsets("ab\ncd", "it").map((l) => l.map((c) => c.i)), [[0, 1], [3, 4]]);
  assert.deepEqual(lineOffsets("ab\ncd", "ja").map((l) => l.map((c) => c.i)), [[0, 1], [2, 3]]);
});
