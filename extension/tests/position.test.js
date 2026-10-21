import { test } from "node:test";
import assert from "node:assert/strict";
import { clampPosition, positionFromPointer } from "../shared/position.js";
import { pictureRect, isBlack } from "../shared/frame.js";

const player = { left: 100, top: 50, width: 1000, height: 500 };
const bar = { width: 400, height: 50 };

test("the grabbed point stays under the pointer", () => {
  // Bar grabbed 30 px from its left and 20 px from its top, dropped with the pointer at (600, 300).
  const pos = positionFromPointer(600, 300, { x: 30, y: 20 }, player, bar);
  // Bar left edge at 570 -> centre 770 -> 67 % of the player; bar bottom at 330 -> 220 px above the player bottom -> 44 %.
  assert.deepEqual(pos, { x: 67, y: 44 });
});

test("the bar never leaves the player", () => {
  assert.deepEqual(clampPosition({ x: 0, y: -10 }, player, bar), { x: 20, y: 0 }); // left and bottom edges
  assert.deepEqual(clampPosition({ x: 100, y: 100 }, player, bar), { x: 80, y: 90 }); // right and top edges
  assert.deepEqual(positionFromPointer(-500, -500, { x: 0, y: 0 }, player, bar), { x: 20, y: 90 });
});

test("a smaller player (or a wider bar) re-clamps the same position", () => {
  const small = { left: 0, top: 0, width: 500, height: 300 };
  assert.deepEqual(clampPosition({ x: 80, y: 90 }, small, bar), { x: 60, y: 83.33 });
  assert.deepEqual(clampPosition({ x: 10, y: 5 }, small, { width: 900, height: 50 }), { x: 50, y: 5 }); // bar wider than the player: centred
  assert.deepEqual(clampPosition({ x: 30, y: 30 }, { left: 0, top: 0, width: 0, height: 0 }, bar), { x: 30, y: 30 }); // player not laid out yet
});

test("picture rectangle inside a letterboxed video element", () => {
  // 16:9 video in a wide element: bars left and right.
  assert.deepEqual(pictureRect({ left: 0, top: 100, width: 2000, height: 900 }, 1920, 1080), { left: 200, top: 100, width: 1600, height: 900 });
  // 2.39:1 film in a 16:9 element: bars top and bottom.
  const r = pictureRect({ left: 0, top: 0, width: 1600, height: 900 }, 1920, 803);
  assert.equal(r.width, 1600);
  assert.ok(Math.abs(r.top - (900 - 1600 * 803 / 1920) / 2) < 1e-9);
  // Unknown size: the element itself.
  assert.deepEqual(pictureRect({ left: 1, top: 2, width: 3, height: 4 }, 0, 0), { left: 1, top: 2, width: 3, height: 4 });
});

test("black frame check", () => {
  assert.equal(isBlack(new Uint8ClampedArray(4000)), true);
  const px = new Uint8ClampedArray(4000);
  px.fill(200);
  assert.equal(isBlack(px), false);
});
