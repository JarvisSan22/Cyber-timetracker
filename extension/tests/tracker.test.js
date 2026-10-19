import { test } from "node:test";
import assert from "node:assert/strict";
import * as tracker from "../background/tracker.js";

test("network errors keep the browser's reason and are retried once", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new TypeError("Failed to fetch");
  };
  await assert.rejects(tracker.health("http://192.168.0.101:8686/"), /not reachable at http:\/\/192\.168\.0\.101:8686 \(TypeError: Failed to fetch\)/);
  assert.equal(calls, 2);

  calls = 0;
  globalThis.fetch = async () => {
    if (++calls === 1) throw new DOMException("signal timed out", "TimeoutError");
    return { ok: true, status: 200, json: async () => ({ status: "ok" }) };
  };
  assert.deepEqual(await tracker.health("http://pi:8686"), { status: "ok" });
  assert.equal(calls, 2);
});

test("HTTP errors carry FastAPI's detail; empty URL is explained", async () => {
  globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({ detail: "Not Found" }) });
  await assert.rejects(tracker.getTheme("http://pi:8686"), /\/api\/theme: HTTP 404 \(Not Found\)/);
  await assert.rejects(tracker.health(""), /No Cyber Tracker URL/);
});
