import { LeaderborderError } from "./errors.js";

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";
const SLOW_DOWN_SECONDS = 5;
const FAILURE_MESSAGES = {
  expired_token: "GitHub device code expired, run login again",
  access_denied: "GitHub authorization was denied",
};

const post = async (fetch, url, params) => {
  const response = await fetch(url, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  }).catch((cause) => {
    throw new LeaderborderError("network", `cannot reach GitHub: ${cause.message}`, { cause });
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) {
    throw new LeaderborderError("unauthorized", `GitHub request failed with HTTP ${response.status}`, { status: response.status });
  }
  return body;
};

const pollFailure = (body) =>
  new LeaderborderError("unauthorized", FAILURE_MESSAGES[body.error] ?? `GitHub login failed: ${body.error_description ?? body.error}`);

export const githubDeviceFlow = async ({ clientId, fetch = globalThis.fetch, onCode, sleep, scope = "read:org", now = Date.now }) => {
  const code = await post(fetch, DEVICE_CODE_URL, { client_id: clientId, ...(scope ? { scope } : {}) });
  if (!code.device_code) throw pollFailure(code);
  if (code.verification_uri !== "https://github.com/login/device" || typeof code.user_code !== "string" ||
      !Number.isFinite(code.expires_in) || code.expires_in <= 0 || code.expires_in > 1800 ||
      (code.interval !== undefined && (!Number.isFinite(code.interval) || code.interval < 1))) {
    throw new LeaderborderError("unauthorized", "Invalid GitHub device authorization response");
  }
  const deadline = now() + code.expires_in * 1000;
  await onCode({ userCode: code.user_code, verificationUri: code.verification_uri, expiresIn: code.expires_in });
  const params = { client_id: clientId, device_code: code.device_code, grant_type: GRANT_TYPE };
  const poll = async (intervalSeconds) => {
    if (now() + intervalSeconds * 1000 >= deadline) throw new LeaderborderError("unauthorized", FAILURE_MESSAGES.expired_token);
    await sleep(intervalSeconds * 1000);
    if (now() >= deadline) throw new LeaderborderError("unauthorized", FAILURE_MESSAGES.expired_token);
    const body = await post(fetch, ACCESS_TOKEN_URL, params);
    if (body.access_token) return body.access_token;
    if (body.error === "authorization_pending") return poll(intervalSeconds);
    if (body.error === "slow_down") return poll(intervalSeconds + SLOW_DOWN_SECONDS);
    throw pollFailure(body);
  };
  return poll(code.interval ?? 5);
};
