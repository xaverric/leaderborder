import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, statSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getConfig } from "../../src/core/config.js";
import { loadState, saveState, defaultState } from "../../src/core/state.js";
import { LeaderborderError } from "../../src/core/errors.js";
import { localDay, addDays } from "../../src/core/dates.js";

const tempDir = () => mkdtempSync(join(tmpdir(), "lb-test-"));

test("getConfig defaults to production api and ~/.config/leaderborder", () => {
  assert.deepEqual(getConfig({ HOME: "/Users/x" }), {
    apiUrl: "https://leaderborder.xaverric.cz",
    configDir: "/Users/x/.config/leaderborder",
  });
});

test("getConfig honours LEADERBORDER_API_URL without trailing slash", () => {
  assert.equal(getConfig({ HOME: "/h", LEADERBORDER_API_URL: "http://localhost:8787/" }).apiUrl, "http://localhost:8787");
});

test("getConfig prefers an explicit apiUrl over LEADERBORDER_API_URL", () => {
  const env = { HOME: "/h", LEADERBORDER_API_URL: "http://localhost:8787" };
  assert.equal(getConfig(env, { apiUrl: "https://staging.test/" }).apiUrl, "https://staging.test");
  assert.equal(getConfig(env, { apiUrl: undefined }).apiUrl, "http://localhost:8787");
  assert.equal(getConfig({ HOME: "/h" }, {}).apiUrl, "https://leaderborder.xaverric.cz");
  assert.throws(() => getConfig(env, { apiUrl: "http://remote.test" }), { code: "invalid_config" });
});

test("getConfig honours LEADERBORDER_CONFIG_DIR", () => {
  assert.equal(getConfig({ HOME: "/h", LEADERBORDER_CONFIG_DIR: "/tmp/lb" }).configDir, "/tmp/lb");
});

test("loadState returns defaults when the file is missing", () => {
  assert.deepEqual(loadState({ configDir: join(tempDir(), "missing") }), defaultState());
});

test("loadState returns defaults when the file is corrupt", () => {
  const configDir = tempDir();
  writeFileSync(join(configDir, "state.json"), "{");
  assert.deepEqual(loadState({ configDir }), defaultState());
});

test("loadState fills missing keys with defaults and ignores unknown keys", () => {
  const configDir = tempDir();
  writeFileSync(join(configDir, "state.json"), JSON.stringify({ deviceId: "d1", secret: "x" }));
  assert.deepEqual(loadState({ configDir }), { ...defaultState(), deviceId: "d1" });
});

test("saveState round trips and writes the file with mode 600", () => {
  const configDir = join(tempDir(), "nested");
  const state = { ...defaultState(), deviceId: "d1", lastSyncAt: "2026-09-24T10:00:00.000Z" };
  saveState({ configDir }, state);
  assert.deepEqual(loadState({ configDir }), state);
  assert.equal(statSync(join(configDir, "state.json")).mode & 0o777, 0o600);
});

test("saveState overwrites an existing state file", () => {
  const configDir = tempDir();
  mkdirSync(configDir, { recursive: true });
  saveState({ configDir }, { ...defaultState(), deviceId: "a" });
  saveState({ configDir }, { ...defaultState(), deviceId: "b" });
  assert.equal(JSON.parse(readFileSync(join(configDir, "state.json"), "utf8")).deviceId, "b");
});

test("LeaderborderError carries code, message and status", () => {
  const error = new LeaderborderError("network", "boom", { status: 503 });
  assert.ok(error instanceof Error);
  assert.equal(error.name, "LeaderborderError");
  assert.equal(error.code, "network");
  assert.equal(error.message, "boom");
  assert.equal(error.status, 503);
});

test("localDay formats the local calendar day", () => {
  assert.equal(localDay(new Date(2026, 8, 24, 23, 30)), "2026-09-24");
  assert.equal(localDay(new Date(2026, 0, 5, 0, 1)), "2026-01-05");
});

test("addDays moves by calendar days", () => {
  assert.equal(localDay(addDays(new Date(2026, 8, 24, 12), -35)), "2026-08-20");
  assert.equal(localDay(addDays(new Date(2026, 9, 26, 1), -1)), "2026-10-25");
});
