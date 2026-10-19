import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as anki from "../background/anki.js";
import { FIELDS } from "../shared/card.js";
import { resolveTheme } from "../shared/theme.js";

const presets = JSON.parse(readFileSync(new URL("../shared/themes.json", import.meta.url)));
const theme = resolveTheme(presets, "tracker", null);
const conn = { url: "http://127.0.0.1:8765", apiKey: "", noteType: "Cyber Sentence" };

/** Fake AnkiConnect: answers per action, records every call. */
let calls;
let answers;
beforeEach(() => beforeEachFetch());
function beforeEachFetch() {
  calls ??= [];
  answers ??= {};
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const answer = answers[body.action];
    if (answer instanceof Error) throw answer;
    const reply = typeof answer === "function" ? answer(body.params) : answer;
    return { ok: true, status: 200, json: async () => reply ?? { result: null, error: null } };
  };
}
beforeEach(() => {
  calls = [];
  answers = {};
});

test("invoke sends version 6 and the API key, and surfaces errors", async () => {
  answers.deckNames = { result: ["Default"], error: null };
  assert.deepEqual(await anki.invoke({ ...conn, apiKey: "k" }, "deckNames"), ["Default"]);
  assert.deepEqual(calls[0], { action: "deckNames", version: 6, params: {}, key: "k" });

  answers.addNote = { result: null, error: "cannot create note because it is a duplicate" };
  await assert.rejects(anki.invoke(conn, "addNote"), /duplicate/);

  globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => null });
  await assert.rejects(anki.invoke(conn, "deckNames"), /not allowed Cyber Miner yet/);
  beforeEachFetch();

  answers.version = new TypeError("fetch failed");
  await assert.rejects(anki.invoke(conn, "version"), /not reachable/);
});

test("connect checks permission and reads decks and note types", async () => {
  answers.requestPermission = { result: { permission: "granted", requireApikey: false, version: 6 }, error: null };
  answers.version = { result: 6, error: null };
  answers.deckNames = { result: ["Mining::Japanese"], error: null };
  answers.modelNames = { result: ["Basic"], error: null };
  assert.deepEqual(await anki.connect(conn), { version: 6, decks: ["Mining::Japanese"], noteTypeExists: false });

  answers.requestPermission = { result: { permission: "denied" }, error: null };
  await assert.rejects(anki.connect(conn), /denied/);
  answers.requestPermission = { result: { permission: "granted", requireApikey: true }, error: null };
  await assert.rejects(anki.connect(conn), /API key/);
  answers.requestPermission = { result: { permission: "granted", requireApiKey: true }, error: null };
  await assert.rejects(anki.connect(conn), /API key/);
});

test("ensureDecks creates only missing decks", async () => {
  answers.deckNames = { result: ["Mining::Japanese"], error: null };
  assert.deepEqual(await anki.ensureDecks(conn, ["Mining::Japanese", "Mining::Italian"]), ["Mining::Italian"]);
  assert.deepEqual(calls.filter((c) => c.action === "createDeck").map((c) => c.params.deck), ["Mining::Italian"]);
});

test("ensureNoteType creates the model, or adds missing fields in place", async () => {
  answers.modelNames = { result: ["Basic"], error: null };
  assert.equal(await anki.ensureNoteType(conn, theme), "created");
  const create = calls.find((c) => c.action === "createModel");
  assert.deepEqual(create.params.inOrderFields, FIELDS);

  calls.length = 0;
  answers.modelNames = { result: ["Cyber Sentence"], error: null };
  answers.modelFieldNames = { result: FIELDS.filter((f) => f !== "Lang" && f !== "Notes"), error: null };
  assert.equal(await anki.ensureNoteType(conn, theme), "updated");
  assert.deepEqual(
    calls.filter((c) => c.action === "modelFieldAdd").map((c) => [c.params.fieldName, c.params.index]),
    [["Lang", 10], ["Notes", 11]],
  );

  answers.modelFieldNames = { result: FIELDS, error: null };
  assert.equal(await anki.ensureNoteType(conn, theme), "ok");
});

test("pushTheme updates styling and templates; storeFonts sends base64", async () => {
  await anki.pushTheme(conn, theme);
  assert.deepEqual(calls.map((c) => c.action), ["updateModelStyling", "updateModelTemplates"]);
  assert.ok(calls[0].params.model.css.includes("--accent"));
  assert.ok(calls[1].params.model.templates.Recognition.Back.includes("{{FrontSide}}"));

  calls.length = 0;
  await anki.storeFonts(conn, async () => new TextEncoder().encode("font").buffer);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].params.data, Buffer.from("font").toString("base64"));
  assert.ok(calls[0].params.filename.startsWith("_cyber_"));
});

test("toBase64 handles large buffers", () => {
  const big = new Uint8Array(100000).map((_, i) => i % 256);
  assert.equal(anki.toBase64(big.buffer), Buffer.from(big).toString("base64"));
});
