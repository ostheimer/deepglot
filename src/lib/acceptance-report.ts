export type AcceptanceStatus = "PASS" | "FAIL" | "BLOCKED" | "SKIPPED";

export type AcceptanceCheck = {
  name: string;
  status: AcceptanceStatus;
  detail: string;
  durationMs?: number;
};

export type AcceptanceReport = {
  name: string;
  generatedAt: string;
  checks: AcceptanceCheck[];
};

export function buildAcceptanceReport({
  name,
  checks,
  now = new Date(),
}: {
  name: string;
  checks: AcceptanceCheck[];
  now?: Date;
}): AcceptanceReport {
  return {
    name,
    generatedAt: now.toISOString(),
    checks,
  };
}

export function summarizeAcceptanceReport(report: AcceptanceReport) {
  const summary = {
    total: report.checks.length,
    passed: 0,
    failed: 0,
    blocked: 0,
    skipped: 0,
  };

  for (const check of report.checks) {
    if (check.status === "PASS") summary.passed += 1;
    if (check.status === "FAIL") summary.failed += 1;
    if (check.status === "BLOCKED") summary.blocked += 1;
    if (check.status === "SKIPPED") summary.skipped += 1;
  }

  return summary;
}

export function getAcceptanceExitCode(report: AcceptanceReport, strict = false) {
  const summary = summarizeAcceptanceReport(report);

  if (summary.failed > 0) {
    return 1;
  }

  if (strict && (summary.blocked > 0 || summary.skipped > 0)) {
    return 1;
  }

  return 0;
}

export function renderAcceptanceText(report: AcceptanceReport) {
  const lines = [`${report.name} (${report.generatedAt})`];

  for (const check of report.checks) {
    const duration = check.durationMs == null ? "" : ` [${check.durationMs}ms]`;
    lines.push(`${check.status} ${check.name}: ${check.detail}${duration}`);
  }

  const summary = summarizeAcceptanceReport(report);
  lines.push(
    `Summary: ${summary.passed}/${summary.total} passed, ${summary.failed} failed, ${summary.blocked} blocked, ${summary.skipped} skipped.`
  );

  return lines.join("\n");
}

export function renderAcceptanceJson(report: AcceptanceReport) {
  return `${JSON.stringify(
    {
      ...report,
      summary: summarizeAcceptanceReport(report),
    },
    null,
    2
  )}\n`;
}

export function renderAcceptanceJunit(report: AcceptanceReport) {
  const summary = summarizeAcceptanceReport(report);
  const cases = report.checks.map((check) => renderJunitCase(check)).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="${escapeXml(report.name)}" tests="${summary.total}" failures="${summary.failed}" skipped="${summary.blocked + summary.skipped}" timestamp="${escapeXml(report.generatedAt)}">
${cases}
</testsuite>
`;
}

function renderJunitCase(check: AcceptanceCheck) {
  const time = check.durationMs == null ? "0" : String(check.durationMs / 1000);
  const attrs = `name="${escapeXml(check.name)}" classname="deepglot.acceptance" time="${escapeXml(time)}"`;

  if (check.status === "FAIL") {
    return `  <testcase ${attrs}>
    <failure message="${escapeXml(check.detail)}">${escapeXml(check.detail)}</failure>
  </testcase>`;
  }

  if (check.status === "BLOCKED" || check.status === "SKIPPED") {
    return `  <testcase ${attrs}>
    <skipped message="${escapeXml(check.detail)}">${escapeXml(check.detail)}</skipped>
  </testcase>`;
  }

  return `  <testcase ${attrs} />`;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
