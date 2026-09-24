# leaderborder Implementation Plan (master)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mac menubar app + CLI that collects local AI coding token usage via tokscale and publishes daily aggregates to a Cloudflare Worker + D1 backend with a public landing page and a GitHub-login leaderboard at https://leaderborder.xaverric.cz.

**Architecture:** npm-workspaces monorepo. `packages/client` is the single published npm package `leaderborder` (core sync engine + CLI + Electron app). `packages/worker` is a Cloudflare Worker serving the JSON API, GitHub auth and static web from `public/`. Workstreams run in parallel against the contracts below.

**Tech Stack:** Node 22 ESM JavaScript, Electron 44, electron-builder 26, `@tokscale/cli` 4.17.0 (pinned), Cloudflare Workers + D1, wrangler 4, vitest 4.1 + `@cloudflare/vitest-pool-workers` 0.22, `node:test`, eslint 10, uPlot 1.6, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-24-leaderborder-design.md`

## Global Constraints

- JavaScript ESM only, no TypeScript, Node >= 22. Pure functions where possible, IO at the edges.
- Zero comments by default. Only public-API JSDoc where genuinely useful.
- Never use a long dash (U+2014 / U+2013) in code, copy or docs. Plain hyphen only.
- Do NOT run `npm install` / add dependencies. All deps are pre-installed. Need one? Stop and report it.
- Do NOT commit or push. Only `git add` your own files.
- Touch only the paths your workstream owns (table below). Anything else: report, do not edit.
- tokscale: only `graph`, `cursor login|sync|status`, `--version`. Never `login`, `submit`, `autosubmit`, `report`, `delete-data`, TUI.
- Upload only usage rows. Never send `mcpServers`, `timeMetrics`, paths, session ids or prompts.
- No secrets in argv, logs or files. Device token lives only in macOS Keychain (service `leaderborder`, account `device-token`), written through `security -i` stdin.
- Default API URL `https://leaderborder.xaverric.cz`, override env `LEADERBORDER_API_URL`.
- `npm run lint` and the workstream's tests must pass before reporting done.

## Workstreams and ownership

| WS | Owner paths | Detailed plan file |
|---|---|---|
| A core+cli | `packages/client/src/core/**`, `packages/client/src/cli/**`, `packages/client/test/core/**`, `packages/client/test/cli/**`, `packages/client/test/compat/**`, `fixtures/home/**` | `docs/superpowers/plans/2026-09-24-ws-a-core-cli.md` |
| B worker API | `packages/worker/src/**`, `packages/worker/migrations/**`, `packages/worker/test/**`, `packages/worker/wrangler.toml`, `packages/worker/vitest.config.js` | `docs/superpowers/plans/2026-09-24-ws-b-worker.md` |
| C web | `packages/worker/public/**`, `packages/worker/scripts/**`, `.hallmark/**` | `docs/superpowers/plans/2026-09-24-ws-c-web.md` |
| D Electron app | `packages/client/src/app/**`, `packages/client/assets/**`, `packages/client/electron-builder.yml`, `packages/client/test/app/**` | `docs/superpowers/plans/2026-09-24-ws-d-app.md` |
| E CI/release/docs | `.github/**`, `packaging/**`, `scripts/**` (repo root), `docs/RELEASING.md`, `README.md` | `docs/superpowers/plans/2026-09-24-ws-e-ci.md` |
| F infra (lead) | Cloudflare account, D1, DNS, GitHub OAuth App, secrets | this file, Phase 3 |

Shared read-only inputs: `fixtures/tokscale-graph-4.17.0.json` (real anonymized `tokscale graph` output), this file, the spec. Root `package.json`, `eslint.config.js`, `.npmrc`, `packages/*/package.json` are owned by the lead; request script changes in your report.

## Phases

