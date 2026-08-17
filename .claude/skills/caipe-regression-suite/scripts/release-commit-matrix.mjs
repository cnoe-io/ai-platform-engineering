#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import process from "node:process";

const DOMAIN_RULES = [
  {
    id: "DEP-01",
    title: "Deployment compatibility and runtime health",
    tests: ["PRE-01", "DEP-01", "OBS-01"],
    patterns: [
      /(^|\/)charts?\//, /(^|\/)deploy(\/|$)/, /docker-compose/, /setup-caipe/,
      /(^|\/)build\//, /(^|\/)\.github\//, /helm/, /kubernetes|k8s|argocd/,
      /health|readiness|liveness|startup probe|release|version bump|\bbump:/,
    ],
  },
  {
    id: "SEC-01",
    title: "Security and authentication",
    tests: ["PRE-01", "SEC-01", "RBAC-01"],
    patterns: [
      /security|vulnerab|cve|snyk|dependabot|ssrf|csrf|xss|secret/, /keycloak|oauth|oidc|jwt|token|session|authn/,
      /(^|\/)auth(\/|\.|-)/, /middleware/, /cookie|login|logout|password|encryption|redact|mask/,
    ],
  },
  {
    id: "FGA-01",
    title: "OpenFGA, RBAC, teams, and identity sync",
    tests: ["PRE-01", "FGA-01", "RBAC-01", "MCP-04", "AGT-01", "CRED-02", "CHAT-03"],
    patterns: [
      /openfga|rebac|rbac|authz|authorization|permission|visibility|private|global/, /team|group|member|role/,
      /identity.sync|idp.sync|okta|scim|relationship|tuple|cas decision|entitlement/,
    ],
  },
  {
    id: "MCP-01",
    title: "MCP servers, tools, and gateway",
    tests: ["MCP-01", "MCP-02", "MCP-03", "MCP-04", "AGT-04"],
    patterns: [/mcp|agentgateway|tool gateway|tool catalog|remote server|a2a gateway/],
  },
  {
    id: "CRED-01",
    title: "Credentials and provider connections",
    tests: ["CRED-01", "CRED-02", "CRED-03", "AGT-04"],
    patterns: [/credential|secret.ref|provider connection|api key|webex.*token|token.*webex/],
  },
  {
    id: "KB-01",
    title: "Knowledge bases, RAG, ingestion, and search",
    tests: ["KB-01", "KB-02", "TOME-02"],
    patterns: [
      /knowledge.base|knowledge_bases|\brag\b|graphrag|graph.rag|ingest|embedding|vector|milvus|neo4j/,
      /data.source|datasource|web.loader|web_ingestor|retriev|semantic search/,
    ],
  },
  {
    id: "AGT-01",
    title: "Agents, models, and execution",
    tests: ["AGT-01", "AGT-02", "AGT-03", "AGT-04", "CHAT-01"],
    patterns: [
      /dynamic.agent|dynamic_agents|supervisor|sub.?agent|agent builder|agent config|agent card/,
      /(^|\/)agents?(\/|\.|-)/, /llm|model provider|model config|bedrock|anthropic|openai|ollama/,
      /a2a|ag.ui|ag_ui|executor|task config/,
    ],
  },
  {
    id: "CHAT-01",
    title: "Chat, streaming, sharing, and feedback",
    tests: ["CHAT-01", "CHAT-02", "CHAT-03", "CHAT-04"],
    patterns: [
      /chat|conversation|message|history|stream|sse|timeline|attachment|upload/,
      /feedback|thumb|report.problem|share.*chat|chat.*share|deep.link/,
    ],
  },
  {
    id: "TOME-01",
    title: "Projects and TOME content",
    tests: ["TOME-01", "TOME-02", "TOME-03"],
    patterns: [
      /tome|project|wiki|gist|markdown|vidcast|youtube|arxiv|charter|initiative|issue/,
      /analytics|metric|trend|synthesis|label|comment/,
    ],
  },
  {
    id: "WF-01",
    title: "Workflows, schedules, and skills",
    tests: ["WF-01", "SKL-01"],
    patterns: [/workflow|scheduler|schedule|cron|skill|prompt catalog|automation/],
  },
  {
    id: "INT-01",
    title: "External integrations and bots",
    tests: ["INT-01"],
    patterns: [
      /slack|webex|github|jira|atlassian|pagerduty|victorops|confluence|backstage/,
      /(^|\/)integrations?\//, /bot\b|webhook/,
    ],
  },
  {
    id: "OBS-01",
    title: "Admin, audit, observability, and operations",
    tests: ["OBS-01", "RBAC-01"],
    patterns: [
      /admin|audit|observ|telemetry|tracing|langfuse|logging|loguru|health|status/,
      /insight|dashboard|metric|performance|latency|pagination/,
    ],
  },
  {
    id: "UX-01",
    title: "General UI and accessibility",
    tests: ["UX-01", "RBAC-01"],
    patterns: [
      /(^|\/)ui\//, /\bui\b|frontend|next\.js|react|zustand|component|navigation|sidebar|top.bar/,
      /responsive|mobile|accessib|a11y|aria|theme|layout|dialog|form|wizard|toast/,
    ],
  },
  {
    id: "QUAL-01",
    title: "Tests, documentation, dependencies, and release governance",
    tests: ["REL-00", "REL-01", "REL-02", "REL-03", "QUAL-01"],
    patterns: [
      /(^|\/)tests?\//, /(^|\/)e2e\//, /__tests__|\.spec\.|\.test\./, /(^|\/)docs?\//,
      /\bdocs?\b|readme|changelog|adr|blog|\.md\b/, /dependency|dependencies|\bdeps\b|uv\.lock|package.lock|yarn\.lock/,
      /lint|ruff|eslint|typecheck|coverage|fixture|snapshot|ci\b|merge/,
      /release|version|\bbump:/, /license|codeowners|renovate/,
    ],
  },
];

