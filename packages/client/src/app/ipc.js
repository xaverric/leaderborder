export const CHANNELS = [
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
];

const detach = (controller, action) => () => {
  Promise.resolve(action()).catch(() => null);
  return controller.view();
};

export const createHandlers = ({ controller, quit }) => ({
  "state:get": () => controller.view(),
  "sync:now": detach(controller, () => controller.syncNow()),
  "auth:login": detach(controller, () => controller.login()),
  "auth:copy-code": () => controller.copyCode(),
  "auth:open-github": () => controller.openGithub(),
  "auth:logout": () => controller.logout(),
  "cursor:login": detach(controller, () => controller.cursorLogin()),
  "open:leaderboard": () => controller.openLeaderboard(),
  "app:quit": () => quit(),
  "login-item:set": (enabled) => controller.setLoginItem(enabled === true),
});

export const isTrustedUrl = (expectedHref, actual) => {
  try {
    const expected = new URL(expectedHref);
    const url = new URL(actual);
    return url.protocol === expected.protocol && url.host === expected.host && url.pathname === expected.pathname;
  } catch {
    return false;
  }
};

export const registerIpc = ({ ipcMain, handlers, expectedHref }) => {
  for (const channel of CHANNELS) {
    ipcMain.handle(channel, (event, arg) => {
      if (!event?.senderFrame || event.senderFrame !== event.sender?.mainFrame || !isTrustedUrl(expectedHref, event.senderFrame.url)) throw new Error("Untrusted sender");
      return handlers[channel](arg);
    });
  }
};
