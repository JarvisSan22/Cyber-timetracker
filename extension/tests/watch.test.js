import { test } from "node:test";
import assert from "node:assert/strict";
import * as realTracker from "../background/tracker.js";
import { createWatchService } from "../background/watch.js";
import { DEFAULTS } from "../shared/settings.js";

const { TrackerError } = realTracker;
const unreachable = () => new TrackerError("Cyber Tracker is not reachable at http://pi:8686 (TypeError: Failed to fetch).");
const refused = () => new TrackerError("Cyber Tracker /api/sessions/5/resume: HTTP 409 (Session is not paused)");

/** Fake world: clock, storage, tracker that records calls and can be switched offline. */
function world({ projects = { ja: 3, zh: 0, it: 0 } } = {}) {
  let t = Date.parse("2026-10-20T10:00:00Z");
  const store = {};
  const calls = [];
  const w = {
    offline: false,
    /** @type {null | ((name: string, args: any[]) => any)} */
    refuse: null,
    calls,
    store,
    advance: (ms) => (t += ms),
  };
  const net = (name, result) => async (...args) => {
    if (w.offline) throw unreachable();
    const r = w.refuse?.(name, args);
    if (r) throw r;
    calls.push([name, ...args.slice(1)]);
    return typeof result === "function" ? result(...args) : result;
  };
  let nextSession = 5;
  const tracker = {
    ...realTracker,
    tagIds: net("tagIds", (_u, _p, names) => names.map((_, i) => 100 + i)),
    startSession: net("startSession", () => ({ id: nextSession++ })),
    sessionAction: net("sessionAction", null),
    patchSession: net("patchSession", null),
    addPastSession: net("addPastSession", () => ({ id: 50 })),
    postCard: net("postCard", () => ({ id: 1 })),
  };
  const settings = structuredClone(DEFAULTS);
  settings.tracker.url = "http://pi:8686";
  settings.tracker.projects = projects;
  const service = createWatchService({
    tracker,
    storage: {
      get: async (key) => (key in store ? { [key]: structuredClone(store[key]) } : {}),
      set: async (items) => Object.assign(store, structuredClone(items)),
    },
    loadSettings: async () => settings,
    now: () => new Date(t),
  });
  return { w, service, settings };
}

const video = { videoId: "abc", title: "Frieren S1E3", lang: "ja", site: "youtube" };
const iso = (ms) => new Date(Date.parse("2026-10-20T10:00:00Z") + ms).toISOString();

test("a watched video becomes one session with the right pauses", async () => {
  const { w, service } = world();
  await service.onEvent(7, { event: "start", ...video });
  assert.deepEqual(w.calls[0], ["tagIds", 3, ["Watching", "YouTube"]]);
  assert.deepEqual(w.calls[1], ["startSession", { project_id: 3, title: "Frieren S1E3", tag_ids: [100, 101] }]);
  w.advance(60_000);
  await service.onEvent(7, { event: "pause" });
  w.advance(30_000);
  await service.onEvent(7, { event: "resume" });
  const st = await service.status(7);
  assert.deepEqual([st.state, st.elapsedMs, st.offline], ["watching", 60_000, false]);
  w.advance(120_000);
  await service.onEvent(7, { event: "stop" });
  assert.deepEqual(w.calls.slice(-2), [
    ["sessionAction", 5, "stop"],
    ["patchSession", 5, { ended_at: iso(210_000), paused_sec: 30 }],
  ]);
  assert.equal((await service.status(7)).state, "idle");
});

test("a paused session that idles out ends where the pause began", async () => {
  const { w, service } = world();
  await service.onEvent(7, { event: "start", ...video });
  w.advance(90_000);
  await service.onEvent(7, { event: "pause" });
  w.advance(600_000);
  await service.onEvent(7, { event: "stop" });
  assert.deepEqual(w.calls.at(-1), ["patchSession", 5, { ended_at: iso(90_000), paused_sec: 0 }]);
});

test("closing the tab ends the session at the last heartbeat", async () => {
  const { w, service } = world();
  await service.onEvent(7, { event: "start", ...video });
  w.advance(60_000);
  await service.onEvent(7, { event: "beat" });
  w.advance(45_000);
  await service.tabClosed(7);
  assert.deepEqual(w.calls.at(-1), ["patchSession", 5, { ended_at: iso(60_000), paused_sec: 0 }]);
});

