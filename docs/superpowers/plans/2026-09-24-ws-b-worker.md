# WS B: Worker API + D1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cloudflare Worker serving the leaderborder JSON API (Contract 3), GitHub web OAuth + device registration, D1 storage, and `/app` shell routing.

**Architecture:** One `fetch` handler in `src/index.js` wraps a hand-written route table (`src/router.js`). Pure helpers (validation, periods, encoding, cookies, access rule, leaderboard shaping) are separate modules; IO lives in `src/queries.js` (D1), `src/github.js` (GitHub HTTP) and `src/routes/*.js`. Tests call `worker.fetch(request, env, ctx)` directly inside the Workers runtime with a real D1 (migrations applied in a setup file) and `vi.spyOn(globalThis, "fetch")` for GitHub.

**Tech Stack:** Cloudflare Workers, D1, wrangler 4.138, vitest 4.1.11, `@cloudflare/vitest-pool-workers` 0.22 (`cloudflareTest` plugin, `readD1Migrations` + `applyD1Migrations`), WebCrypto.

**Spec:** `docs/superpowers/specs/2026-09-24-leaderborder-design.md`, master plan `docs/superpowers/plans/2026-09-24-leaderborder.md` (Contracts 2, 3, 4).

## Global Constraints

- JavaScript ESM only, no TypeScript. Pure functions where possible, IO at the edges.
- Zero comments by default. Plain hyphen only, never U+2014 / U+2013.
- No `npm install`, no new deps, no router/framework. WebCrypto for HMAC, SHA-256, random.
- Edit only `packages/worker/src/**`, `packages/worker/migrations/**`, `packages/worker/test/**` (not `test/web/**`), `packages/worker/wrangler.toml`, `packages/worker/vitest.config.js`.
- No commit, push, stash, checkout, reset, worktree. `git add` own files only.
- `npm run lint` (repo root) and `npm run test -w @leaderborder/worker` green.
- Never deploy, never `wrangler login`, never `--remote`.

## File map

| File | Responsibility |
|---|---|
| `wrangler.toml` | Contract 4 config: D1 `DB`, assets `ASSETS` + `run_worker_first`, vars, ratelimit `USAGE_LIMITER` |
| `vitest.config.js` | `cloudflareTest` plugin, `TEST_MIGRATIONS` binding, test secrets, `include: ["test/**/*.test.js"]`, setup file |
| `migrations/0001_init.sql` | tables `users`, `devices`, `api_tokens`, `usage_daily` + indexes, FKs |
| `src/index.js` | `export default { fetch }`: routing, error mapping, security headers |
| `src/router.js` | `createRouter(routes)` -> `match(method, pathname)` = `{ handler, params }` / `{ status: 404 }` / `{ status: 405, allow }` |
| `src/http.js` | `HttpError`, `json`, `errorResponse`, `noContent`, `redirect`, `htmlPage`, `readJsonBody`, `withSecurityHeaders` |
| `src/encoding.js` | `base64urlEncode(bytes)`, `base64urlDecode(str)`, `utf8`, `hex` |
| `src/cookies.js` | `parseCookies(header)`, `serializeCookie(name, value, opts)` |
| `src/session.js` | `signValue(obj, secret)`, `verifyValue(str, secret, nowSec)`, `SESSION_MAX_AGE` |
| `src/tokens.js` | `createDeviceToken()`, `hashToken(token)`, `isDeviceTokenFormat(token)` |
| `src/validate.js` | Contract 2 row validation, usage body, device body, uuid v4, `safeNext` |
| `src/periods.js` | `localDay(date, tz)`, `addDays(day, n)`, `periodRange(period, now, tz)`, `dayRange(start, end)` |
| `src/access.js` | `parseList(str)`, `isAllowed({ login, orgs }, env)`, `needsOrgs(env)` |
| `src/github.js` | `exchangeCode`, `getGithubUser`, `getGithubOrgs`, `resolveGithubAccess(token, env)` |
| `src/metrics.js` | `METRICS`, metric SQL expressions, `rankEntries`, `denseSeries`, `roundCost` |
| `src/queries.js` | all D1 SQL |
| `src/auth.js` | `sessionUser(request, env)`, `bearerAuth(request, env)`, `requireCookieUser`, `requireAnyUser`, `assertSameOrigin` |
| `src/routes/*.js` | `config.js`, `devices.js`, `usage.js`, `me.js`, `leaderboard.js`, `users.js`, `stats.js`, `web-auth.js`, `app.js` |
| `test/apply-migrations.js` | setup: `applyD1Migrations(env.DB, env.TEST_MIGRATIONS)` |
| `test/helpers.js` | `makeEnv(overrides)`, `call(method, path, opts)`, `resetDb()`, `mockGithub(spec)`, `loginCookie(uid)`, `registerDevice(...)`, `row(overrides)` |
| `test/*.test.js` | unit + API tests |
| `test/fixtures/seed.sql` | 6 users, 8 devices, ~90 days usage via recursive CTE |

