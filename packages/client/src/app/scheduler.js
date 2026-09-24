export const SYNC_INTERVAL_MS = 60 * 60 * 1000;
export const STARTUP_DELAY_MS = 10_000;
export const RESUME_DELAY_MS = 5_000;

const toMs = (value) => {
  if (value === null || value === undefined) return NaN;
  return typeof value === "number" ? value : Date.parse(value);
};

export const nextDelay = ({ lastSyncAt, lastAttemptAt } = {}, now) => {
  const latest = Math.max(...[toMs(lastSyncAt), toMs(lastAttemptAt)].filter(Number.isFinite), -Infinity);
  if (latest === -Infinity) return 0;
  return Math.min(Math.max(latest + SYNC_INTERVAL_MS - now, 0), SYNC_INTERVAL_MS);
};

const settle = (fn) => {
  try {
    return Promise.resolve(fn()).catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
};

export const createScheduler =({ run, now, setTimer, clearTimer }) => {
  let timer = null;
  let inFlight = null;
  let lastAttemptAt = null;
  let stopped = false;

  const cancel = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  const schedule = (ms) => {
    cancel();
    if (!stopped) timer = setTimer(() => trigger(), ms);
  };

  const execute = async () => {
    await settle(run);
    lastAttemptAt = now();
    inFlight = null;
    schedule(nextDelay({ lastAttemptAt }, now()));
  };

  const trigger = () => {
    if (inFlight) return inFlight;
    cancel();
    inFlight = execute();
    return inFlight;
  };

  return {
    start: () => {
      stopped = false;
      schedule(STARTUP_DELAY_MS);
    },
    resume: () => schedule(RESUME_DELAY_MS),
    trigger,
    stop: () => {
      stopped = true;
      cancel();
    },
    isRunning: () => inFlight !== null,
  };
};
