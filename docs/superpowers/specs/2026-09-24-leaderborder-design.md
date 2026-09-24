# leaderborder - design

Datum: 2026-09-24 · Stav: návrh ke schválení · Web: https://leaderborder.xaverric.cz

## Cíl

Firemní soutěž v pálení tokenů. Každý si na Macu pustí menubar appku, ta sbírá lokální usage ze všech AI coding nástrojů (Claude Code, Codex, Cursor a další) a publikuje denní agregáty na vlastní Cloudflare backend. Web ukazuje veřejnou landing page s instalací a po GitHub loginu leaderboard a statistiky.

## Mimo rozsah (YAGNI)

- Rozpad per subscription/účet. Agreguje se per člověk (a zařízení).
- Týmy/skupiny, výzvy, notifikace, achievementy.
- Windows/Linux build appky (tokscale to umí, appka zatím jen macOS arm64 + x64).
- Podpis a notarizace (připraveno v CI, vypnuto do dodání Apple Developer ID).
- Cokoli sdílené s tokscale.ai. Tokscale je jen lokální engine a inspirace.

## Architektura

```
Mac                                             Cloudflare
┌───────────────────────────────┐               ┌──────────────────────────────────┐
│ Electron menubar (packages/app)│               │ Worker (packages/worker)         │
│   └ core: sync                 │  PUT /api/usage│   ├ /api/*  (JSON API)           │
│       ├ tokscale cursor sync   │ ─────────────▶│   ├ /auth/* (GitHub OAuth)       │
│       ├ tokscale graph --output│  Bearer token │   └ static assets (landing + app)│
│       └ normalize → rows       │               │ D1 (SQLite)                      │
│ CLI (packages/cli)             │               └──────────────────────────────────┘
└───────────────────────────────┘
```

Veřejné monorepo na GitHubu uživatele, npm workspaces, čisté JavaScript (ESM), Node 22.

```
packages/
  client/   jediný npm balíček `leaderborder`:
    src/core/  sync engine: spuštění tokscale, normalizace, upload, device auth, Keychain
    src/cli/   `leaderborder login | sync | status | logout | app`
    src/app/   Electron menubar nad core
  worker/   Cloudflare Worker + D1 migrace + web (public/)
```

### Závislost na tokscale

- Balíček `@tokscale/cli` (MIT), verze přesně připnutá. Appka přibalí jen `@tokscale/cli-darwin-arm64` / `-x64`.
- Voláme výhradně lokální příkazy: `tokscale cursor login|sync|status` a `tokscale graph --output <tmp>.json`.
- Nikdy nevoláme `login`, `submit`, `autosubmit`, `report`, `delete-data`, TUI. Tím k tokscale.ai nic neodchází (ověřeno ve zdrojácích, commit `2edc986`: tokscale.ai kontaktují jen tyto příkazy a TUI remote stats s uloženým tokscale loginem).
- Síť tokscale při reportu: ceníky z `raw.githubusercontent.com/BerriAI/litellm`, `openrouter.ai/api/v1`, `models.dev/api.json` (GET, bez uživatelských dat) a `cursor.com` pro Cursor sync.
- Cursor: uživatel jednou v appce spustí `tokscale cursor login` (auto-detekce z Cursor desktop). Tokscale ukládá session cookie v plaintextu do `~/.config/tokscale/cursor-credentials.json`. Vědomě akceptováno.

## packages/core

Čisté funkce + tenká IO vrstva.

- `runTokscale(args)` - spustí přibalenou binárku (`execFile`, timeout 120 s), vrátí stdout/soubor.
- `readGraph(since)` - `tokscale graph --since <YYYY-MM-DD> --output <tmp>` → parsovaný `GraphResult`.
- `toUsageRows(graph)` (pure) - `contributions[].clients[]` → `{ day, client, model, input, output, cacheRead, cacheWrite, costUsd, messages }`. Součet přes `providerId` pro stejný `client+model+day`.
- `syncWindow(state)` (pure) - první sync: celá historie; další: posledních 35 dní.
- `uploadUsage(rows, token)` - `PUT /api/usage` po dávkách max 500 řádků.
- `deviceLogin()` - GitHub Device Flow (client_id veřejný) → GitHub access token → `POST /api/devices` → náš device token. GitHub token se neukládá.
- `credentials` - device token v macOS Keychain (`security add/find-generic-password`, service `leaderborder`). Electron používá stejnou položku.
- Lokální stav `~/.config/leaderborder/state.json`: `deviceId`, `lastSyncAt`, `lastError`, `apiUrl`. Žádná tajemství.

## packages/cli

`leaderborder login | sync [--dry-run] | status | logout | app`. `sync --dry-run` vypíše řádky, které by odešly. `app` spustí Electron menubar (electron je dependency balíčku).

