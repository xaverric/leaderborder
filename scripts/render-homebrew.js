#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const DEFAULT_REPO = "xaverric/leaderborder";
const TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "packaging", "homebrew");
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

class UsageError extends Error {}

export const renderTemplate = (tpl, vars) =>
  tpl.replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (_, key) => {
    if (!Object.hasOwn(vars, key)) throw new Error(`Missing template variable: ${key}`);
    return String(vars[key]);
  });

export const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

export const releaseUrl = ({ repo, version, file }) =>
  `https://github.com/${repo}/releases/download/v${version}/${file}`;

export const dmgFileName = (version, arch) => `Leaderborder-${version}-${arch}.dmg`;

export const tarballFileName = (version) => `leaderborder-${version}.tgz`;

const check = (value, pattern, label) => {
  if (!pattern.test(String(value))) throw new Error(`Invalid ${label}: ${value}`);
  return value;
};

export const homebrewVars = ({ repo, version, tarballSha256, dmgArm64Sha256, dmgX64Sha256 }) => ({
  REPO: check(repo, REPO, "repo"),
  VERSION: check(version, SEMVER, "version"),
  TARBALL_URL: releaseUrl({ repo, version, file: tarballFileName(version) }),
  TARBALL_SHA256: check(tarballSha256, SHA256_HEX, "sha256"),
  DMG_ARM64_SHA256: check(dmgArm64Sha256, SHA256_HEX, "sha256"),
  DMG_X64_SHA256: check(dmgX64Sha256, SHA256_HEX, "sha256"),
});

export const renderHomebrew = ({ formulaTpl, caskTpl, vars }) => ({
  formula: renderTemplate(formulaTpl, vars),
  cask: renderTemplate(caskTpl, vars),
});

const USAGE =
  "Usage: node scripts/render-homebrew.js --version X.Y.Z --tarball <tgz> --dmg-arm64 <dmg> --dmg-x64 <dmg> --out <dir> [--repo owner/name]";

const parseCli = (argv) => {
  const { values } = parseArgs({
    args: argv,
    options: {
      version: { type: "string" },
      tarball: { type: "string" },
      "dmg-arm64": { type: "string" },
      "dmg-x64": { type: "string" },
      out: { type: "string" },
      repo: { type: "string", default: DEFAULT_REPO },
    },
    strict: true,
  });
  const missing = ["version", "tarball", "dmg-arm64", "dmg-x64", "out"].filter((key) => !values[key]);
  if (missing.length) throw new UsageError(`Missing --${missing.join(", --")}`);
  if (!SEMVER.test(values.version)) throw new UsageError(`Invalid --version: ${values.version}`);
  return values;
};

const expectName = (path, expected) => {
  if (basename(path) !== expected) throw new UsageError(`Expected file named ${expected}, got ${basename(path)}`);
  return path;
};

const hashFile = async (path) => sha256(await readFile(path));

export const main = async (argv) => {
  const opts = parseCli(argv);
  const { version } = opts;
  const vars = homebrewVars({
    repo: opts.repo,
    version,
    tarballSha256: await hashFile(expectName(opts.tarball, tarballFileName(version))),
    dmgArm64Sha256: await hashFile(expectName(opts["dmg-arm64"], dmgFileName(version, "arm64"))),
    dmgX64Sha256: await hashFile(expectName(opts["dmg-x64"], dmgFileName(version, "x64"))),
  });
  const { formula, cask } = renderHomebrew({
    formulaTpl: await readFile(join(TEMPLATE_DIR, "leaderborder.rb.tmpl"), "utf8"),
    caskTpl: await readFile(join(TEMPLATE_DIR, "leaderborder-cask.rb.tmpl"), "utf8"),
    vars,
  });
  await mkdir(opts.out, { recursive: true });
  await writeFile(join(opts.out, "leaderborder.rb"), formula);
  await writeFile(join(opts.out, "leaderborder-cask.rb"), cask);
  return [join(opts.out, "leaderborder.rb"), join(opts.out, "leaderborder-cask.rb")];
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (files) => files.forEach((file) => console.log(`wrote ${file}`)),
    (error) => {
      const usage = error instanceof UsageError || error.code?.startsWith?.("ERR_PARSE_ARGS");
      console.error(usage ? `${error.message}\n${USAGE}` : error.message);
      process.exitCode = usage ? 2 : 1;
    },
  );
}
