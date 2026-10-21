// Content script entry (isolated world). Content scripts cannot be ES modules, so this loads the real code
// with a dynamic import of the extension's own files (listed in web_accessible_resources).
(async () => {
  try {
    const { start } = await import(chrome.runtime.getURL("content/app.js"));
    await start();
  } catch (e) {
    // After the extension is reloaded, scripts left in already-open tabs can no longer load its files.
    if (!chrome.runtime?.id) console.warn("[Cyber Miner] the extension was reloaded: refresh this tab");
    else console.error("[Cyber Miner] failed to start", e);
  }
})();
