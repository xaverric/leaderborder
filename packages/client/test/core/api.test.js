import { test } from "node:test";
import assert from "node:assert/strict";
import { createApi } from "../../src/core/api.js";
import { fakeFetch, jsonResponse } from "./fake-fetch.js";

const apiUrl = "http://api.test";
const token = `lb_${"a".repeat(43)}`;

test("getConfig fetches /api/config without auth", async () => {
  const fetch = fakeFetch([{ githubClientId: "cid", apiVersion: 1 }]);
  assert.deepEqual(await createApi({ apiUrl, fetch }).getConfig(), { githubClientId: "cid", apiVersion: 1 });
  assert.equal(fetch.calls[0].url, "http://api.test/api/config");
  assert.equal(fetch.calls[0].method, "GET");
  assert.equal(fetch.calls[0].headers.authorization, undefined);
  assert.equal(fetch.calls[0].headers.accept, "application/json");
});

test("registerDevice posts the device registration", async () => {
  const fetch = fakeFetch([jsonResponse({ token, deviceId: "d1", user: { login: "octo" } }, 201)]);
  const body = { githubToken: "gho_x", deviceId: "d1", deviceName: "Mac" };
  const result = await createApi({ apiUrl, fetch }).registerDevice(body);
  assert.equal(result.token, token);
  assert.equal(fetch.calls[0].url, "http://api.test/api/devices");
  assert.equal(fetch.calls[0].method, "POST");
  assert.equal(fetch.calls[0].headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(fetch.calls[0].body), body);
});

test("putUsage sends PUT /api/usage with the bearer token", async () => {
  const fetch = fakeFetch([{ upserted: 2 }]);
  const body = { deviceId: "d1", tokscaleVersion: "4.17.0", rows: [{ day: "2026-09-24" }] };
  assert.deepEqual(await createApi({ apiUrl, fetch, token }).putUsage(body), { upserted: 2 });
  assert.equal(fetch.calls[0].method, "PUT");
  assert.equal(fetch.calls[0].url, "http://api.test/api/usage");
  assert.equal(fetch.calls[0].headers.authorization, `Bearer ${token}`);
  assert.deepEqual(JSON.parse(fetch.calls[0].body), body);
});

test("getMe fetches /api/me with the bearer token", async () => {
  const fetch = fakeFetch([{ user: { login: "octo" }, rank: null, devices: [] }]);
  assert.equal((await createApi({ apiUrl, fetch, token }).getMe()).user.login, "octo");
  assert.equal(fetch.calls[0].url, "http://api.test/api/me");
  assert.equal(fetch.calls[0].headers.authorization, `Bearer ${token}`);
});

const failWith = async (reply) => {
  try {
    await createApi({ apiUrl, fetch: fakeFetch([reply]), token }).putUsage({ rows: [] });
  } catch (error) {
    return error;
  }
  assert.fail("expected rejection");
};

test("maps 401 to unauthorized with the server message", async () => {
  const error = await failWith(jsonResponse({ error: { code: "unauthorized", message: "token revoked" } }, 401));
  assert.equal(error.code, "unauthorized");
  assert.equal(error.status, 401);
  assert.match(error.message, /token revoked/);
});

test("maps 403 to forbidden", async () => {
  assert.equal((await failWith(jsonResponse({ error: { code: "forbidden", message: "no" } }, 403))).code, "forbidden");
});

test("maps other errors to upload_failed with status", async () => {
  const badRequest = await failWith(jsonResponse({ error: { code: "invalid_request", message: "bad row" } }, 400));
  assert.equal(badRequest.code, "upload_failed");
  assert.equal(badRequest.status, 400);
  const serverError = await failWith(new Response("oops", { status: 502 }));
  assert.equal(serverError.code, "upload_failed");
  assert.equal(serverError.status, 502);
});

test("maps fetch rejection to network", async () => {
  const error = await failWith(new TypeError("fetch failed"));
  assert.equal(error.code, "network");
  assert.equal(error.status, undefined);
});

test("returns null for empty success bodies", async () => {
  const fetch = fakeFetch([new Response(null, { status: 204 })]);
  assert.equal(await createApi({ apiUrl, fetch, token }).getMe(), null);
});