function parseArgs(argv) {
  const values = { base: process.env.CAIPE_REGRESSION_SUITE_RELEASE_BASE_REF || "0.5.0", head: process.env.CAIPE_REGRESSION_SUITE_RELEASE_HEAD_REF || "HEAD", format: "json" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base" || arg === "--head" || arg === "--format") {
      const value = argv[index + 1];
      if (!value) throw new Error(`Missing value for ${arg}`);
      values[arg.slice(2)] = value;
      index += 1;
    } else if (arg === "--help") {
      process.stdout.write("Usage: release-commit-matrix.mjs [--base REF] [--head REF] [--format json|summary]\n");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!new Set(["json", "summary"]).has(values.format)) throw new Error(`Unsupported format: ${values.format}`);
  return values;
}
function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
}

function classify(subject, files) {
  const searchable = `${subject}/${files.join("/")}`.toLowerCase();
  return DOMAIN_RULES.filter((rule) => rule.patterns.some((pattern) => pattern.test(searchable)));
}

function collect(base, head) {
  const baseSha = git(["rev-parse", `${base}^{commit}`]);
  const headSha = git(["rev-parse", `${head}^{commit}`]);
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", baseSha, headSha], { stdio: "ignore" });
  } catch {
    throw new Error(`${base} (${baseSha}) is not an ancestor of ${head} (${headSha})`);
  }

  const raw = git([
    "log",
    "--reverse",
    "--date=short",
    "--format=%x1e%H%x1f%h%x1f%cs%x1f%P%x1f%s",
    "--name-only",
    `${baseSha}..${headSha}`,
  ]);
  const commits = raw.split("\x1e").filter(Boolean).map((record) => {
    const lines = record.replace(/^\n+/, "").split("\n");
    const [fullSha, sha, date, parents, subject] = lines.shift().split("\x1f");
    const files = lines.map((line) => line.trim()).filter(Boolean);
    const domains = classify(subject, files);
    return {
      fullSha,
      sha,
      date,
      subject,
      merge: parents.trim().split(/\s+/).filter(Boolean).length > 1,
      changedFileCount: files.length,
      domains: domains.map((domain) => domain.id),
      tests: [...new Set(domains.flatMap((domain) => domain.tests))].sort(),
    };
  });
  const unmapped = commits.filter((commit) => commit.domains.length === 0);
  const coverage = DOMAIN_RULES.map((domain) => ({
    id: domain.id,
    title: domain.title,
    tests: domain.tests,
    commitCount: commits.filter((commit) => commit.domains.includes(domain.id)).length,
  })).filter((domain) => domain.commitCount > 0);
  return {
    generatedAt: new Date().toISOString(),
    range: `${baseSha}..${headSha}`,
    base: { ref: base, sha: baseSha },
    head: { ref: head, sha: headSha },
    counts: {
      commits: commits.length,
      mergeCommits: commits.filter((commit) => commit.merge).length,
      nonMergeCommits: commits.filter((commit) => !commit.merge).length,
      unmappedCommits: unmapped.length,
    },
    coverage,
    unmapped,
    commits,
  };
}

function summary(report) {
  const lines = [
    `CAIPE Regression Suite release range: ${report.base.ref} (${report.base.sha.slice(0, 12)})..${report.head.ref} (${report.head.sha.slice(0, 12)})`,
    `Commits: ${report.counts.commits} total; ${report.counts.nonMergeCommits} non-merge; ${report.counts.mergeCommits} merge; ${report.counts.unmappedCommits} unmapped`,
  ];
  for (const domain of report.coverage) lines.push(`${domain.id}\t${domain.commitCount}\t${domain.tests.join(",")}\t${domain.title}`);
  if (report.unmapped.length > 0) {
    lines.push("Unmapped commits:");
    for (const commit of report.unmapped) lines.push(`${commit.sha}\t${commit.subject}`);
  }
  return `${lines.join("\n")}\n`;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const report = collect(args.base, args.head);
  process.stdout.write(args.format === "summary" ? summary(report) : `${JSON.stringify(report, null, 2)}\n`);
  if (report.counts.unmappedCommits > 0) process.exitCode = 4;
} catch (error) {
  process.stderr.write(`CAIPE Regression Suite release matrix failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
