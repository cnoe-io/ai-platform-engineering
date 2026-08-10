import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const defaultReportPath = "test-results/grid-prod-execution-report.json";
const reportPath = process.env.GRID_EXECUTION_REPORT_PATH || defaultReportPath;
const resolvedReportPath = isAbsolute(reportPath) ? reportPath : resolve(process.cwd(), reportPath);

if (!existsSync(resolvedReportPath)) {
  console.error(`GRID prod execution report not found: ${resolvedReportPath}`);
  process.exit(1);
}

const report = JSON.parse(readFileSync(resolvedReportPath, "utf8"));
const scenarios = Array.isArray(report.scenarios) ? report.scenarios : [];
const passed = scenarios.filter((scenario) => scenario.status === "passed").length;
const failed = scenarios.filter((scenario) => scenario.status === "failed").length;
const skipped = scenarios.filter((scenario) => scenario.status === "skipped").length;
const other = scenarios.length - passed - failed - skipped;

console.log("GRID prod execution report");
console.log(`Report: ${resolvedReportPath}`);
console.log(`Run ID: ${report.run_id || "unknown"}`);
console.log(`Started: ${report.started_at || "unknown"}`);
console.log(`Summary: ${passed} passed, ${failed} failed, ${skipped} skipped, ${other} other`);
console.log("");

for (const entry of scenarios) {
  const scenario = entry.scenario || {};
  const name = scenario.name || entry.name || scenario.id || entry.id || "unknown scenario";
  const id = scenario.id || entry.id || "unknown";
  const details = describeResourceDetails(entry.resource_details || {});
  const duration = typeof entry.duration_ms === "number" ? ` (${Math.round(entry.duration_ms / 1000)}s)` : "";

  console.log(`${statusLabel(entry.status)} ${name} [${id}]${duration}`);
  if (entry.chat_url) {
    console.log(`  Chat: ${entry.chat_url}`);
  }
  if (details.length > 0) {
    console.log(`  Details: ${details.join(", ")}`);
  }
  if (entry.completion_reason) {
    console.log(`  Completion: ${entry.completion_reason}`);
  }
  if (entry.error) {
    console.log(`  Error: ${String(entry.error).replace(/\s+/g, " ").trim()}`);
  }
  console.log("");
}

if (failed > 0) {
  process.exitCode = 1;
}

function statusLabel(status) {
  if (status === "passed") {
    return "PASS";
  }
  if (status === "failed") {
    return "FAIL";
  }
  if (status === "skipped") {
    return "SKIP";
  }
  return String(status || "UNKNOWN").toUpperCase();
}

function describeResourceDetails(details) {
  const preferredKeys = [
    "key_name",
    "key_type",
    "provider",
    "model",
    "owner",
    "team",
    "instance_name",
    "aws_account",
    "region",
    "instance_type",
    "bucket_name",
    "repository",
    "deployment_name",
    "jira_key",
    "jira_summary",
    "webex_space",
  ];
  return preferredKeys
    .filter((key) => details[key])
    .map((key) => `${key}=${formatValue(details[key])}`);
}

function formatValue(value) {
  if (Array.isArray(value)) {
    return value.join("|");
  }
  return String(value);
}