## Decisions (contract gaps)

- 405 and 413 use `code: "invalid_request"` (contract code list has no dedicated codes); 405 carries `Allow`. Non-JSON `Content-Type` -> 400 `invalid_request`.
- `devices.revoked_at` added: `DELETE /api/me/devices/:id` revokes the device and its tokens, usage history stays counted. Re-registering the same `deviceId` un-revokes and rotates the token. A `deviceId` owned by another user -> 403.
- Series (`sparkline` 30, UserDetail `daily` 365, PublicStats `daily` 90) are dense: one entry per day, zeros filled, ascending.
- `all` period: `range.start` = earliest usage day (or today when empty), `range.end` = today. `month` ends today.
- `filters.clients/models` = all-time distinct values (stable dropdowns).
- Ranking = competition ranking by value desc, ties share rank, ordered by login.
- `costUsd` outputs rounded to 6 decimals.
- Row `day` future limit: `day <= UTC today + 1`.
- Cookie-authenticated mutations (`DELETE /api/me/devices/:id`, `POST /auth/logout`) reject a present `Origin` that differs from the request origin (403).
- Tests override `compatibilityDate` to `2026-08-22` in `vitest.config.js`: the workerd bundled with `@cloudflare/vitest-pool-workers` 0.22 rejects `2026-09-01`. `wrangler.toml` keeps `2026-09-01` (wrangler 4.138 dev accepts it).
- Local dev (`APP_URL` starting `http://localhost`) drops `Secure` from cookies so Safari accepts them.

---

### Task 1: Tooling (wrangler.toml, migration, vitest config, harness)

**Files:** Create `wrangler.toml`, `migrations/0001_init.sql`, `vitest.config.js`, `test/apply-migrations.js`, `test/helpers.js`, `test/schema.test.js`

- [ ] Step 1: failing test `test/schema.test.js`: `SELECT name FROM sqlite_master WHERE type='table'` contains the 4 tables; inserting `usage_daily` with unknown `device_id` fails (FK).
- [ ] Step 2: run `npm run test -w @leaderborder/worker` -> FAIL (no config).
- [ ] Step 3: write config + migration:

```toml
name = "leaderborder"
main = "src/index.js"
compatibility_date = "2026-09-01"

[assets]
directory = "public"
binding = "ASSETS"
run_worker_first = ["/api/*", "/auth/*", "/app", "/app/*"]

[[d1_databases]]
binding = "DB"
database_name = "leaderborder"
database_id = "00000000-0000-0000-0000-000000000000"
migrations_dir = "migrations"

[[ratelimits]]
name = "USAGE_LIMITER"
namespace_id = "1001"
simple = { limit = 60, period = 60 }

[vars]
APP_URL = "https://leaderborder.xaverric.cz"
GITHUB_CLIENT_ID = ""
ALLOWED_GITHUB_ORGS = ""
ALLOWED_GITHUB_LOGINS = ""
LEADERBOARD_TZ = "Europe/Prague"
```

```js
import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
  return {
    plugins: [cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: { bindings: { TEST_MIGRATIONS: migrations, SESSION_SECRET: "test-session-secret", GITHUB_CLIENT_SECRET: "test-client-secret" } },
    })],
    test: { include: ["test/**/*.test.js"], setupFiles: ["./test/apply-migrations.js"] },
  };
});
```

- [ ] Step 4: run tests -> PASS.

### Task 2: Pure helpers (encoding, cookies, session, tokens)

**Files:** `src/encoding.js`, `src/cookies.js`, `src/session.js`, `src/tokens.js`; tests `test/session.test.js`, `test/tokens.test.js`

