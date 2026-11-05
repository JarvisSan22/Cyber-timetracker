// Page reader entry (M8), registered on every site while the reader is on, and injected into open tabs
// when it is switched on. Content scripts cannot be ES modules, so this loads the real code with a dynamic
// import (content/reader.js, listed in web_accessible_resources). Injected twice: runs once.
(async () => {
  if (/** @type {any} */ (globalThis).__cyberMinerReader) return;
  /** @type {any} */ (globalThis).__cyberMinerReader = true;
  try {
    const { start } = await import(chrome.runtime.getURL("content/reader.js"));
    await start();
  } catch (e) {
    if (!chrome.runtime?.id) console.warn("[Cyber Miner] the extension was reloaded: refresh this tab");
    else console.error("[Cyber Miner] page reader failed to start", e);
  }
})();