## packages/app (Electron menubar)

- Tray ikona + popover okno (bez Docku): dnešní a týdenní tokeny, top model, pozice v leaderboardu, čas posledního syncu, tlačítka Sync now, Open leaderboard, Cursor login, Log out.
- Periodický sync každých 60 min + při probuzení z režimu spánku. Launch at login (`app.setLoginItemSettings`).
- Nepřihlášený stav: tlačítko Sign in with GitHub → device kód v popoveru + otevření `github.com/login/device`.
- UI používá stejné tokeny (`tokens.css`) jako web.

## packages/worker

### Přístup

- Landing a `/api/public/stats` veřejně.
- Login: GitHub OAuth App (web) a Device Flow (appka). Vstup jen pro členy `ALLOWED_GITHUB_ORGS` nebo loginy v `ALLOWED_GITHUB_LOGINS` (vars ve `wrangler.toml`). Obojí prázdné = kdokoli s GitHub účtem. Scope `read:org`.
- Web session: HMAC-podepsaná cookie (`HttpOnly; Secure; SameSite=Lax`, 30 dní), secret `SESSION_SECRET`.
- Device token: náhodných 32 B, v DB jen `sha256`. Revokace per zařízení.

### D1 schéma

```sql
users       (id INTEGER PK, github_id INTEGER UNIQUE, login TEXT, name TEXT, avatar_url TEXT, created_at TEXT)
devices     (id TEXT PK /* uuid */, user_id INTEGER, name TEXT, created_at TEXT, last_sync_at TEXT)
api_tokens  (id INTEGER PK, device_id TEXT, token_hash TEXT UNIQUE, created_at TEXT, last_used_at TEXT, revoked_at TEXT)
usage_daily (device_id TEXT, day TEXT, client TEXT, model TEXT,
             input INTEGER, output INTEGER, cache_read INTEGER, cache_write INTEGER, reasoning INTEGER,
             cost_usd REAL, messages INTEGER, updated_at TEXT,
             PRIMARY KEY (device_id, day, client, model))
```

`device_id` v klíči: dva Macy jednoho člověka se sčítají, opakovaný sync téhož zařízení přepisuje (idempotentní upsert).

### API

| Metoda | Cesta | Auth | Popis |
|---|---|---|---|
| GET | `/auth/github` | - | redirect na GitHub OAuth |
| GET | `/auth/github/callback` | - | ověření org, upsert user, cookie |
| POST | `/auth/logout` | cookie | smaže cookie |
| POST | `/api/devices` | GitHub token v body | ověří `/user` + org, vytvoří device + token |
| PUT | `/api/usage` | Bearer | `{ rows: [...] }`, max 500, upsert |
| GET | `/api/leaderboard` | cookie | `period=day\|week\|month\|all`, `metric=tokens\|tokens_nocache\|cost`, `client`, `model` |
| GET | `/api/users/:login` | cookie | trend po dnech, rozpad appka × model, zařízení |
| GET | `/api/me` | cookie nebo Bearer | profil, pozice, zařízení |
| DELETE | `/api/me/devices/:id` | cookie | revokace zařízení |
| GET | `/api/public/stats` | - | jen anonymní agregáty: tokeny celkem, tento týden, počet hráčů, top modely |

Validace vstupů přes malé ruční validátory, router ručně (tabulka metoda + cesta), žádný framework.

### Metriky

- `tokens` = input + output + cache_read + cache_write (výchozí).
- `tokens_nocache` = input + output.
- `cost` = API-equivalent USD dle tokscale ceníku.
- Den = lokální den z tokscale (časová zóna zařízení).

## Web (Hallmark)

Vstupy: publikum = veřejnost (vývojáři, kolegové z firmy), akce = nainstaluj a přihlas se / podívej se, kde jsi v žebříčku, tón = technický a atraktivní, statistiky jako hlavní hrdina.

- **Landing** (`/`): Hallmark genre *atmospheric*, macrostructure *04 Stat-Led*, theme *Bloom* (světlé plátno s teplými radiálními bloomy, výrazný sans display), dotažený k našim potřebám. Layout (ne obsah ani assety) inspirovaný tokscale.ai: velké živé číslo, contribution graf, přehled nástrojů, instalační blok. Hero = **živé číslo** z `/api/public/stats` (tokeny spálené tento týden), žádná vymyšlená čísla. Sekce: hero · jak to funguje (Mac → sync → leaderboard) · podporované nástroje · instalace (npm / brew / DMG, copy buttony) · co se posílá a co ne (soukromí) · CTA Sign in with GitHub · footer. Nav N5 floating pill, footer Ft5 statement. Konečné archetypy a detaily potvrdí Hallmark flow při buildu.
- **App** (`/app`, po loginu): leaderboard (pořadí, avatar, login, metrika, sparkline 30 dní, podíl appek), filtry period/metric/client/model, detail člověka (`/app/u/:login`: denní heatmapa, trend, stacked appka × model, zařízení), moje zařízení (revokace).
- Grafy: uPlot pro časové řady, vlastní SVG pro heatmapu a stacked bary. Frontend vanilla JS + ES moduly bez build stepu, servírované jako Workers static assets.
- Mobil je plnohodnotný cíl: 320/375/414/768 px bez horizontálního scrollu. Leaderboard se na mobilu mění z tabulky na karty (pořadí, avatar, metrika, sparkline), filtry do sheetu, grafy s horizontálním posunem uvnitř karty místo zmenšování. `prefers-reduced-motion`.

