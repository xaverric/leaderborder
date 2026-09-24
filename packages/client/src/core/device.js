import { execFile as nodeExecFile } from "node:child_process";
import { hostname as osHostname } from "node:os";

const MAX_NAME_LENGTH = 60;

const scutilName = (execFile) =>
  new Promise((resolve) => {
    execFile("scutil", ["--get", "ComputerName"], { timeout: 5000 }, (error, stdout) => resolve(error ? "" : String(stdout).trim()));
  });

export const computerName = async ({ execFile = nodeExecFile, hostname = osHostname } = {}) => {
  const name = (await scutilName(execFile)) || String(hostname() ?? "").trim() || "Mac";
  return name.slice(0, MAX_NAME_LENGTH);
};
