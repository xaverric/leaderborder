import { test } from "node:test";
import assert from "node:assert/strict";
import { statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import { createApi } from "../../src/core/api.js";
import { createKeychain } from "../../src/core/keychain.js";
import { readGraph } from "../../src/core/tokscale.js";
import { githubDeviceFlow } from "../../src/core/github.js";

test("credentials cannot be sent to insecure or ambiguous API endpoints", () => {
  for (const apiUrl of ["http://remote.test", "https://user:pass@api.test", "https://api.test?secret=x", "https://api.test#x", "file:///tmp/api"]) {
    assert.throws(() => createApi({ apiUrl }), /API URL/);
  }
  assert.doesNotThrow(() => createApi({ apiUrl: "http://localhost:8787" }));
});

test("credential-bearing requests reject redirects and have a timeout", async () => {
  await createApi({
    apiUrl: "https://api.test",
    fetch: async (_url, init) => {
      assert.equal(init.redirect, "error");
      assert.ok(init.signal instanceof AbortSignal);
      return Response.json({});
    },
  }).registerDevice({ githubToken: "gho_synthetic", deviceId: "d", deviceName: "Mac" });
});

test("server errors cannot persist reflected device or GitHub credentials", async () => {
  const token = `lb_${"a".repeat(43)}`;
  const githubToken = "gho_synthetic";
  const api = createApi({ apiUrl: "https://api.test", token, fetch: async () => Response.json({ error: { message: `${token} ${githubToken}` } }, { status: 400 }) });
  await assert.rejects(api.registerDevice({ githubToken }), (error) => !error.message.includes(token) && !error.message.includes(githubToken));
});

test("Keychain credentials are isolated by API destination", async () => {
  const accounts = [];
  const keychain = createKeychain({ exec: async (args) => {
    accounts.push(args[args.indexOf("-a") + 1]);
    return { code: 44, stdout: "", stderr: "" };
  } });
  await keychain.getToken();
  await keychain.getToken({ apiUrl: "http://localhost:8787" });
  assert.equal(accounts[0], "device-token");
  assert.notEqual(accounts[0], accounts[1]);
});

test("a locked Keychain is not reported as an expired server token", async () => {
  const keychain = createKeychain({ exec: async () => ({ code: 36, stdout: "", stderr: "interaction not allowed" }) });
  await assert.rejects(keychain.getToken(), { code: "keychain_unavailable" });
});

test("tokscale exports stay in a private temporary directory", async () => {
  await readGraph({}, { run: async (args) => {
    const output = args.at(-1);
    assert.notEqual(dirname(output), tmpdir().replace(/\/$/, ""));
    assert.equal(statSync(dirname(output)).mode & 0o777, 0o700);
    writeFileSync(output, "{}");
  } });
});

test("GitHub device flow rejects verification URLs outside GitHub", async () => {
  let opened = false;
  const fetch = async () => Response.json({ device_code: "synthetic", user_code: "TEST-1234", verification_uri: "file:///tmp/app", expires_in: 900, interval: 5 });
  await assert.rejects(githubDeviceFlow({ clientId: "test", fetch, onCode: () => { opened = true; throw new Error("opened"); }, sleep: async () => {} }), /GitHub.*response/);
  assert.equal(opened, false);
});

test("API responses are bounded before parsing", async () => {
  const fetch = async () => new Response("x".repeat(1024 * 1024 + 1));
  await assert.rejects(createApi({ apiUrl: "https://api.test", fetch }).getMe(), /response is too large/);
});

test("GitHub polling expires locally even when the server keeps returning pending", async () => {
  let elapsed = 0;
  let calls = 0;
  const fetch = async () => Response.json(calls++ === 0 ? {
    device_code: "synthetic", user_code: "TEST-1234", verification_uri: "https://github.com/login/device", expires_in: 12, interval: 5,
  } : { error: "authorization_pending" });
  await assert.rejects(githubDeviceFlow({ clientId: "test", fetch, onCode: () => {}, now: () => elapsed, sleep: async (ms) => { elapsed += ms; } }), /expired/);
  assert.equal(calls, 3);
});
