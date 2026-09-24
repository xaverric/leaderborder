# WS A: core + CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `leaderborder` client sync engine (Contract 5) and the `leaderborder` CLI on top of it, plus a nightly tokscale compatibility check.

**Architecture:** `packages/client/src/core/` is split into focused modules (pure data functions in `rows.js`, thin IO modules with injectable dependencies) re-exported from `index.js`. Orchestration (`login`, `logout`, `sync`) lives in `session.js` and receives every IO dependency through an optional `deps` object so unit tests never touch the Keychain, network or tokscale. The CLI is a pure-ish `main(argv, io)` in `src/cli/main.js` with a two-line `bin.js` wrapper.

**Tech Stack:** Node 22 ESM, `node:test`, `node:assert/strict`, `node:util` `parseArgs`, `node:child_process`, `node:crypto`, global `fetch`, `@tokscale/cli@4.17.0` binary, `electron` (path export only).

**Spec:** `docs/superpowers/specs/2026-09-24-leaderborder-design.md`, contracts in `docs/superpowers/plans/2026-09-24-leaderborder.md` (Contracts 1, 2, 3, 5).

## Global Constraints

- JavaScript ESM only, no TypeScript, Node >= 22. Pure functions where possible, IO at the edges.
- Zero comments by default. Plain hyphen only, never U+2014 / U+2013.
- No new dependencies, no `npm install`. Node built-ins + `@tokscale/cli` + `electron` only.
- No commit/push/stash/checkout. Only `git add` own files.
- Own paths only: `packages/client/src/core/**`, `packages/client/src/cli/**`, `packages/client/test/core/**`, `packages/client/test/cli/**`, `packages/client/test/compat/**`, `fixtures/home/**`, this plan file.
- tokscale: only `graph`, `cursor login|sync|status`, `--version`.
- Upload only usage rows (Contract 2 fields). No paths, session ids, prompts.
- Device token only in macOS Keychain (service `leaderborder`, account `device-token`), written and deleted through `security -i` stdin, never in argv, logs or files.
- Default API URL `https://leaderborder.xaverric.cz`, override env `LEADERBORDER_API_URL`.
- `npm run lint` (repo root) and `npm run test -w leaderborder` green.

## File Structure

| File | Responsibility |
|---|---|
| `src/core/errors.js` | `LeaderborderError(code, message, { cause, status })` |
| `src/core/dates.js` | pure local-date helpers `localDay(date)`, `addDays(date, n)` |
| `src/core/config.js` | `getConfig(env)` |
| `src/core/state.js` | `defaultState()`, `loadState`, `saveState` (atomic write, mode 600) |
| `src/core/rows.js` | pure `toUsageRows`, `validateRow`, `syncWindow`, `summarize`, `chunk`, `rowTokens` |
| `src/core/tokscale.js` | `tokscaleBin`, `runTokscale`, `readGraph`, `cursorStatus`, `cursorSync`, `cursorLogin` |
| `src/core/api.js` | `createApi({ apiUrl, fetch, token })` |
| `src/core/github.js` | `githubDeviceFlow` |
| `src/core/keychain.js` | `createKeychain({ exec })`, default `keychain` |
| `src/core/device.js` | `computerName({ execFile, hostname })` |
| `src/core/session.js` | `login`, `logout`, `sync`, `withRetry` |
| `src/core/index.js` | re-exports (Contract 5 names) |
| `src/cli/format.js` | pure `formatRowsTable`, `formatStatus`, `formatNumber` |
| `src/cli/main.js` | `main(argv, io)` command dispatch, exit codes |
| `src/cli/bin.js` | shebang wrapper, executable |
| `test/core/*.test.js`, `test/cli/*.test.js` | unit tests |
| `test/compat/tokscale-compat.js` | real-binary check against `fixtures/home` |
| `fixtures/home/.claude/projects/-synthetic-project/<uuid>.jsonl` | synthetic Claude Code session |
| `fixtures/home/.codex/sessions/2026/09/10/rollout-...jsonl` | synthetic Codex session |

