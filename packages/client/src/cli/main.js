import { spawn as nodeSpawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import * as coreModule from "../core/index.js";
import { DEFAULT_API_URL } from "../core/config.js";
import { cleanText, formatNumber, formatRowsTable, formatStatus, formatSummary } from "./format.js";

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_USAGE = 2;

const USAGE = `Usage: leaderborder [command] [options]

Commands:
  (none), app        Launch the menu bar app (macOS)
  login              Sign in with GitHub and register this device
  logout             Revoke this device's token and remove it from the Keychain
  sync [--dry-run]   Upload local usage (--dry-run prints rows, uploads nothing)
  status [--json]    Show login and sync state
  cursor-login       Connect Cursor usage through tokscale

Options:
  -h, --help             Show this help
  -v, --version          Show the version
  --api-url <url>        API base URL for login, logout, sync and status (overrides LEADERBORDER_API_URL)
  --device-name <name>   Name of this device in your device list (login only, default: Mac (<arch>))

Environment:
  LEADERBORDER_API_URL   API base URL (default https://leaderborder.xaverric.cz)
`;

const OPTIONS = {
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
  "dry-run": { type: "boolean" },
  json: { type: "boolean" },
  "api-url": { type: "string" },
  "device-name": { type: "string" },
};

const GLOBAL_OPTIONS = new Set(["help", "version"]);

const COMMAND_OPTIONS = {
  app: [],
  login: ["api-url", "device-name"],
  logout: ["api-url"],
  sync: ["dry-run", "api-url"],
  status: ["json", "api-url"],
  "cursor-login": [],
};

class UsageError extends Error {}

const packageVersion = () =>
  JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;

const defaultIo = () => ({
  stdout: process.stdout,
  stderr: process.stderr,
  core: coreModule,
  platform: process.platform,
  env: process.env,
  spawn: nodeSpawn,
  loadElectron: async () => (await import("electron")).default,
  packageRoot: fileURLToPath(new URL("../..", import.meta.url)),
  version: packageVersion(),
});

const parseCommand = (argv) => {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  const [command = "app", ...rest] = positionals;
  if (values.help || values.version) return { command: values.help ? "help" : "version", values };
  if (!Object.hasOwn(COMMAND_OPTIONS, command)) throw new UsageError(`unknown command: ${command}`);
  if (rest.length > 0) throw new UsageError(`unexpected argument: ${rest[0]}`);
  const misplaced = Object.keys(values).find((name) => !GLOBAL_OPTIONS.has(name) && !COMMAND_OPTIONS[command].includes(name));
  if (misplaced) throw new UsageError(`--${misplaced} is not valid for ${command}`);
  return { command, values };
};

const print = (target, text) => target.write(`${text}\n`);

const plural = (count, word) => `${formatNumber(count)} ${word}${count === 1 ? "" : "s"}`;

const describeSince = (since) => (since ? `since ${since}` : "full history");

const progressPrinter = (io) => (event) => {
  if (event.phase === "cursor") print(io.stderr, "Checking Cursor...");
  if (event.phase === "graph") print(io.stderr, `Reading usage with tokscale (${describeSince(event.since)})...`);
  if (event.phase === "upload") print(io.stderr, `Uploading batch ${event.done + 1}/${event.total}...`);
};

const launchApp = async (io) => {
  if (io.platform !== "darwin") {
    print(io.stderr, "leaderborder: the menu bar app is only available on macOS. Use leaderborder sync instead.");
    return EXIT_ERROR;
  }
  const electronPath = await io.loadElectron();
  const env = Object.fromEntries(Object.entries(io.env).filter(([key]) => key !== "ELECTRON_RUN_AS_NODE"));
  io.spawn(electronPath, [io.packageRoot], { detached: true, stdio: "ignore", env }).unref();
  print(io.stdout, "leaderborder is starting in the menu bar.");
  return EXIT_OK;
};

const openUrl = (io, url) => {
  if (io.platform !== "darwin") return;
  const child = io.spawn("/usr/bin/open", [url], { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
};

const describeUser = (user) => {
  const login = cleanText(user?.login) || "unknown";
  const name = cleanText(user?.name);
  return name ? `${login} (${name})` : login;
};

const runLogin = async (io, { apiUrl, deviceName }) => {
  const config = io.core.getConfig(io.env, { apiUrl });
  if (config.apiUrl !== DEFAULT_API_URL) print(io.stdout, `API: ${new URL(config.apiUrl).host}`);
  const { user } = await io.core.login({
    apiUrl,
    deviceName,
    onCode: ({ userCode, verificationUri }) => {
      print(io.stdout, `Your one-time code: ${userCode}`);
      print(io.stdout, `Enter it at ${verificationUri} (opening in your browser)`);
      print(io.stdout, "Waiting for GitHub authorization...");
      openUrl(io, verificationUri);
    },
  });
  print(io.stdout, `Logged in as ${describeUser(user)}. Run leaderborder sync to upload usage.`);
  return EXIT_OK;
};

const LOGOUT_MESSAGES = {
  revoked: "Logged out. The device token was revoked and removed from the Keychain.",
  local: "Logged out. The device token was removed from the Keychain but could not be revoked on the server. Revoke this device in the web app.",
};

const runLogout = async (io, { apiUrl }) => {
  const result = await io.core.logout({ apiUrl });
  print(io.stdout, result?.revoked ? LOGOUT_MESSAGES.revoked : LOGOUT_MESSAGES.local);
  return EXIT_OK;
};

const runSync = async (io, { dryRun, apiUrl }) => {
  const result = await io.core.sync({ dryRun, apiUrl, onProgress: progressPrinter(io) });
  result.warnings?.forEach((warning) => print(io.stderr, `warning: ${cleanText(warning)}`));
  if (dryRun) {
    print(io.stdout, formatRowsTable(result.rows));
    print(io.stdout, `${plural(result.rows.length, "row")} (${describeSince(result.since)}). Dry run, nothing uploaded.`);
    return EXIT_OK;
  }
  print(io.stdout, `Uploaded ${plural(result.uploaded, "row")} (${describeSince(result.since)}).`);
  print(io.stdout, formatSummary(result.summary));
  return EXIT_OK;
};

const runStatus = async (io, { json, apiUrl }) => {
  const config = io.core.getConfig(io.env, { apiUrl });
  const state = io.core.loadState(config);
  const hasToken = Boolean(await io.core.keychain.getToken(config));
  print(io.stdout, json ? JSON.stringify({ ...state, apiUrl: config.apiUrl, hasToken }, null, 2) : formatStatus({ state, apiUrl: config.apiUrl, hasToken }));
  return EXIT_OK;
};

const runCursorLogin = async (io) => {
  await io.core.cursorLogin({ stdio: "inherit" });
  return EXIT_OK;
};

const COMMANDS = {
  help: (io) => {
    io.stdout.write(USAGE);
    return EXIT_OK;
  },
  version: (io) => {
    print(io.stdout, io.version);
    return EXIT_OK;
  },
  app: launchApp,
  login: (io, values) => runLogin(io, { apiUrl: values["api-url"], deviceName: values["device-name"] }),
  logout: (io, values) => runLogout(io, { apiUrl: values["api-url"] }),
  sync: (io, values) => runSync(io, { dryRun: Boolean(values["dry-run"]), apiUrl: values["api-url"] }),
  status: (io, values) => runStatus(io, { json: Boolean(values.json), apiUrl: values["api-url"] }),
  "cursor-login": runCursorLogin,
};

const describeError = (error) =>
  error?.code && error.name === "LeaderborderError" ? `${cleanText(error.message)} [${cleanText(error.code)}]` : cleanText(error?.message ?? String(error));

export const main = async (argv, ioOverrides = {}) => {
  const io = { ...defaultIo(), ...ioOverrides };
  try {
    const { command, values } = parseCommand(argv);
    return await COMMANDS[command](io, values);
  } catch (error) {
    if (error instanceof UsageError || error?.code?.startsWith?.("ERR_PARSE_ARGS")) {
      print(io.stderr, `leaderborder: ${error.message}\n\n${USAGE}`);
      return EXIT_USAGE;
    }
    print(io.stderr, `leaderborder: ${describeError(error)}`);
    return EXIT_ERROR;
  }
};
