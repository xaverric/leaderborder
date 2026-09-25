# leaderborder

[![CI](https://github.com/xaverric/leaderborder/actions/workflows/ci.yml/badge.svg)](https://github.com/xaverric/leaderborder/actions/workflows/ci.yml)
[![Nightly](https://github.com/xaverric/leaderborder/actions/workflows/nightly.yml/badge.svg)](https://github.com/xaverric/leaderborder/actions/workflows/nightly.yml)
[![CodeQL](https://github.com/xaverric/leaderborder/actions/workflows/codeql.yml/badge.svg)](https://github.com/xaverric/leaderborder/actions/workflows/codeql.yml)
[![npm](https://img.shields.io/npm/v/leaderborder)](https://www.npmjs.com/package/leaderborder)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Track how many tokens you burn in Claude Code, Codex, Cursor and other AI coding tools, and compete with your colleagues on a leaderboard.

leaderborder is a macOS menu bar app and CLI. It reads your local AI coding usage, publishes daily totals to https://leaderborder.xaverric.cz and shows where you rank. Sign in with GitHub to see the leaderboard.

## Install

Requires macOS (Apple Silicon or Intel). The npm routes need Node.js 22 or newer.

**npx (recommended)**

```sh
npx leaderborder
```

Starts the menu bar app. On first run it offers GitHub sign-in and launch at login.

**npm**

```sh
npm install -g leaderborder
leaderborder
```

**Homebrew**

```sh
brew install xaverric/tap/leaderborder          # CLI (includes the app launcher)
brew install --cask xaverric/tap/leaderborder   # app only
```

**DMG**

Download `Leaderborder-<version>-arm64.dmg` (Apple Silicon) or `Leaderborder-<version>-x64.dmg` (Intel) from [GitHub Releases](https://github.com/xaverric/leaderborder/releases/latest) and drag the app to Applications.

The app is not signed with an Apple Developer ID yet. On first launch right-click Leaderborder.app in Finder and choose Open.

Verify a downloaded DMG against the GitHub build attestation before opening it:

```sh
gh attestation verify Leaderborder-<version>-arm64.dmg -R xaverric/leaderborder
```

### CLI

```sh
leaderborder                # launch the menu bar app
leaderborder login          # sign in with GitHub (device code)
leaderborder sync           # collect and upload usage now
leaderborder sync --dry-run # print the rows that would be sent, send nothing
leaderborder status [--json]
leaderborder cursor-login   # connect Cursor usage (optional)
leaderborder logout         # revoke the device token on the server and remove it from the Keychain
leaderborder --version
```

Options:

- `login --device-name <name>` names this device in your device list (1-60 printable characters). Default: `Mac (arm64)` or `Mac (x64)`.
- `--api-url <url>` points `login`, `logout`, `sync` and `status` at another server and takes precedence over `LEADERBORDER_API_URL`. `login` prints the API host whenever it is not the default, so you can see where your GitHub token goes.

## How it works

```
your Mac                                          Cloudflare
+------------------------------+                  +-------------------------------+
| leaderborder app / CLI       |  PUT /api/usage  | Worker + D1                   |
|  1. tokscale graph (local)   | ---------------> |  daily totals per device      |
|  2. normalize to daily rows  |  bearer token    |  leaderboard, GitHub sign-in  |
|  3. upload changed days      |                  |  https://leaderborder.xaverric.cz
+------------------------------+                  +-------------------------------+
```

1. Every 60 minutes (and after wake from sleep) the app runs the bundled tokscale engine locally. tokscale reads the usage logs your AI coding tools already keep on disk.
2. The result is reduced to one row per day, tool and model.
3. The rows are uploaded to the leaderborder Worker. Re-syncing a day overwrites it, so nothing is counted twice. Two Macs of the same person add up.

### Privacy

What is sent, per day, tool and model:

- token counts: input, output, cache read, cache write, reasoning
- estimated API-equivalent cost in USD and the number of messages
- model time: the summed duration of model responses and how many responses it covers. Cursor records no timing, so its rows have none.
- a random device id, a device name and the tokscale version. The device name defaults to a generic `Mac (arm64)` or `Mac (x64)`; pass `leaderborder login --device-name <name>` to choose one. Only you see your own device names, other signed-in players see just the number of your devices.

Per day, for the last 35 days on each sync:

- session totals: active time, the longest stretch without a 3 minute break, the number of sessions and the peak of parallel sessions
- per tool: the number of prompts and 24 hourly buckets of tokens, messages and prompts in the device's local time

Your GitHub login, name and avatar are known to the server because you sign in with GitHub.

What is never sent:

- prompts, responses, code or any file content
- file paths, project or repository names
- session ids, MCP server names, timestamps of individual messages or prompts

Credentials:

- The GitHub token from sign-in is used once to register the device and is not stored.
- The device token is stored only in the macOS Keychain (service `leaderborder`). The server keeps only its SHA-256 hash. `leaderborder logout` revokes the token on the server and removes it from the Keychain; you can also revoke a device any time on the web.
- If you connect Cursor, tokscale stores the Cursor session in `~/.config/tokscale/cursor-credentials.json` on your Mac.

Other network traffic of the tokscale engine: model price lists (`raw.githubusercontent.com/BerriAI/litellm`, `openrouter.ai`, `models.dev`, plain GET without your data) and `cursor.com` for Cursor usage if you connected it. leaderborder never calls the tokscale commands that talk to tokscale.ai (`login`, `submit`, `autosubmit`), so nothing goes there.

The public landing page shows only anonymous totals. Per-person numbers require a GitHub sign-in, optionally limited to selected GitHub organizations.

## Powered by tokscale

Usage collection is done by [tokscale](https://github.com/junhoyeo/tokscale), the open-source token usage engine by [@junhoyeo](https://github.com/junhoyeo), MIT licensed. leaderborder pins an exact `@tokscale/cli` version and checks nightly that the newest tokscale still produces the same data.

## Development

npm workspaces monorepo, plain JavaScript (ESM), Node.js 22.

| Path | What |
|---|---|
| `packages/client` | the `leaderborder` npm package: sync core, CLI, Electron app |
| `packages/worker` | Cloudflare Worker: JSON API, GitHub auth, D1 migrations, website in `public/` |
| `packaging/homebrew` | formula and cask templates rendered by the Release workflow |
| `scripts` | release helpers |

```sh
npm ci
npm run lint
npm test                   # all workspaces
npm run test:client
npm run test:worker
npm run compat:tokscale    # real tokscale binary against fixtures/home (macOS)
node --test "scripts/*.test.js"
```

`.npmrc` sets `legacy-peer-deps=true` to work around an npm 10 peer resolution bug with the vitest packages. Keep it.

### Local Worker

```sh
cd packages/worker
npx wrangler d1 migrations apply leaderborder --local
npx wrangler d1 execute leaderborder --local --file test/fixtures/seed.sql
npx wrangler dev --local --var DEV_LOGIN:1 --var APP_URL:http://localhost:8787
```

`npm run dev:worker` from the repo root starts `wrangler dev` too. The seed adds sample users, devices and about 90 days of usage. `DEV_LOGIN=1` enables a local sign-in without GitHub. It works only when `APP_URL` is `http://localhost:8787` and is never active in production.

Point the client at the local Worker with `--api-url` or `LEADERBORDER_API_URL`. `login` prints the API host whenever it is not the default:

```sh
npx leaderborder sync --dry-run --api-url http://localhost:8787
LEADERBORDER_API_URL=http://localhost:8787 npx leaderborder sync --dry-run
```

### Releasing

See [docs/RELEASING.md](docs/RELEASING.md).

## License

[MIT](LICENSE)
