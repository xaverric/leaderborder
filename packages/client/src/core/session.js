import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createApi } from "./api.js";
import { getConfig } from "./config.js";
import { computerName } from "./device.js";
import { LeaderborderError } from "./errors.js";
import { githubDeviceFlow } from "./github.js";
import { keychain } from "./keychain.js";
import { chunk, summarize, syncWindow, toUsageRows } from "./rows.js";
import { loadState, saveState } from "./state.js";
import { cursorStatus, cursorSync, readGraph } from "./tokscale.js";

export const RETRY_DELAYS_MS = [1000, 4000, 16000];

const defaultDeps = {
  getConfig,
  loadState,
  saveState,
  keychain,
  createApi,
  githubDeviceFlow,
  computerName,
  randomUUID,
  cursorStatus,
  cursorSync,
  readGraph,
  sleep: (ms) => delay(ms),
};

const resolveDeps = (deps = {}) => ({ ...defaultDeps, ...deps });

const isRetryable = (error) => error?.code === "network" || error?.status >= 500;

export const withRetry = async (operation, { delays = RETRY_DELAYS_MS, sleep }) => {
  try {
    return await operation();
  } catch (error) {
    if (!isRetryable(error) || delays.length === 0) throw error;
    await sleep(delays[0]);
    return withRetry(operation, { delays: delays.slice(1), sleep });
  }
};

const errorRecord = (error, now) => ({
  code: error instanceof LeaderborderError ? error.code : "unknown",
  message: error?.message ?? String(error),
  at: now.toISOString(),
});

export const login = async ({ onCode = () => {}, fetch, deps } = {}) => {
  const d = resolveDeps(deps);
  const config = d.getConfig();
  const api = d.createApi({ apiUrl: config.apiUrl, fetch });
  const { githubClientId } = (await api.getConfig()) ?? {};
  if (!githubClientId) throw new LeaderborderError("upload_failed", "server did not provide a GitHub client id");
  const githubToken = await d.githubDeviceFlow({ clientId: githubClientId, fetch, onCode, sleep: d.sleep });
  const state = d.loadState(config);
  const deviceId = state.deviceId ?? d.randomUUID();
  const deviceName = await d.computerName();
  d.saveState(config, { ...state, deviceId, deviceName });
  const registered = await api.registerDevice({ githubToken, deviceId, deviceName });
  await d.keychain.setToken(registered.token);
  d.saveState(config, {
    ...d.loadState(config),
    deviceId: registered.deviceId ?? deviceId,
    deviceName,
    lastSyncAt: null,
    lastError: null,
  });
  return { user: registered.user };
};

export const logout = async ({ deps } = {}) => {
  const d = resolveDeps(deps);
  const config = d.getConfig();
  await d.keychain.deleteToken();
  d.saveState(config, { ...d.loadState(config), deviceId: null, lastSyncAt: null, lastError: null, summary: null });
};

const syncCursor = async (d, onProgress) => {
  onProgress({ phase: "cursor" });
  try {
    const { loggedIn } = await d.cursorStatus();
    if (loggedIn) await d.cursorSync();
    return [];
  } catch (error) {
    return [`Cursor sync skipped: ${error.message}`];
  }
};

const credentials = async (d, state) => {
  const token = await d.keychain.getToken();
  if (!token || !state.deviceId) throw new LeaderborderError("not_logged_in", "not logged in, run leaderborder login");
  return token;
};

const upload = async (d, { api, deviceId, tokscaleVersion, rows, onProgress }) => {
  const batches = chunk(rows);
  for (const [index, batch] of batches.entries()) {
    onProgress({ phase: "upload", done: index, total: batches.length });
    try {
      await withRetry(() => api.putUsage({ deviceId, tokscaleVersion, rows: batch }), { sleep: d.sleep });
    } catch (error) {
      if (error?.code !== "unauthorized") throw error;
      await d.keychain.deleteToken();
      throw new LeaderborderError("unauthorized", "device token was rejected, run leaderborder login", { status: 401 });
    }
  }
};

const collect = async (d, { state, now, onProgress }) => {
  const warnings = await syncCursor(d, onProgress);
  const { since } = syncWindow({ lastSyncAt: state.lastSyncAt, now });
  onProgress({ phase: "graph", since });
  const graph = await d.readGraph({ since });
  return { warnings, since, graph, rows: toUsageRows(graph, now) };
};

export const sync = async ({ now = new Date(), fetch, onProgress = () => {}, dryRun = false, deps } = {}) => {
  const d = resolveDeps(deps);
  const config = d.getConfig();
  const state = d.loadState(config);
  if (dryRun) {
    const { warnings, since, rows } = await collect(d, { state, now, onProgress });
    onProgress({ phase: "done" });
    return { rows, since, summary: summarize(rows, now), warnings, uploaded: 0 };
  }
  try {
    const token = await credentials(d, state);
    const { warnings, since, graph, rows } = await collect(d, { state, now, onProgress });
    const api = d.createApi({ apiUrl: config.apiUrl, fetch, token });
    await upload(d, { api, deviceId: state.deviceId, tokscaleVersion: graph.meta?.version ?? "unknown", rows, onProgress });
    const summary = summarize(rows, now);
    d.saveState(config, { ...d.loadState(config), lastSyncAt: now.toISOString(), summary, lastError: null });
    onProgress({ phase: "done" });
    return { rows, since, summary, warnings, uploaded: rows.length };
  } catch (error) {
    d.saveState(config, { ...d.loadState(config), lastError: errorRecord(error, now) });
    throw error;
  }
};
