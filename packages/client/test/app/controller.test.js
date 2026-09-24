import { test } from "node:test";
import assert from "node:assert/strict";
import { createController, CURSOR_HINT, externalHosts, isAllowedExternalUrl, isHttpsUrl } from "../../src/app/controller.js";
import { createFakeCore } from "../../src/app/fake-core.js";

const NOW = new Date("2026-09-24T12:00:00Z");

const coreError = (code, message = code) => Object.assign(new Error(message), { code });

const setup = ({ core = createFakeCore({ loginDelayMs: 0, syncDelayMs: 0, now: () => NOW }), loginItem } = {}) => {
  const opened = [];
  const copied = [];
  const views = [];
  const pending = new Map();
  let nextId = 1;
  const controller = createController({
    core,
    openExternal: (url) => opened.push(url),
    writeClipboard: (text) => copied.push(text),
    loginItem: loginItem ?? { available: false, get: () => false, set: () => {} },
    now: () => NOW,
    timers: {
      setTimer: (fn, ms) => {
        const id = nextId++;
        pending.set(id, ms);
        return id;
      },
      clearTimer: (id) => pending.delete(id),
    },
    onChange: (view) => views.push(view),
  });
  return { controller, core, opened, copied, views, pending };
};

test("isHttpsUrl", () => {
  assert.equal(isHttpsUrl("https://github.com/login/device"), true);
  assert.equal(isHttpsUrl("http://github.com"), false);
  assert.equal(isHttpsUrl("file:///etc/passwd"), false);
  assert.equal(isHttpsUrl("javascript:alert(1)"), false);
  assert.equal(isHttpsUrl("not a url"), false);
  assert.equal(isHttpsUrl(undefined), false);
});

test("externalHosts allows GitHub and the configured API host", () => {
  assert.deepEqual(externalHosts("https://leaderborder.xaverric.cz"), ["github.com", "leaderborder.xaverric.cz"]);
  assert.deepEqual(externalHosts("https://staging.test:8443/"), ["github.com", "staging.test:8443"]);
  assert.deepEqual(externalHosts("not a url"), ["github.com"]);
});

test("isAllowedExternalUrl requires https and an allowed host", () => {
  const hosts = externalHosts("https://leaderborder.xaverric.cz");
  assert.equal(isAllowedExternalUrl("https://github.com/login/device", hosts), true);
  assert.equal(isAllowedExternalUrl("https://leaderborder.xaverric.cz/app", hosts), true);
  assert.equal(isAllowedExternalUrl("https://evil.test/github.com", hosts), false);
  assert.equal(isAllowedExternalUrl("https://github.com.evil.test/", hosts), false);
  assert.equal(isAllowedExternalUrl("https://github.com:8443/", hosts), false);
  assert.equal(isAllowedExternalUrl("https://user@github.com/", hosts), true);
  assert.equal(isAllowedExternalUrl("http://github.com/", hosts), false);
  assert.equal(isAllowedExternalUrl("file:///etc/passwd", hosts), false);
  assert.equal(isAllowedExternalUrl("javascript:alert(1)", hosts), false);
  assert.equal(isAllowedExternalUrl(undefined, hosts), false);
});

test("init while signed out shows the signed-out view", async () => {
  const { controller, views } = setup();
  const view = await controller.init();
  assert.equal(view.kind, "signed-out");
  assert.equal(views.at(-1).kind, "signed-out");
});

test("init while signed in loads me and cursor status", async () => {
  const core = createFakeCore({ signedIn: true, cursorLoggedIn: true, now: () => NOW });
  const { controller } = setup({ core });
  const view = await controller.init();
  assert.equal(view.kind, "idle");
  assert.equal(view.user.login, "octocat");
  assert.equal(view.cursor.connected, true);
});

test("login shows the device code, opens GitHub, then syncs", async () => {
  const { controller, opened, views } = setup();
  await controller.init();
  const done = controller.login();
  assert.equal(controller.view().kind, "signing-in");
  await done;
  const codeView = views.find((v) => v.kind === "signing-in" && v.userCode);
  assert.equal(codeView.userCode, "FAKE-1234");
  assert.deepEqual(opened, ["https://github.com/login/device"]);
  assert.ok(views.some((v) => v.kind === "syncing"));
  const view = controller.view();
  assert.equal(view.kind, "idle");
  assert.equal(view.today.tokens, "1.3M");
  assert.equal(view.rank.label, "#3");
  assert.equal(view.lastSync, "Just now");
});

test("login ignores a non-https verification URI", async () => {
  const core = {
    ...createFakeCore({ now: () => NOW }),
    login: async ({ onCode }) => {
      onCode({ user_code: "EVIL-0001", verification_uri: "file:///Applications" });
      throw coreError("network", "offline");
    },
  };
  const { controller, opened, views } = setup({ core });
  await controller.init();
  await controller.login();
  assert.deepEqual(opened, []);
  assert.ok(views.some((v) => v.userCode === "EVIL-0001"));
});

