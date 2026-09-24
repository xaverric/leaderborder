import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  dmgFileName,
  homebrewVars,
  releaseUrl,
  renderHomebrew,
  renderTemplate,
  sha256,
  tarballFileName,
} from "./render-homebrew.js";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "render-homebrew.js");
const templateDir = join(here, "..", "packaging", "homebrew");

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);

const vars = () =>
  homebrewVars({
    repo: "xaverric/leaderborder",
    version: "1.2.3",
    tarballSha256: SHA_A,
    dmgArm64Sha256: SHA_B,
    dmgX64Sha256: SHA_C,
  });

const templates = async () => ({
  formulaTpl: await readFile(join(templateDir, "leaderborder.rb.tmpl"), "utf8"),
  caskTpl: await readFile(join(templateDir, "leaderborder-cask.rb.tmpl"), "utf8"),
});

test("renderTemplate fills placeholders and keeps Ruby interpolation", () => {
  assert.equal(renderTemplate("a {{X}} {{ X }} #{version}", { X: "1" }), "a 1 1 #{version}");
});

test("renderTemplate throws on a missing variable", () => {
  assert.throws(() => renderTemplate("{{Y}}", { X: "1" }), /Missing template variable: Y/);
});

test("sha256 hashes a buffer as hex", () => {
  assert.equal(sha256(Buffer.from("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("release file names and URLs", () => {
  assert.equal(dmgFileName("1.2.3", "x64"), "Leaderborder-1.2.3-x64.dmg");
  assert.equal(tarballFileName("1.2.3"), "leaderborder-1.2.3.tgz");
  assert.equal(
    releaseUrl({ repo: "xaverric/leaderborder", version: "1.2.3", file: "leaderborder-1.2.3.tgz" }),
    "https://github.com/xaverric/leaderborder/releases/download/v1.2.3/leaderborder-1.2.3.tgz",
  );
});

test("homebrewVars builds the template variables", () => {
  assert.deepEqual(vars(), {
    REPO: "xaverric/leaderborder",
    VERSION: "1.2.3",
    TARBALL_URL: "https://github.com/xaverric/leaderborder/releases/download/v1.2.3/leaderborder-1.2.3.tgz",
    TARBALL_SHA256: SHA_A,
    DMG_ARM64_SHA256: SHA_B,
    DMG_X64_SHA256: SHA_C,
  });
});

test("homebrewVars rejects an invalid version, sha or repo", () => {
  const base = { repo: "xaverric/leaderborder", version: "1.2.3", tarballSha256: SHA_A, dmgArm64Sha256: SHA_B, dmgX64Sha256: SHA_C };
  assert.throws(() => homebrewVars({ ...base, version: "v1.2.3" }), /Invalid version/);
  assert.throws(() => homebrewVars({ ...base, dmgX64Sha256: "a".repeat(63) }), /Invalid sha256/);
  assert.throws(() => homebrewVars({ ...base, repo: "xaverric" }), /Invalid repo/);
});

test("renderHomebrew renders formula and cask from the real templates", async () => {
  const { formula, cask } = renderHomebrew({ ...(await templates()), vars: vars() });
  assert.doesNotMatch(formula + cask, /\{\{/);
  assert.match(formula, /^class Leaderborder < Formula$/m);
  assert.match(formula, /url "https:\/\/github\.com\/xaverric\/leaderborder\/releases\/download\/v1\.2\.3\/leaderborder-1\.2\.3\.tgz"/);
  assert.match(formula, new RegExp(`sha256 "${SHA_A}"`));
  assert.match(formula, /depends_on "node"/);
  assert.match(formula, /std_npm_args/);
  assert.match(formula, /leaderborder --version/);
  assert.match(cask, /^cask "leaderborder" do$/m);
  assert.match(cask, /version "1\.2\.3"/);
  assert.match(cask, new RegExp(`sha256 arm:\\s+"${SHA_B}",\\s+intel: "${SHA_C}"`));
  assert.match(cask, /Leaderborder-#\{version\}-#\{arch\}\.dmg/);
  assert.match(cask, /app "Leaderborder\.app"/);
  assert.match(cask, /zap trash: \[/);
  assert.match(cask, /~\/\.config\/leaderborder/);
  assert.match(cask, /xattr -dr com\.apple\.quarantine/);
});

const withReleaseFiles = async (names, fn) => {
  const dir = await mkdtemp(join(tmpdir(), "render-homebrew-"));
  try {
    const paths = {};
    for (const [key, name] of Object.entries(names)) {
      paths[key] = join(dir, name);
      await writeFile(paths[key], key);
    }
    await fn(dir, paths);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

test("CLI writes rendered formula and cask with file hashes", async () => {
  const names = { tarball: "leaderborder-1.2.3.tgz", arm64: "Leaderborder-1.2.3-arm64.dmg", x64: "Leaderborder-1.2.3-x64.dmg" };
  await withReleaseFiles(names, async (dir, paths) => {
    const out = join(dir, "out");
    await run(process.execPath, [
      script, "--version", "1.2.3", "--tarball", paths.tarball,
      "--dmg-arm64", paths.arm64, "--dmg-x64", paths.x64, "--out", out,
    ]);
    const formula = await readFile(join(out, "leaderborder.rb"), "utf8");
    const cask = await readFile(join(out, "leaderborder-cask.rb"), "utf8");
    assert.match(formula, new RegExp(sha256(Buffer.from("tarball"))));
    assert.match(cask, new RegExp(sha256(Buffer.from("arm64"))));
    assert.match(cask, new RegExp(sha256(Buffer.from("x64"))));
  });
});

test("CLI exits 2 when a DMG does not follow the release naming", async () => {
  const names = { tarball: "leaderborder-1.2.3.tgz", arm64: "Leaderborder-1.2.3-arm64.dmg", x64: "Leaderborder-1.2.3.dmg" };
  await withReleaseFiles(names, async (dir, paths) => {
    const result = run(process.execPath, [
      script, "--version", "1.2.3", "--tarball", paths.tarball,
      "--dmg-arm64", paths.arm64, "--dmg-x64", paths.x64, "--out", join(dir, "out"),
    ]);
    await assert.rejects(result, (error) => error.code === 2 && /Leaderborder-1\.2\.3-x64\.dmg/.test(error.stderr));
  });
});

test("CLI exits 2 when a flag is missing", async () => {
  await assert.rejects(run(process.execPath, [script, "--version", "1.2.3"]), (error) => error.code === 2);
});
