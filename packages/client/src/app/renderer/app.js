const api = window.leaderborder;
const CURSOR_COMMAND = "npx leaderborder cursor-login";
const FLASH_MS = 1600;
const REFRESH_MS = 30_000;

const SCREEN_BY_KIND = {
  loading: null,
  "signed-out": "signed-out",
  "signing-in": "signing-in",
  idle: "account",
  syncing: "account",
  error: "account",
};

const STATUS_BY_KIND = {
  loading: () => "",
  "signed-out": () => "Signed out",
  "signing-in": () => "Connecting",
  idle: (view) => `Synced ${view.lastSync.toLowerCase()}`,
  syncing: () => "Syncing",
  error: () => "Sync failed",
};

const flashes = new Map();
let current = null;

const all = (selector) => [...document.querySelectorAll(selector)];

const setText = (name, value) => {
  for (const el of all(`[data-field="${name}"]`)) el.textContent = value ?? "";
};

const toggle = (name, visible) => {
  for (const el of all(`[data-show="${name}"]`)) el.hidden = !visible;
};

const button = (action) => document.querySelector(`[data-action="${action}"]`);

const setButton = (action, { label, state = null, disabled = false }) => {
  const el = button(action);
  if (!el) return;
  const flash = flashes.get(action);
  const next = flash ?? { label, state };
  el.querySelector(".btn__label").textContent = next.label;
  if (next.state) el.dataset.state = next.state;
  else delete el.dataset.state;
  el.setAttribute("aria-busy", String(next.state === "loading"));
  el.disabled = disabled;
};

const flash = (action, label, state) => {
  clearTimeout(flashes.get(action)?.timer);
  const timer = setTimeout(() => {
    flashes.delete(action);
    if (current) render(current);
  }, FLASH_MS);
  flashes.set(action, { label, state, timer });
  if (current) render(current);
};

const hintNodes = (text) => {
  const index = text.indexOf(CURSOR_COMMAND);
  if (index === -1) return [document.createTextNode(text)];
  const code = document.createElement("code");
  code.textContent = CURSOR_COMMAND;
  return [
    document.createTextNode(text.slice(0, index)),
    code,
    document.createTextNode(text.slice(index + CURSOR_COMMAND.length)),
  ];
};

const renderUser = (user) => {
  const img = document.querySelector('[data-field="avatar"]');
  const avatarUrl = user?.avatarUrl ?? "";
  const hasAvatar = avatarUrl.startsWith("https://avatars.githubusercontent.com/");
  img.hidden = !hasAvatar;
  if (hasAvatar && img.getAttribute("src") !== avatarUrl) img.src = avatarUrl;
  if (!hasAvatar) img.removeAttribute("src");
  const login = user?.login ?? "";
  setText("initial", (user?.name || login || "?").slice(0, 1).toUpperCase());
  setText("user-login", login ? `@${login}` : "Signed in");
};

const renderAccount = (view) => {
  renderUser(view.user);
  setText("today-tokens", view.today.tokens);
  setText("today-cost", view.today.cost);
  setText("week-tokens", view.week.tokens);
  setText("week-cost", view.week.cost);
  setText("rank-label", view.rank?.label ?? "-");
  setText("rank-detail", view.rank?.detail ?? "after first sync");
  setText("top-model", view.topModel ?? "No usage yet");
  setText("error-message", view.errorMessage);
  toggle("error", view.kind === "error");
  setText("warning", view.warning);
  toggle("warning", Boolean(view.warning) && view.kind !== "error");

  const syncing = view.kind === "syncing";
  setButton("sync", {
    label: syncing ? "Syncing" : view.kind === "error" ? "Retry sync" : "Sync now",
    state: syncing ? "loading" : view.kind === "error" ? "error" : null,
  });

  setText("cursor-status", view.cursor.connected ? "Connected" : "Not connected");
  document.querySelector(".setting__value").dataset.tone = view.cursor.connected ? "positive" : "muted";
  toggle("cursor-connect", !view.cursor.connected);
  setButton("cursor-login", {
    label: view.cursor.busy ? "Connecting" : "Connect Cursor",
    state: view.cursor.busy ? "loading" : null,
  });
  const hint = document.querySelector('[data-show="cursor-hint"]');
  hint.replaceChildren(...(view.cursor.hint ? hintNodes(view.cursor.hint) : []));
  hint.hidden = !view.cursor.hint;

  toggle("login-item", view.loginItem.available);
  button("login-item").setAttribute("aria-checked", String(view.loginItem.enabled));
};

const renderSignedOut = (view) => {
  setText("notice", view.notice);
  toggle("notice", Boolean(view.notice));
  setButton("login", { label: "Sign in with GitHub" });
};

const renderSigningIn = (view) => {
  setText("user-code", view.userCode);
  toggle("code", Boolean(view.userCode));
  toggle("code-pending", !view.userCode);
  setButton("copy-code", { label: "Copy code", disabled: !view.userCode });
  setButton("open-github", { label: "Open GitHub", disabled: !view.verificationUri });
};

const RENDERERS = { "signed-out": renderSignedOut, "signing-in": renderSigningIn, account: renderAccount };

const focusScreen = (screen) => {
  const target = all("[data-autofocus]").find((el) => !el.closest("[hidden]") && el.closest(`[data-screen="${screen}"], .pop__action`));
  if (target && !target.disabled) target.focus({ preventScroll: true });
};

function render(view) {
  if (!view || !(view.kind in SCREEN_BY_KIND)) return;
  const previous = current ? SCREEN_BY_KIND[current.kind] : null;
  const wasSyncing = current?.kind === "syncing";
  current = view;
  const screen = SCREEN_BY_KIND[view.kind];
  document.body.dataset.kind = view.kind;
  for (const el of all("[data-screen]")) el.hidden = el.dataset.screen !== screen;
  setText("status-text", STATUS_BY_KIND[view.kind](view));
  toggle("account", screen === "account");
  RENDERERS[screen]?.(view);
  if (wasSyncing && view.kind === "idle") flash("sync", "Synced", "success");
  const focusLost = document.activeElement === document.body || document.activeElement?.closest("[hidden]");
  if (previous && previous !== screen && focusLost) focusScreen(screen);
}

const perform = async (action, run) => {
  try {
    const result = await run();
    if (result && typeof result === "object" && "kind" in result) render(result);
    return result;
  } catch {
    flash(action, "Try again", "error");
    return null;
  }
};

const ACTIONS = {
  login: () => {
    setButton("login", { label: "Opening GitHub", state: "loading" });
    return perform("login", api.login);
  },
  "copy-code": async () => {
    const copied = await perform("copy-code", api.copyCode);
    if (copied === true) flash("copy-code", "Copied", "success");
  },
  "open-github": () => perform("open-github", api.openGithub),
  sync: () => perform("sync", api.syncNow),
  "cursor-login": () => perform("cursor-login", api.cursorLogin),
  "login-item": () => perform("login-item", () => api.setLoginItem(!current?.loginItem?.enabled)),
  "open-leaderboard": () => perform("open-leaderboard", api.openLeaderboard),
  logout: () => perform("logout", api.logout),
  quit: () => perform("quit", api.quit),
};

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target || target.disabled || target.dataset.state === "loading") return;
  ACTIONS[target.dataset.action]?.();
});

api.onState(render);
perform("state", api.getState);
setInterval(() => {
  if (document.visibilityState === "visible") perform("state", api.getState);
}, REFRESH_MS);