test("a second login call while signing in is ignored", async () => {
  let calls = 0;
  const base = createFakeCore({ loginDelayMs: 0, syncDelayMs: 0, now: () => NOW });
  const core = { ...base, login: (args) => (calls++, base.login(args)) };
  const { controller } = setup({ core });
  await controller.init();
  const first = controller.login();
  const second = controller.login();
  await Promise.all([first, second]);
  assert.equal(calls, 1);
});

test("forbidden login returns to signed-out with a notice", async () => {
  const core = { ...createFakeCore({ now: () => NOW }), login: async () => Promise.reject(coreError("forbidden")) };
  const { controller } = setup({ core });
  await controller.init();
  await controller.login();
  const view = controller.view();
  assert.equal(view.kind, "signed-out");
  assert.match(view.notice, /Access requested/);
});

test("copyCode copies only the current device code", async () => {
  let approve;
  const approved = new Promise((resolve) => (approve = resolve));
  const base = createFakeCore({ syncDelayMs: 0, now: () => NOW });
  const core = {
    ...base,
    login: async ({ onCode }) => {
      onCode({ userCode: "WXYZ-9876", verificationUri: "https://github.com/login/device" });
      await approved;
      return { user: { login: "octocat" } };
    },
  };
  const { controller, copied, opened } = setup({ core });
  await controller.init();
  assert.equal(controller.copyCode(), false);
  const done = controller.login();
  assert.equal(controller.copyCode(), true);
  assert.deepEqual(copied, ["WXYZ-9876"]);
  assert.equal(controller.openGithub(), true);
  assert.deepEqual(opened, ["https://github.com/login/device", "https://github.com/login/device"]);
  approve();
  await done;
  assert.equal(controller.copyCode(), false);
  assert.equal(controller.openGithub(), false);
});

test("syncNow while signed out does nothing", async () => {
  let syncs = 0;
  const core = { ...createFakeCore({ now: () => NOW }), sync: async () => syncs++ };
  const { controller } = setup({ core });
  await controller.init();
  await controller.syncNow();
  assert.equal(syncs, 0);
  assert.equal(controller.view().kind, "signed-out");
});

test("sync failure shows an error and the next success clears it", async () => {
  const base = createFakeCore({ signedIn: true, syncDelayMs: 0, now: () => NOW });
  let fail = true;
  const core = {
    ...base,
    sync: (args) => (fail ? Promise.reject(coreError("tokscale_failed", "spawn ENOENT")) : base.sync(args)),
  };
  const { controller } = setup({ core });
  await controller.init();
  await controller.syncNow();
  assert.equal(controller.view().kind, "error");
  assert.match(controller.view().errorMessage, /local usage/);
  fail = false;
  await controller.syncNow();
  assert.equal(controller.view().kind, "idle");
});

test("unauthorized sync signs out with a notice", async () => {
  const core = {
    ...createFakeCore({ signedIn: true, now: () => NOW }),
    sync: async () => Promise.reject(coreError("unauthorized")),
  };
  const { controller } = setup({ core });
  await controller.init();
  await controller.syncNow();
  const view = controller.view();
  assert.equal(view.kind, "signed-out");
  assert.match(view.notice, /Sign in again/);
});

test("start schedules the startup sync and stop clears it", async () => {
  const { controller, pending } = setup();
  await controller.init();
  controller.start();
  assert.deepEqual([...pending.values()], [10_000]);
  controller.stop();
  assert.deepEqual([...pending.values()], []);
});