1. **Phase 0 (done by lead):** repo, workspaces, deps, eslint, fixture, GitHub repo `xaverric/leaderborder` (public, remote set, nothing pushed).
2. **Phase 1 (parallel A-E):** each agent writes its detailed TDD plan file, then implements it.
3. **Phase 2 (lead):** integration: copy web `tokens.css` into app renderer, end-to-end `wrangler dev` + `leaderborder sync` against local D1, cross-review agents.
4. **Phase 3 (lead + user):** Cloudflare login + MCP, D1 create, OAuth App, secrets, DNS zone move, Worker Custom Domain, first deploy.
5. **Phase 4 (user):** commit, push, tag, npm publish + Homebrew tap per `docs/RELEASING.md`.

---

## Contract 1: tokscale graph input (fixture)

`tokscale graph [--since YYYY-MM-DD] --output <file>` writes:

```json
{ "meta": { "generatedAt": "...", "version": "4.17.0", "dateRange": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" } },
  "summary": { "totalTokens": 0, "totalCost": 0, "clients": ["claude"], "models": ["..."] },
  "contributions": [ { "date": "YYYY-MM-DD",
      "clients": [ { "client": "claude", "modelId": "claude-opus-5", "providerId": "anthropic",
          "tokens": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "reasoning": 0 },
          "cost": 0.0, "messages": 0 } ] } ] }
```

Same `date + client + modelId` may appear with different `providerId`: sum them into one row.

## Contract 2: usage row (client to worker)

```json
{ "day": "2026-09-24", "client": "claude", "model": "claude-opus-5",
  "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "reasoning": 0,
  "costUsd": 0.0, "messages": 0 }
```

Validation (worker enforces, client produces): `day` matches `^\d{4}-\d{2}-\d{2}$` and is a real date not more than 1 day in the future; `client` matches `^[a-z0-9][a-z0-9._-]{0,39}$`; `model` 1-120 chars of `[A-Za-z0-9._:/@+-]`; token fields and `messages` are safe non-negative integers; `costUsd` finite >= 0.

Metrics: `tokens = input + output + cacheRead + cacheWrite`; `tokensNoCache = input + output`; `costUsd` as sent. `reasoning` is stored and shown but not added to totals (tokscale already counts it inside output).

## Contract 3: HTTP API

All JSON. Errors: `{ "error": { "code": "invalid_request|unauthorized|forbidden|not_found|rate_limited|internal", "message": "..." } }` with 400/401/403/404/429/500.

Auth kinds: **cookie** `lb_session` (web), **bearer** `Authorization: Bearer lb_<43 base64url chars>` (device).

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/api/config` | - | - | `{ "githubClientId": "...", "apiVersion": 1 }` |
| POST | `/api/devices` | - | `{ "githubToken": "...", "deviceId": "<uuid v4>", "deviceName": "1-60 chars" }` | 201 `{ "token": "lb_...", "deviceId": "...", "user": User }` ; 403 if not allowed |
| PUT | `/api/usage` | bearer | `{ "deviceId": "<uuid>", "tokscaleVersion": "4.17.0", "rows": [Row] }` (1-500 rows) | 200 `{ "upserted": n }` |
| GET | `/api/me` | cookie or bearer | - | `{ "user": User, "rank": { "period": "week", "metric": "tokens", "position": 3, "of": 12, "value": 123 } \| null, "devices": [Device] }` |
| DELETE | `/api/me/devices/:id` | cookie | - | 204 |
| GET | `/api/leaderboard` | cookie | `?period=day\|week\|month\|all&metric=tokens\|tokens_nocache\|cost&client=&model=` (defaults week, tokens) | Leaderboard |
| GET | `/api/users/:login` | cookie | - | UserDetail |
| GET | `/api/public/stats` | - | - | PublicStats (`Cache-Control: public, max-age=60`) |
| GET | `/auth/github` | - | `?next=/app` (must start with `/`) | 302 to GitHub, state cookie |
| GET | `/auth/github/callback` | - | `?code&state` | 302 to `next`, sets `lb_session`; 403 page if not allowed |
| POST | `/auth/logout` | cookie | - | 204, clears cookie |

```
User        { "login": "octo", "name": "Octo Cat", "avatarUrl": "https://..." }
Device      { "id": "<uuid>", "name": "Octo's MacBook", "createdAt": "ISO", "lastSyncAt": "ISO|null" }
Leaderboard { "period": "week", "metric": "tokens", "range": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
              "entries": [ { "rank": 1, "login": "octo", "name": "Octo Cat", "avatarUrl": "...",
                             "value": 123, "tokens": 123, "tokensNoCache": 12, "costUsd": 1.5,
                             "byClient": { "claude": 100, "codex": 23 },
                             "sparkline": [ { "day": "YYYY-MM-DD", "value": 10 } ] } ],
              "filters": { "clients": ["claude","codex"], "models": ["claude-opus-5"] } }
