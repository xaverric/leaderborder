import { LeaderborderError } from "./errors.js";

const STATUS_CODES = { 401: "unauthorized", 403: "forbidden" };

const readBody = async (response) => {
  const text = await response.text();
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
  const request = async (method, path, { body, auth = false } = {}) => {
    const headers = {
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(auth && token ? { authorization: `Bearer ${token}` } : {}),
    };
    const init = { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
    const response = await fetch(`${apiUrl}${path}`, init).catch((cause) => {
      throw new LeaderborderError("network", `cannot reach ${apiUrl}: ${cause.message}`, { cause });
    });
    const parsed = await readBody(response);
    if (!response.ok) throw errorFor(response, parsed);
    return parsed;
  };

  return {
    getConfig: () => request("GET", "/api/config"),
    registerDevice: ({ githubToken, deviceId, deviceName }) =>
      request("POST", "/api/devices", { body: { githubToken, deviceId, deviceName } }),
    putUsage: ({ deviceId, tokscaleVersion, rows }) =>
      request("PUT", "/api/usage", { body: { deviceId, tokscaleVersion, rows }, auth: true }),
    getMe: () => request("GET", "/api/me", { auth: true }),
  };
};
