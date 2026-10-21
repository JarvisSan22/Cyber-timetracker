// @ts-check
/** Message types between pages, content scripts and the service worker. One place for the names. */

export const MSG = /** @type {const} */ ({
  STATUS: "status", // -> {anki, tracker}
  ANKI_CONNECT: "anki-connect", // -> {version, decks, noteTypeExists}
  ANKI_SETUP: "anki-setup", // create decks + note type, push theme and fonts
  ANKI_PUSH_THEME: "anki-push-theme",
  ANKI_TEST_NOTE: "anki-test-note", // -> {noteId, deck}
  TRACKER_TEST: "tracker-test", // -> {ok, theme}
  THEME_REFRESH: "theme-refresh", // fetch tracker theme into the cache -> Theme | null
  ENCODE_MP3: "encode-mp3", // {data: base64 webm, kbps} -> {data: base64 mp3, ext, seconds}
  CAPTURE_FRAME: "capture-frame", // content -> worker: {rect, viewportWidth, width, quality} -> {data, ext} | null (tab screenshot, cropped)
  MINE_CARD: "mine-card", // {draft, allowDuplicate} -> {noteId, today} | {duplicate} | {queued, pending}
  OPEN_NOTE: "open-note", // {noteId}
  PENDING_RETRY: "pending-retry", // -> {sent, left}
  COMMAND: "command", // worker -> content script: {command} from a hotkey
  SETTINGS_CHANGED: "settings-changed",
  // Card editor in Chrome's side panel. One draft per tab, kept by the worker in storage.session.
  OPEN_SIDEBAR: "open-sidebar", // content script click -> worker opens the side panel
  DRAFT_START: "draft-start", // content -> worker: {draft, meta} -> {draftId}
  DRAFT_UPDATE: "draft-update", // content -> worker: {draftId, draft?, meta?}
  DRAFT_CLEAR: "draft-clear", // side panel -> worker: {tabId}
  RERECORD: "rerecord", // side panel -> content: {draftId}
  DRAFT_CLOSED: "draft-closed", // worker -> content: stop recording for this draft
  TOAST: "toast", // side panel -> content: {text, error?, noteId?}
  // Watch time (M3)
  WATCH: "watch", // content -> worker: {event: start|pause|resume|beat|stop, videoId, title, lang, site}
  WATCH_STATUS: "watch-status", // popup -> worker: {tabId} -> status
  WATCH_IGNORE: "watch-ignore", // popup -> worker: {tabId, ignore}
  TRACKER_PROJECTS: "tracker-projects", // options -> worker: -> projects
  TRACKER_CREATE_PROJECT: "tracker-create-project", // options -> worker: {name} -> project
});

/** storage.session key of a tab's draft. */
export const draftKey = (/** @type {number} */ tabId) => `draft:${tabId}`;

/**
 * Send a message to the service worker; rejects with the worker's error message.
 * @param {string} type
 * @param {object} [payload]
 */
export async function ask(type, payload = {}) {
  const reply = await chrome.runtime.sendMessage({ type, ...payload });
  if (!reply) throw new Error("No reply from the extension's background worker");
  if (reply.error) throw new Error(reply.error);
  return reply.result;
}
