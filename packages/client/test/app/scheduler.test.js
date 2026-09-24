import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createScheduler,
  nextDelay,
  RESUME_DELAY_MS,
  STARTUP_DELAY_MS,
  SYNC_INTERVAL_MS,
} from "../../src/app/scheduler.js";

const NOW = Date.parse("2026-09-24T12:00:00Z");
const MIN = 60_000;

const fakeTimers = () => {
  const timers = new Map();
  let nextId = 1;
  return {
    timers,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    pending: () => [...timers.values()].map((t) => t.ms),
    fire: async () => {
      const [id, timer] = [...timers.entries()][0];
      timers.delete(id);
      await timer.fn();
    },
  };
};

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

test("constants", () => {
  assert.equal(SYNC_INTERVAL_MS, 60 * MIN);
  assert.equal(STARTUP_DELAY_MS, 10_000);
  assert.equal(RESUME_DELAY_MS, 5_000);
});

test("nextDelay without history is immediate", () => {
  assert.equal(nextDelay({ lastSyncAt: null, lastAttemptAt: null }, NOW), 0);
  assert.equal(nextDelay({}, NOW), 0);
});

test("nextDelay counts from the last sync", () => {
  assert.equal(nextDelay({ lastSyncAt: new Date(NOW - 10 * MIN).toISOString() }, NOW), 50 * MIN);
  assert.equal(nextDelay({ lastSyncAt: new Date(NOW - 120 * MIN).toISOString() }, NOW), 0);
});

test("nextDelay caps future timestamps at one interval", () => {
  assert.equal(nextDelay({ lastSyncAt: new Date(NOW + 300 * MIN).toISOString() }, NOW), SYNC_INTERVAL_MS);
});

test("nextDelay prefers the newer attempt over an old sync", () => {
  const state = { lastSyncAt: new Date(NOW - 300 * MIN).toISOString(), lastAttemptAt: NOW - 20 * MIN };
  assert.equal(nextDelay(state, NOW), 40 * MIN);
});

test("nextDelay ignores invalid timestamps", () => {
  assert.equal(nextDelay({ lastSyncAt: "nope", lastAttemptAt: NOW - 5 * MIN }, NOW), 55 * MIN);
});

test("start schedules the first sync after 10 s, then hourly", async () => {
  const t = fakeTimers();
  let runs = 0;
  const scheduler = createScheduler({ run: async () => runs++, now: () => NOW, ...t });
  scheduler.start();
  assert.deepEqual(t.pending(), [STARTUP_DELAY_MS]);
  await t.fire();
  assert.equal(runs, 1);
  assert.deepEqual(t.pending(), [SYNC_INTERVAL_MS]);
});

test("trigger never runs two syncs at once", async () => {
  const t = fakeTimers();
  const gate = deferred();
  let runs = 0;
  const scheduler = createScheduler({
    run: () => {
      runs++;
      return gate.promise;
    },
    now: () => NOW,
    ...t,
  });
  const first = scheduler.trigger();
  const second = scheduler.trigger();
  assert.equal(first, second);
  assert.equal(scheduler.isRunning(), true);
  assert.equal(runs, 1);
  gate.resolve();
  await first;
  assert.equal(scheduler.isRunning(), false);
  await scheduler.trigger();
  assert.equal(runs, 2);
});

test("a failing run still reschedules and clears running", async () => {
  const t = fakeTimers();
  const scheduler = createScheduler({
    run: async () => {
      throw new Error("boom");
    },
    now: () => NOW,
    ...t,
  });
  await scheduler.trigger();
  assert.equal(scheduler.isRunning(), false);
  assert.deepEqual(t.pending(), [SYNC_INTERVAL_MS]);
});

test("trigger replaces a pending timer", async () => {
  const t = fakeTimers();
  const scheduler = createScheduler({ run: async () => {}, now: () => NOW, ...t });
  scheduler.start();
  await scheduler.trigger();
  assert.deepEqual(t.pending(), [SYNC_INTERVAL_MS]);
});

test("resume replaces the pending timer with a short delay", () => {
  const t = fakeTimers();
  const scheduler = createScheduler({ run: async () => {}, now: () => NOW, ...t });
  scheduler.start();
  scheduler.resume();
  assert.deepEqual(t.pending(), [RESUME_DELAY_MS]);
});

test("stop clears timers and prevents rescheduling", async () => {
  const t = fakeTimers();
  const gate = deferred();
  const scheduler = createScheduler({ run: () => gate.promise, now: () => NOW, ...t });
  const running = scheduler.trigger();
  scheduler.stop();
  gate.resolve();
  await running;
  assert.deepEqual(t.pending(), []);
});
