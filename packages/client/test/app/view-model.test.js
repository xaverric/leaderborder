import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compactNumber,
  errorMessage,
  formatCost,
  normalizeDeviceCode,
  relativeTime,
  toView,
} from "../../src/app/view-model.js";

const NOW = new Date("2026-09-24T12:00:00Z");

const baseSession = {
  signedIn: true,
  syncing: false,
  signingIn: null,
  error: null,
  notice: null,
  me: null,
  cursor: { loggedIn: false, busy: false, hint: null },
  loginItem: { available: false, enabled: false },
};

const baseState = {
  deviceId: "d1",
  deviceName: "Mac",
  lastSyncAt: "2026-09-24T11:55:00Z",
  lastError: null,
  summary: {
    today: { tokens: 1_234_567, costUsd: 4.2 },
    week: { tokens: 45_600_000, costUsd: 120.5 },
    topModel: "claude-opus-5",
  },
};

const me = {
  user: { login: "octo", name: "Octo Cat", avatarUrl: "https://avatars.githubusercontent.com/u/1" },
  rank: { period: "week", metric: "tokens", position: 3, of: 12, value: 45_600_000 },
};

test("compactNumber", () => {
  assert.equal(compactNumber(0), "0");
  assert.equal(compactNumber(950), "950");
  assert.equal(compactNumber(1_234), "1.2K");
  assert.equal(compactNumber(12_345), "12.3K");
  assert.equal(compactNumber(123_456), "123K");
  assert.equal(compactNumber(1_000_000), "1M");
  assert.equal(compactNumber(1_234_567), "1.2M");
  assert.equal(compactNumber(999_950), "1M");
  assert.equal(compactNumber(2_500_000_000), "2.5B");
  assert.equal(compactNumber(undefined), "0");
});

test("formatCost", () => {
  assert.equal(formatCost(0), "$0.00");
  assert.equal(formatCost(0.424), "$0.42");
  assert.equal(formatCost(12.3), "$12.30");
  assert.equal(formatCost(1_234), "$1.2K");
  assert.equal(formatCost(null), "$0.00");
});

test("relativeTime", () => {
  assert.equal(relativeTime(null, NOW), "Never");
  assert.equal(relativeTime("2026-09-24T11:59:30Z", NOW), "Just now");
  assert.equal(relativeTime("2026-09-24T12:00:10Z", NOW), "Just now");
  assert.equal(relativeTime("2026-09-24T11:55:00Z", NOW), "5 min ago");
  assert.equal(relativeTime("2026-09-24T09:00:00Z", NOW), "3 h ago");
  assert.equal(relativeTime("2026-09-22T11:00:00Z", NOW), "2 d ago");
  assert.equal(relativeTime("garbage", NOW), "Never");
});

test("errorMessage maps core codes to friendly copy", () => {
  assert.match(errorMessage({ code: "tokscale_failed", message: "x" }), /local usage/);
  assert.match(errorMessage({ code: "network", message: "x" }), /connection/i);
  assert.match(errorMessage({ code: "upload_failed", message: "x" }), /Upload failed/);
  assert.match(errorMessage({ code: "forbidden", message: "x" }), /Access requested/);
  assert.match(errorMessage({ code: "unauthorized", message: "x" }), /expired or was revoked\. Sign in again/);
});

test("errorMessage never shows raw messages for unknown errors", () => {
  const generic = "Something went wrong. Run leaderborder status in a terminal for details.";
  assert.equal(errorMessage({ message: "Boom" }), generic);
  assert.equal(errorMessage({ code: "weird", message: "\u001b[31mspawn ENOENT /Users/octo/.config" }), generic);
  assert.equal(errorMessage(null), generic);
});

test("normalizeDeviceCode accepts camelCase and GitHub snake_case", () => {
  const expected = { userCode: "ABCD-1234", verificationUri: "https://github.com/login/device" };
  assert.deepEqual(normalizeDeviceCode(expected), expected);
  assert.deepEqual(
    normalizeDeviceCode({ user_code: "ABCD-1234", verification_uri: "https://github.com/login/device" }),
    expected,
  );
  assert.deepEqual(normalizeDeviceCode(undefined), { userCode: null, verificationUri: null });
});

test("signed-out view", () => {
  const view = toView({ state: baseState, session: { ...baseSession, signedIn: false }, now: NOW });
  assert.equal(view.kind, "signed-out");
  assert.equal(view.trayTitle, "");
  assert.equal(view.notice, null);
});