## Distribuce

- **npx (primární)**: `npx leaderborder` spustí menubar appku, při prvním spuštění nabídne GitHub login a launch at login. `npx leaderborder sync|status|login` pro CLI.
- **npm**: `npm i -g leaderborder` (packages/cli, závisí na core, electron, `@tokscale/cli`).
- **Homebrew**: tap `<gh-user>/homebrew-tap`: formula `leaderborder` (Node CLI) a cask `leaderborder` (DMG z GitHub Releases, nepodepsaný, první spuštění přes pravý klik → Otevřít, popsáno na landingu).
- **GitHub Releases**: DMG arm64 + x64 přes electron-builder.

Publikaci na npm a do Homebrew tapu provádí uživatel ručně podle `docs/RELEASING.md`. CI připraví artefakty (tarball, DMG, vyplněnou formuli a cask se sha256), ale nepublikuje.

## CI/CD (GitHub Actions)

- `ci.yml` (PR + push): lint (eslint), unit testy (`node --test`) pro core/cli, testy Workeru (`vitest` + `@cloudflare/vitest-pool-workers` s D1), build appky (bez podpisu).
- `release.yml` (tag `v*`): DMG → Release, `wrangler d1 migrations apply --remote`, `wrangler deploy`. Podpis/notarizace jako krok podmíněný existencí secrets.
- `deploy.yml` (push na `main`, cesty `packages/worker/**`): migrace + deploy Workeru.
- `nightly.yml` (cron denně): plný build + testy, CodeQL, `npm audit --omit=dev` + OSV-Scanner, gitleaks, **kompatibilita s nejnovějším `@tokscale/cli`** (spustí `graph` nad fixtures a ověří tvar JSON). Dependabot pro npm + actions.
- Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`; Worker secrets `GITHUB_CLIENT_SECRET`, `SESSION_SECRET` přes `wrangler secret put`.

## Infrastruktura a doména

- Cloudflare účet (uživatel přihlášen přes GitHub). Ovládání přes `wrangler` + oficiální Cloudflare MCP.
- Přesun DNS zóny `xaverric.cz` z Websupportu na Cloudflare (free). Mail se neřeší. Kroky: export zóny z Websupportu → založení zóny v Cloudflare → porovnání záznamů → uživatel odsouhlasí → přepnutí NS u Websupportu → ověření.
- Worker Custom Domain `leaderborder.xaverric.cz` (TLS automaticky).
- GitHub OAuth App: homepage `https://leaderborder.xaverric.cz`, callback `/auth/github/callback`, Device Flow zapnutý.

## Chyby a odolnost

- Chybějící/rozbitá tokscale binárka nebo nečitelný JSON → appka ukáže stav chyby, `lastError` ve state, sync se zkusí příští tick. Žádná data se neodešlou.
- Upload: retry s exponenciálním backoffem (3×), 401 → odhlásit a vyzvat k loginu.
- Worker: validace každého řádku (nezáporná celá čísla, `day` formát, délky stringů), limit 500 řádků / request, rate limit per token (Cloudflare Rate Limiting binding).
- Cursor sync selže → pokračuje se bez Cursoru, upozornění v appce.

## Testování

- core: `toUsageRows` a `syncWindow` nad fixtures ze skutečného výstupu `tokscale graph` (anonymizované).
- worker: API testy v Workers runtime s D1 (upsert idempotence, sčítání zařízení, org allowlist, revokace, validace).
- app: smoke test spuštění (Playwright pro Electron) v CI.
- web: Hallmark slop test + kontrola 320/375/414/768 px.

## Rizika

- Změna formátu `tokscale graph` → připnutá verze + nightly kompatibilita.
- Cursor usage API je neoficiální → Cursor degraduje samostatně, zbytek funguje.
- Nepodepsaná appka → npm cesta jako primární doporučení, DMG/cask s návodem.
- Veřejná landing ukazuje anonymní agregáty → žádná jména ani per-user čísla bez loginu.
