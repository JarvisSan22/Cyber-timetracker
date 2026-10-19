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
