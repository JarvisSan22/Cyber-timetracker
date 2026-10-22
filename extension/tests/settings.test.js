import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, mergeDefaults, getPath, setPath, originPattern, baseUrl } from "../shared/settings.js";
import { readControl } from "../shared/bind.js";

test("mergeDefaults keeps defaults for missing or wrongly typed values", () => {
  const merged = mergeDefaults(DEFAULTS, { anki: { url: "http://x:1", decks: { ja: "JP" } }, cards: { padBeforeMs: "oops" }, extra: 1 });
  assert.equal(merged.anki.url, "http://x:1");
  assert.equal(merged.anki.decks.ja, "JP");
  assert.equal(merged.anki.decks.zh, "Mining::Chinese");
  assert.equal(merged.cards.padBeforeMs, 250);
  assert.equal("extra" in merged, false);
  assert.deepEqual(mergeDefaults(DEFAULTS, undefined), DEFAULTS);
});

test("mergeDefaults replaces arrays and copies them", () => {
  const merged = mergeDefaults(DEFAULTS, { languages: { targets: ["it"] } });
  assert.deepEqual(merged.languages.targets, ["it"]);
  merged.languages.targets.push("ja");
  assert.deepEqual(DEFAULTS.languages.targets, ["ja", "zh", "it"]);
});

test("a moved subtitle bar position survives the merge; null means the default spot", () => {
  assert.deepEqual(mergeDefaults(DEFAULTS, { overlay: { position: { x: 30, y: 60 } } }).overlay.position, { x: 30, y: 60 });
  assert.equal(mergeDefaults(DEFAULTS, { overlay: { position: null } }).overlay.position, null);
  assert.equal(mergeDefaults(DEFAULTS, {}).overlay.position, null);
  assert.equal(mergeDefaults(DEFAULTS, {}).overlay.translation, "blur");
  assert.equal(mergeDefaults(DEFAULTS, { overlay: { translation: "show" } }).overlay.translation, "show");
  // Known words: on by default, mature at 21 days, extra decks kept as stored.
  assert.deepEqual(mergeDefaults(DEFAULTS, {}).known, { enabled: true, sources: [], matureDays: 21, colors: { unknown: "accent", learning: "underline", known: "none" } });
  const src = [{ deck: "Core 2k", field: "Expression", lang: "ja" }];
  assert.deepEqual(mergeDefaults(DEFAULTS, { known: { sources: src } }).known.sources, src);
});

test("dotted paths", () => {
  const obj = { a: { b: 1 } };
  assert.equal(getPath(obj, "a.b"), 1);
  assert.equal(getPath(obj, "a.x.y"), undefined);
  setPath(obj, "a.c.d", 2);
  assert.deepEqual(obj, { a: { b: 1, c: { d: 2 } } });
});

test("originPattern and baseUrl", () => {
  assert.equal(originPattern("http://192.168.0.50:8686/"), "http://192.168.0.50:8686/*");
  assert.equal(originPattern("https://pi.tailnet.ts.net/stats"), "https://pi.tailnet.ts.net/*");
  assert.equal(originPattern("ftp://x"), null);
  assert.equal(originPattern(""), null);
  assert.equal(baseUrl(" http://pi:8686// "), "http://pi:8686");
});

test("readControl handles text, numbers, number selects, checkboxes and array checkboxes", () => {
  const state = structuredClone(DEFAULTS);
  assert.ok(readControl({ dataset: { field: "anki.url" }, type: "url", value: " http://h:1 " }, state));
  assert.equal(state.anki.url, "http://h:1");
  readControl({ dataset: { field: "cards.padAfterMs" }, type: "number", valueAsNumber: 300 }, state);
  assert.equal(state.cards.padAfterMs, 300);
  assert.equal(readControl({ dataset: { field: "cards.padAfterMs" }, type: "number", valueAsNumber: NaN }, state), false);
  readControl({ dataset: { field: "cards.mp3Kbps" }, type: "select-one", value: "128" }, state);
  assert.equal(state.cards.mp3Kbps, 128);
  readControl({ dataset: { field: "tracker.countCards" }, type: "checkbox", checked: false }, state);
  assert.equal(state.tracker.countCards, false);
  readControl({ dataset: { field: "languages.targets" }, type: "checkbox", value: "zh", checked: false }, state);
  assert.deepEqual(state.languages.targets, ["ja", "it"]);
  readControl({ dataset: { field: "languages.targets" }, type: "checkbox", value: "zh", checked: true }, state);
  assert.deepEqual(state.languages.targets, ["ja", "it", "zh"]);
});