test("signed-out view carries a notice", () => {
  const session = { ...baseSession, signedIn: false, notice: "Your session expired. Sign in again." };
  assert.equal(toView({ state: baseState, session, now: NOW }).notice, session.notice);
});

test("signing-in view shows the code or waits for it", () => {
  const waiting = toView({
    state: baseState,
    session: { ...baseSession, signedIn: false, signingIn: { userCode: null, verificationUri: null } },
    now: NOW,
  });
  assert.equal(waiting.kind, "signing-in");
  assert.equal(waiting.userCode, null);
  const ready = toView({
    state: baseState,
    session: {
      ...baseSession,
      signedIn: false,
      signingIn: { userCode: "ABCD-1234", verificationUri: "https://github.com/login/device" },
    },
    now: NOW,
  });
  assert.equal(ready.userCode, "ABCD-1234");
  assert.equal(ready.verificationUri, "https://github.com/login/device");
});

test("idle view with summary, rank and user", () => {
  const view = toView({ state: baseState, session: { ...baseSession, me }, now: NOW });
  assert.equal(view.kind, "idle");
  assert.equal(view.trayTitle, "1.2M");
  assert.deepEqual(view.today, { tokens: "1.2M", cost: "$4.20" });
  assert.deepEqual(view.week, { tokens: "45.6M", cost: "$120.50" });
  assert.equal(view.topModel, "claude-opus-5");
  assert.deepEqual(view.rank, { label: "#3", detail: "of 12 this week" });
  assert.equal(view.lastSync, "5 min ago");
  assert.deepEqual(view.user, me.user);
  assert.equal(view.errorMessage, null);
});

test("idle view without summary or me", () => {
  const view = toView({
    state: { ...baseState, summary: null, lastSyncAt: null },
    session: baseSession,
    now: NOW,
  });
  assert.equal(view.kind, "idle");
  assert.deepEqual(view.today, { tokens: "0", cost: "$0.00" });
  assert.equal(view.topModel, null);
  assert.equal(view.rank, null);
  assert.equal(view.user, null);
  assert.equal(view.lastSync, "Never");
  assert.equal(view.trayTitle, "0");
});

test("syncing view keeps numbers", () => {
  const view = toView({ state: baseState, session: { ...baseSession, syncing: true }, now: NOW });
  assert.equal(view.kind, "syncing");
  assert.equal(view.today.tokens, "1.2M");
});

test("error view from session error", () => {
  const view = toView({
    state: baseState,
    session: { ...baseSession, error: { code: "network", message: "fetch failed" } },
    now: NOW,
  });
  assert.equal(view.kind, "error");
  assert.match(view.errorMessage, /connection/i);
  assert.equal(view.trayTitle, "1.2M");
});

test("error view from persisted lastError", () => {
  const view = toView({
    state: { ...baseState, lastError: { code: "tokscale_failed", message: "x", at: "2026-09-24T11:00:00Z" } },
    session: baseSession,
    now: NOW,
  });
  assert.equal(view.kind, "error");
  assert.match(view.errorMessage, /local usage/);
});

test("syncing wins over a previous error", () => {
  const view = toView({
    state: baseState,
    session: { ...baseSession, syncing: true, error: { message: "old" } },
    now: NOW,
  });
  assert.equal(view.kind, "syncing");
});

test("cursor and login item pass through", () => {
  const view = toView({
    state: baseState,
    session: {
      ...baseSession,
      cursor: { loggedIn: false, busy: false, hint: "Run it" },
      loginItem: { available: true, enabled: true },
    },
    now: NOW,
  });
  assert.deepEqual(view.cursor, { connected: false, busy: false, hint: "Run it" });
  assert.deepEqual(view.loginItem, { available: true, enabled: true });
});

test("toView tolerates missing state", () => {
  const view = toView({ state: null, session: baseSession, now: NOW });
  assert.equal(view.kind, "idle");
  assert.equal(view.lastSync, "Never");
});

test("loading view before the controller is initialised", () => {
  const view = toView({ state: baseState, session: { ...baseSession, loading: true }, now: NOW });
  assert.deepEqual(view, { kind: "loading", trayTitle: "" });
});

test("warning shows fixed copy without the raw tokscale output", () => {
  const view = toView({ state: baseState, session: { ...baseSession, warning: "Cursor sync skipped: \u001b[31m/Users/octo stderr" }, now: NOW });
  assert.equal(view.kind, "idle");
  assert.equal(view.warning, "Cursor sync skipped");
  assert.equal(toView({ state: baseState, session: baseSession, now: NOW }).warning, null);
});
