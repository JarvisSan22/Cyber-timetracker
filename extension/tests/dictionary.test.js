// Fixtures are small excerpts of the built dictionaries (scripts/fetch-dicts.py): JMdict © EDRDG and
// Kanjium pitch (CC BY-SA 4.0), CC-CEDICT © MDBG (CC BY-SA 4.0), Wiktionary via kaikki.org (CC BY-SA 4.0, GFDL).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { memoryStore } from "../shared/dictionary/memory-store.js";
import { deinflect, furigana, lookupJa, toHiragana } from "../shared/dictionary/ja.js";
import { lookupZh } from "../shared/dictionary/zh.js";
import { cliticCandidates, lookupIt, wordAt } from "../shared/dictionary/it.js";

const fixture = (lang) =>
  readFileSync(new URL(`fixtures/dict-${lang}.jsonl`, import.meta.url), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const store = memoryStore({ ja: fixture("ja"), zh: fixture("zh"), it: fixture("it") });
const matched = (r, s) => r && s.slice(r.start, r.end);
const terms = (r) => r?.entries.map((e) => e.term);

test("deinflect traces conjugations back to the dictionary form", () => {
  // Several classes are proposed (e.g. 食べる as a godan passive too); the lookup keeps the one whose
  // part of speech matches the dictionary entry.
  const reasons = (text, term, cls) => deinflect(text).find((c) => c.term === term && c.rules.includes(cls))?.reasons;
  assert.deepEqual(reasons("食べられなかった", "食べる", "v1"), ["past", "negative", "potential or passive"]);
  assert.deepEqual(reasons("飲みたい", "飲む", "v5"), ["want"]);
  assert.deepEqual(reasons("来なかった", "来る", "vk"), ["past", "negative"]);
  assert.deepEqual(reasons("していました", "する", "vs"), ["past", "polite", "progressive", "te"]);
  assert.deepEqual(reasons("行って", "行く", "v5"), ["te"]);
  assert.deepEqual(reasons("高くない", "高い", "adj-i"), ["negative"]);
  assert.deepEqual(deinflect("魔法")[0], { term: "魔法", rules: [], reasons: [] });
});

test("Japanese: longest match with conjugation, reading, furigana and pitch", async () => {
  const s = "昨日は食べられなかった";
  const r = await lookupJa(store, s, 3);
  assert.equal(matched(r, s), "食べられなかった");
  assert.ok(terms(r).includes("食べる"));
  const taberu = r.entries.find((e) => e.term === "食べる");
  assert.equal(taberu.reading, "たべる");
  assert.equal(taberu.furigana, "食[た]べる");
  assert.deepEqual(taberu.pitch, [2]);
  assert.equal(taberu.note, "potential or passive · negative · past");
  assert.equal(taberu.senses[0].glosses[0], "to eat");

  const m = await lookupJa(store, "今日は魔法の練習", 3);
  assert.deepEqual([matched(m, "今日は魔法の練習"), m.entries[0].term, m.entries[0].pitch], ["魔法", "魔法", [0]]);
  assert.equal(terms(await lookupJa(store, "コーヒーを飲みたい", 5))[0], "飲む");
  assert.equal(terms(await lookupJa(store, "来なかった", 0))[0], "来る");
  assert.equal(terms(await lookupJa(store, "勉強しなければ", 0))[0], "勉強");
  assert.equal(terms(await lookupJa(store, "高くない", 0))[0], "高い");
});

test("Japanese: kana words keep their spelling; drag selects exactly", async () => {
  const r = await lookupJa(store, "ありがとう", 0);
  assert.equal(r.entries[0].term, "ありがとう");
  assert.equal(r.entries[0].furigana, "");
  assert.match(r.entries[0].note, /also written/);
  const exact = await lookupJa(store, "今日は魔法の練習", 3, 4);
  assert.equal(exact, null); // 魔 alone is not in the fixture
  assert.equal(await lookupJa(store, "xyz", 0), null);
});

test("furigana alignment", () => {
  assert.equal(furigana("食べる", "たべる"), "食[た]べる");
  assert.equal(furigana("魔法", "まほう"), "魔法[まほう]");
  assert.equal(furigana("お茶", "おちゃ"), "お 茶[ちゃ]");
  assert.equal(furigana("ありがとう", "ありがとう"), "ありがとう");
  assert.equal(furigana("行ってくる", "いってくる"), "行[い]ってくる");
  assert.equal(furigana("変な", "ちがう"), "変な[ちがう]"); // cannot align: ruby over the whole word
  assert.equal(toHiragana("コーヒー"), "こーひー");
});

test("Chinese: longest word, simplified or traditional, pinyin with tone marks", async () => {
  const r = await lookupZh(store, "我在学习中文", 2);
  assert.equal(matched(r, "我在学习中文"), "学习");
  assert.equal(r.entries[0].reading, "xué xí");
  assert.equal(r.entries[0].note, "traditional 學習");
  const t = await lookupZh(store, "他們學習中文", 2);
  assert.equal(t.entries[0].note, "simplified 学习");
  const d = await lookupZh(store, "女儿很可爱", 0);
  assert.equal(d.entries[0].reading, "nǚ ér");
  const one = await lookupZh(store, "学习", 0, 1);
  assert.equal(matched(one, "学习"), "学");
});

test("Italian: word span, inflected forms, attached pronouns", async () => {
  assert.deepEqual(wordAt("l'amico mio", 3), { start: 2, end: 7 });
  assert.deepEqual(wordAt("l'amico mio", 0), { start: 0, end: 2 });
  assert.equal(wordAt("ciao!", 4), null);
  assert.ok(cliticCandidates("dimmelo").some(([w]) => w === "di'"));
  assert.ok(cliticCandidates("parlarlo").some(([w]) => w === "parlare"));

  const go = await lookupIt(store, "Andiamo al mare", 0);
  assert.equal(matched(go, "Andiamo al mare"), "Andiamo");
  assert.equal(go.entries[0].term, "andare");
  assert.match(go.entries[0].note, /andiamo/);
  assert.equal((await lookupIt(store, "Parlavamo molto", 0)).entries[0].term, "parlare");
  assert.ok(terms(await lookupIt(store, "Dimmelo subito", 0)).includes("dire"));
  assert.ok(terms(await lookupIt(store, "Non voglio parlarlo", 12)).includes("parlare"));
  assert.equal((await lookupIt(store, "gli amici", 4)).entries[0].term, "amico");
});
