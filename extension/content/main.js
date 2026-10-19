// Content script entry (isolated world). Content scripts cannot be ES modules, so this loads the real code
// with a dynamic import of the extension's own files (listed in web_accessible_resources).
(async () => {
  try {
    const { start } = await import(chrome.runtime.getURL("content/app.js"));
    await start();
  } catch (e) {
    console.error("[Cyber Miner] failed to start", e);
  }
})();
