import { spawn } from "node:child_process";
import { LeaderborderError } from "./errors.js";

const SECURITY = "/usr/bin/security";
const SERVICE = "leaderborder";
const ACCOUNT = "device-token";
const NOT_FOUND = 44;
const TOKEN_PATTERN = /^lb_[A-Za-z0-9_-]{43}$/;

export const runSecurity = (args, { input } = {}) =>
  new Promise((resolve) => {
    const child = spawn(SECURITY, args, { stdio: ["pipe", "pipe", "pipe"] });
    const out = { stdout: "", stderr: "" };
    child.stdout.on("data", (data) => (out.stdout += data));
    child.stderr.on("data", (data) => (out.stderr += data));
    child.on("error", (error) => resolve({ code: -1, stdout: "", stderr: error.message }));
    child.on("close", (code) => resolve({ code, ...out }));
    child.stdin.end(input ?? "");
  });

const keychainError = (action, { stderr }, secret) =>
  new LeaderborderError(
    "unauthorized",
    `Keychain ${action} failed: ${(secret ? stderr.replaceAll(secret, "***") : stderr).trim() || "unknown error"}`,
  );

export const createKeychain = ({ exec = runSecurity } = {}) => ({
  getToken: async () => {
    const result = await exec(["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"]);
    return result.code === 0 && result.stdout.trim() ? result.stdout.trim() : null;
  },
  setToken: async (token) => {
    if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) {
      throw new LeaderborderError("unauthorized", "server returned an invalid device token");
    }
    const result = await exec(["-i"], { input: `add-generic-password -U -s ${SERVICE} -a ${ACCOUNT} -w ${token}\n` });
    if (result.code !== 0) throw keychainError("write", result, token);
  },
  deleteToken: async () => {
    const result = await exec(["-i"], { input: `delete-generic-password -s ${SERVICE} -a ${ACCOUNT}\n` });
    if (result.code !== 0 && result.code !== NOT_FOUND) throw keychainError("delete", result);
  },
});

export const keychain = createKeychain();