**Produces:** `signValue(obj, secret) -> Promise<string>` (`<b64url json>.<b64url hmac>`), `verifyValue(str, secret, nowSec) -> Promise<object|null>` (null on bad format, bad signature, `exp <= nowSec`), `createDeviceToken() -> "lb_" + 43 chars`, `hashToken(t) -> Promise<hex64>`, `isDeviceTokenFormat(t) -> boolean`, `parseCookies(h) -> Record`, `serializeCookie(name, value, { maxAge, path, httpOnly, secure, sameSite }) -> string`.

- [ ] Tests: roundtrip; tampered payload (flip a char) -> null; tampered signature -> null; wrong secret -> null; expired -> null; garbage (`""`, `"a"`, `"a.b.c"`) -> null; token matches `^lb_[A-Za-z0-9_-]{43}$`, two tokens differ; hash is 64 hex and stable; cookie parse with spaces/`=` in value; serialize attribute order `Name=v; Path=/; Max-Age=..; HttpOnly; Secure; SameSite=Lax`.
- [ ] Implement with `crypto.subtle.importKey("raw", ..., { name: "HMAC", hash: "SHA-256" })`, `crypto.subtle.verify` for constant-time compare, `crypto.getRandomValues(new Uint8Array(32))`.

### Task 3: Validation (Contract 2 + bodies)

**Files:** `src/validate.js`; test `test/validate.test.js`

**Produces:** `validateRow(row, now) -> string|null`, `validateUsageBody(body, now) -> string|null` (message like `rows[3].day: invalid`), `validateDeviceBody(body) -> string|null`, `isUuidV4(s)`, `safeNext(next, fallback = "/app") -> string`.

- [ ] Tests: valid row ok; `day` `2026-02-30` rejected, `2026-9-01` rejected, today+1 ok, today+2 rejected; client `Claude` rejected, 41 chars rejected, `.x` rejected, `claude-code_1.x` ok; model empty / 121 chars / space / `ü` rejected, `anthropic/claude-opus-5@2026:beta+x` ok; tokens `-1`, `1.5`, `"1"`, `2**53`, missing -> rejected; `costUsd` `NaN`/`Infinity`/`-0.1`/`"1"` rejected, `0` ok; non-object row rejected; body rows empty / 501 / not array rejected with index of first bad row; device body: bad uuid, uuid v1, name empty / 61 chars / non-string, missing githubToken rejected; `safeNext`: `/app/u/x` ok, `//evil.com`, `/\\evil`, `https://x`, `app`, undefined -> fallback.

### Task 4: Periods

**Files:** `src/periods.js`; test `test/periods.test.js`

**Produces:** `localDay(date, tz) -> "YYYY-MM-DD"`, `addDays(day, n)`, `periodRange(period, now, tz) -> { start: string|null, end }`, `dayRange(start, end) -> string[]`.

- [ ] Tests: `2026-09-30T22:30:00Z` in `Europe/Prague` -> `2026-10-01` (month = `2026-10-01..2026-10-01`, week = `2026-09-25..2026-10-01`); same instant in `UTC` -> `2026-09-30`, month `2026-09-01..2026-09-30`; `2026-03-02` week crosses Feb (`2026-02-24`), leap `2028-03-01` week start `2028-02-24`; year boundary `2027-01-03` week -> `2026-12-28`; day period start=end; all -> start null; `dayRange` lengths.

### Task 5: Access rule + GitHub client

**Files:** `src/access.js`, `src/github.js`; tests `test/access.test.js`, `test/github.test.js`

**Produces:** `parseList(s) -> string[]` (trim, lowercase, drop empty), `isAllowed({ login, orgs }, env) -> boolean`, `needsOrgs(env)`, `getGithubUser(token)`, `getGithubOrgs(token)`, `exchangeCode({ code, redirectUri, env })`, `resolveGithubAccess(token, env) -> { profile: { githubId, login, name, avatarUrl }, allowed }` (throws `HttpError(401)` on GitHub 401).

- [ ] Tests: both empty -> allowed; login list only (case-insensitive) match / no match; orgs only member / non-member; both lists: login OR org; `resolveGithubAccess` does not call `/user/orgs` when orgs empty (spy call count), sends `Authorization: Bearer`, `User-Agent`, `Accept`.

### Task 6: Router, http helpers, index shell, config, app, 404/405/413

**Files:** `src/router.js`, `src/http.js`, `src/index.js`, `src/routes/config.js`, `src/routes/app.js`; test `test/http.test.js`

