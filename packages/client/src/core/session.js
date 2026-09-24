import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createApi } from "./api.js";
import { getConfig } from "./config.js";
import { defaultDeviceName, parseDeviceName } from "./device.js";
import { LeaderborderError } from "./errors.js";
import { githubDeviceFlow } from "./github.js";
import { keychain } from "./keychain.js";
import { chunk, summarize, syncWindow, toUsageRows } from "./rows.js";
import { loadState, saveState } from "./state.js";
import { cursorStatus, cursorSync, readGraph } from "./tokscale.js";

export const RETRY_DELAYS_MS = [1000, 4000, 16000];

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GITHUB_LOGIN = /^[A-Za-z0-9-]{1,39}$/;
const DEFAULT_GITHUB_SCOPE = "read:org";
const GITHUB_SCOPES = new Set(["", DEFAULT_GITHUB_SCOPE]);

const defaultDeps = {
  getConfig,
  loadState,
  saveState,
  keychain,
  createApi,
  githubDeviceFlow,
  defaultDeviceName,
  randomUUID,
  cursorStatus,
  cursorSync,
  readGraph,
  sleep: (ms) => delay(ms),
};

const resolveDeps = (deps = {}) => ({ ...defaultDeps, ...deps });

const configFor = (d, apiUrl) => d.getConfig(process.env, { apiUrl });

const deviceNameFor = (d, deviceName) => {
  if (deviceName === undefined) return d.defaultDeviceName();
  const name = parseDeviceName(deviceName);
  if (!name) throw new LeaderborderError("invalid_config", "device name must be 1-60 printable characters");
  return name;
};

const scopeFor = ({ githubScope }) => {
  const scope = githubScope ?? DEFAULT_GITHUB_SCOPE;
  if (!GITHUB_SCOPES.has(scope)) throw new LeaderborderError("upload_failed", "server requested an unsupported GitHub scope");
  return scope;
};

const matches = (pattern, value) => typeof value === "string" && pattern.test(value);

const validateRegistration = (registered) => {
  if (!matches(UUID_V4, registered?.deviceId)) throw new LeaderborderError("upload_failed", "server returned an invalid device id");
  if (!matches(GITHUB_LOGIN, registered?.user?.login)) throw new LeaderborderError("upload_failed", "server returned an invalid user login");
  return registered;
};

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

export const login = async ({ onCode = () => {}, fetch, apiUrl, deviceName: requestedName, deps } = {}) => {
  const d = resolveDeps(deps);
  const config = configFor(d, apiUrl);
  const deviceName = deviceNameFor(d, requestedName);
  const api = d.createApi({ apiUrl: config.apiUrl, fetch });
  const serverConfig = (await api.getConfig()) ?? {};
  if (!serverConfig.githubClientId) throw new LeaderborderError("upload_failed", "server did not provide a GitHub client id");
  const scope = scopeFor(serverConfig);
  const githubToken = await d.githubDeviceFlow({ clientId: serverConfig.githubClientId, scope, fetch, onCode, sleep: d.sleep });
  const state = d.loadState(config);
  const deviceId = state.deviceId ?? d.randomUUID();
  d.saveState(config, { ...state, deviceId, deviceName });
  const registered = validateRegistration(await api.registerDevice({ githubToken, deviceId, deviceName }));
  await d.keychain.setToken(registered.token, config);
  d.saveState(config, {
    ...d.loadState(config),
    deviceId: registered.deviceId,
    deviceName,
    lastSyncAt: null,
    lastError: null,
  });
  return { user: registered.user };
};

const revokeToken = async (d, config, fetch) => {
  try {
    const token = await d.keychain.getToken(config);
    if (!token) return false;
    await d.createApi({ apiUrl: config.apiUrl, fetch, token }).revokeSelf();
    return true;
  } catch {
    return false;
  }
};

export const logout = async ({ fetch, apiUrl, deps } = {}) => {
  const d = resolveDeps(deps);
  const config = configFor(d, apiUrl);
  const revoked = await revokeToken(d, config, fetch);
  await d.keychain.deleteToken(config);
  d.saveState(config, { ...d.loadState(config), deviceId: null, lastSyncAt: null, lastError: null, summary: null });
  return { revoked };
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

const credentials = async (d, state, config) => {
  const token = await d.keychain.getToken(config);
  if (!token || !state.deviceId) throw new LeaderborderError("not_logged_in", "not logged in, run leaderborder login");
  return token;
};

const upload = async (d, { api, config, deviceId, tokscaleVersion, rows, onProgress }) => {
  const batches = chunk(rows);
  for (const [index, batch] of batches.entries()) {
    onProgress({ phase: "upload", done: index, total: batches.length });
    try {
      await withRetry(() => api.putUsage({ deviceId, tokscaleVersion, rows: batch }), { sleep: d.sleep });
    } catch (error) {
      if (error?.code !== "unauthorized") throw error;
      await d.keychain.deleteToken(config);
      throw new LeaderborderError("unauthorized", "device login expired or was revoked, run leaderborder login again", { status: 401 });
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

export const sync = async ({ now = new Date(), fetch, apiUrl, onProgress = () => {}, dryRun = false, deps } = {}) => {
  const d = resolveDeps(deps);
  const config = configFor(d, apiUrl);
  const state = d.loadState(config);
  if (dryRun) {
    const { warnings, since, rows } = await collect(d, { state, now, onProgress });
    onProgress({ phase: "done" });
    return { rows, since, summary: summarize(rows, now), warnings, uploaded: 0 };
  }
  try {
    const token = await credentials(d, state, config);
    const { warnings, since, graph, rows } = await collect(d, { state, now, onProgress });
    const api = d.createApi({ apiUrl: config.apiUrl, fetch, token });
    await upload(d, { api, config, deviceId: state.deviceId, tokscaleVersion: graph.meta?.version ?? "unknown", rows, onProgress });
    const summary = summarize(rows, now);
    d.saveState(config, { ...d.loadState(config), lastSyncAt: now.toISOString(), summary, lastError: null });
    onProgress({ phase: "done" });
    return { rows, since, summary, warnings, uploaded: rows.length };
  } catch (error) {
    d.saveState(config, { ...d.loadState(config), lastError: errorRecord(error, now) });
    throw error;
  }
};
