import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_SENTENCE, collapseSpaces, pickLang, sentenceAround } from "../shared/reader.js";

const around = (text, needle, extra = 0) => {
  const r = sentenceAround(text, text.indexOf(needle) + extra);
  return [r.sentence, r.sentence.slice(r.offset, r.offset + needle.length)];
};

test("sentenceAround: Japanese sentences split on 。！？", () => {
  const text = "今日は晴れ。明日は雨が降るでしょう！本当？";
  assert.deepEqual(around(text, "雨"), ["明日は雨が降るでしょう！", "雨"]);
  assert.deepEqual(around(text, "今日"), ["今日は晴れ。", "今日"]);
  assert.deepEqual(around(text, "本当"), ["本当？", "本当"]);
});

test("sentenceAround: closing quotes stay with their sentence", () => {
  const text = "彼は「行くよ。」と言った。それから帰った。";
  assert.deepEqual(around(text, "それ"), ["それから帰った。", "それ"]);
  const r = sentenceAround(text, text.indexOf("行く"));
  assert.equal(r.sentence, "彼は「行くよ。」");
});

test("sentenceAround: Italian, '.' only before a space or the end", () => {
  const text = "Costa 3.50 euro. Poi andiamo al mare!  Va bene.";
  assert.deepEqual(around(text, "euro"), ["Costa 3.50 euro.", "euro"]);
  assert.deepEqual(around(text, "mare"), ["Poi andiamo al mare!", "mare"]);
  assert.deepEqual(around(text, "bene"), ["Va bene.", "bene"]);
});

test("sentenceAround: newline ends a sentence, whitespace trimmed", () => {
  const text = "  見出し\n  本文の最初の文";
  assert.deepEqual(around(text, "本文"), ["本文の最初の文", "本文"]);
  assert.deepEqual(around(text, "見出し"), ["見出し", "見出し"]);
});

test("sentenceAround: long text is cut around the offset", () => {
  const text = "あ".repeat(500) + "猫" + "い".repeat(500);
  const r = sentenceAround(text, 500);
  assert.equal(r.sentence.length, MAX_SENTENCE);
  assert.equal(r.sentence[r.offset], "猫");
  const edge = sentenceAround(text, 3);
  assert.equal(edge.offset, 3);
  assert.equal(edge.sentence.length, MAX_SENTENCE);
});

test("sentenceAround: offset past the end clamps", () => {
  assert.deepEqual(sentenceAround("猫です", 9), { sentence: "猫です", offset: 2 });
});

test("pickLang: kana, latin, han", () => {
  const all = ["ja", "zh", "it"];
  assert.equal(pickLang("食べる", 1, all), "ja");
  assert.equal(pickLang("食べる", 0, all), "ja"); // kanji, kana in sentence
  assert.equal(pickLang("parlare", 2, all), "it");
  assert.equal(pickLang("我学习中文", 1, all, "zh-CN"), "zh");
  assert.equal(pickLang("東京都", 0, all, "ja"), "ja");
  assert.equal(pickLang("東京都", 0, ["zh", "ja"]), "zh"); // no hint: first CJK target
  assert.equal(pickLang("東京都", 0, all, "en"), "ja");
});

test("pickLang: languages not chosen, or not a letter", () => {
  assert.equal(pickLang("parlare", 0, ["ja"]), null);
  assert.equal(pickLang("食べる", 1, ["zh"]), null);
  assert.equal(pickLang("学习", 0, ["it"]), null);
  assert.equal(pickLang("2026年", 0, ["ja"]), null);
  assert.equal(pickLang("、", 0, ["ja"]), null);
});

test("collapseSpaces: runs of whitespace, CJK line wraps, map back", () => {
  const { text, map } = collapseSpaces("  Va   bene\n    poi");
  assert.equal(text, "Va bene\npoi");
  assert.equal(map[text.indexOf("bene")], "  Va   bene".indexOf("bene"));
  assert.equal(collapseSpaces("日本語の\n      文章です").text, "日本語の\n文章です");
  assert.equal(collapseSpaces("日本語の      文章です").text, "日本語の文章です");
  assert.equal(collapseSpaces("東京 Tokyo").text, "東京 Tokyo");
  const src = "a \n\n  b";
  const r = collapseSpaces(src);
  assert.equal(r.text, "a\nb");
  assert.equal(src[r.map[2]], "b");
});
