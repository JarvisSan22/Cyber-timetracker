import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULTS } from "../shared/settings.js";
import { resolveTheme } from "../shared/theme.js";
import {
  FIELDS, FRONT, BACK, buildFields, buildNote, buildTags, cardCss, escapeHtml, highlightWord, noteTypeModel, tagPart, localDate,
} from "../shared/card.js";

const presets = JSON.parse(readFileSync(new URL("../shared/themes.json", import.meta.url)));
const theme = resolveTheme(presets, "tracker", null);

test("sentence is escaped and the target word bolded once", () => {
  assert.equal(highlightWord("食べられなかった。食べる", "食べ"), "<b>食べ</b>られなかった。食べる");
  assert.equal(highlightWord("a <b> & c", ""), "a &lt;b&gt; &amp; c");
  assert.equal(highlightWord("x < y", "<"), "x <b>&lt;</b> y");
  assert.equal(highlightWord("ciao", "mondo"), "ciao");
});

test("selected range is bolded as it appears; Word can be the dictionary form", () => {
  assert.equal(highlightWord("昨日は食べられなかった", "食べる", { start: 3, end: 11 }), "昨日は<b>食べられなかった</b>");
  assert.equal(highlightWord("a<b", "x", { start: 1, end: 2 }), "a<b>&lt;</b>b");
  assert.equal(highlightWord("魔法", "魔法", { start: 0, end: 9 }), "<b>魔法</b>"); // bad range: fall back to the word
  const f = buildFields({ lang: "ja", sentence: "昨日は食べられなかった", word: "食べる", wordReading: "食[た]べる", highlight: { start: 3, end: 11 } });
  assert.equal(f.Sentence, "昨日は<b>食べられなかった</b>");
  assert.equal(f.Word, "食べる");
});

test("fields: Japanese gets a reading even when only the word was typed", () => {
  const f = buildFields({ lang: "ja", sentence: "魔法を使う ", word: "魔法" });
  assert.deepEqual(Object.keys(f), FIELDS);
  assert.equal(f.Sentence, "<b>魔法</b>を使う");
  assert.equal(f.WordReading, "魔法");
  assert.equal(f.Lang, "ja");
  assert.equal(buildFields({ lang: "zh", sentence: "我在学习", word: "学习" }).WordReading, "");
  assert.equal(buildFields({ lang: "ja", sentence: "x", word: "食べる", wordReading: "食[た]べる" }).WordReading, "食[た]べる");
});

test("fields: definitions, notes and escaping", () => {
  const f = buildFields({ lang: "it", sentence: "Dimmelo", definitions: ["tell me (it)", "", "<x>"], notes: "line 1\nline 2", source: "A & B" });
  assert.equal(f.WordDefinition, "<ol><li>tell me (it)</li><li>&lt;x&gt;</li></ol>");
  assert.equal(f.Notes, "line 1<br>line 2");
  assert.equal(f.Source, "A &amp; B");
  assert.equal(buildFields({ lang: "it", sentence: "x" }).WordDefinition, "");
});

test("tags", () => {
  assert.equal(tagPart("  Frieren: Beyond Journey's End  "), "Frieren_Beyond_Journey's_End");
  assert.equal(tagPart('a::b "c"'), "a_b_c");
  const now = new Date(2026, 9, 16, 23, 30);
  assert.equal(localDate(now), "2026-10-16");
  assert.deepEqual(buildTags({ lang: "ja", sentence: "", site: "YouTube", show: "日本語の森" }, now), [
    "cyber-miner", "youtube", "show::日本語の森", "mined::2026-10-16",
  ]);
  assert.deepEqual(buildTags({ lang: "ja", sentence: "" }, now), ["cyber-miner", "mined::2026-10-16"]);
});

test("note goes to the language's deck with media for AnkiConnect", () => {
  const note = buildNote(
    { lang: "zh", sentence: "你好", audio: { data: "QUJD", ext: "mp3" }, picture: { data: "REVG", ext: "jpg" } },
    DEFAULTS,
    { now: new Date(2026, 9, 16), id: "abc" },
  );
  assert.equal(note.deckName, "Mining::Chinese");
  assert.equal(note.modelName, "Cyber Sentence");
  assert.deepEqual(note.options, { allowDuplicate: false, duplicateScope: "deck" });
  assert.deepEqual(note.audio, [{ data: "QUJD", filename: "cyber_abc.mp3", fields: ["Audio"] }]);
  assert.deepEqual(note.picture, [{ data: "REVG", filename: "cyber_abc.jpg", fields: ["Picture"] }]);
  assert.deepEqual(buildNote({ lang: "it", sentence: "x" }, DEFAULTS).audio, []);
});

test("note type uses every field and the theme's colors", () => {
  const model = noteTypeModel("Cyber Sentence", theme);
  assert.deepEqual(model.inOrderFields, FIELDS);
  for (const field of FIELDS) assert.ok(FRONT.includes(`{{${field}}}`) || BACK.includes(field), field);
  assert.ok(BACK.includes("{{furigana:WordReading}}"));
  const css = cardCss(theme);
  assert.ok(css.includes("--accent: #fcee0a;"));
  assert.ok(css.includes('url("_cyber_rajdhani-600.woff2")'));
  assert.ok(cardCss(resolveTheme(presets, "sakura", null)).includes("--accent: #e4507c;"));
});

test("escapeHtml", () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
});

test("pitch accent graph for Japanese words", async () => {
  const { furiganaKana, morae, pitchPattern, pitchHtml } = await import("../shared/card.js");
  assert.equal(furiganaKana("食[た]べる"), "たべる");
  assert.equal(furiganaKana("お 茶[ちゃ]"), "おちゃ");
  assert.deepEqual(morae("きょう"), ["きょ", "う"]);
  assert.deepEqual(pitchPattern(3, 0), [false, true, true, true]); // heiban: particle stays high
  assert.deepEqual(pitchPattern(3, 1), [true, false, false, false]); // atamadaka
  assert.deepEqual(pitchPattern(3, 2), [false, true, false, false]); // 食べる [2]
  assert.deepEqual(pitchPattern(2, 2), [false, true, false]); // odaka: drop on the particle
  const svg = pitchHtml("たべる", [2]);
  assert.equal((svg.match(/<circle/g) || []).length, 4);
  assert.ok(svg.includes("[2]"));
  const f = buildFields({ lang: "ja", sentence: "食べる", word: "食べる", wordReading: "食[た]べる", pitch: [2] });
  assert.ok(f.WordPitch.startsWith("<svg"));
  assert.equal(buildFields({ lang: "zh", sentence: "学习", word: "学习", pitch: [2] }).WordPitch, "");
});
