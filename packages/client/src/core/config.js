import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_API_URL = "https://leaderborder.xaverric.cz";

export const getConfig = (env = process.env) => ({
  apiUrl: (env.LEADERBORDER_API_URL || DEFAULT_API_URL).replace(/\/+$/, ""),
  configDir: env.LEADERBORDER_CONFIG_DIR || join(env.HOME || homedir(), ".config", "leaderborder"),
});
