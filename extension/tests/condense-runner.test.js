import { test } from "node:test";
import assert from "node:assert/strict";
import { condenseAudio } from "../content/condense.js";
import { condensedFileName } from "../shared/condense.js";

const settings = { padBeforeMs: 0, padAfterMs: 0, mergeGapMs: 1500 };
const cues = [
  { start_ms: 1000, end_ms: 2000 },
  { start_ms: 10000, end_ms: 11000 },
];
const b64 = (s) => Buffer.from(s).toString("base64");

/** Fake recorder: plays the whole span unless `plan` says otherwise for that call. */
function fakes(plan = []) {
  const calls = [];
  const record = async (video, startMs, endMs, { isCancelled }) => {
    const step = plan[calls.length] ?? {};
    calls.push([startMs, endMs]);
    step.before?.();
    if (step.throw || isCancelled()) throw new Error("Recording cancelled");
    return { data: b64(`${startMs}`), fromMs: startMs, toMs: step.toMs ?? endMs };
  };
  return { calls, record };
}

/** Runs the recording; resolves to the joined parts as text (the fake MP3 of a span is "[start]"). */
const run = async (extra) => {
  const parts = [];
  await condenseAudio({
    video: { duration: 30 },
    cues,
    settings,
    seek: async () => {},
    isAd: () => false,
    isCancelled: () => false,
    encode: async (data) => b64(`[${Buffer.from(data, "base64")}]`),
    onPart: (mp3) => parts.push(Buffer.from(mp3, "base64").toString()),
    ...extra,
  });
  return parts.join("");
};

test("condenseAudio: one recording per span, MP3 parts in order, progress", async () => {
  const { calls, record } = fakes();
  const progress = [];
  const joined = await run({ record, onProgress: (p) => progress.push(p) });
  assert.deepEqual(calls, [[1000, 2000], [10000, 11000]]);
  assert.equal(joined, "[1000][10000]");
  assert.deepEqual(progress, [
    { span: 0, spans: 2, msLeft: 2000 },
    { span: 1, spans: 2, msLeft: 1000 },
    { span: 2, spans: 2, msLeft: 0 },
  ]);
});

test("condenseAudio: a span cut short is redone, and kept after the last attempt", async () => {
  const redo = fakes([{ toMs: 1200 }]);
  assert.equal(await run({ record: redo.record }), "[1000][10000]");
  assert.deepEqual(redo.calls.map((c) => c[0]), [1000, 1000, 10000]);

  const short = fakes([{ toMs: 1200 }, { toMs: 1200 }, { toMs: 1200 }]);
  await run({ record: short.record });
  assert.deepEqual(short.calls.map((c) => c[0]), [1000, 1000, 1000, 10000]);
});

test("condenseAudio: the video ending before the span end is not short", async () => {
  const { calls, record } = fakes([{}, { toMs: 10500 }]);
  await run({ record, video: { duration: 10.5 } });
  assert.equal(calls.length, 2);
});

test("condenseAudio: an ad stops the span; it is recorded again after the ad", async () => {
  let ad = false;
  const { calls, record } = fakes([{ before: () => (ad = true), throw: true }]);
  // the ad is over after the runner has waited once
  const isAd = () => {
    const now = ad;
    if (ad && calls.length === 1) setTimeout(() => (ad = false), 10);
    return now;
  };
  assert.equal(await run({ record, isAd }), "[1000][10000]");
  assert.deepEqual(calls.map((c) => c[0]), [1000, 1000, 10000]);
});

test("condenseAudio: the user moving the video redoes the span, without using up attempts", async () => {
  let jump = false;
  const take = () => {
    const was = jump;
    jump = false;
    return was;
  };
  // the user jumps during the first span twice, then the span plays through
  const { calls, record } = fakes([{ before: () => (jump = true) }, { before: () => (jump = true), toMs: 1100 }]);
  assert.equal(await run({ record, takeJump: take }), "[1000][10000]");
  assert.deepEqual(calls.map((c) => c[0]), [1000, 1000, 1000, 10000]);
});

test("condenseAudio: the video leaving the span (timeline click, no seek event) redoes it and tells", async () => {
  const video = { duration: 30, currentTime: 0 };
  const calls = [];
  let jumps = 0;
  const record = async (v, startMs, endMs, { isCancelled }) => {
    calls.push(startMs);
    v.currentTime = startMs / 1000;
    if (calls.length === 1) v.currentTime = 25; // user clicked far ahead on the timeline
    if (isCancelled()) throw new Error("Recording cancelled");
    v.currentTime = endMs / 1000;
    return { data: b64(`${startMs}`), fromMs: startMs, toMs: endMs };
  };
  assert.equal(await run({ record, video, onJump: () => jumps++ }), "[1000][10000]");
  assert.deepEqual(calls, [1000, 1000, 10000]);
  assert.equal(jumps, 1);
});

test("condenseAudio: cancel stops at once with an error; no subtitles is an error", async () => {
  let cancelled = false;
  const { calls, record } = fakes([{ before: () => (cancelled = true) }]);
  await assert.rejects(run({ record, isCancelled: () => cancelled }), /cancelled/);
  assert.equal(calls.length, 1);
  await assert.rejects(run({ record, cues: [] }), /No subtitle lines/);
});

test("condensedFileName: unsafe characters removed", () => {
  assert.equal(condensedFileName('Show: "S1E3" / part 1?'), "Show S1E3 part 1 (condensed).mp3");
  assert.equal(condensedFileName("  "), "video (condensed).mp3");
});
