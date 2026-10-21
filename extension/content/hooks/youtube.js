// YouTube part of the page hook (MAIN world, runs right after content/page-hook.js): copy the player's
// /api/timedtext responses, and answer player calls. Classic script, no imports.
(() => {
  const register = window.__cyberMinerRegister;
  if (!register) return;

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
      show: data.author || response.videoDetails?.author || "",
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

  register({
    wantsUrl: (url) => url.includes("/api/timedtext"),
    commands: { info, enableTrack },
  });
})();
