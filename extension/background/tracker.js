// @ts-check
/** Cyber Tracker client (the FastAPI app on the Pi). M1: health and theme; sessions and cards come in M3. */

import { baseUrl } from "../shared/settings.js";

export class TrackerError extends Error {}

/**
 * @param {string} url tracker base URL
 * @param {string} path "/api/..."
 * @param {RequestInit & {timeoutMs?: number}} [init]
 */
export async function request(url, path, { timeoutMs = 5000, ...init } = {}) {
  if (!url) throw new TrackerError("No Cyber Tracker URL set (Options > Cyber Tracker).");
  let res;
  try {
    res = await fetchWithRetry(baseUrl(url) + path, init, timeoutMs);
  } catch (e) {
    // Keep the browser's reason: "TimeoutError" (slow or asleep Pi) reads very differently from
    // "TypeError: Failed to fetch" (no route, connection refused, or blocked by Chrome).
    const reason = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    throw new TrackerError(`Cyber Tracker is not reachable at ${baseUrl(url)} (${reason}).`);
  }
  if (!res.ok) {
    const detail = await res.json().then((j) => j.detail, () => "");
    throw new TrackerError(`Cyber Tracker ${path}: HTTP ${res.status}${detail ? ` (${detail})` : ""}`);
  }
  return res.status === 204 ? null : res.json();
}

/**
 * One retry after a network error: a Pi on Wi-Fi sometimes drops the first request after idling.
 * @param {string} url
 * @param {RequestInit} init
 * @param {number} timeoutMs
 */
async function fetchWithRetry(url, init, timeoutMs) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  }
}

/** @param {string} url */
export async function health(url) {
  return request(url, "/api/health");
}

/**
 * @param {string} url
 * @returns {Promise<import("../shared/theme.js").Theme>}
 */
export async function getTheme(url) {
  return request(url, "/api/theme");
}

// --- M3: projects, tags, sessions, cards ---

/** @param {any} body */
const json = (body) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** @param {string} url @returns {Promise<{id: number, name: string, type: string, color: string, archived: boolean}[]>} */
export const listProjects = (url) => request(url, "/api/projects");

/**
 * A language project with the tracker's starter tags (Listening, Watching, YouTube, Anki, Mining, …).
 * @param {string} url
 * @param {string} name
 */
export const createProject = (url, name) => request(url, "/api/projects", json({ name, type: "language" }));

/** @param {string} url @param {number} projectId @returns {Promise<{id: number, name: string}[]>} */
export const listTags = (url, projectId) => request(url, `/api/projects/${projectId}/tags`);

/** @param {string} url @param {number} projectId @param {string} name */
export const createTag = (url, projectId, name) => request(url, `/api/projects/${projectId}/tags`, json({ name }));

/**
 * Tag ids for names, creating tags the project does not have yet (matched without case).
 * @param {string} url
 * @param {number} projectId
 * @param {string[]} names
 */
export async function tagIds(url, projectId, names) {
  const tags = await listTags(url, projectId);
  const ids = [];
  for (const name of names) {
    const found = tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
    ids.push(found ? found.id : (await createTag(url, projectId, name)).id);
  }
  return ids;
}

/** @param {string} url @param {{project_id: number, title: string, tag_ids: number[]}} body @returns {Promise<{id: number}>} */
export const startSession = (url, body) => request(url, "/api/sessions/start", json(body));

/** @param {string} url @param {number} id @param {"pause" | "resume" | "stop"} action */
export const sessionAction = (url, id, action) => request(url, `/api/sessions/${id}/${action}`, { method: "POST" });

/** @param {string} url @param {number} id @param {object} patch e.g. {ended_at, paused_sec} */
export const patchSession = (url, id, patch) =>
  request(url, `/api/sessions/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });

/**
 * A finished session logged afterwards (watched while the tracker was unreachable).
 * @param {string} url
 * @param {{project_id: number, title: string, started_at: string, ended_at: string, tag_ids: number[], note?: string}} body
 */
export const addPastSession = (url, body) => request(url, "/api/sessions", json(body));

/**
 * @param {string} url
 * @param {{project_id: number, session_id?: number | null, created_at?: string, site?: string, source_title?: string, word?: string, anki_note_id?: number | null}} body
 */
export const postCard = (url, body) => request(url, "/api/cards", json(body));

/** True for errors that mean "the tracker answered no" (404/409), not "unreachable". */
export function isRefusal(/** @type {unknown} */ e) {
  return e instanceof TrackerError && /HTTP (404|409)/.test(e.message);
}

/** True for errors that mean the tracker could not be reached (worth retrying later). */
export function isUnreachable(/** @type {unknown} */ e) {
  return e instanceof TrackerError && /not reachable/.test(e.message);
}