All paths below are relative to `packages/client` unless they start with `fixtures/`.

---

### Task 1: errors, dates, config, state

**Files:**
- Create: `src/core/errors.js`, `src/core/dates.js`, `src/core/config.js`, `src/core/state.js`
- Test: `test/core/config-state.test.js`

**Interfaces:**
- Produces: `class LeaderborderError extends Error { code, status? }`; `localDay(date) -> "YYYY-MM-DD"` (device local time); `addDays(date, n) -> Date` (calendar days, DST safe); `getConfig(env = process.env) -> { apiUrl, configDir }`; `defaultState() -> State`; `loadState({ configDir }) -> State`; `saveState({ configDir }, state) -> void`.

- [ ] **Step 1: Write failing tests**

```js
test("getConfig defaults", () => {
  const c = getConfig({ HOME: "/Users/x" });
  assert.deepEqual(c, { apiUrl: "https://leaderborder.xaverric.cz", configDir: "/Users/x/.config/leaderborder" });
});
test("getConfig honours LEADERBORDER_API_URL and strips trailing slash", () => {
  assert.equal(getConfig({ HOME: "/h", LEADERBORDER_API_URL: "http://localhost:8787/" }).apiUrl, "http://localhost:8787");
});
test("getConfig honours LEADERBORDER_CONFIG_DIR", () => {
  assert.equal(getConfig({ HOME: "/h", LEADERBORDER_CONFIG_DIR: "/tmp/lb" }).configDir, "/tmp/lb");
});
test("loadState returns defaults when missing or corrupt", () => { /* tmp dir, then write "{" */ });
test("saveState round trips and writes mode 600", () => { /* statSync(file).mode & 0o777 === 0o600 */ });
test("loadState merges unknown/missing keys with defaults", () => { /* {"deviceId":"x"} -> other keys default */ });
test("LeaderborderError carries code and status", () => { /* new LeaderborderError("network","m",{status:503}) */ });
test("localDay and addDays use local calendar", () => { /* new Date(2026, 8, 24, 23, 30) -> "2026-09-24", addDays(-35) -> "2026-08-20" */ });
```

- [ ] **Step 2: Run** `npm run test -w leaderborder` - FAIL (modules missing).
- [ ] **Step 3: Implement**

```js
export const DEFAULT_API_URL = "https://leaderborder.xaverric.cz";
export const getConfig = (env = process.env) => ({
  apiUrl: (env.LEADERBORDER_API_URL || DEFAULT_API_URL).replace(/\/+$/, ""),
  configDir: env.LEADERBORDER_CONFIG_DIR || join(env.HOME || homedir(), ".config", "leaderborder"),
});
export const defaultState = () => ({ deviceId: null, deviceName: null, lastSyncAt: null, lastError: null, summary: null });
export const loadState = ({ configDir }) => { try { return { ...defaultState(), ...pick(JSON.parse(readFileSync(file))) } } catch { return defaultState() } };
export const saveState = ({ configDir }, state) => { mkdirSync(configDir, { recursive: true, mode: 0o700 }); writeFileSync(tmp, json, { mode: 0o600 }); renameSync(tmp, file) };
```

- [ ] **Step 4: Run tests** - PASS.
- [ ] **Step 5:** `git add` the files (no commit, lead commits).

### Task 2: pure rows module

**Files:**
- Create: `src/core/rows.js`
- Test: `test/core/rows.test.js` (uses `fixtures/tokscale-graph-4.17.0.json`)

**Interfaces:**
- Consumes: `localDay`, `addDays`.
- Produces: `rowTokens(row) -> input+output+cacheRead+cacheWrite`; `validateRow(row, now = new Date()) -> string[]` (empty = valid, Contract 2 rules incl. not more than 1 day in the future); `toUsageRows(graph, now = new Date()) -> Row[]` (sum across providerId, drop zero rows, drop invalid rows, sort by day, client, model, costUsd rounded to 1e-9); `syncWindow({ lastSyncAt, now }) -> { since }`; `summarize(rows, now) -> { today, week, topModel }`; `chunk(rows, size = 500) -> Row[][]`.

