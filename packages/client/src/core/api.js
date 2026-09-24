import { LeaderborderError } from "./errors.js";
import { normalizeApiUrl } from "./config.js";

const STATUS_CODES = { 401: "unauthorized", 403: "forbidden" };
const MAX_RESPONSE_BYTES = 1024 * 1024;

const readBody = async (response) => {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new LeaderborderError("upload_failed", "API response is too large");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const errorFor = (response, body) =>
  new LeaderborderError(
    STATUS_CODES[response.status] ?? "upload_failed",
    body?.error?.message ?? `request failed with HTTP ${response.status}`,
    { status: response.status },
  );

export const createApi = ({ apiUrl, fetch = globalThis.fetch, token } = {}) => {
  apiUrl = normalizeApiUrl(apiUrl);
  const request = async (method, path, { body, auth = false } = {}) => {
    const headers = {
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(auth && token ? { authorization: `Bearer ${token}` } : {}),
    };
    const init = { method, headers, redirect: "error", signal: AbortSignal.timeout(30000), ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
    const response = await fetch(`${apiUrl}${path}`, init).catch((cause) => {
      throw new LeaderborderError("network", `cannot reach ${apiUrl}: ${cause.message}`, { cause });
    });
    const parsed = await readBody(response);
    if (!response.ok) {
      const error = errorFor(response, parsed);
      error.message = [token, body?.githubToken].filter(Boolean).reduce((message, secret) => message.replaceAll(secret, "[redacted]"), String(error.message)).slice(0, 500);
      throw error;
    }
    return parsed;
  };

  return {
    getConfig: () => request("GET", "/api/config"),
    registerDevice: ({ githubToken, deviceId, deviceName }) =>
      request("POST", "/api/devices", { body: { githubToken, deviceId, deviceName } }),
    putUsage: ({ deviceId, tokscaleVersion, rows }) =>
      request("PUT", "/api/usage", { body: { deviceId, tokscaleVersion, rows }, auth: true }),
    getMe: () => request("GET", "/api/me", { auth: true }),
    revokeSelf: () => request("DELETE", "/api/me/devices/self", { auth: true }),
  };
};