- [ ] Tests: `GET /api/config` -> `{ githubClientId, apiVersion: 1 }`, `Cache-Control: no-store`, security headers present; `GET /api/nope` -> 404 `not_found` JSON; `POST /api/config` -> 405 with `Allow: GET`; `PUT /api/usage` with `Content-Length` > 512 KB -> 413; oversized body without length -> 413; `text/plain` body -> 400; invalid JSON -> 400; `/app` and `/app/u/ada` call `ASSETS.fetch` with `/app.html` and response has security headers; unknown non-API path falls through to `ASSETS.fetch(request)`; thrown non-HttpError -> 500 `internal`.

### Task 7: Queries + device registration

**Files:** `src/queries.js`, `src/routes/devices.js`, `src/auth.js`; test `test/devices.test.js`

- [ ] Tests (GitHub mocked): 201 shape `{ token, deviceId, user: { login, name, avatarUrl } }`; token only stored as sha256; GitHub 401 -> 401; not allowed (logins configured) -> 403, no rows written; orgs configured + member -> 201; same deviceId re-register -> old token 401 on `/api/me`, new works, still one device row; deviceId of another user -> 403; user profile updated on re-login (login rename).

### Task 8: Usage upload

**Files:** `src/routes/usage.js`, queries; test `test/usage.test.js`

- [ ] Tests: no/garbage bearer -> 401; revoked token -> 401; deviceId mismatch -> 403; bad row -> 400 message contains `rows[1]`, nothing written; 200 `{ upserted: 2 }`; same payload twice -> still 2 rows with same values (idempotent), changed values overwrite; `devices.last_sync_at` and `api_tokens.last_used_at` set; limiter `{ success: false }` -> 429 `rate_limited`, limiter absent -> ok.

### Task 9: Web auth (OAuth, session, logout, dev login)

**Files:** `src/routes/web-auth.js`; test `test/web-auth.test.js`

- [ ] Tests: `/auth/github?next=/app/u/x` -> 302 to `https://github.com/login/oauth/authorize?...client_id...scope=read%3Aorg&state=...`, `Set-Cookie: lb_oauth_state=...; Path=/auth; Max-Age=600; HttpOnly; Secure; SameSite=Lax`; `next=//evil` stored as `/app`; callback with matching state -> 302 to next, `lb_session` cookie with `Max-Age=2592000`, user row; mismatched/missing state -> 400; not allowed -> 403 HTML with link to `/`; tampered `lb_session` -> `/api/me` 401; expired -> 401; logout -> 204 + `Max-Age=0`; logout with foreign Origin -> 403; dev login: enabled only for `DEV_LOGIN=1` + `APP_URL=http://localhost:8787` (302 + cookie), 404 when `DEV_LOGIN` missing, 404 when APP_URL is https production even with `DEV_LOGIN=1`, 400 on invalid login.

### Task 10: Me, device revocation, leaderboard, user detail, public stats

**Files:** `src/metrics.js`, `src/routes/me.js`, `src/routes/leaderboard.js`, `src/routes/users.js`, `src/routes/stats.js`; tests `test/leaderboard.test.js`, `test/me.test.js`, `test/stats.test.js`

- [ ] Tests: two devices of one user sum into one entry; `metric=tokens_nocache` and `cost` change value + order; `client=codex` filter narrows value/byClient; `model=` filter; invalid period/metric -> 400; cookie required (bearer -> 401); sparkline 30 dense entries ending at range.end; filters lists; ranks with ties; `/api/me` via bearer and cookie, rank null without usage, devices listed; DELETE own device -> 204, token then 401, device hidden; DELETE foreign device -> 404; `/api/users/:login` shape, 365 daily, unknown -> 404; public stats shape, `Cache-Control: public, max-age=60`, 90 daily entries, top 5 lists, no logins in payload.

### Task 11: Seed, lint, smoke

**Files:** `test/fixtures/seed.sql`

- [ ] Write compact seed with recursive CTE (days 0..89 relative to `date('now')`), deterministic pseudo-random via `abs(random())` avoided in favor of arithmetic on day index + device id for reproducibility.
- [ ] `npm run lint`, tests green.
- [ ] `npx wrangler d1 migrations apply leaderborder --local`, `npx wrangler d1 execute leaderborder --local --file test/fixtures/seed.sql`, `npx wrangler dev --local --var DEV_LOGIN:1 --var APP_URL:http://localhost:8787`, curl `/api/public/stats`, `/api/config`, stop server.
- [ ] `git add` owned files.
