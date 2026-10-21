// @ts-check
/** Watch time -> Cyber Tracker sessions, one per tab, and mined-card counts. Runs in the service worker.
 *
 * The content script reports start (after 10 s of playback), pause, resume, beat (every minute while
 * playing) and stop. Pauses are also counted here, so the session can be corrected at the end even when
 * the tracker missed a pause call. When the tracker cannot be reached the session is kept locally and sent
 * later as a past session; failed calls wait in a queue that is retried every few minutes. Records live in
 * storage.local so a session left running when the browser closed is ended at its last heartbeat. */

/**
 * @typedef {object} WatchRecord
 * @property {number} tabId
 * @property {string} videoId
 * @property {string} title
 * @property {string} lang
 * @property {string} site
 * @property {number} projectId
 * @property {string[]} tags
 * @property {number | null} sessionId null while offline
 * @property {string} startedAt ISO
 * @property {string | null} pausedAt ISO while paused
 * @property {number} pausedMs finished pauses
 * @property {string} lastSeenAt ISO, last heartbeat while playing
 */

/**
 * @typedef {{kind: "finish", sessionId: number, ended_at: string, paused_sec: number}
 *   | {kind: "past", body: {project_id: number, title: string, started_at: string, ended_at: string, note: string}, tags: string[], paused_sec: number}
 *   | {kind: "card", body: object}} QueueItem
 */

const RECORDS = "watch"; // {[tabId]: WatchRecord}
const QUEUE = "trackerQueue"; // QueueItem[]
const STATUS = "watchStatus"; // {[tabId]: {state: "unmapped" | "error", lang?: string, message?: string}}
const MIN_SESSION_MS = 10000;

/**
 * @param {{
 *   tracker: typeof import("./tracker.js"),
 *   storage: {get: (key: string) => Promise<Record<string, any>>, set: (items: Record<string, any>) => Promise<void>},
 *   loadSettings: () => Promise<import("../shared/settings.js").Settings>,
 *   now?: () => Date,
 * }} deps
 */
