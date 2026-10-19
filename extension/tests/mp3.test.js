import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { encodeMp3 } from "../shared/mp3.js";

// Load the vendored lamejs the way the offscreen page does (a classic script defining a global).
const context = vm.createContext({});
vm.runInContext(readFileSync(new URL("../vendor/lame.min.js", import.meta.url), "utf8") + ";this.lamejs = lamejs;", context);

test("stereo PCM becomes a mono MP3 of the expected size", () => {
  const rate = 44100;
  const left = new Float32Array(rate * 2).map((_, i) => Math.sin((i / rate) * 2 * Math.PI * 440) * 0.5);
  const right = left.map((v) => -v * 0.5);
  const mp3 = encodeMp3(context.lamejs, { numberOfChannels: 2, sampleRate: rate, length: left.length, getChannelData: (c) => (c ? right : left) }, 96);
  assert.equal(mp3[0], 0xff); // MPEG frame sync
  assert.equal(mp3[1] & 0xe0, 0xe0);
  // 2 s at 96 kbit/s is about 24 KB.
  assert.ok(mp3.length > 20000 && mp3.length < 28000, String(mp3.length));
});