UserDetail  { "user": User, "totals": { "tokens": 0, "tokensNoCache": 0, "costUsd": 0, "messages": 0, "activeDays": 0 },
              "daily": [ { "day": "YYYY-MM-DD", "tokens": 0, "tokensNoCache": 0, "costUsd": 0 } ],
              "byClientModel": [ { "client": "claude", "model": "...", "tokens": 0, "tokensNoCache": 0, "costUsd": 0 } ],
              "devices": [ { "name": "...", "lastSyncAt": "ISO|null" } ] }
PublicStats { "tokensAllTime": 0, "tokensThisWeek": 0, "costThisWeekUsd": 0, "players": 0, "activeThisWeek": 0,
              "topModels": [ { "model": "...", "tokens": 0 } ], "topClients": [ { "client": "...", "tokens": 0 } ],
              "daily": [ { "day": "YYYY-MM-DD", "tokens": 0 } ], "updatedAt": "ISO" }
```

`sparkline` = last 30 days ending at `range.end`. `daily` in UserDetail = last 365 days; in PublicStats = last 90 days, all users summed. `topModels`/`topClients` = top 5 this week. Periods computed in `LEADERBOARD_TZ` (default `Europe/Prague`): day = today, week = last 7 days incl. today, month = current calendar month, all = everything.

## Contract 4: Worker environment

`wrangler.toml` name `leaderborder`, `main = "src/index.js"`, `compatibility_date = "2026-09-01"`, D1 binding `DB` (database `leaderborder`), assets `directory = "public"`, binding `ASSETS`, `run_worker_first = ["/api/*", "/auth/*", "/app", "/app/*"]`. Worker serves `/app` and `/app/*` by returning `ASSETS.fetch` of `/app.html`.

Vars: `APP_URL`, `GITHUB_CLIENT_ID`, `ALLOWED_GITHUB_ORGS` (comma list, empty = no org filter), `ALLOWED_GITHUB_LOGINS` (comma list), `LEADERBOARD_TZ`. Access rule: allowed if both lists empty, or login in logins, or member of any org. Secrets: `GITHUB_CLIENT_SECRET`, `SESSION_SECRET`. Optional binding `USAGE_LIMITER` (ratelimit, 60 req / 60 s per token); skip when absent.

## Contract 5: client core module (`packages/client/src/core/index.js` exports)

```js
getConfig(env = process.env) -> { apiUrl, configDir }          // configDir ~/.config/leaderborder
loadState({ configDir }) -> State ; saveState({ configDir }, State) -> void
// State { deviceId, deviceName, lastSyncAt: ISO|null, lastError: { code, message, at }|null,
//         summary: { today: { tokens, costUsd }, week: { tokens, costUsd }, topModel: string|null }|null }
tokscaleBin({ arch = process.arch }) -> absolute path of @tokscale/cli-darwin-<arch> binary
runTokscale(args, { timeoutMs = 120000 }) -> Promise<{ stdout, stderr }>
readGraph({ since }) -> Promise<GraphResult>                     // tokscale graph --no-spinner [--since] --output <tmp>
toUsageRows(graph) -> Row[]                                      // pure
syncWindow({ lastSyncAt, now }) -> { since: "YYYY-MM-DD" | null } // pure; null = full history, else now - 35 days
summarize(rows, now) -> State.summary                            // pure; week = last 7 days incl. today
chunk(rows, size = 500) -> Row[][]                               // pure
createApi({ apiUrl, fetch, token }) -> { getConfig, registerDevice, putUsage, getMe }
githubDeviceFlow({ clientId, fetch, onCode, sleep }) -> Promise<githubToken>  // scope read:org
keychain -> { getToken(), setToken(token), deleteToken() }       // security CLI, token via stdin
login({ onCode, fetch }) -> Promise<{ user }>
logout() -> Promise<void>                                        // delete keychain token, clear deviceId
sync({ now = new Date(), fetch, onProgress }) -> Promise<{ rows, since, summary }>
cursorStatus() -> Promise<{ loggedIn: boolean }>
cursorLogin({ stdio = "inherit" }) -> Promise<void>              // tokscale cursor login --name default
class LeaderborderError extends Error { code: "not_logged_in"|"tokscale_failed"|"upload_failed"|"unauthorized"|"forbidden"|"network" }
```

`sync` order: `cursorStatus` then `tokscale cursor sync` if logged in (failure is a warning, not fatal) → `readGraph({ since })` → `toUsageRows` → `putUsage` per chunk with 3 retries (backoff 1s, 4s, 16s; no retry on 4xx) → `saveState` with `lastSyncAt`, `summary`, `lastError: null`. On 401: delete token, throw `unauthorized`.

CLI (`src/cli/bin.js`): `leaderborder` (no args) launches the app; `app`, `login`, `logout`, `sync [--dry-run]`, `status [--json]`, `cursor-login`, `--version`, `--help`. Exit codes: 0 ok, 1 error, 2 usage error.

## Contract 6: shared design tokens

Web (WS C) owns `packages/worker/public/css/tokens.css`. It must define at least: `--color-paper`, `--color-paper-2`, `--color-paper-3`, `--color-ink`, `--color-ink-2`, `--color-muted`, `--color-accent`, `--color-accent-ink`, `--color-rule`, `--color-focus`, `--color-positive`, `--color-negative`, `--font-display`, `--font-body`, `--font-mono`, `--space-2xs..--space-3xl`, `--text-xs..--text-display`, `--radius-sm|md|lg|pill`, `--ease-out|in|in-out`, `--dur-fast|base|slow`. App (WS D) references only these names and ships a temporary `src/app/renderer/tokens.css` with the same names; the lead replaces it with the web copy in Phase 2.

---

## Phase 3: infra (lead)

Known values: Cloudflare account id `a2a11f9660e380f8eda01796204aac34`; D1 `leaderborder` id `0409dfb7-8b69-41fb-934b-0e5e4f902d04` (WEUR); GitHub OAuth App client id `Ov23liGpxnsqRCLTD8Pr` (Device Flow enabled).

- [ ] Install Cloudflare MCP + `npx wrangler login` (user completes browser login).
- [ ] `wrangler d1 create leaderborder`, put `database_id` into `wrangler.toml`.
- [ ] GitHub OAuth App `leaderborder` (homepage `https://leaderborder.xaverric.cz`, callback `https://leaderborder.xaverric.cz/auth/github/callback`, Device Flow enabled). Client id into vars; `wrangler secret put GITHUB_CLIENT_SECRET`, `SESSION_SECRET` (random 32 B).
- [ ] Export Websupport zone, create `xaverric.cz` zone in Cloudflare, diff records, user approves, switch nameservers at Websupport, verify.
- [ ] `wrangler d1 migrations apply leaderborder --remote`, `wrangler deploy`, attach Custom Domain `leaderborder.xaverric.cz`.
- [ ] GitHub repo secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
- [ ] Smoke: landing loads, `/api/public/stats` 200, login works, `leaderborder login && leaderborder sync` from this Mac shows up on the leaderboard.
