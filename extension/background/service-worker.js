// @ts-check
/** Background worker: routes messages from the popup, options page and (later) content scripts. */

import * as anki from "./anki.js";
import * as tracker from "./tracker.js";
import { MSG, draftKey } from "../shared/messages.js";
import { loadSettings, LANGUAGES } from "../shared/settings.js";
import { buildNote, localDate } from "../shared/card.js";
import { loadPresets, resolveTheme } from "../shared/theme.js";
import { createWatchService } from "./watch.js";
import { captureTabFrame } from "./capture.js";

const watch = createWatchService({ tracker, storage: chrome.storage.local, loadSettings });
const IGNORED_KEY = "ignoredTabs"; // storage.session: tabs the user switched off in the popup

/** @returns {Promise<number[]>} */
async function ignoredTabs() {
  return (await chrome.storage.session.get(IGNORED_KEY))[IGNORED_KEY] ?? [];
}

const THEME_CACHE_KEY = "trackerTheme";
const PENDING_KEY = "pendingCards"; // cards mined while Anki was closed: [{draft, queuedAt}]
const COUNTS_KEY = "minedCounts"; // {"2026-10-16": 14}
const OFFSCREEN_URL = "offscreen/offscreen.html";

/** One offscreen document for MP3 encoding (it needs Web Audio, which the worker lacks). */
let offscreenReady = null;
function ensureOffscreen() {
  offscreenReady ??= (async () => {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
    if (!contexts.length) {
      await chrome.offscreen.createDocument({ url: OFFSCREEN_URL, reasons: ["BLOBS"], justification: "Encode recorded subtitle audio to MP3" });
    }
  })().catch((e) => {
    offscreenReady = null;
    throw e;
  });
  return offscreenReady;
}

/** Add one to today's mined count; returns the new count. */
async function countMined() {
  const today = localDate(new Date());
  const counts = (await chrome.storage.local.get(COUNTS_KEY))[COUNTS_KEY] ?? {};
  // Keep two weeks; older days are in Anki (and in the tracker from M3).
  const kept = Object.fromEntries(Object.entries(counts).filter(([day]) => day >= localDate(new Date(Date.now() - 14 * 864e5))));
  kept[today] = (kept[today] ?? 0) + 1;
  await chrome.storage.local.set({ [COUNTS_KEY]: kept });
  return kept[today];
}

async function minedToday() {
  return ((await chrome.storage.local.get(COUNTS_KEY))[COUNTS_KEY] ?? {})[localDate(new Date())] ?? 0;
}

/** @returns {Promise<{draft: any, queuedAt: string}[]>} */
async function pendingCards() {
  return (await chrome.storage.local.get(PENDING_KEY))[PENDING_KEY] ?? [];
}

/** @param {{draft: any, queuedAt: string}[]} list */
async function setPending(list) {
  await chrome.storage.local.set({ [PENDING_KEY]: list });
  await chrome.action.setBadgeText({ text: list.length ? String(list.length) : "" });
}

/**
 * Send one draft to Anki. Duplicates come back as {duplicate: true} unless allowed. Accepted cards are
 * counted in Cyber Tracker (linked to the watch session of `tabId`).
 * @param {any} draft
 * @param {boolean} allowDuplicate
 * @param {number | null} [tabId]
 */
async function sendToAnki(draft, allowDuplicate, tabId = null) {
  const settings = await loadSettings();
  const note = buildNote(draft, settings, { allowDuplicate });
  if (!allowDuplicate) {
    const check = await anki.checkNote(settings.anki, note);
    if (!check.canAdd) {
      if (/duplicate/i.test(check.error ?? "")) return { duplicate: true };
      throw new anki.AnkiError(`Anki refused the card: ${check.error}`);
    }
  }
  const noteId = await anki.addNote(settings.anki, note);
  watch.countCard(tabId, draft, noteId).catch(() => {}); // never holds up the card
  return { noteId, today: await countMined() };
}

/** @returns {Promise<import("../shared/theme.js").Theme | null>} */
async function cachedTrackerTheme() {
  return (await chrome.storage.local.get(THEME_CACHE_KEY))[THEME_CACHE_KEY] ?? null;
}

/** Fetch the tracker's theme into the cache; keeps the old cache when the tracker is offline. */
async function refreshTrackerTheme() {
  const settings = await loadSettings();
  if (!settings.tracker.url) return cachedTrackerTheme();
  try {
    const theme = await tracker.getTheme(settings.tracker.url);
    await chrome.storage.local.set({ [THEME_CACHE_KEY]: theme });
    return theme;
  } catch {
    return cachedTrackerTheme();
  }
}

async function currentTheme() {
  const settings = await loadSettings();
  return resolveTheme(await loadPresets(), settings.theme.mode, await cachedTrackerTheme());
}

/** @param {string} path */
async function readExtensionFile(path) {
  return (await fetch(chrome.runtime.getURL(path))).arrayBuffer();
}

