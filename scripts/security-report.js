import { readFileSync } from "node:fs";

const SEVERITIES = ["critical", "high", "medium", "low", "warning", "note", "error", "info", "moderate"];

const readJson = (path) => {
  if (!path) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

const countBy = (items, key) => {
  const counts = new Map();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => SEVERITIES.indexOf(a[0]) - SEVERITIES.indexOf(b[0]));
};

const table = (rows) => ["| Item | Count |", "| --- | --- |", ...rows.map(([name, count]) => `| ${name} | ${count} |`)].join("\n");

const codeScanningSection = (alerts, repo) => {
  if (!Array.isArray(alerts)) return "Code scanning: not readable by the workflow token.";
  if (alerts.length === 0) return "Code scanning: no open alerts.";
  const byTool = countBy(alerts, (a) => `${a.tool?.name ?? "unknown"} / ${a.rule?.security_severity_level ?? a.rule?.severity ?? "unknown"}`);
  const top = alerts
    .slice(0, 10)
    .map((a) => `- [#${a.number}](https://github.com/${repo}/security/code-scanning/${a.number}) ${a.rule?.id ?? ""} in \`${a.most_recent_instance?.location?.path ?? "?"}\``);
  return [`Code scanning: **${alerts.length} open alert(s)**`, "", table(byTool), "", ...top].join("\n");
};

const dependabotSection = (alerts) => {
  if (!Array.isArray(alerts)) return "Dependabot: not readable by the workflow token, check the Security tab.";
  if (alerts.length === 0) return "Dependabot: no open alerts.";
  const rows = countBy(alerts, (a) => `${a.security_advisory?.severity ?? "unknown"} (${a.dependency?.scope ?? "?"})`);
  return [`Dependabot: **${alerts.length} open alert(s)**`, "", table(rows)].join("\n");
};

const auditSection = (audit) => {
  const counts = audit?.metadata?.vulnerabilities;
  if (!counts) return "npm audit: no data.";
  const total = Object.entries(counts).filter(([k]) => k !== "total").reduce((sum, [, n]) => sum + n, 0);
  if (total === 0) return "npm audit (lockfile): no known vulnerabilities.";
  const rows = Object.entries(counts).filter(([k, n]) => k !== "total" && n > 0);
  return [`npm audit (lockfile): **${total} vulnerable path(s)**`, "", table(rows)].join("\n");
};

export const buildReport = ({ repo, date, codeScanning, dependabot, audit }) =>
  [
    `## Weekly security report ${date}`,
    "",
    codeScanningSection(codeScanning, repo),
    "",
    dependabotSection(dependabot),
    "",
    auditSection(audit),
    "",
    "Dashboards:",
    `- [Security overview](https://github.com/${repo}/security)`,
    `- [Code scanning](https://github.com/${repo}/security/code-scanning) (CodeQL, Semgrep, ESLint, zizmor, Scorecard)`,
    `- [OpenSSF Scorecard](https://scorecard.dev/viewer/?uri=github.com/${repo})`,
    `- [SonarCloud](https://sonarcloud.io/project/overview?id=${repo.replace("/", "_")})`,
  ].join("\n");

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , repo, codeScanningPath, dependabotPath, auditPath] = process.argv;
  process.stdout.write(
    `${buildReport({
      repo,
      date: new Date().toISOString().slice(0, 10),
      codeScanning: readJson(codeScanningPath),
      dependabot: readJson(dependabotPath),
      audit: readJson(auditPath),
    })}\n`,
  );
}
