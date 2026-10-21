import { test } from "node:test";
import assert from "node:assert/strict";
import { createWatcher } from "../content/watcher.js";

function setup() {
  let t = 0;
  const events = [];
  const video = { paused: false, ended: false, readyState: 4 };
  const flags = { ad: false, busy: false };
  const watcher = createWatcher({
    send: (event) => events.push(event),
    getVideo: () => video,
    isAd: () => flags.ad,
    isBusy: () => flags.busy,
    idleStopMs: () => 600_000,
    now: () => t,
  });
  const run = (seconds) => {
    for (let i = 0; i < seconds; i++) {
      t += 1000;
      watcher.tick();
    }
  };
  watcher.attach({ videoId: "abc", title: "T", lang: "ja", site: "youtube" });
  return { events, video, flags, watcher, run };
}

test("starts after 10 s of playback, beats every minute, pauses and resumes", () => {
  const { events, video, run } = setup();
  run(9);
  assert.deepEqual(events, []);
  run(1);
  assert.deepEqual(events, ["start"]);
  run(60);
  assert.deepEqual(events, ["start", "beat"]);
  video.paused = true;
  run(5);
  video.paused = false;
  run(1);
  assert.deepEqual(events, ["start", "beat", "pause", "resume"]);
});

test("ads count as paused; mining and replays change nothing", () => {
  const { events, flags, video, run } = setup();
  run(10);
  flags.ad = true;
  run(3);
  flags.ad = false;
  run(1);
  flags.busy = true;
  video.paused = true;
  run(30);
  assert.deepEqual(events, ["start", "pause", "resume"]);
});

test("ten minutes paused or the end of the video stops the session; leaving stops it too", () => {
  const { events, video, watcher, run } = setup();
  run(10);
  video.paused = true;
  run(600); // the pause is seen on the first of these ticks: 599 s paused so far
  assert.deepEqual(events, ["start", "pause"]);
  run(1);
  assert.deepEqual(events, ["start", "pause", "stop"]);
  video.paused = false;
  run(10);
  video.ended = true;
  run(1);
  assert.deepEqual(events.slice(3), ["start", "stop"]);
  video.ended = false;
  run(10);
  watcher.detach();
  assert.deepEqual(events.slice(5), ["start", "stop"]);
});

test("a short look at a video starts nothing; a new video stops the old session", () => {
  const { events, watcher, run } = setup();
  run(5);
  watcher.attach({ videoId: "next", title: "N", lang: "ja", site: "youtube" });
  run(5);
  assert.deepEqual(events, []);
  run(5);
  watcher.attach({ videoId: "third", title: "3", lang: "ja", site: "youtube" });
  assert.deepEqual(events, ["start", "stop"]);
});
