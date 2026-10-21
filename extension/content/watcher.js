// @ts-check
/** Reports watch time for the current video to the worker (which keeps the Cyber Tracker session).
 * Checks the player once a second instead of listening to media events: our own replays, YouTube's
 * buffering and ads all fire play/pause events, and polling the state is simpler to get right. */

const START_AFTER_MS = 10_000; // a session starts after 10 s of real playback
const BEAT_EVERY_MS = 60_000;

/**
 * @param {{
 *   send: (event: string, info: {videoId: string, title: string, lang: string, site: string}) => void,
 *   getVideo: () => HTMLVideoElement | null,
 *   isAd: () => boolean,
 *   isBusy: () => boolean,  // mining or replaying: keep the session as it is
 *   idleStopMs: () => number,
 *   now?: () => number,
 * }} deps
 */
export function createWatcher({ send, getVideo, isAd, isBusy, idleStopMs, now = () => Date.now() }) {
  /** @type {{videoId: string, title: string, lang: string, site: string} | null} */
  let info = null;
  let started = false;
  let paused = false;
  let playedMs = 0;
  let pausedSince = 0;
  let lastBeat = 0;
  let last = now();

  function tick() {
    const t = now();
    const dt = Math.min(t - last, 5000); // a throttled background tab must not count as long playback
    last = t;
    if (!info || isBusy()) return;
    const video = getVideo();
    const playing = Boolean(video && !video.paused && !video.ended && video.readyState > 2 && !isAd());

    if (playing) {
      if (!started) {
        playedMs += dt;
        if (playedMs >= START_AFTER_MS) {
          started = true;
          lastBeat = t;
          send("start", info);
        }
      } else if (paused) {
        paused = false;
        lastBeat = t;
        send("resume", info);
      } else if (t - lastBeat >= BEAT_EVERY_MS) {
        lastBeat = t;
        send("beat", info);
      }
      return;
    }
    if (!started) return;
    if (video?.ended) return stopSession();
    if (!paused) {
      paused = true;
      pausedSince = t;
      send("pause", info);
    } else if (t - pausedSince >= idleStopMs()) {
      stopSession();
    }
  }

  function stopSession() {
    if (started && info) send("stop", info);
    started = false;
    paused = false;
    playedMs = 0;
  }

  return {
    tick,
    /** A new video with a mined-language track: start counting towards a session. */
    attach(/** @type {{videoId: string, title: string, lang: string, site: string}} */ next) {
      if (info?.videoId !== next.videoId) stopSession();
      info = next;
    },
    /** Left the video (navigation, no target track): end its session. */
    detach() {
      stopSession();
      info = null;
    },
  };
}
