import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { memoryStore } from "../shared/dictionary/memory-store.js";
import { lookupJa } from "../shared/dictionary/ja.js";
import { lookupIt } from "../shared/dictionary/it.js";
import { bestEntry, cardStatus, fieldWords, markWords, mergeWord, normalizeWord, wordStyleVars } from "../shared/known.js";

const fixture = (lang) =>
  readFileSync(new URL(`fixtures/dict-${lang}.jsonl`, import.meta.url), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const store = memoryStore({ ja: fixture("ja"), it: fixture("it") });

test("card status: new, learning, mature", () => {
  assert.equal(cardStatus({ type: 0, interval: 0 }, 21), "new");
  assert.equal(cardStatus({ type: 1, interval: -600 }, 21), "learning");
  assert.equal(cardStatus({ type: 2, interval: 20 }, 21), "learning");
  assert.equal(cardStatus({ type: 2, interval: 21 }, 21), "known");
});

test("field text becomes clean words", () => {
  assert.deepEqual(fieldWords("<b>食[た]べる</b>", "ja"), ["食べる"]);
  assert.deepEqual(fieldWords(" 食べる、食う<br>飲む[sound:x.mp3]", "ja"), ["食べる", "食う", "飲む"]);
  assert.deepEqual(fieldWords("Andare (verb)", "it"), ["andare"]);
  assert.deepEqual(fieldWords("parlare / dire&nbsp;", "it"), ["parlare", "dire"]);
  assert.deepEqual(fieldWords("「魔法」。", "ja"), ["魔法"]);
  assert.equal(normalizeWord("L’amico", "it"), "l'amico");
});

test("the best card wins per word", () => {
  const words = {};
  mergeWord(words, "魔法", ["new", 0, "A"]);
  mergeWord(words, "魔法", ["known", 30, "B"]);
  mergeWord(words, "魔法", ["learning", 5, "C"]);
  assert.deepEqual(words["魔法"], ["known", 30, "B"]);
  mergeWord(words, "魔法", ["known", 60, "D"]);
  assert.deepEqual(words["魔法"], ["known", 60, "D"]);
  assert.deepEqual(bestEntry(words, ["魔法じゃない", "魔法"], "ja"), ["known", 60, "D"]);
  assert.equal(bestEntry(words, ["勉強"], "ja"), null);
});

test("Japanese line: words marked by status, grammar and unknown text skipped", async () => {
  const sentence = "今日は魔法を勉強した";
  const words = { 魔法: ["known", 40, "Core"], 勉強: ["learning", 3, "Mining::Japanese"] };
  const marks = await markWords(sentence, "ja", (s, i) => lookupJa(store, s, i), words);
  const seen = marks.map((m) => [sentence.slice(m.start, m.end), m.status]);
  assert.deepEqual(seen.slice(0, 3), [
    ["今日", "unknown"],
    ["魔法", "known"],
    ["勉強した", "learning"], // the inflected form is marked, matched by its dictionary form
  ]);
  assert.ok(!seen.some(([w]) => w === "は" || w === "を"));
  assert.equal(marks[1].deck, "Core");
});

test("Italian line: inflected forms match the dictionary form", async () => {
  const sentence = "Andiamo dagli amici!";
  const marks = await markWords(sentence, "it", (s, i) => lookupIt(store, s, i), { andare: ["known", 25, "Italian"] });
  assert.deepEqual(marks.map((m) => [sentence.slice(m.start, m.end), m.status]), [
    ["Andiamo", "known"],
    ["amici", "unknown"],
  ]);
});

test("word colours become CSS variables, unknown keys fall back to no colour", () => {
  const vars = wordStyleVars({ unknown: "none", learning: "underline", known: "accent2" });
  assert.equal(vars["w-unknown-color"], "inherit");
  assert.equal(vars["w-known-color"], "var(--accent-2)");
  assert.match(vars["w-learning-deco"], /underline dotted/);
  assert.equal(wordStyleVars({ unknown: "nope" })["w-unknown-deco"], "none");
});