/**
 * The draft for a tab, as the side panel reads it from storage.session:
 * {draftId, tabId, draft (CardDraft incl. picture/audio), meta: {deck, audio: {state, seconds?, message?}, pick?: {start, end?}}}
 * @param {number} tabId
 */
async function getDraft(tabId) {
  return (await chrome.storage.session.get(draftKey(tabId)))[draftKey(tabId)] ?? null;
}

let nextDraftId = Date.now();

/**
 * Open the side panel for a window. Must run before any await in a user-action handler:
 * Chrome only allows sidePanel.open() while the user gesture is still current.
 * @param {number} windowId
 */
function openSidebar(windowId) {
  return chrome.sidePanel.open({ windowId });
}

/** @type {Record<string, (msg: any, sender: chrome.runtime.MessageSender) => Promise<unknown>>} */
const handlers = {
  async [MSG.STATUS]() {
    const settings = await loadSettings();
    const [today, pending] = await Promise.all([minedToday(), pendingCards()]);
    const [ankiStatus, trackerStatus] = await Promise.all([
      anki.status(settings.anki),
      settings.tracker.url
        ? tracker.health(settings.tracker.url).then(() => ({ ok: true }), (e) => ({ ok: false, error: e.message }))
        : Promise.resolve({ ok: false, error: "Not set up" }),
    ]);
    return { anki: ankiStatus, tracker: trackerStatus, today, pending: pending.length };
  },

  async [MSG.ANKI_CONNECT]() {
    return anki.connect((await loadSettings()).anki);
  },

  async [MSG.ANKI_SETUP]() {
    const settings = await loadSettings();
    const theme = await currentTheme();
    const decks = settings.languages.targets.map((lang) => settings.anki.decks[/** @type {keyof typeof LANGUAGES} */ (lang)]);
    const createdDecks = await anki.ensureDecks(settings.anki, decks);
    const noteType = await anki.ensureNoteType(settings.anki, theme);
    await anki.storeFonts(settings.anki, readExtensionFile);
    if (noteType !== "created") await anki.pushTheme(settings.anki, theme);
    return { createdDecks, noteType, theme: theme.label };
  },

  async [MSG.ANKI_PUSH_THEME]() {
    const settings = await loadSettings();
    const theme = await currentTheme();
    await anki.storeFonts(settings.anki, readExtensionFile);
    await anki.pushTheme(settings.anki, theme);
    return { theme: theme.label };
  },

  async [MSG.ANKI_TEST_NOTE]() {
    const settings = await loadSettings();
    const icon = anki.toBase64(await readExtensionFile("icons/icon-128.png"));
    const note = buildNote(
      {
        lang: "ja",
        sentence: "これはサイバーマイナーのテストです。",
        translation: "This is a Cyber Miner test.",
        word: "テスト",
        definitions: ["test", "trial"],
        source: "Cyber Miner test note",
        sourceUrl: "https://www.youtube.com/",
        site: "youtube",
        show: "Cyber Miner test",
        notes: "Delete me after checking the style.",
        picture: { data: icon, ext: "png" },
      },
      settings,
      { allowDuplicate: true },
    );
    const noteId = await anki.addNote(settings.anki, note);
    await anki.openInBrowser(settings.anki, noteId).catch(() => {});
    return { noteId, deck: note.deckName };
  },

  async [MSG.TRACKER_TEST]() {
    const settings = await loadSettings();
    await tracker.health(settings.tracker.url);
    try {
      const theme = await tracker.getTheme(settings.tracker.url);
      await chrome.storage.local.set({ [THEME_CACHE_KEY]: theme });
      return { ok: true, theme };
    } catch (e) {
      // A tracker older than Cyber Miner M0 has no /api/theme (and no /api/cards).
      return { ok: true, theme: null, themeError: /** @type {Error} */ (e).message };
    }
  },

  async [MSG.ENCODE_MP3](msg) {
    await ensureOffscreen();
    const reply = await chrome.runtime.sendMessage({ target: "offscreen", type: "encode-mp3", data: msg.data, kbps: msg.kbps });
    if (!reply || reply.error) throw new Error(reply?.error ?? "Encoder did not answer");
    return reply.result;
  },

  async [MSG.CAPTURE_FRAME](msg, sender) {
    const windowId = sender.tab?.windowId;
    if (windowId === undefined) throw new Error("No tab to capture");
    return captureTabFrame({ windowId, rect: msg.rect, viewportWidth: msg.viewportWidth, width: msg.width, quality: msg.quality });
  },

  async [MSG.MINE_CARD](msg, sender) {
    try {
      return await sendToAnki(msg.draft, Boolean(msg.allowDuplicate), msg.tabId ?? sender.tab?.id ?? null);
    } catch (e) {
      // Anki closed: keep the card (with its media) and send it later from the popup.
      if (e instanceof anki.AnkiError && /not reachable/.test(e.message)) {
        const list = [...(await pendingCards()), { draft: msg.draft, queuedAt: new Date().toISOString() }];
        await setPending(list);
        return { queued: true, pending: list.length };
      }
      throw e;
    }
  },

  async [MSG.PENDING_RETRY]() {
    const list = await pendingCards();
    let sent = 0;
    while (list.length) {
      // Duplicates are allowed here: the check already passed (or was overridden) when it was mined.
      await sendToAnki(list[0].draft, true);
      list.shift();
      sent++;
      await setPending(list);
    }
    return { sent, left: list.length };
  },

  async [MSG.DRAFT_START](msg, sender) {
    const tabId = /** @type {number} */ (sender.tab?.id);
    const draftId = ++nextDraftId;
    await chrome.storage.session.set({ [draftKey(tabId)]: { draftId, tabId, draft: msg.draft, meta: msg.meta } });
    return { draftId };
  },

  async [MSG.DRAFT_UPDATE](msg, sender) {
    const tabId = /** @type {number} */ (sender.tab?.id);
    const current = await getDraft(tabId);
    if (!current || current.draftId !== msg.draftId) return { stale: true };
    await chrome.storage.session.set({
      [draftKey(tabId)]: { ...current, draft: { ...current.draft, ...msg.draft }, meta: { ...current.meta, ...msg.meta } },
    });
    return { ok: true };
  },

  async [MSG.DRAFT_CLEAR](msg) {
    const current = await getDraft(msg.tabId);
    await chrome.storage.session.remove(draftKey(msg.tabId));
    if (current) chrome.tabs.sendMessage(msg.tabId, { type: MSG.DRAFT_CLOSED, draftId: current.draftId }).catch(() => {});
    return { ok: true };
  },

  async [MSG.WATCH](msg, sender) {
    const tabId = sender.tab?.id;
    if (tabId === undefined || (await ignoredTabs()).includes(tabId)) return { ignored: true };
    await watch.onEvent(tabId, msg);
    return { ok: true };
  },

  async [MSG.WATCH_STATUS](msg) {
    const st = await watch.status(msg.tabId);
    return { ...st, ignored: (await ignoredTabs()).includes(msg.tabId) };
  },

  async [MSG.WATCH_IGNORE](msg) {
    const list = (await ignoredTabs()).filter((id) => id !== msg.tabId);
    if (msg.ignore) {
      list.push(msg.tabId);
      await watch.tabClosed(msg.tabId); // ends the running session now
    }
    await chrome.storage.session.set({ [IGNORED_KEY]: list });
    return { ignored: msg.ignore };
  },

  async [MSG.TRACKER_PROJECTS]() {
    return tracker.listProjects((await loadSettings()).tracker.url);
  },

  async [MSG.TRACKER_CREATE_PROJECT](msg) {
    return tracker.createProject((await loadSettings()).tracker.url, msg.name);
  },

  async [MSG.OPEN_NOTE](msg) {
    return anki.openInBrowser((await loadSettings()).anki, msg.noteId);
  },

  async [MSG.THEME_REFRESH]() {
    await refreshTrackerTheme();
    return currentTheme();
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target === "offscreen") return false;
  if (msg?.type === MSG.OPEN_SIDEBAR) {
    // Synchronously, while the click in the page still counts as a user gesture.
    const windowId = sender.tab?.windowId;
    if (windowId === undefined) return false;
    openSidebar(windowId).then(
      () => sendResponse({ result: { opened: true } }),
      (e) => sendResponse({ error: e instanceof Error ? e.message : String(e) }),
    );
    return true;
  }
  const handler = handlers[msg?.type];
  if (!handler) return false;
  handler(msg, sender).then(
    (result) => sendResponse({ result }),
    (e) => sendResponse({ error: e instanceof Error ? e.message : String(e) }),
  );
  return true; // reply comes later
});

// Hotkeys go to the content script of the tab they were pressed in. Mining opens the side panel first,
// synchronously, because the hotkey is the user gesture Chrome requires for sidePanel.open().
chrome.commands.onCommand.addListener((command, tab) => {
  if (tab?.id === undefined) return;
  if (command === "mine-card") openSidebar(tab.windowId).catch(() => {});
  chrome.tabs.sendMessage(tab.id, { type: MSG.COMMAND, command }).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(draftKey(tabId));
  watch.tabClosed(tabId);
});

// Calls that failed while the tracker was unreachable are retried every 5 minutes.
chrome.alarms.create("tracker-flush", { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "tracker-flush") watch.flush();
});

chrome.runtime.onStartup.addListener(async () => {
  setPending(await pendingCards());
  watch.endLeftovers(); // sessions still open when the browser closed end at their last heartbeat
});

chrome.runtime.onInstalled.addListener((details) => {
  // A reload or update orphans the old content scripts: their sessions would never be stopped.
  watch.endLeftovers();
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});
