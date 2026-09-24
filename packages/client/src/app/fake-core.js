const FAKE_TOKEN = "lb_fake";
const FAKE_USER = { login: "octocat", name: "Octo Cat", avatarUrl: null };
const FAKE_SUMMARY = {
  today: { tokens: 1_284_311, costUsd: 3.84 },
  week: { tokens: 18_902_550, costUsd: 51.2 },
  topModel: "claude-opus-5",
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fakeError = (code, message) => Object.assign(new Error(message), { name: "LeaderborderError", code });

export const createFakeCore = ({
  signedIn = false,
  cursorLoggedIn = false,
  cursorLoginOk = false,
  loginDelayMs = 400,
  syncDelayMs = 600,
  now = () => new Date(),
} = {}) => {
  let token = signedIn ? FAKE_TOKEN : null;
  let cursor = cursorLoggedIn;
  let state = {
    deviceId: signedIn ? "00000000-0000-4000-8000-000000000000" : null,
    deviceName: "Fake Mac",
    lastSyncAt: signedIn ? new Date(now().getTime() - 25 * 60_000).toISOString() : null,
    lastError: null,
    summary: signedIn ? FAKE_SUMMARY : null,
  };

  const getMe = (bearer) => async () => {
    if (!token || bearer !== token) throw fakeError("unauthorized", "Unauthorized");
    return {
      user: FAKE_USER,
      rank: { period: "week", metric: "tokens", position: 3, of: 12, value: FAKE_SUMMARY.week.tokens },
      devices: [],
    };
  };

  return {
    getConfig: () => ({ apiUrl: "https://leaderborder.xaverric.cz", configDir: "/tmp/leaderborder-fake" }),
    loadState: () => ({ ...state }),
    saveState: (_config, next) => {
      state = { ...next };
    },
    keychain: {
      getToken: async () => token,
      setToken: async (next) => {
        token = next;
      },
      deleteToken: async () => {
        token = null;
      },
    },
    createApi: ({ token: bearer }) => ({
      getConfig: async () => ({ githubClientId: "fake", apiVersion: 1 }),
      registerDevice: async () => ({ token: FAKE_TOKEN, deviceId: state.deviceId, user: FAKE_USER }),
      putUsage: async ({ rows }) => ({ upserted: rows.length }),
      getMe: getMe(bearer),
    }),
    login: async ({ onCode }) => {
      await wait(20);
      onCode({ userCode: "FAKE-1234", verificationUri: "https://github.com/login/device" });
      await wait(loginDelayMs);
      token = FAKE_TOKEN;
      state = { ...state, deviceId: "00000000-0000-4000-8000-000000000000" };
      return { user: FAKE_USER };
    },
    logout: async () => {
      token = null;
      state = { ...state, deviceId: null };
    },
    sync: async () => {
      if (!token) throw fakeError("not_logged_in", "Not logged in");
      await wait(syncDelayMs);
      state = { ...state, lastSyncAt: now().toISOString(), lastError: null, summary: FAKE_SUMMARY };
      return { rows: [], since: null, summary: FAKE_SUMMARY, warnings: [], uploaded: 0 };
    },
    cursorStatus: async () => ({ loggedIn: cursor }),
    cursorLogin: async () => {
      if (!cursorLoginOk) throw fakeError("tokscale_failed", "Cursor session not found");
      cursor = true;
    },
  };
};
