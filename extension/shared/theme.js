// @ts-check
/** Theme tokens: bundled presets (from app/config.py) or the tracker's live theme. */

/** @typedef {{name: string, label: string, scheme: string, vars: Record<string, string>}} Theme */

/** @returns {Promise<{default: string, themes: Record<string, Omit<Theme, "name">>}>} */
export async function loadPresets() {
  const res = await fetch(chrome.runtime.getURL("shared/themes.json"));
  return res.json();
}

/**
 * The theme to show: the cached tracker theme in "tracker" mode, else the chosen preset.
 * @param {{default: string, themes: Record<string, Omit<Theme, "name">>}} presets
 * @param {string} mode "tracker" or a preset name
 * @param {Theme | null} trackerTheme last theme fetched from GET /api/theme
 * @returns {Theme}
 */
export function resolveTheme(presets, mode, trackerTheme) {
  if (mode === "tracker" && trackerTheme && trackerTheme.vars) return trackerTheme;
  const name = mode in presets.themes ? mode : presets.default;
  return { name, ...presets.themes[name] };
}

/**
 * Put the theme on a page the same way the tracker does on <html>.
 * @param {HTMLElement} root
 * @param {Theme} theme
 */
export function applyTheme(root, theme) {
  for (const [key, value] of Object.entries(theme.vars)) root.style.setProperty(`--${key}`, value);
  root.dataset.theme = theme.scheme;
  root.dataset.preset = theme.name;
}

/**
 * CSS custom property declarations, e.g. for the Anki card styling.
 * @param {Theme} theme
 */
export function cssVars(theme) {
  return Object.entries(theme.vars)
    .map(([key, value]) => `  --${key}: ${value};`)
    .join("\n");
}
