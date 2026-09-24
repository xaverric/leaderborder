import { homedir } from "node:os";
import { join } from "node:path";
import { LeaderborderError } from "./errors.js";

export const DEFAULT_API_URL = "https://leaderborder.xaverric.cz";

export const normalizeApiUrl = (value = DEFAULT_API_URL) => {
  try {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && local)) || url.username || url.password || url.search || url.hash) throw new Error();
    return url.href.replace(/\/+$/, "");
  } catch {
    throw new LeaderborderError("invalid_config", "API URL must use HTTPS (HTTP is allowed only on loopback), without credentials, query or fragment");
  }
};

export const getConfig = (env = process.env, { apiUrl } = {}) => ({
  apiUrl: normalizeApiUrl(apiUrl || env.LEADERBORDER_API_URL || DEFAULT_API_URL),
  configDir: env.LEADERBORDER_CONFIG_DIR || join(env.HOME || homedir(), ".config", "leaderborder"),
});
