import { test } from "node:test";
import assert from "node:assert/strict";
import { githubDeviceFlow } from "../../src/core/github.js";
import { fakeFetch } from "./fake-fetch.js";

const deviceCode = {
  device_code: "dc",
  user_code: "ABCD-1234",
  verification_uri: "https://github.com/login/device",
  expires_in: 900,
  interval: 5,
};

const run = (replies) => {
  const fetch = fakeFetch([deviceCode, ...replies]);
  const sleeps = [];
  const codes = [];
  const promise = githubDeviceFlow({
    clientId: "cid",
    fetch,
    onCode: (code) => codes.push(code),
    sleep: async (ms) => sleeps.push(ms),
  });
  return { promise, fetch, sleeps, codes };
};

test("device flow requests a code with read:org scope and reports it", async () => {
  const { promise, fetch, codes } = run([{ access_token: "gho_x" }]);
  await promise;
  const [request] = fetch.calls;
  assert.equal(request.url, "https://github.com/login/device/code");
  assert.equal(request.method, "POST");
  assert.equal(request.headers.accept, "application/json");
  const params = new URLSearchParams(request.body);
  assert.equal(params.get("client_id"), "cid");
  assert.equal(params.get("scope"), "read:org");
  assert.deepEqual(codes, [{ userCode: "ABCD-1234", verificationUri: "https://github.com/login/device", expiresIn: 900 }]);
});

test("device flow sends the requested scope and omits it when empty", async () => {
  const scoped = fakeFetch([deviceCode, { access_token: "gho_x" }]);
  await githubDeviceFlow({ clientId: "cid", fetch: scoped, scope: "read:org", onCode: () => {}, sleep: async () => {} });
  assert.equal(new URLSearchParams(scoped.calls[0].body).get("scope"), "read:org");
  const unscoped = fakeFetch([deviceCode, { access_token: "gho_x" }]);
  await githubDeviceFlow({ clientId: "cid", fetch: unscoped, scope: "", onCode: () => {}, sleep: async () => {} });
  assert.equal(new URLSearchParams(unscoped.calls[0].body).has("scope"), false);
});

test("device flow polls through pending and slow_down and returns the token", async () => {
  const { promise, fetch, sleeps } = run([{ error: "authorization_pending" }, { error: "slow_down" }, { access_token: "gho_x" }]);
  assert.equal(await promise, "gho_x");
  assert.deepEqual(sleeps, [5000, 5000, 10000]);
  const poll = fetch.calls[1];
  assert.equal(poll.url, "https://github.com/login/oauth/access_token");
  assert.equal(poll.headers.accept, "application/json");
  const params = new URLSearchParams(poll.body);
  assert.equal(params.get("client_id"), "cid");
  assert.equal(params.get("device_code"), "dc");
  assert.equal(params.get("grant_type"), "urn:ietf:params:oauth:grant-type:device_code");
});

test("device flow rejects expired_token as a GitHub login failure", async () => {
  await assert.rejects(run([{ error: "expired_token" }]).promise, (e) => e.code === "github_login" && /expired/i.test(e.message));
});

test("device flow rejects access_denied as a GitHub login failure", async () => {
  await assert.rejects(run([{ error: "access_denied" }]).promise, (e) => e.code === "github_login" && /denied/i.test(e.message));
});

test("device flow rejects unknown errors with the GitHub description", async () => {
  await assert.rejects(
    run([{ error: "unexpected_error", error_description: "Something odd happened" }]).promise,
    (e) => e.code === "github_login" && /Something odd happened/.test(e.message),
  );
});

test("device flow maps network failures to network", async () => {
  await assert.rejects(run([new TypeError("fetch failed")]).promise, (e) => e.code === "network");
});

test("device flow rejects a failed code request", async () => {
  const fetch = fakeFetch([new Response("nope", { status: 404 })]);
  await assert.rejects(
    githubDeviceFlow({ clientId: "bad", fetch, onCode: () => {}, sleep: async () => {} }),
    (e) => e.code === "github_login" && /HTTP 404/.test(e.message),
  );
});

test("device flow explains a disabled Device Flow reported with HTTP 400", async () => {
  const body = JSON.stringify({ error: "device_flow_disabled", error_description: "Device Flow must be explicitly enabled for this App" });
  const fetch = fakeFetch([new Response(body, { status: 400, headers: { "content-type": "application/json" } })]);
  await assert.rejects(
    githubDeviceFlow({ clientId: "cid", fetch, onCode: () => {}, sleep: async () => {} }),
    (e) => e.code === "github_login" && e.reason === "device_flow_disabled" && /Device Flow is disabled/.test(e.message),
  );
});
