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

test("device flow rejects expired_token as unauthorized", async () => {
  await assert.rejects(run([{ error: "expired_token" }]).promise, (e) => e.code === "unauthorized" && /expired/i.test(e.message));
});

test("device flow rejects access_denied as unauthorized", async () => {
  await assert.rejects(run([{ error: "access_denied" }]).promise, (e) => e.code === "unauthorized" && /denied/i.test(e.message));
});

test("device flow rejects unknown errors with the GitHub description", async () => {
  await assert.rejects(
    run([{ error: "device_flow_disabled", error_description: "Device Flow must be enabled" }]).promise,
    (e) => e.code === "unauthorized" && /Device Flow must be enabled/.test(e.message),
  );
});

test("device flow maps network failures to network", async () => {
  await assert.rejects(run([new TypeError("fetch failed")]).promise, (e) => e.code === "network");
});

test("device flow rejects a failed code request", async () => {
  const fetch = fakeFetch([new Response("nope", { status: 404 })]);
  await assert.rejects(
    githubDeviceFlow({ clientId: "bad", fetch, onCode: () => {}, sleep: async () => {} }),
    (e) => e.code === "unauthorized",
  );
});