test("logout returns to signed-out", async () => {
  const core = createFakeCore({ signedIn: true, now: () => NOW });
  const { controller } = setup({ core });
  await controller.init();
  await controller.logout();
  assert.equal(controller.view().kind, "signed-out");
  assert.equal(await core.keychain.getToken(), null);
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("logout waits for an in-flight sync before revoking", async () => {
  const events = [];
  let finishSync;
  const base = createFakeCore({ signedIn: true, syncDelayMs: 0, now: () => NOW });
  const core = {
    ...base,
    sync: async (args) => {
      events.push("sync:start");
      await new Promise((resolve) => (finishSync = resolve));
      events.push("sync:end");
      return base.sync(args);
    },
    logout: async () => {
      events.push("logout");
      return base.logout();
    },
  };
  const { controller } = setup({ core });
  await controller.init();
  const syncing = controller.syncNow();
  const loggingOut = controller.logout();
  assert.equal(controller.logout(), loggingOut);
  await tick();
  assert.deepEqual(events, ["sync:start"]);
  finishSync();
  await Promise.all([syncing, loggingOut]);
  assert.deepEqual(events, ["sync:start", "sync:end", "logout"]);
  assert.equal(controller.view().kind, "signed-out");
});

test("no sync starts while a logout is pending", async () => {
  const events = [];
  let finishLogout;
  const base = createFakeCore({ signedIn: true, syncDelayMs: 0, now: () => NOW });
  const core = {
    ...base,
    sync: async (args) => {
      events.push("sync");
      return base.sync(args);
    },
    logout: async () => {
      events.push("logout:start");
      await new Promise((resolve) => (finishLogout = resolve));
      events.push("logout:end");
      return base.logout();
    },
  };
  const { controller } = setup({ core });
  await controller.init();
  const loggingOut = controller.logout();
  await tick();
  const syncing = controller.syncNow();
  await tick();
  assert.deepEqual(events, ["logout:start"]);
  finishLogout();
  await Promise.all([loggingOut, syncing]);
  assert.deepEqual(events, ["logout:start", "logout:end"]);
  assert.equal(controller.view().kind, "signed-out");
});

test("concurrent syncNow calls share one sync", async () => {
  let syncs = 0;
  const base = createFakeCore({ signedIn: true, syncDelayMs: 0, now: () => NOW });
  const core = { ...base, sync: async (args) => (syncs++, base.sync(args)) };
  const { controller } = setup({ core });
  await controller.init();
  await Promise.all([controller.syncNow(), controller.syncNow()]);
  assert.equal(syncs, 1);
});

test("cursorLogin failure shows the terminal instruction", async () => {
  const core = createFakeCore({ signedIn: true, now: () => NOW });
  const { controller } = setup({ core });
  await controller.init();
  await controller.cursorLogin();
  const view = controller.view();
  assert.equal(view.cursor.connected, false);
  assert.equal(view.cursor.busy, false);
  assert.equal(view.cursor.hint, CURSOR_HINT);
  assert.match(CURSOR_HINT, /npx leaderborder cursor-login/);
});

test("cursorLogin passes stdio pipe and connects on success", async () => {
  const base = createFakeCore({ signedIn: true, cursorLoginOk: true, syncDelayMs: 0, now: () => NOW });
  const calls = [];
  const core = { ...base, cursorLogin: (options) => (calls.push(options), base.cursorLogin(options)) };
  const { controller } = setup({ core });
  await controller.init();
  await controller.cursorLogin();
  assert.deepEqual(calls, [{ stdio: "pipe" }]);
  assert.equal(controller.view().cursor.connected, true);
  assert.equal(controller.view().cursor.hint, null);
});

test("openLeaderboard opens the https app URL only", async () => {
  const { controller, opened } = setup();
  await controller.init();
  assert.equal(controller.openLeaderboard(), true);
  assert.deepEqual(opened, ["https://leaderborder.xaverric.cz/app"]);

  const insecure = setup({
    core: { ...createFakeCore(), getConfig: () => ({ apiUrl: "http://localhost:8787", configDir: "/x" }) },
  });
  await insecure.controller.init();
  assert.equal(insecure.controller.openLeaderboard(), false);
  assert.deepEqual(insecure.opened, []);
});

test("setLoginItem is ignored when unavailable", async () => {
  const calls = [];
  const { controller } = setup({
    core: createFakeCore({ signedIn: true, now: () => NOW }),
    loginItem: { available: false, get: () => false, set: (value) => calls.push(value) },
  });
  await controller.init();
  controller.setLoginItem(true);
  assert.deepEqual(calls, []);
  assert.equal(controller.view().loginItem.available, false);
});

test("setLoginItem toggles when available", async () => {
  let enabled = false;
  const { controller } = setup({
    core: createFakeCore({ signedIn: true, now: () => NOW }),
    loginItem: { available: true, get: () => enabled, set: (value) => (enabled = value) },
  });
  await controller.init();
  const view = controller.setLoginItem(true);
  assert.equal(enabled, true);
  assert.deepEqual(view.loginItem, { available: true, enabled: true });
});

test("view is loading until init finishes", async () => {
  const { controller } = setup({ core: createFakeCore({ signedIn: true, now: () => NOW }) });
  assert.equal(controller.view().kind, "loading");
  await controller.init();
  assert.equal(controller.view().kind, "idle");
});

test("not_logged_in sync signs out", async () => {
  const core = {
    ...createFakeCore({ signedIn: true, now: () => NOW }),
    sync: async () => Promise.reject(coreError("not_logged_in")),
  };
  const { controller } = setup({ core });
  await controller.init();
  await controller.syncNow();
  assert.equal(controller.view().kind, "signed-out");
});

test("sync warnings surface on the account view and clear on the next clean sync", async () => {
  const base = createFakeCore({ signedIn: true, syncDelayMs: 0, now: () => NOW });
  let warnings = ["Cursor sync skipped: offline"];
  const core = { ...base, sync: async (args) => ({ ...(await base.sync(args)), warnings }) };
  const { controller } = setup({ core });
  await controller.init();
  await controller.syncNow();
  assert.equal(controller.view().kind, "idle");
  assert.equal(controller.view().warning, "Cursor sync skipped");
  warnings = [];
  await controller.syncNow();
  assert.equal(controller.view().warning, null);
});
