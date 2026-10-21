import { test } from "node:test";
import assert from "node:assert/strict";
import { clampPosition, positionFromPointer } from "../shared/position.js";

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