export function createWatchService({ tracker, storage, loadSettings, now = () => new Date() }) {
  /** One operation at a time: content events, tab closes and queue flushes all touch the same records. */
  let chain = Promise.resolve();
  /** @template T @param {() => Promise<T>} fn @returns {Promise<T>} */
  const serial = (fn) => {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => {},
      () => {},
    );
    return run;
  };

  const iso = () => now().toISOString();
  /** @returns {Promise<Record<string, WatchRecord>>} */
  const records = async () => (await storage.get(RECORDS))[RECORDS] ?? {};
  /** @param {Record<string, WatchRecord>} all */
  const saveRecords = (all) => storage.set({ [RECORDS]: all });
  /** @returns {Promise<QueueItem[]>} */
  const queue = async () => (await storage.get(QUEUE))[QUEUE] ?? [];
  /** @param {QueueItem} item */
  const enqueue = async (item) => storage.set({ [QUEUE]: [...(await queue()), item] });

  /** @param {number} tabId @param {any} value */
  async function setStatus(tabId, value) {
    const all = (await storage.get(STATUS))[STATUS] ?? {};
    if (value) all[tabId] = value;
    else delete all[tabId];
    await storage.set({ [STATUS]: all });
  }

  /** @param {string} names "Watching, YouTube" */
  const splitTags = (names) => names.split(",").map((t) => t.trim()).filter(Boolean);

  /**
   * @param {number} tabId
   * @param {{videoId: string, title: string, lang: string, site: string}} info
   */
  async function start(tabId, info) {
    const settings = await loadSettings();
    const current = (await records())[tabId];
    if (current && current.videoId === info.videoId) return resume(tabId);
    if (current) {
      await saveRecords(await withoutTab(tabId));
      await finish(current, false);
    }
    if (!settings.tracker.logWatchTime || !settings.tracker.url) return;
    const projectId = /** @type {any} */ (settings.tracker.projects)[info.lang] ?? 0;
    if (!projectId) {
      await setStatus(tabId, { state: "unmapped", lang: info.lang });
      return;
    }
    const tags = splitTags(/** @type {any} */ (settings.tracker.watchTags)[info.site] ?? "");
    /** @type {WatchRecord} */
    const record = { tabId, ...info, projectId, tags, sessionId: null, startedAt: iso(), pausedAt: null, pausedMs: 0, lastSeenAt: iso() };
    try {
      const ids = await tracker.tagIds(settings.tracker.url, projectId, tags);
      record.sessionId = (await tracker.startSession(settings.tracker.url, { project_id: projectId, title: info.title, tag_ids: ids })).id;
      await setStatus(tabId, null);
    } catch (e) {
      if (!tracker.isUnreachable(e)) {
        // The tracker said no (project archived or deleted): log nothing, say why in the popup.
        await setStatus(tabId, { state: "error", message: /** @type {Error} */ (e).message });
        return;
      }
      await setStatus(tabId, null); // offline: kept here, sent as a past session at the end
    }
    const fresh = await records();
    fresh[tabId] = record;
    await saveRecords(fresh);
  }

  /** @param {number} tabId */
  async function withoutTab(tabId) {
    const all = await records();
    delete all[tabId];
    return all;
  }

  /** @param {number} tabId */
  async function pause(tabId) {
    const all = await records();
    const r = all[tabId];
    if (!r || r.pausedAt) return;
    r.pausedAt = iso();
    await saveRecords(all);
    const url = (await loadSettings()).tracker.url;
    // Best effort, so the tracker's page shows it paused; the end of the session is corrected anyway.
    if (r.sessionId && url) await tracker.sessionAction(url, r.sessionId, "pause").catch(() => {});
  }

  /** @param {number} tabId */
  async function resume(tabId) {
    const all = await records();
    const r = all[tabId];
    if (!r || !r.pausedAt) return;
    r.pausedMs += Math.max(0, now().getTime() - Date.parse(r.pausedAt));
    r.pausedAt = null;
    r.lastSeenAt = iso();
    await saveRecords(all);
    if (!r.sessionId) return;
    const url = (await loadSettings()).tracker.url;
    try {
      await tracker.sessionAction(url, r.sessionId, "resume");
    } catch (e) {
      if (!tracker.isRefusal(e)) return;
      // Stopped or deleted in the tracker meanwhile: carry on in a new session.
      const fresh = await records();
      delete fresh[tabId];
      await saveRecords(fresh);
      await start(tabId, { videoId: r.videoId, title: r.title, lang: r.lang, site: r.site });
    }
  }

  /** @param {number} tabId */
  async function beat(tabId) {
    const all = await records();
    const r = all[tabId];
    if (!r || r.pausedAt) return;
    r.lastSeenAt = iso();
    await saveRecords(all);
  }

  /** @param {number} tabId @param {boolean} explicit stop from the page (else: tab or browser closed) */
  async function stop(tabId, explicit) {
    const all = await records();
    const r = all[tabId];
    if (!r) return;
    delete all[tabId];
    await saveRecords(all);
    await finish(r, explicit);
  }

  /**
   * End a session. A paused session ends where the pause began; one that just vanished (tab or browser
   * closed) ends at its last heartbeat.
   * @param {WatchRecord} r
   * @param {boolean} explicit
   */
  async function finish(r, explicit) {
    const endedAt = r.pausedAt ?? (explicit ? iso() : r.lastSeenAt);
    const durationMs = Date.parse(endedAt) - Date.parse(r.startedAt);
    const pausedSec = Math.round(r.pausedMs / 1000);
    if (r.sessionId) {
      await enqueue({ kind: "finish", sessionId: r.sessionId, ended_at: endedAt, paused_sec: pausedSec });
    } else if (durationMs - r.pausedMs >= MIN_SESSION_MS) {
      await enqueue({
        kind: "past",
        body: { project_id: r.projectId, title: r.title, started_at: r.startedAt, ended_at: endedAt, note: "Logged by Cyber Miner while the tracker was unreachable" },
        tags: r.tags,
        paused_sec: pausedSec,
      });
    }
    await flushQueue();
  }

  /** Send queued calls in order; stop at the first one that cannot reach the tracker. */
  async function flushQueue() {
    const url = (await loadSettings()).tracker.url;
    let items = await queue();
    while (items.length && url) {
      const item = items[0];
      try {
        await send(url, item);
      } catch (e) {
        if (tracker.isUnreachable(e)) break;
        // Refused for good (session or project gone): drop it rather than block the queue forever.
      }
      items = items.slice(1);
      await storage.set({ [QUEUE]: items });
    }
    return items.length;
  }

  /** @param {string} url @param {QueueItem} item */
  async function send(url, item) {
    if (item.kind === "finish") {
      await tracker.sessionAction(url, item.sessionId, "stop").catch((e) => {
        if (!tracker.isRefusal(e)) throw e; // already stopped: still correct its end
      });
      await tracker.patchSession(url, item.sessionId, { ended_at: item.ended_at, paused_sec: item.paused_sec });
    } else if (item.kind === "past") {
      const tagIds = await tracker.tagIds(url, item.body.project_id, item.tags);
      const s = await tracker.addPastSession(url, { ...item.body, tag_ids: tagIds });
      if (item.paused_sec) await tracker.patchSession(url, s.id, { paused_sec: item.paused_sec });
    } else {
      await tracker.postCard(url, item.body).catch(async (e) => {
        // The session it belonged to is gone: count the card without it.
        if (tracker.isRefusal(e) && /** @type {any} */ (item.body).session_id) await tracker.postCard(url, { ...item.body, session_id: null });
        else throw e;
      });
    }
  }

  /**
   * Count a card Anki accepted, linked to the tab's running session when there is one.
   * @param {number | null} tabId
   * @param {{lang: string, site?: string, source?: string, word?: string}} draft
   * @param {number | null} noteId
   */
  async function countCard(tabId, draft, noteId) {
    const settings = await loadSettings();
    const projectId = /** @type {any} */ (settings.tracker.projects)[draft.lang] ?? 0;
    if (!settings.tracker.countCards || !settings.tracker.url || !projectId) return;
    const r = tabId === null ? null : (await records())[tabId];
    await enqueue({
      kind: "card",
      body: {
        project_id: projectId,
        session_id: r?.sessionId ?? null,
        created_at: iso(),
        site: draft.site ?? "",
        source_title: (draft.source ?? "").replace(/ · [\d:]+$/, ""),
        word: draft.word ?? "",
        anki_note_id: noteId,
      },
    });
    await flushQueue();
  }

  /** Sessions left from a closed browser or a reloaded extension: end them at their last heartbeat. */
  async function endLeftovers() {
    const all = await records();
    await saveRecords({});
    for (const r of Object.values(all)) await finish(r, false);
  }

  /**
   * For the popup.
   * @param {number} tabId
   */
  async function status(tabId) {
    const r = (await records())[tabId];
    const note = ((await storage.get(STATUS))[STATUS] ?? {})[tabId] ?? null;
    const waiting = (await queue()).length;
    if (!r) return { state: note?.state ?? "idle", lang: note?.lang, message: note?.message, waiting };
    const pausedNow = r.pausedAt ? now().getTime() - Date.parse(r.pausedAt) : 0;
    return {
      state: r.pausedAt ? "paused" : "watching",
      lang: r.lang,
      title: r.title,
      offline: !r.sessionId,
      elapsedMs: now().getTime() - Date.parse(r.startedAt) - r.pausedMs - pausedNow,
      waiting,
    };
  }

  return {
    /** @param {number} tabId @param {{event: string, videoId: string, title: string, lang: string, site: string}} msg */
    onEvent: (tabId, msg) =>
      serial(() => {
        if (msg.event === "start") return start(tabId, msg);
        if (msg.event === "pause") return pause(tabId);
        if (msg.event === "resume") return resume(tabId);
        if (msg.event === "beat") return beat(tabId);
        if (msg.event === "stop") return stop(tabId, true);
        return Promise.resolve();
      }),
    tabClosed: (/** @type {number} */ tabId) => serial(() => stop(tabId, false)),
    countCard: (/** @type {number | null} */ tabId, /** @type {any} */ draft, /** @type {number | null} */ noteId) => serial(() => countCard(tabId, draft, noteId)),
    flush: () => serial(flushQueue),
    endLeftovers: () => serial(endLeftovers),
    status: (/** @type {number} */ tabId) => status(tabId),
  };
}