- [ ] **Step 1: Write failing tests**

```js
const graph = JSON.parse(readFileSync(new URL("../../../../fixtures/tokscale-graph-4.17.0.json", import.meta.url)));
const now = new Date(2026, 8, 24, 12);
test("toUsageRows sums duplicate day+client+model across providers", () => {
  const row = toUsageRows(graph, now).find((r) => r.day === "2026-09-10" && r.model === "claude-opus-5");
  assert.deepEqual({ ...row, costUsd: undefined }, { day: "2026-09-10", client: "claude", model: "claude-opus-5",
    input: 288, output: 116892, cacheRead: 53082104, cacheWrite: 1875983, reasoning: 5, costUsd: undefined, messages: 140 });
  assert.ok(Math.abs(row.costUsd - 41.68887075) < 1e-6);
});
test("toUsageRows yields one row per unique day+client+model and only Contract 2 keys", ...);
test("every produced row passes validateRow", ...);
test("toUsageRows drops rows with zero tokens and zero messages", ...);
test("toUsageRows drops rows failing validation (bad client, far future day)", ...);
test("toUsageRows handles empty/missing contributions", () => assert.deepEqual(toUsageRows({}), []));
test("validateRow rejects bad day, impossible date, future > 1 day, bad client, bad model, negative/float ints, NaN cost", ...);
test("syncWindow: null lastSyncAt -> full history; otherwise now - 35 days local", ...);
test("summarize: today and last 7 days incl. today, topModel by week tokens, null when empty week", ...);
test("chunk splits into size-bounded slices", () => assert.deepEqual(chunk([1,2,3], 2), [[1,2],[3]]));
```

- [ ] **Step 2: Run** - FAIL.
- [ ] **Step 3: Implement** with `Map` keyed by `day\u0000client\u0000model`, a `TOKEN_FIELDS` list, regexes from Contract 2.
- [ ] **Step 4: Run** - PASS.
- [ ] **Step 5:** `git add`.

### Task 3: tokscale adapter

**Files:**
- Create: `src/core/tokscale.js`
- Test: `test/core/tokscale.test.js`

**Interfaces:**
- Produces: `tokscaleBin({ arch = process.arch, resolve } = {}) -> string` (resolves `@tokscale/cli-darwin-${arch}/package.json`, joins `bin/tokscale`, rewrites `app.asar/` to `app.asar.unpacked/`, throws `tokscale_failed` when unresolvable); `runTokscale(args, { timeoutMs = 120000, bin, execFile } = {}) -> Promise<{ stdout, stderr }>` (env `NO_COLOR=1`, errors become `tokscale_failed`); `readGraph({ since, home } = {}, { run, tmpdir } = {}) -> Promise<GraphResult>` (args `graph --no-spinner [--since X] [--home H] --output <tmp>`, reads + deletes the temp file, `tokscale_failed` on unreadable JSON); `cursorStatus({ run } = {}) -> Promise<{ loggedIn }>` (`cursor status`, matches `Session: Valid`); `cursorSync({ run } = {})`; `cursorLogin({ stdio = "inherit", spawn, bin } = {}) -> Promise<void>` (`cursor login --name default`).

- [ ] **Step 1: Write failing tests**

