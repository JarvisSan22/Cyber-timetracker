import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseJson3 } from "../shared/subtitles.js";
import { parseVtt } from "../shared/subformats.js";
import { condensedMs, planSpans } from "../shared/condense.js";

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const opts = { padBeforeMs: 250, padAfterMs: 400, mergeGapMs: 1500, maxSpanMs: 60000 };
const cue = (start_ms, end_ms) => ({ start_ms, end_ms });

test("planSpans: padding, and a start near 0 is not negative", () => {
  assert.deepEqual(planSpans([cue(100, 2000)], opts), [{ startMs: 0, endMs: 2400, firstCue: 0, lastCue: 0 }]);
  assert.deepEqual(planSpans([cue(5000, 7000)], opts), [{ startMs: 4750, endMs: 7400, firstCue: 0, lastCue: 0 }]);
});

test("planSpans: short gaps are kept, long gaps are skipped", () => {
  // padded: [4750, 7400] then [8650, 10400] (gap 1250) then [20000-250, ...] (gap > 1500)
  const spans = planSpans([cue(5000, 7000), cue(8900, 10000), cue(20000, 21000)], opts);
  assert.deepEqual(spans, [
    { startMs: 4750, endMs: 10400, firstCue: 0, lastCue: 1 },
    { startMs: 19750, endMs: 21400, firstCue: 2, lastCue: 2 },
  ]);
  // padded [750, 2400] and [3900, 4700]: a gap of exactly mergeGapMs is skipped, 1 ms less is kept
  assert.equal(planSpans([cue(1000, 2000), cue(4150, 4300)], opts).length, 2);
  assert.equal(planSpans([cue(1000, 2000), cue(4149, 4300)], opts).length, 1);
});

test("planSpans: overlapping lines merge, and split spans never overlap", () => {
  assert.deepEqual(planSpans([cue(1000, 3000), cue(2500, 4000)], opts), [{ startMs: 750, endMs: 4400, firstCue: 0, lastCue: 1 }]);
  const spans = planSpans([cue(1000, 3000), cue(3100, 5000)], { ...opts, maxSpanMs: 3000 });
  assert.equal(spans.length, 2);
  assert.equal(spans[1].startMs, spans[0].endMs);
});

test("planSpans: a line inside the previous span is counted, not recorded again", () => {
  const spans = planSpans([cue(1000, 5000), cue(2000, 3000)], { ...opts, maxSpanMs: 1000 });
  assert.deepEqual(spans, [{ startMs: 750, endMs: 5400, firstCue: 0, lastCue: 1 }]);
});

test("planSpans: spans stop growing at maxSpanMs; one long line stays whole", () => {
  const cues = Array.from({ length: 40 }, (_, k) => cue(k * 3000, k * 3000 + 2500));
  const spans = planSpans(cues, opts);
  assert.ok(spans.every((s) => s.endMs - s.startMs <= 60000));
  assert.equal(spans[0].firstCue, 0);
  assert.equal(spans.at(-1).lastCue, 39);
  assert.deepEqual(planSpans([cue(0, 90000)], opts), [{ startMs: 0, endMs: 90400, firstCue: 0, lastCue: 0 }]);
});

test("condensedMs and real fixtures (YouTube json3, Netflix WebVTT)", () => {
  assert.equal(condensedMs([]), 0);
  assert.equal(condensedMs([{ startMs: 0, endMs: 1000 }, { startMs: 5000, endMs: 5500 }]), 1500);
  for (const cues of [
    parseJson3(fixture("youtube-ja-manual.json3.json"), "ja", "primary"),
    parseVtt(fixture("netflix.vtt"), "ja", "primary"),
  ]) {
    const spans = planSpans(cues, opts);
    assert.ok(spans.length >= 1);
    assert.equal(spans[0].firstCue, 0);
    assert.equal(spans.at(-1).lastCue, cues.length - 1);
    spans.forEach((s, k) => k && assert.ok(s.startMs >= spans[k - 1].endMs));
  }
});
