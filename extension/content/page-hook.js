// Runs in the page's own JS world ("world": "MAIN") at document_start, so it sees the site's requests and
// player object. Shared part: copies the responses the site file asks for (fetch and XHR) and answers
// commands for the content script. The site file (content/hooks/<site>.js, listed right after this one in
// the manifest) registers which URLs to copy and its player commands. Talks to the content script only
// through window.postMessage. Classic script, no imports.
(() => {
  if (window.__cyberMinerHook) return;
  window.__cyberMinerHook = true;

  const TAG = "__cyberMiner";
  const captured = []; // recent responses, for a content script that loads after the player
  const MAX_CAPTURED = 30;
  /** Set by the site file: wantsUrl(url) picks responses to copy; commands answer the content script. */
  const site = { wantsUrl: (url) => false, onSkipped: null, commands: {} };

  /** Returns keep(url, body), for site files that copy data some other way than by URL. */
  window.__cyberMinerRegister = (def) => {
    delete window.__cyberMinerRegister; // one site per page
    if (def.wantsUrl) site.wantsUrl = def.wantsUrl;
    if (def.onSkipped) site.onSkipped = def.onSkipped;
    Object.assign(site.commands, def.commands || {});
    return { keep };
  };

  function toContent(message) {
    window.postMessage({ [TAG]: true, dir: "to-content", ...message }, location.origin);
  }

  function wanted(url) {
    try {
      return typeof url === "string" && site.wantsUrl(url);
    } catch {
      return false;
    }
  }

  function keep(url, body) {
    const absolute = new URL(url, location.href).toString();
    captured.push({ url: absolute, body });
    if (captured.length > MAX_CAPTURED) captured.shift();
    toContent({ type: "captured", url: absolute, body });
  }

  // --- copy responses (fetch and XHR) ---
  const originalFetch = window.fetch;
  window.fetch = async function (input, init) {
    const response = await originalFetch.apply(this, arguments);
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
      if (wanted(url) && response.ok) response.clone().text().then((body) => keep(url, body), () => {});
    } catch {
      // never break the page
    }
    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__cyberMinerUrl = String(url);
    return originalOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (wanted(this.__cyberMinerUrl)) {
      this.addEventListener("load", () => {
        try {
          if (this.status !== 200) return;
          if (this.responseType === "" || this.responseType === "text") keep(this.__cyberMinerUrl, this.responseText);
          else if (this.responseType === "json") keep(this.__cyberMinerUrl, JSON.stringify(this.response));
          else site.onSkipped?.(this.__cyberMinerUrl, this.responseType);
        } catch {
          // ignore
        }
      });
    }
    return originalSend.apply(this, arguments);
  };

  // --- commands from the content script ---
  site.commands.dump = () => captured;

  window.addEventListener("message", async (event) => {
    const msg = event.data;
    if (event.source !== window || !msg || msg[TAG] !== true || msg.dir !== "to-page") return;
    const command = site.commands[msg.command];
    try {
      if (!command) throw new Error(`Unknown command ${msg.command}`);
      toContent({ type: "reply", id: msg.id, result: await command(msg.args || {}) });
    } catch (e) {
      toContent({ type: "reply", id: msg.id, error: String(e?.message || e) });
    }
  });
})();