```js
test("tokscaleBin resolves the arch package binary", () => {
  const bin = tokscaleBin({ arch: "arm64", resolve: (id) => { assert.equal(id, "@tokscale/cli-darwin-arm64/package.json"); return "/x/node_modules/@tokscale/cli-darwin-arm64/package.json"; } });
  assert.equal(bin, "/x/node_modules/@tokscale/cli-darwin-arm64/bin/tokscale");
});
test("tokscaleBin rewrites app.asar to app.asar.unpacked", ...);
test("tokscaleBin throws tokscale_failed when package missing", ...);
test("tokscaleBin default resolves the real installed binary", () => assert.ok(existsSync(tokscaleBin())));
test("runTokscale passes args, timeout, NO_COLOR and wraps failures", ...);
test("readGraph builds args, parses and deletes the temp file", async () => {
  let seen; const run = async (args) => { seen = args; writeFileSync(args.at(-1), JSON.stringify({ meta: {}, contributions: [] })); return { stdout: "", stderr: "" }; };
  const g = await readGraph({ since: "2026-08-20" }, { run });
  assert.deepEqual(seen.slice(0, 4), ["graph", "--no-spinner", "--since", "2026-08-20"]);
  assert.equal(seen.at(-2), "--output"); assert.ok(seen.at(-1).startsWith(tmpdir()));
  assert.equal(existsSync(seen.at(-1)), false); assert.deepEqual(g.contributions, []);
});
test("readGraph omits --since when null and rejects invalid JSON with tokscale_failed, still deleting the file", ...);
test("cursorStatus detects a valid session and a missing one", ...);
test("cursorLogin spawns cursor login --name default and rejects on non-zero exit", ...);
```

- [ ] **Step 2-4:** Run FAIL, implement with `execFile` from `node:child_process` (promisified manually to keep stdout/stderr on error) and `createRequire(import.meta.url).resolve`, run PASS.
- [ ] **Step 5:** `git add`.

### Task 4: API client and GitHub Device Flow

**Files:**
- Create: `src/core/api.js`, `src/core/github.js`
- Test: `test/core/api.test.js`, `test/core/github.test.js`

**Interfaces:**
- Produces: `createApi({ apiUrl, fetch = globalThis.fetch, token }) -> { getConfig(), registerDevice({ githubToken, deviceId, deviceName }), putUsage({ deviceId, tokscaleVersion, rows }), getMe() }`. Errors: fetch rejection -> `network`; 401 -> `unauthorized`; 403 -> `forbidden`; other non-2xx -> `upload_failed`; all carry `status`; message from `{ error: { message } }` when present. `githubDeviceFlow({ clientId, fetch, onCode, sleep, scope = "read:org" }) -> Promise<string>`: `onCode({ userCode, verificationUri, expiresIn })`, polls every `interval` s, `slow_down` adds 5 s, `expired_token` / `access_denied` / other errors -> `unauthorized`, fetch rejection -> `network`.

- [ ] **Step 1: Write failing tests** using a recording fake `fetch` returning `new Response(JSON.stringify(body), { status })`:

```js
test("putUsage sends PUT /api/usage with bearer and JSON body", ...);
test("registerDevice posts without auth header", ...);
test("maps 401/403/500/network to error codes with status", ...);
test("device flow handles pending, slow_down and returns token", async () => {
  const calls = []; const sleeps = [];
  const replies = [{ device_code: "dc", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 },
    { error: "authorization_pending" }, { error: "slow_down" }, { access_token: "gho_x" }];
  const token = await githubDeviceFlow({ clientId: "cid", fetch: fakeFetch(replies, calls), onCode: (c) => codes.push(c), sleep: async (ms) => sleeps.push(ms) });
  assert.equal(token, "gho_x"); assert.deepEqual(sleeps, [5000, 5000, 10000]);
  assert.equal(new URLSearchParams(calls[1].body).get("grant_type"), "urn:ietf:params:oauth:grant-type:device_code");
});
test("device flow rejects expired_token and access_denied as unauthorized", ...);
```

- [ ] **Step 2-4:** Run FAIL, implement, run PASS.
- [ ] **Step 5:** `git add`.

### Task 5: keychain and device name

**Files:**
- Create: `src/core/keychain.js`, `src/core/device.js`
- Test: `test/core/keychain.test.js`, `test/core/device.test.js`

