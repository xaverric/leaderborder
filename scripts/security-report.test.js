import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReport } from "./security-report.js";

const repo = "xaverric/leaderborder";

test("summarizes open alerts by tool and severity", () => {
  const report = buildReport({
    repo,
    date: "2026-09-28",
    codeScanning: [
      { number: 3, tool: { name: "CodeQL" }, rule: { id: "js/xss", security_severity_level: "high" }, most_recent_instance: { location: { path: "a.js" } } },
      { number: 4, tool: { name: "Semgrep" }, rule: { id: "x", security_severity_level: "medium" }, most_recent_instance: { location: { path: "b.js" } } },
    ],
    dependabot: [{ security_advisory: { severity: "high" }, dependency: { scope: "development" } }],
    audit: { metadata: { vulnerabilities: { info: 0, low: 0, moderate: 1, high: 0, critical: 0, total: 1 } } },
  });
  assert.match(report, /2 open alert\(s\)/);
  assert.match(report, /\| CodeQL \/ high \| 1 \|/);
  assert.match(report, /security\/code-scanning\/3\) js\/xss in `a\.js`/);
  assert.match(report, /Dependabot: \*\*1 open alert\(s\)\*\*/);
  assert.match(report, /\| moderate \| 1 \|/);
  assert.match(report, /scorecard\.dev\/viewer\/\?uri=github\.com\/xaverric\/leaderborder/);
});

test("reports clean state and unreadable sources", () => {
  const report = buildReport({ repo, date: "2026-09-28", codeScanning: [], dependabot: null, audit: { metadata: { vulnerabilities: { total: 0 } } } });
  assert.match(report, /Code scanning: no open alerts\./);
  assert.match(report, /Dependabot: not readable by the workflow token/);
  assert.match(report, /npm audit \(lockfile\): no known vulnerabilities\./);
});
