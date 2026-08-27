// assisted-by Codex

export function buildOssRepoMarkdownReport(dashboard, { reportOrigin = "live" } = {}) {
  const value = dashboard || {};
  const repo = text(value.repo, "owner/repo");
  const repository = value.repository || {};
  const issues = value.issues || {};
  const pullRequests = value.pullRequests || {};
  const community = value.community || {};
  const ownership = value.ownership || {};
  const readiness = value.readiness || {};
  const security = value.security || {};
  const provenance = value.provenance || {};
  const generatedAt = text(value.generatedAt, new Date().toISOString());
  const reportDate = formatDate(generatedAt);
  const lines = [
    `# ${escapeMarkdown(repo)}: OSS Repo Report Card`,
    "",
    `**Generated:** ${escapeMarkdown(reportDate)}`,
    `**Source:** ${escapeMarkdown(value.source || provenance.provider || "Unknown")}`,
    `**Confidence:** ${escapeMarkdown(value.confidence || "unknown")}`,
    `**Report type:** ${reportOrigin === "cached" ? "Cached snapshot" : "Live snapshot"}`,
    "",
    "**Disclaimer:** This is an evidence-based repository snapshot, not a foundation acceptance decision or a substitute for legal, security, or governance review.",
    "",
    "---",
    "",
    "## Executive Summary",
    "",
    escapeMarkdown(text(value.summary, `No summary is available for ${repo}.`)),
    "",
    `**Bottom line:** ${bottomLine(value)}`,
    "",
    "## Repository Snapshot",
    "",
    "| Metric | Value |",
    "| :-- | :-- |",
    row("Repository", repo),
    row("Repository URL", repository.htmlUrl || "Not available"),
    row("Description", repository.description || "Not available"),
    row("Visibility", repository.visibility || "Unknown"),
    row("Default branch", repository.defaultBranch || "Unknown"),
    row("Stars", number(repository.stars)),
    row("Forks", number(repository.forks)),
    row("Watchers", number(repository.watchers)),
    row("Contributors", `${community.totalContributorsIsLowerBound ? "At least " : ""}${number(community.totalContributors)}`),
    row("Active contributors", number(community.activeContributors)),
    "",
    "## Activity and Engagement",
    "",
    "| Signal | Current snapshot |",
    "| :-- | --: |",
    row("Open issues", number(issues.open)),
    row("P0 issues", number(issues.p0)),
    row("Stale issues", number(issues.stale)),
    row("Issues needing triage", number(issues.needsTriage)),
    row("Open pull requests", number(pullRequests.open)),
    row("Pull requests needing review", number(pullRequests.awaitingReview)),
    row("Blocked pull requests", number(pullRequests.blocked)),
    row("Sampled issue engagement", number(community.engagementInteractions)),
    "",
    "### Reporting-window trends",
    "",
    "| Trend | Total represented | Coverage |",
    "| :-- | --: | :-- |",
    row3("Commits per week", sumTrend(value.trends?.commitsPerWeek), value.trends?.coverage?.commits),
    row3("Pull requests per week", sumTrend(value.trends?.pullRequestsPerWeek), value.trends?.coverage?.pullRequests),
    row3("Issue engagement", sumTrend(value.trends?.engagementPerWeek), value.trends?.coverage?.engagement),
    row3("Current stars", number(repository.stars), value.trends?.coverage?.stars),
    "",
    "## Maintainers and Ownership",
    "",
    `- **Declared maintainers:** ${formatHandles(ownership.maintainers?.handles, ownership.maintainers?.path)}`,
    `- **CODEOWNERS:** ${formatHandles(ownership.codeowners?.handles, ownership.codeowners?.path)}`,
    `- **Maintainers source:** ${escapeMarkdown(ownership.maintainers?.path || "No standard MAINTAINERS file detected")}`,
    `- **CODEOWNERS source:** ${escapeMarkdown(ownership.codeowners?.path || "No standard CODEOWNERS file detected")}`,
    "",
    "### Top contributors in the sampled activity",
    "",
    ...listOrFallback(
      ownership.topContributors,
      (entry) => `- ${escapeMarkdown(entry.login)} — ${number(entry.contributions)} contributions`,
      "- Contributor activity was unavailable.",
    ),
    "",
    `> ${escapeMarkdown(ownership.caveat || "Contributor activity does not by itself establish maintainer status.")}`,
    "",
    "## Community and Security Posture",
    "",
    "| Practice | Evidence |",
    "| :-- | :-- |",
    row("Community health", community.communityHealthPercent == null ? "Unavailable" : `${community.communityHealthPercent}%`),
    row("Contributing guide", present(community.hasContributing)),
    row("Code of conduct", present(community.hasCodeOfConduct)),
    row("Security policy", present(community.hasSecurityPolicy)),
    row("License", present(community.hasLicense)),
    row("OpenSSF Scorecard", security.scorecard?.status === "available" ? `${security.scorecard.score}/10` : "Unavailable"),
    row("Dependabot alerts", nullableCount(security.githubAlerts?.dependabotOpen)),
    row("Code scanning alerts", nullableCount(security.githubAlerts?.codeScanningOpen)),
    "",
    "## Foundation Readiness",
    "",
    `**Summary:** ${readinessSummary(readiness.summary)}`,
    "",
    `> ${escapeMarkdown(readiness.caveat || "Manual checks require human and foundation review.")}`,
    "",
    "| Dimension | Criterion | Status | Evidence | Source |",
    "| :-- | :-- | :-- | :-- | :-- |",
    ...listOrFallback(
      readiness.checks,
      (check) => `| ${cell(check.dimension)} | ${cell(check.criterion)} | **${cell(check.status)}** | ${cell(check.evidence)} | ${cell(check.source)} |`,
      "| — | No readiness evidence available | unavailable | — | — |",
    ),
    "",
    "## Risks",
    "",
    ...listOrFallback(
      value.risks,
      (risk) => `- **${escapeMarkdown(String(risk.severity || "unknown").toUpperCase())}: ${escapeMarkdown(risk.title || "Risk")}** — ${escapeMarkdown(risk.rationale || "No rationale provided.")}`,
      "- No repository risks were identified in the available snapshot.",
    ),
    "",
    "## Recommended Actions",
    "",
    ...numberedOrFallback(value.recommendations, "No recommendations were generated."),
    "",
    "## Maintainer Action Plan",
    "",
    ...listOrFallback(
      value.maintainerAsks,
      (ask) => `- **${escapeMarkdown(ask.title || "Maintainer action")}** (${escapeMarkdown(ask.priority || "normal")}) — ${escapeMarkdown(ask.detail || "No details provided.")}`,
      "- No maintainer actions were generated.",
    ),
    "",
    "## Methodology and Coverage",
    "",
    `- **Provider:** ${escapeMarkdown(provenance.provider || "Unknown")}`,
    `- **Access mode:** ${escapeMarkdown(provenance.accessMode || "Unknown")}`,
    `- **Core coverage:** ${escapeMarkdown(provenance.coverage || "Not documented")}`,
    `- **Trend coverage:** ${escapeMarkdown(provenance.trendCoverage || "Not documented")}`,
    `- **Stale threshold:** ${number(provenance.staleThresholdDays)} days`,
    "",
    "## Reference Frameworks",
    "",
    ...listOrFallback(
      value.frameworks,
      (framework) => formatFramework(framework),
      "- No external framework references were recorded.",
    ),
    "",
    "---",
    "",
    `*Generated by OSS Repo Report Card at ${escapeMarkdown(reportDate)}.*`,
    "",
  ];

  return lines.join("\n");

  function text(input, fallback) {
    return typeof input === "string" && input.trim() ? input.trim() : fallback;
  }

  function number(input) {
    const parsed = Number(input);
    return Number.isFinite(parsed) ? parsed.toLocaleString("en-US") : "Unavailable";
  }

  function nullableCount(input) {
    return input == null ? "Permission required or unavailable" : number(input);
  }

  function present(input) {
    return input ? "Present" : "Not detected";
  }

  function escapeMarkdown(input) {
    return String(input ?? "").replace(/([\\`*_{}\[\]<>])/g, "\\$1");
  }

  function cell(input) {
    return escapeMarkdown(input == null || input === "" ? "—" : input)
      .replace(/\|/g, "\\|")
      .replace(/\r?\n/g, " ");
  }

  function row(label, value) {
    return `| ${cell(label)} | ${cell(value)} |`;
  }

  function row3(label, value, coverage) {
    return `| ${cell(label)} | ${cell(value)} | ${cell(coverage || "Not documented")} |`;
  }

  function sumTrend(points) {
    return number((Array.isArray(points) ? points : []).reduce((sum, point) => sum + Number(point?.value || 0), 0));
  }

  function formatHandles(handles, path) {
    const values = Array.isArray(handles) ? handles.filter(Boolean) : [];
    if (values.length) return values.map(escapeMarkdown).join(", ");
    return path ? `File detected at ${escapeMarkdown(path)}; no GitHub handles were parsed.` : "Not declared in a standard repository file.";
  }

  function readinessSummary(summary) {
    const counts = summary || {};
    return ["pass", "warn", "manual", "unavailable"]
      .map((status) => `${number(counts[status] || 0)} ${status}`)
      .join(" · ");
  }

  function listOrFallback(items, render, fallback) {
    return Array.isArray(items) && items.length ? items.map(render) : [fallback];
  }

  function numberedOrFallback(items, fallback) {
    return Array.isArray(items) && items.length
      ? items.map((item, index) => `${index + 1}. ${escapeMarkdown(item)}`)
      : [`1. ${fallback}`];
  }

  function formatFramework(framework) {
    const name = escapeMarkdown(framework?.name || "Framework");
    const focus = escapeMarkdown(framework?.focus || "");
    const url = safeHttpUrl(framework?.url);
    return url ? `- [${name}](${url}) — ${focus}` : `- ${name} — ${focus}`;
  }

  function safeHttpUrl(input) {
    try {
      const url = new URL(String(input || ""));
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
    } catch {
      return "";
    }
  }

  function bottomLine(report) {
    const urgent = Number(report.issues?.p0 || 0) + Number(report.pullRequests?.blocked || 0);
    const attention = Number(report.issues?.needsTriage || 0) + Number(report.pullRequests?.awaitingReview || 0);
    if (urgent > 0) return `${number(urgent)} critical or blocked item(s) require immediate maintainer attention.`;
    if (attention > 0) return `No critical blockers were detected, but ${number(attention)} triage or review item(s) need maintainer attention.`;
    return "No critical, blocked, untriaged, or review-waiting work was detected in the available snapshot.";
  }

  function formatDate(input) {
    const date = new Date(input);
    return Number.isNaN(date.getTime()) ? String(input) : date.toISOString();
  }
}