**Interfaces:**
- Produces: `createKeychain({ exec }) -> { getToken(), setToken(token), deleteToken() }` where `exec(args, { input }) -> Promise<{ code, stdout, stderr }>` runs `/usr/bin/security`. `getToken`: `find-generic-password -s leaderborder -a device-token -w`, code 0 -> trimmed stdout, else `null`. `setToken`: rejects tokens not matching `^lb_[A-Za-z0-9_-]{43}$`, runs `security -i` with stdin `add-generic-password -U -s leaderborder -a device-token -w <token>\n`. `deleteToken`: `security -i` with `delete-generic-password -s leaderborder -a device-token\n`, code 44 (not found) is fine. `keychain` = `createKeychain()` with the real spawn-based exec. `computerName({ execFile, hostname })` -> `scutil --get ComputerName` trimmed, fallback `hostname()`, then `Mac`, capped at 60 chars.

- [ ] **Step 1: Write failing tests** asserting the token never appears in any `args` array and appears exactly in `input`; non-zero set -> throws; delete tolerates 44; computerName fallbacks and 60-char cap.
- [ ] **Step 2-4:** Run FAIL, implement, run PASS.
- [ ] **Step 5:** `git add`.

### Task 6: session orchestration (login, logout, sync)

**Files:**
- Create: `src/core/session.js`, `src/core/index.js`
- Test: `test/core/session.test.js`, `test/core/index.test.js`

**Interfaces:**
- Consumes: everything above.
- Produces (each accepts optional `deps` overriding `{ getConfig, loadState, saveState, keychain, createApi, githubDeviceFlow, computerName, randomUUID, cursorStatus, cursorSync, readGraph, sleep }`):
  - `login({ onCode, fetch, deps }) -> { user }`: api `getConfig()` -> `githubClientId` -> device flow -> `deviceId` from state or new uuid v4 -> `deviceName` from `computerName()` -> persist state -> `registerDevice` -> `keychain.setToken` -> `lastError: null`.
  - `logout({ deps }) -> void`: `deleteToken`, state `deviceId`, `lastSyncAt`, `summary`, `lastError` reset to null.
  - `sync({ now = new Date(), fetch, onProgress, dryRun = false, deps }) -> { rows, since, summary, warnings, uploaded }`: token + deviceId required unless `dryRun` (`not_logged_in`), `cursorStatus` then `cursorSync` if logged in (failures -> `warnings`), `syncWindow`, `readGraph({ since })`, `toUsageRows`, per chunk `withRetry(putUsage, { delays: [1000, 4000, 16000], sleep })` retrying only `network` or `status >= 500`, 401 -> `deleteToken` + throw `unauthorized`, then `saveState` with `lastSyncAt`, `summary`, `lastError: null`. Any failure (not in dry run) records `lastError { code, message, at }` and rethrows. `onProgress({ phase: "cursor"|"graph"|"upload"|"done", ... })`.
  - `index.js` re-exports all Contract 5 names plus `validateRow`, `rowTokens`, `computerName`, `createKeychain`, `cursorSync`, `defaultState`.

- [ ] **Step 1: Write failing tests** with an in-memory `deps` harness (`state` object, fake keychain, fake api factory recording calls):

```js
test("sync uploads chunks, saves state and returns summary", ...);
test("sync first run uses full history (since null), later runs now-35d", ...);
test("sync retries 5xx/network with 1s,4s,16s and gives up after 3 retries", ...);
test("sync does not retry 4xx", ...);
test("sync on 401 deletes token and throws unauthorized, records lastError", ...);
test("sync without token throws not_logged_in", ...);
test("cursor sync failure is a warning, not fatal; skipped when not logged in", ...);
test("dry run uploads nothing, needs no token and does not save state", ...);
test("login registers device with persisted uuid and stores token", ...);
test("login reuses existing deviceId", ...);
test("logout deletes token and clears deviceId", ...);
test("index exports every Contract 5 name", ...);
```

