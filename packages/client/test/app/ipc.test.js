import { test } from "node:test";
import assert from "node:assert/strict";
import { CHANNELS, createHandlers, isTrustedUrl, registerIpc } from "../../src/app/ipc.js";

const INDEX = "file:///Applications/Leaderborder.app/Contents/Resources/app.asar/src/app/renderer/index.html";

const fakeController = () => {
  const calls = [];
  const record = (name) => (...args) => (calls.push([name, ...args]), { kind: "idle" });
  return {
    calls,
    controller: {
      view: record("view"),
      syncNow: record("syncNow"),
      login: record("login"),
      copyCode: record("copyCode"),
      openGithub: record("openGithub"),
      logout: record("logout"),
      cursorLogin: record("cursorLogin"),
      openLeaderboard: record("openLeaderboard"),
      setLoginItem: record("setLoginItem"),
    },
  };
};

test("handlers cover exactly the channels", () => {
  const { controller } = fakeController();
  assert.deepEqual(Object.keys(createHandlers({ controller, quit: () => {} })).sort(), [...CHANNELS].sort());
  assert.deepEqual(CHANNELS, [
    "state:get",
    "sync:now",
    "auth:login",
    "auth:copy-code",
    "auth:open-github",
    "auth:logout",
    "cursor:login",
    "open:leaderboard",
    "app:quit",
    "login-item:set",
  ]);
});

test("login-item:set only accepts a literal true", async () => {
  const { controller, calls } = fakeController();
  const handlers = createHandlers({ controller, quit: () => {} });
  await handlers["login-item:set"]("yes");
  await handlers["login-item:set"](true);
  assert.deepEqual(
    calls.filter(([name]) => name === "setLoginItem"),
    [
      ["setLoginItem", false],
      ["setLoginItem", true],
    ],
  );
});

test("long running actions return the current view without waiting", async () => {
  const { controller } = fakeController();
  controller.syncNow = () => new Promise(() => {});
  controller.login = () => new Promise(() => {});
  controller.cursorLogin = () => new Promise(() => {});
  const handlers = createHandlers({ controller, quit: () => {} });
  assert.deepEqual(await handlers["sync:now"](), { kind: "idle" });
  assert.deepEqual(await handlers["auth:login"](), { kind: "idle" });
  assert.deepEqual(await handlers["cursor:login"](), { kind: "idle" });
});

test("app:quit calls quit", async () => {
  const { controller } = fakeController();
  let quits = 0;
  await createHandlers({ controller, quit: () => quits++ })["app:quit"]();
  assert.equal(quits, 1);
});

test("isTrustedUrl compares protocol and path only", () => {
  assert.equal(isTrustedUrl(INDEX, INDEX), true);
  assert.equal(isTrustedUrl(INDEX, `${INDEX}#top`), true);
  assert.equal(isTrustedUrl(INDEX, `${INDEX}?x=1`), true);
  assert.equal(isTrustedUrl(INDEX, INDEX.replace("index.html", "other.html")), false);
  assert.equal(isTrustedUrl(INDEX, "https://evil.example/index.html"), false);
  assert.equal(isTrustedUrl(INDEX, undefined), false);
  assert.equal(isTrustedUrl(INDEX, "::"), false);
});

test("registerIpc rejects untrusted senders", async () => {
  const registered = new Map();
  const ipcMain = { handle: (channel, fn) => registered.set(channel, fn) };
  const { controller, calls } = fakeController();
  registerIpc({ ipcMain, handlers: createHandlers({ controller, quit: () => {} }), expectedHref: INDEX });
  assert.deepEqual([...registered.keys()], CHANNELS);
  await assert.rejects(
    async () => registered.get("state:get")({ senderFrame: { url: "https://evil.example/" } }),
    /Untrusted sender/,
  );
  await assert.rejects(async () => registered.get("state:get")({ senderFrame: null }), /Untrusted sender/);
  assert.deepEqual(await registered.get("state:get")({ senderFrame: { url: INDEX } }), { kind: "idle" });
  assert.equal(calls.length, 1);
});
