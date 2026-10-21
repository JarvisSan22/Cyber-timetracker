// Netflix part of the page hook (MAIN world, runs right after content/page-hook.js). Classic script, no imports.
// - Subtitles: the player's manifest lists every subtitle track with download URLs. It travels encrypted
//   (MSL), so it is caught after the player decrypts it: JSON.parse (and Response.json) are watched for a
//   result with `timedtexttracks` (older) or `textTracks` (newer) and a movieId. Only {movieId,
//   timedtexttracks, audio} is passed on.
// - Text formats: the manifest request (JSON.stringify of an object whose `url` names the manifest) lists
//   the subtitle formats the player accepts; adding ours makes Netflix list them. showAllSubDubTracks
//   asks for every language, not only the ones Netflix would show for this region and profile.
// - Title: /metadata responses (plain JSON) are copied by URL.
// - Seek: setting video.currentTime breaks Netflix's player (error M7375); its own player API seeks.
(() => {
  const register = window.__cyberMinerRegister;
  if (!register) return;

  const EXTRA_PROFILES = ["imsc1.1", "dfxp-ls-sdh", "webvtt-lssdh-ios8", "simplesdh"]; // same as shared/netflix.js

  const { keep } = register({
    wantsUrl: (url) => url.includes("/metadata?"),
    commands: { seek, playerReady, audioLang },
  });

  function inspect(obj) {
    try {
      const r = obj?.result;
      const tracks = r && (r.timedtexttracks || r.textTracks);
      if (!Array.isArray(tracks) || r.movieId === undefined) return;
      const audio = (r.audio_tracks || r.audioTracks || []).map((a) => ({
        language: a.language || "",
        original: Boolean(a.isNative) || /original/i.test(a.languageDescription || ""),
      }));
      console.info("[Cyber Miner hook] manifest", r.movieId, tracks.length, "subtitle tracks");
      keep("netflix:manifest", originalStringify({ movieId: String(r.movieId), timedtexttracks: tracks, audio }));
    } catch {
      // never break the page
    }
  }

  const originalParse = JSON.parse;
  JSON.parse = function (text) {
    const value = originalParse.apply(this, arguments);
    if (typeof text === "string" && text.length > 200 && (text.includes('"timedtexttracks"') || text.includes('"textTracks"'))) inspect(value);
    return value;
  };

  const originalJson = Response.prototype.json;
  Response.prototype.json = function () {
    return originalJson.apply(this, arguments).then((value) => {
      inspect(value);
      return value;
    });
  };

  const originalStringify = JSON.stringify;
  JSON.stringify = function (value) {
    try {
      if (value && typeof value.url === "string" && /manifest/i.test(value.url)) {
        for (const v of Object.values(value)) {
          if (!v || !Array.isArray(v.profiles)) continue;
          for (const p of EXTRA_PROFILES) if (!v.profiles.includes(p)) v.profiles.unshift(p);
          if (v.showAllSubDubTracks != null) v.showAllSubDubTracks = true;
          console.info("[Cyber Miner hook] asked for text subtitle formats");
        }
      }
    } catch {
      // ignore
    }
    return originalStringify.apply(this, arguments);
  };

  function videoPlayer() {
    const api = window.netflix?.appContext?.state?.playerApp?.getAPI?.()?.videoPlayer;
    const ids = api?.getAllPlayerSessionIds?.() || [];
    const id = ids.find((i) => String(i).startsWith("watch")) ?? ids[ids.length - 1];
    return id ? api.getVideoPlayerBySessionId(id) : null;
  }

  function playerReady() {
    return Boolean(videoPlayer());
  }

  /** Language of the audio track playing now ("ja", "en"), "" when unknown. */
  function audioLang() {
    const track = videoPlayer()?.getAudioTrack?.();
    return track?.bcp47 || track?.language || "";
  }

  function seek({ ms }) {
    const player = videoPlayer();
    if (!player) throw new Error("Netflix player not ready");
    player.seek(Math.max(0, Math.round(ms)));
    return true;
  }
})();
