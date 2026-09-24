const UNITS = [
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "K"],
];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const PERIOD_LABELS = { day: "today", week: "this week", month: "this month", all: "all time" };

const ERROR_COPY = {
  tokscale_failed: "Could not read local usage. Leaderborder will retry at the next sync.",
  upload_failed: "Upload failed. Leaderborder will retry at the next sync.",
  network: "No connection to the leaderboard. Leaderborder will retry at the next sync.",
  forbidden: "Your GitHub account is not allowed on this leaderboard.",
  unauthorized: "Your session expired. Sign in again.",
  not_logged_in: "You are signed out. Sign in again.",
};

const trimUnit = (value) => (value < 100 ? value.toFixed(1) : String(Math.round(value))).replace(/\.0$/, "");

const toCount = (value) => (Number.isFinite(value) && value > 0 ? value : 0);

export const compactNumber = (value) => {
  const n = toCount(value);
  const index = UNITS.findIndex(([size]) => n >= size);
  if (index === -1) return String(Math.round(n));
  const [size, suffix] = UNITS[index];
  const text = trimUnit(n / size);
  if (Number(text) < 1000 || index === 0) return `${text}${suffix}`;
  const [bigger, biggerSuffix] = UNITS[index - 1];
  return `${trimUnit(n / bigger)}${biggerSuffix}`;
};

export const formatCost = (usd) => {
  const n = toCount(usd);
  return n >= 1000 ? `$${compactNumber(n)}` : `$${n.toFixed(2)}`;
};

export const relativeTime = (iso, now) => {
  const at = iso ? new Date(iso).getTime() : NaN;
  if (Number.isNaN(at)) return "Never";
  const diff = now.getTime() - at;
  if (diff < MINUTE) return "Just now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} h ago`;
  return `${Math.floor(diff / DAY)} d ago`;
};

export const errorMessage = (error) =>
  ERROR_COPY[error?.code] ?? (error?.message ? String(error.message) : "Something went wrong.");

export const normalizeDeviceCode = (arg) => ({
  userCode: arg?.userCode ?? arg?.user_code ?? null,
  verificationUri: arg?.verificationUri ?? arg?.verification_uri ?? null,
});

const toRank = (rank) =>
  rank && Number.isFinite(rank.position)
    ? { label: `#${rank.position}`, detail: `of ${rank.of} ${PERIOD_LABELS[rank.period] ?? PERIOD_LABELS.week}` }
    : null;

const toTotals = (bucket) => ({ tokens: compactNumber(bucket?.tokens), cost: formatCost(bucket?.costUsd) });

const accountView = (state, session, now) => {
  const summary = state?.summary ?? null;
  const failure = session.error ?? state?.lastError ?? null;
  return {
    trayTitle: compactNumber(summary?.today?.tokens),
    user: session.me?.user ?? null,
    today: toTotals(summary?.today),
    week: toTotals(summary?.week),
    topModel: summary?.topModel ?? null,
    rank: toRank(session.me?.rank),
    lastSync: relativeTime(state?.lastSyncAt, now),
    cursor: {
      connected: Boolean(session.cursor?.loggedIn),
      busy: Boolean(session.cursor?.busy),
      hint: session.cursor?.hint ?? null,
    },
    loginItem: {
      available: Boolean(session.loginItem?.available),
      enabled: Boolean(session.loginItem?.enabled),
    },
    warning: session.warning ?? null,
    errorMessage: failure ? errorMessage(failure) : null,
  };
};

const accountKind = (session, account) => {
  if (session.syncing) return "syncing";
  return account.errorMessage ? "error" : "idle";
};

export const toView = ({ state, session, now }) => {
  if (session.loading) return { kind: "loading", trayTitle: "" };
  if (!session.signedIn && session.signingIn) {
    return { kind: "signing-in", trayTitle: "", ...normalizeDeviceCode(session.signingIn) };
  }
  if (!session.signedIn) return { kind: "signed-out", trayTitle: "", notice: session.notice ?? null };
  const account = accountView(state, session, now);
  const kind = accountKind(session, account);
  return { kind, ...account, errorMessage: kind === "error" ? account.errorMessage : null };
};
