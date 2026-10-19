import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveTheme, cssVars } from "../shared/theme.js";

const presets = JSON.parse(readFileSync(new URL("../shared/themes.json", import.meta.url)));

test("bundled presets match the tracker's five themes", () => {
  assert.equal(presets.default, "cyberpunk");
  assert.deepEqual(Object.keys(presets.themes), ["cyberpunk", "netrunner", "terminal", "sakura", "arasaka"]);
  for (const t of Object.values(presets.themes)) {
    for (const key of ["bg", "card", "text", "accent", "accent-2", "accent-ink", "font-body", "font-mono"]) assert.ok(t.vars[key], key);
  }
});

test("resolveTheme: tracker theme when cached, else preset, else default", () => {
  const live = { name: "sakura", label: "Japan sakura", scheme: "light", vars: { accent: "#ff00aa" } };
  assert.equal(resolveTheme(presets, "tracker", live), live);
  assert.equal(resolveTheme(presets, "tracker", null).name, "cyberpunk");
  assert.equal(resolveTheme(presets, "terminal", live).name, "terminal");
  assert.equal(resolveTheme(presets, "gone", null).name, "cyberpunk");
});

test("cssVars", () => {
  assert.equal(cssVars({ name: "x", label: "", scheme: "dark", vars: { bg: "#000", "accent-2": "#fff" } }), "  --bg: #000;\n  --accent-2: #fff;");
});
