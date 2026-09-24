import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  powerMonitor,
  screen,
  session,
  shell,
  Tray,
} from "electron";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createController, isHttpsUrl } from "./controller.js";
import { createFakeCore } from "./fake-core.js";
import { createHandlers, registerIpc } from "./ipc.js";
import { POPOVER_SIZE, popoverPosition, shouldShowOnClick } from "./position.js";

const FAKE_CORE = process.env.LEADERBORDER_FAKE_CORE === "1";
const PAPER = { light: "#fcfcfd", dark: "#0f1012" };
const FIRST_SHOW_DELAY_MS = 400;

const resolveHere = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const INDEX_PATH = resolveHere("./renderer/index.html");
const INDEX_HREF = pathToFileURL(INDEX_PATH).href;
const PRELOAD_PATH = resolveHere("./preload.cjs");
const TRAY_ICON_PATH = resolveHere("../../assets/trayTemplate.png");

const loadCore = async () =>
  FAKE_CORE ? createFakeCore({ signedIn: process.env.LEADERBORDER_FAKE_SIGNED_IN === "1" }) : import("../core/index.js");

const openExternal = (url) => {
  if (!isHttpsUrl(url)) return;
  if (FAKE_CORE) console.log(`[fake-core] openExternal ${url}`);
  else shell.openExternal(url).catch(() => null);
};

const hardenContents = () => {
  app.on("web-contents-created", (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      openExternal(url);
      return { action: "deny" };
    });
    contents.on("will-navigate", (event) => event.preventDefault());
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });
};

const paperColor = () => (nativeTheme.shouldUseDarkColors ? PAPER.dark : PAPER.light);

const createPopover = () =>
  new BrowserWindow({
    ...POPOVER_SIZE,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: paperColor(),
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });

const createTray = () => {
  const icon = nativeImage.createFromPath(TRAY_ICON_PATH);
  icon.setTemplateImage(true);
  const tray = new Tray(icon);
  tray.setToolTip("Leaderborder");
  tray.setIgnoreDoubleClickEvents(true);
  return tray;
};

const trayMenu = (controller, showPopover) =>
  Menu.buildFromTemplate([
    { label: "Open Leaderborder", click: showPopover },
    { label: "Sync now", click: () => controller.syncNow() },
    { type: "separator" },
    { label: "Quit Leaderborder", click: () => app.quit() },
  ]);

const run = async () => {
  const core = await loadCore();
  let tray = null;
  let win = null;
  let quitting = false;
  let lastHiddenAt = null;

  const controller = createController({
    core,
    openExternal,
    writeClipboard: (text) => clipboard.writeText(text),
    loginItem: {
      available: app.isPackaged && !FAKE_CORE,
      get: () => app.getLoginItemSettings().openAtLogin,
      set: (openAtLogin) => app.setLoginItemSettings({ openAtLogin }),
    },
    now: () => new Date(),
    timers: { setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (id) => clearTimeout(id) },
    onChange: (view) => {
      tray?.setTitle(view.trayTitle ? ` ${view.trayTitle}` : "", { fontType: "monospacedDigit" });
      if (win && !win.isDestroyed()) win.webContents.send("state:changed", view);
    },
  });

  registerIpc({ ipcMain, handlers: createHandlers({ controller, quit: () => app.quit() }), expectedHref: INDEX_HREF });

  await app.whenReady();
  app.dock?.hide();
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));

  win = createPopover();
  tray = createTray();

  const hidePopover = () => {
    if (!win.isVisible()) return;
    win.hide();
    lastHiddenAt = Date.now();
  };

  const showPopover = () => {
    const trayBounds = tray.getBounds();
    const { workArea } = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
    const { x, y } = popoverPosition({ trayBounds, windowSize: POPOVER_SIZE, workArea });
    win.setPosition(x, y, false);
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.show();
    win.focus();
    controller.refresh();
  };

  const togglePopover = () => {
    if (win.isVisible()) return hidePopover();
    if (shouldShowOnClick({ visible: false, lastHiddenAt, now: Date.now() })) showPopover();
  };

  nativeTheme.on("updated", () => win.setBackgroundColor(paperColor()));
  win.on("blur", hidePopover);
  win.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    hidePopover();
  });
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || input.key !== "Escape") return;
    event.preventDefault();
    hidePopover();
  });

  tray.on("click", togglePopover);
  tray.on("right-click", () => tray.popUpContextMenu(trayMenu(controller, showPopover)));

  app.on("second-instance", showPopover);
  app.on("window-all-closed", () => null);
  app.on("before-quit", () => {
    quitting = true;
    controller.stop();
  });
  powerMonitor.on("resume", () => controller.resume());

  await win.loadFile(INDEX_PATH);
  const view = await controller.init();
  controller.start();
  if (view.kind === "signed-out") setTimeout(showPopover, FIRST_SHOW_DELAY_MS);
};

if (FAKE_CORE) app.setPath("userData", join(tmpdir(), `leaderborder-fake-${process.pid}`));

hardenContents();

if (app.requestSingleInstanceLock()) {
  run().catch((error) => {
    console.error(error);
    app.exit(1);
  });
} else {
  app.quit();
}
