// Runs in the page's own JS world ("world": "MAIN") at document_start, so it sees YouTube's requests and
// player object. It copies the player's subtitle responses and answers a few player calls for the content
// script. Talks to the content script only through window.postMessage. Classic script, no imports.
(() => {
  if (window.__cyberMinerHook) return;
  window.__cyberMinerHook = true;

  const TAG = "__cyberMiner";
  const captured = []; // recent subtitle responses, for a content script that loads after the player
  const MAX_CAPTURED = 30;

  function toContent(message) {
    window.postMessage({ [TAG]: true, dir: "to-content", ...message }, location.origin);
  }

  function isTimedtext(url) {
    return typeof url === "string" && url.includes("/api/timedtext");
  }

  function keep(url, body) {
    const absolute = new URL(url, location.href).toString();
    captured.push({ url: absolute, body });
    if (captured.length > MAX_CAPTURED) captured.shift();
    toContent({ type: "timedtext", url: absolute, body });
  }

  // --- copy subtitle responses (fetch and XHR) ---
  const originalFetch = window.fetch;
  window.fetch = async function (input, init) {
    const response = await originalFetch.apply(this, arguments);
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
      if (isTimedtext(url) && response.ok) response.clone().text().then((body) => keep(url, body), () => {});
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
    if (isTimedtext(this.__cyberMinerUrl)) {
      this.addEventListener("load", () => {
        try {
          if (this.status === 200 && (this.responseType === "" || this.responseType === "text")) keep(this.__cyberMinerUrl, this.responseText);
        } catch {
          // ignore
        }
      });
    }
    return originalSend.apply(this, arguments);
  };

  // --- player calls ---
  function player() {
    return document.getElementById("movie_player");
  }

  function info() {
    const p = player();
    if (!p?.getVideoData) return null;
    const data = p.getVideoData() || {};
    const response = p.getPlayerResponse?.() || {};
    const tracks = response.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    return {
      videoId: data.video_id || "",
      title: data.title || response.videoDetails?.title || "",
      author: data.author || response.videoDetails?.author || "",
      tracks: tracks.map((t) => ({
        languageCode: t.languageCode,
        kind: t.kind || "",
        name: t.name?.simpleText || t.name?.runs?.map((r) => r.text).join("") || "",
      })),
    };
  }

  async function enableTrack({ languageCode, kind }) {
    const p = player();
    if (!p?.setOption) throw new Error("YouTube player not ready");
    p.loadModule?.("captions");
    let list = [];
    for (let i = 0; i < 20 && !list.length; i++) {
      list = p.getOption?.("captions", "tracklist") || [];
      if (!list.length) await new Promise((r) => setTimeout(r, 150));
    }
    const match = list.find((t) => t.languageCode === languageCode && (kind === "asr" ? t.kind === "asr" : t.kind !== "asr"));
    p.setOption("captions", "track", match || { languageCode });
    return Boolean(match);
  }

  const commands = {
    info,
    dump: () => captured,
    enableTrack,
  };

  window.addEventListener("message", async (event) => {
    const msg = event.data;
    if (event.source !== window || !msg || msg[TAG] !== true || msg.dir !== "to-page") return;
    const command = commands[msg.command];
    try {
      if (!command) throw new Error(`Unknown command ${msg.command}`);
      toContent({ type: "reply", id: msg.id, result: await command(msg.args || {}) });
    } catch (e) {
      toContent({ type: "reply", id: msg.id, error: String(e?.message || e) });
    }
  });
})();
