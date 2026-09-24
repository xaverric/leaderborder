import { createScheduler } from "./scheduler.js";
import { errorMessage, normalizeDeviceCode, toView } from "./view-model.js";

export const CURSOR_HINT =
  "No Cursor desktop login found. Run npx leaderborder cursor-login in a terminal to paste a session token, then try again.";

const CURSOR_LOGIN_TIMEOUT_MS = 90_000;

export const isHttpsUrl = (url) => {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
};

export const externalHosts = (apiUrl) => {
  try {
    return ["github.com", new URL(apiUrl).host];
  } catch {
    return ["github.com"];
  }
};

export const isAllowedExternalUrl = (url, hosts) => isHttpsUrl(url) && hosts.includes(new URL(url).host);

const SIGNED_OUT_CODES = new Set(["unauthorized", "not_logged_in"]);

const toFailure = (error) => ({ code: error?.code ?? null, message: errorMessage(error) });

export const createController = ({ core, openExternal, writeClipboard, loginItem, now, timers, onChange }) => {
  const config = core.getConfig();
  const readLoginItem = () => ({
    available: Boolean(loginItem.available),
    enabled: Boolean(loginItem.available && loginItem.get()),
  });

  let state = null;
  let loginInFlight = null;
  let syncInFlight = null;
  let logoutInFlight = null;
  let session = {
    loading: true,
    signedIn: false,
    syncing: false,
    signingIn: null,
    error: null,
    warning: null,
    notice: null,
    me: null,
    cursor: { loggedIn: false, busy: false, hint: null },
    loginItem: readLoginItem(),
  };

  const view = () => toView({ state, session, now: now() });

  const update = (patch) => {
    session = { ...session, ...patch };
    onChange(view());
    return view();
  };

  const refreshState = async () => {
    try {
      state = await core.loadState({ configDir: config.configDir });
    } catch {
      state = null;
    }
  };

  const openHttps = (url) => {
    if (!isHttpsUrl(url)) return false;
    openExternal(url);
    return true;
  };

  const expire = async () => {
    await Promise.resolve(core.logout()).catch(() => null);
    await refreshState();
    update({ signedIn: false, me: null, error: null, notice: errorMessage({ code: "unauthorized" }) });
  };

  const refreshMe = async () => {
    try {
      const token = await core.keychain.getToken(config);
      if (!token) return;
      const me = await core.createApi({ apiUrl: config.apiUrl, fetch: globalThis.fetch, token }).getMe();
      update({ me: { user: me.user, rank: me.rank ?? null } });
    } catch (error) {
      if (error?.code === "unauthorized") await expire();
    }
  };

  const refreshCursor = async () => {
    const status = await Promise.resolve(core.cursorStatus()).catch(() => ({ loggedIn: false }));
    update({ cursor: { ...session.cursor, loggedIn: Boolean(status?.loggedIn) } });
    return Boolean(status?.loggedIn);
  };

  const performSync = async () => {
    update({ syncing: true });
    try {
      const result = await core.sync({ fetch: globalThis.fetch });
      session = { ...session, error: null, warning: result?.warnings?.[0] ?? null };
      await refreshState();
      await refreshMe();
    } catch (error) {
      await refreshState();
      if (SIGNED_OUT_CODES.has(error?.code)) await expire();
      else session = { ...session, error: toFailure(error), warning: null };
    } finally {
      update({ syncing: false });
    }
  };

  const runSync = () => {
    if (!session.signedIn || logoutInFlight) return Promise.resolve();
    if (syncInFlight) return syncInFlight;
    syncInFlight = performSync().finally(() => {
      syncInFlight = null;
    });
    return syncInFlight;
  };

  const scheduler = createScheduler({
    run: runSync,
    now: () => now().getTime(),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  const init = async () => {
    await refreshState();
    const token = await Promise.resolve(core.keychain.getToken(config)).catch(() => null);
    update({ loading: false, signedIn: Boolean(token), loginItem: readLoginItem() });
    await Promise.all([refreshMe(), refreshCursor()]);
    return view();
  };

  const onCode = (arg) => {
    const code = normalizeDeviceCode(arg);
    update({ signingIn: code });
    openHttps(code.verificationUri);
  };

  const performLogin = async () => {
    try {
      const result = await core.login({ onCode, fetch: globalThis.fetch });
      await refreshState();
      update({ signedIn: true, signingIn: null, notice: null, error: null, me: { user: result?.user ?? null, rank: null } });
      await scheduler.trigger();
    } catch (error) {
      update({ signingIn: null, notice: errorMessage(error) });
    } finally {
      loginInFlight = null;
    }
  };

  const login = () => {
    if (loginInFlight) return loginInFlight;
    if (session.signedIn) return Promise.resolve();
    update({ signingIn: { userCode: null, verificationUri: null }, notice: null });
    loginInFlight = performLogin();
    return loginInFlight;
  };

  const copyCode = () => {
    const code = session.signingIn?.userCode;
    if (!code) return false;
    writeClipboard(code);
    return true;
  };

  const openGithub = () => Boolean(session.signingIn) && openHttps(session.signingIn.verificationUri);

  const performLogout = async () => {
    await syncInFlight;
    try {
      await core.logout();
    } catch (error) {
      return update({ error: toFailure(error) });
    }
    await refreshState();
    return update({ signedIn: false, me: null, error: null, notice: null });
  };

  const logout = () => {
    if (logoutInFlight) return logoutInFlight;
    logoutInFlight = performLogout().finally(() => {
      logoutInFlight = null;
    });
    return logoutInFlight;
  };

  const withTimeout = (promise, ms) =>
    new Promise((resolve, reject) => {
      const id = timers.setTimer(() => reject(new Error("Cursor login timed out")), ms);
      Promise.resolve(promise).then(
        (value) => (timers.clearTimer(id), resolve(value)),
        (error) => (timers.clearTimer(id), reject(error)),
      );
    });

  const cursorLogin = async () => {
    if (session.cursor.busy) return view();
    update({ cursor: { ...session.cursor, busy: true, hint: null } });
    await withTimeout(core.cursorLogin({ stdio: "pipe" }), CURSOR_LOGIN_TIMEOUT_MS).catch(() => null);
    const connected = await refreshCursor();
    update({ cursor: { loggedIn: connected, busy: false, hint: connected ? null : CURSOR_HINT } });
    if (connected) await scheduler.trigger();
    return view();
  };

  const openLeaderboard = () => {
    try {
      return openHttps(new URL("/app", config.apiUrl).href);
    } catch {
      return false;
    }
  };

  const setLoginItem = (enabled) => {
    if (!loginItem.available) return view();
    loginItem.set(Boolean(enabled));
    return update({ loginItem: readLoginItem() });
  };

  return {
    init,
    start: () => scheduler.start(),
    resume: () => scheduler.resume(),
    stop: () => scheduler.stop(),
    view,
    refresh: () => update({}),
    syncNow: () => scheduler.trigger(),
    login,
    copyCode,
    openGithub,
    logout,
    cursorLogin,
    openLeaderboard,
    setLoginItem,
  };
};