test("languages without a project are not logged, and the popup says so", async () => {
  const { w, service } = world();
  await service.onEvent(7, { event: "start", ...video, lang: "zh" });
  assert.equal(w.calls.length, 0);
  assert.deepEqual(await service.status(7), { state: "unmapped", lang: "zh", message: undefined, waiting: 0 });
});

test("offline: kept locally, sent as a past session when the tracker is back", async () => {
  const { w, service } = world();
  w.offline = true;
  await service.onEvent(7, { event: "start", ...video });
  assert.equal((await service.status(7)).offline, true);
  w.advance(300_000);
  await service.onEvent(7, { event: "pause" });
  w.advance(60_000);
  await service.onEvent(7, { event: "resume" });
  w.advance(100_000);
  await service.onEvent(7, { event: "stop" });
  assert.equal((await service.status(7)).waiting, 1);
  w.offline = false;
  assert.equal(await service.flush(), 0);
  assert.deepEqual(w.calls[1], ["addPastSession", {
    project_id: 3, title: "Frieren S1E3", started_at: iso(0), ended_at: iso(460_000),
    note: "Logged by Cyber Miner while the tracker was unreachable", tag_ids: [100, 101],
  }]);
  assert.deepEqual(w.calls[2], ["patchSession", 50, { paused_sec: 60 }]);
});

test("a session stopped in the tracker meanwhile is replaced on resume", async () => {
  const { w, service } = world();
  await service.onEvent(7, { event: "start", ...video });
  await service.onEvent(7, { event: "pause" });
  w.refuse = (name) => (name === "sessionAction" ? refused() : null);
  await service.onEvent(7, { event: "resume" });
  w.refuse = null;
  assert.equal(w.calls.filter((c) => c[0] === "startSession").length, 2);
});

test("mined cards are counted with the tab's session, or without it if it is gone", async () => {
  const { w, service, settings } = world();
  await service.onEvent(7, { event: "start", ...video });
  await service.countCard(7, { lang: "ja", site: "youtube", source: "Frieren S1E3 · 12:41", word: "魔法" }, 1760000000000);
  assert.deepEqual(w.calls.at(-1), ["postCard", {
    project_id: 3, session_id: 5, created_at: iso(0), site: "youtube", source_title: "Frieren S1E3", word: "魔法", anki_note_id: 1760000000000,
  }]);
  let first = true;
  w.refuse = (name, args) => (name === "postCard" && args[1].session_id && first ? ((first = false), new TrackerError("Cyber Tracker /api/cards: HTTP 404 (Session 5 not found)")) : null);
  await service.countCard(7, { lang: "ja" }, null);
  assert.equal(w.calls.at(-1)[1].session_id, null);
  settings.tracker.countCards = false;
  const before = w.calls.length;
  await service.countCard(7, { lang: "ja" }, null);
  assert.equal(w.calls.length, before);
});

test("sessions left by a closed browser end at their last heartbeat", async () => {
  const { w, service } = world();
  await service.onEvent(7, { event: "start", ...video });
  w.advance(30_000);
  await service.onEvent(7, { event: "beat" });
  w.advance(3_600_000);
  await service.endLeftovers();
  assert.deepEqual(w.calls.at(-1), ["patchSession", 5, { ended_at: iso(30_000), paused_sec: 0 }]);
});

test("mining during a session adds the mining tag once", async () => {
  const { w, service } = world();
  await service.onEvent(7, { event: "start", ...video });
  await service.countCard(7, { lang: "ja", site: "youtube", word: "魔法" }, 1);
  await service.countCard(7, { lang: "ja", site: "youtube", word: "勉強" }, 2);
  const tagCalls = w.calls.filter((c) => c[0] === "tagIds").map((c) => c[2]); // [name, projectId, names]
  assert.deepEqual(tagCalls.at(-1), ["Watching", "YouTube", "Mining"]);
  const patches = w.calls.filter((c) => c[0] === "patchSession" && c[2].tag_ids); // [name, sessionId, patch]
  assert.equal(patches.length, 1);
  assert.equal(patches[0][1], 5);
  assert.deepEqual(patches[0][2].tag_ids, [100, 101, 102]);
});