- [ ] **Step 2-4:** Run FAIL, implement, run PASS.
- [ ] **Step 5:** `git add`.

### Task 7: CLI

**Files:**
- Create: `src/cli/format.js`, `src/cli/main.js`, `src/cli/bin.js` (`chmod +x`)
- Test: `test/cli/format.test.js`, `test/cli/main.test.js`

**Interfaces:**
- Consumes: core `index.js`.
- Produces: `main(argv, io = {}) -> Promise<number>` (exit code). `io` = `{ stdout, stderr, core, platform, spawn, electronPath, packageRoot, version }` with real defaults. Commands: none/`app` (darwin only, `spawn(electronPath, [packageRoot], { detached: true, stdio: "ignore", env without ELECTRON_RUN_AS_NODE }).unref()`, electron imported lazily), `login` (prints user code + URL, `open <url>`), `logout`, `sync [--dry-run]` (dry run prints table + totals), `status [--json]` (`{ ...state, apiUrl, hasToken }`), `cursor-login`, `--version`, `--help`. Exit 0 ok, 1 error (`LeaderborderError` -> `error [code]: message`), 2 usage (unknown command/option, extra positionals).

- [ ] **Step 1: Write failing tests** with fake core + captured streams: help/version exit 0; unknown command/option exit 2; `status --json` output has `hasToken` and no token; `sync --dry-run` prints header + rows and calls `core.sync({ dryRun: true })`; `sync` error `not_logged_in` exit 1; `app` on linux exit 1; `app` on darwin spawns detached with packageRoot; `login` prints code and opens URL.
- [ ] **Step 2-4:** Run FAIL, implement, run PASS.
- [ ] **Step 5:** `git add`.

### Task 8: tokscale compatibility check

**Files:**
- Create: `fixtures/home/.claude/projects/-synthetic-project/0b6f1f0e-5c3a-4d7e-9a61-2f1d3c4b5a60.jsonl` (1 user + 3 assistant lines, synthetic), `fixtures/home/.codex/sessions/2026/09/10/rollout-2026-09-10T12-00-00-1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f.jsonl` (`session_meta`, `turn_context`, 2 `token_count`), `test/compat/tokscale-compat.js`.

**Interfaces:**
- Consumes: `readGraph({ home })`, `toUsageRows`, `tokscaleBin`.
- Produces: script exiting 0 with `tokscale compat ok (<version>): 3 rows` or 1 with a per-field mismatch list.

Expected rows (timestamps at 12:00 UTC so the local day is stable in any CI timezone):

| day | client | model | input | output | cacheRead | cacheWrite | messages |
|---|---|---|---|---|---|---|---|
| 2026-09-10 | claude | claude-sonnet-4-5 | 110 | 220 | 3000 | 50 | 2 |
| 2026-09-10 | codex | gpt-5-codex | 250 | 45 | 250 | 0 | 2 |
| 2026-09-11 | claude | claude-haiku-4-5 | 5 | 7 | 0 | 3 | 1 |

Also asserts `meta.version`, `contributions` array shape (Contract 1 keys) and `costUsd` finite >= 0 (pricing may be unavailable offline, so not exact).

- [ ] **Step 1:** Write the script with the expected table first, run `npm run compat:tokscale -w leaderborder` with a deliberately wrong value to see it fail, fix, run PASS.
- [ ] **Step 2:** `git add`.

### Task 9: verification

- [ ] `npm run lint` (root) and `npm run test -w leaderborder` green.
- [ ] `node packages/client/src/cli/bin.js sync --dry-run | head -25` prints real rows, uploads nothing.
- [ ] `node packages/client/src/cli/bin.js sync` exits 1 with `not_logged_in`.
- [ ] `node packages/client/src/cli/bin.js status --json` shows `loggedIn: false`.
- [ ] `git add` all owned files.
