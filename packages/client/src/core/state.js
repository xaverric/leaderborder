import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

export const defaultState = () => ({
  deviceId: null,
  deviceName: null,
  lastSyncAt: null,
  lastActivityAt: null,
  lastError: null,
  summary: null,
});

const stateFile = (configDir) => join(configDir, "state.json");

const pickKnown = (value) =>
  Object.fromEntries(Object.keys(defaultState()).filter((key) => key in value).map((key) => [key, value[key]]));

export const loadState = ({ configDir }) => {
  try {
    const parsed = JSON.parse(readFileSync(stateFile(configDir), "utf8"));
    return { ...defaultState(), ...(parsed && typeof parsed === "object" ? pickKnown(parsed) : {}) };
  } catch {
    return defaultState();
  }
};

export const saveState = ({ configDir }, state) => {
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const file = stateFile(configDir);
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify({ ...defaultState(), ...pickKnown(state) }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    renameSync(temp, file);
  } finally {
    rmSync(temp, { force: true });
  }
};
