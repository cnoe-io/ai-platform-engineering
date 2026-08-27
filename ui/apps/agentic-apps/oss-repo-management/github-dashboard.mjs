const DEFAULT_GITHUB_API_BASE = "https://api.github.com";
const DEFAULT_SCORECARD_API_BASE = "https://api.scorecard.dev";
const TREND_WEEKS = 12;

export class GitHubDashboardError extends Error {
  constructor(message, { status = 502, code = "github_request_failed" } = {}) {
    super(message);
    this.name = "GitHubDashboardError";
    this.status = status;
    this.code = code;
  }
}

export async function fetchGitHubRepoDashboard({
  repo,
  staleDays = 30,
  token = "",
  apiBase = DEFAULT_GITHUB_API_BASE,
  scorecardApiBase = DEFAULT_SCORECARD_API_BASE,
  fetchImpl = fetch,
}) {
  const normalizedRepo = normalizeRepoName(repo);
  const boundedStaleDays = Math.max(1, Math.min(365, Math.round(Number(staleDays) || 30)));
  const now = new Date();
  const staleBefore = new Date(now.getTime() - boundedStaleDays * 86_400_000).toISOString().slice(0, 10);
  const trendStart = startOfUtcWeek(new Date(now.getTime() - (TREND_WEEKS - 1) * 7 * 86_400_000));
  const client = createGitHubClient({ token, apiBase, fetchImpl });
  const repository = await client.get(`/repos/${encodeRepoPath(normalizedRepo)}`);
  const canonicalRepo = normalizeRepoName(repository.full_name || normalizedRepo);
  const encodedRepo = encodeRepoPath(canonicalRepo);

  const [result, recentPullsResult, recentIssuesResult, commitsResult, contributorsResult, communityResult, repoTreeResult, scorecardResult] = await Promise.all([
    token ? fetchExactCounts(client, canonicalRepo, staleBefore) : fetchBoundedPublicCounts(client, canonicalRepo, repository, staleBefore),
    client.tryGet(`/repos/${encodedRepo}/pulls?state=all&per_page=100&sort=created&direction=desc`),
    client.tryGet(`/repos/${encodedRepo}/issues?state=all&per_page=100&sort=created&direction=desc`),
    client.tryGet(`/repos/${encodedRepo}/commits?per_page=100&since=${encodeURIComponent(trendStart.toISOString())}`),
    client.tryGet(`/repos/${encodedRepo}/contributors?per_page=100&anon=true`),
    client.tryGet(`/repos/${encodedRepo}/community/profile`),
    client.tryGet(`/repos/${encodedRepo}/git/trees/${encodeURIComponent(repository.default_branch || "HEAD")}?recursive=1`),
    fetchOpenSsfScorecard({ repo: canonicalRepo, apiBase: scorecardApiBase, fetchImpl }),
  ]);
  const [stargazersResult, githubSecurity] = await Promise.all([
    token
      ? client.tryGet(`/repos/${encodedRepo}/stargazers?per_page=100`, { accept: "application/vnd.github.star+json" })
      : Promise.resolve(unavailable("server credential required")),
    token ? fetchGitHubSecurity(client, encodedRepo) : Promise.resolve({ status: "credential-required", dependabotOpen: null, codeScanningOpen: null }),
  ]);

  const { issues, pullRequests } = result;
  const recentPulls = arrayData(recentPullsResult);
  const recentIssues = arrayData(recentIssuesResult).filter((item) => !item.pull_request);
  const commits = arrayData(commitsResult);
  const contributors = arrayData(contributorsResult);
  const communityProfile = objectData(communityResult);
  const repositoryPathMap = extractRepositoryPathMap(repoTreeResult);
  const repositoryPaths = new Set(repositoryPathMap.keys());
  const ownership = await fetchOwnershipEvidence({
    client,
    encodedRepo,
    repositoryPathMap,
    contributors,
  });
  const generatedAt = now.toISOString();
  const stars = repository.stargazers_count ?? 0;

  return {
    source: "github-api",
    generatedAt,
    repo: canonicalRepo,
    summary: buildSummary(canonicalRepo, issues, pullRequests),
    confidence: result.confidence,
    issues,
    pullRequests,
    risks: buildRisks({ issues, pullRequests, staleDays: boundedStaleDays, bounded: result.confidence === "bounded" }),
    recommendations: buildRecommendations({ issues, pullRequests }),
    maintainerAsks: buildMaintainerAsks({ issues, pullRequests }),
    repository: {
      description: repository.description || "No repository description is available.",
      visibility: repository.visibility || (repository.private ? "private" : "public"),
      defaultBranch: repository.default_branch || "unknown",
      stars,
      forks: repository.forks_count ?? 0,
      watchers: repository.subscribers_count ?? repository.watchers_count ?? 0,
      archived: Boolean(repository.archived),
      htmlUrl: repository.html_url || `https://github.com/${canonicalRepo}`,
      pushedAt: repository.pushed_at || null,
    },
    trends: {
      windowWeeks: TREND_WEEKS,
      commitsPerWeek: aggregateWeekly(commits, (item) => item?.commit?.author?.date || item?.commit?.committer?.date, trendStart, now),
      pullRequestsPerWeek: aggregateWeekly(recentPulls, (item) => item?.created_at, trendStart, now),
      engagementPerWeek: aggregateWeeklyWeighted(recentIssues, (item) => item?.created_at, (item) => 1 + Number(item?.comments || 0), trendStart, now),
      starHistory: buildStarHistory(arrayData(stargazersResult), stars, generatedAt),
      coverage: {
        commits: describeBoundedCoverage(commitsResult, commits, "commits"),
        pullRequests: describeBoundedCoverage(recentPullsResult, recentPulls, "pull requests"),
        engagement: describeBoundedCoverage(recentIssuesResult, recentIssues, "issues") + " Engagement counts each sampled issue plus its comments and attributes them to the issue creation week.",
        stars: stargazersResult.status === "available"
          ? describeBoundedCoverage(stargazersResult, arrayData(stargazersResult), "stargazers")
          : "Current count plus timestamped report-card snapshots; the GitHub star timeline requires repository access.",
      },
    },
    community: buildCommunity({ commits, contributors, contributorsResult, communityProfile, repository, recentIssues }),
    ownership,
    security: { scorecard: scorecardResult, githubAlerts: githubSecurity },
    readiness: buildReadinessAssessment({ repository, repositoryPaths, commits, scorecard: scorecardResult }),
    frameworks: [
      { name: "CHAOSS", focus: "community health and responsiveness", url: "https://www.chaoss.community/kb/metrics-model-starter-project-health/" },
      { name: "CNCF CLOMonitor", focus: "project-practice checks", url: "https://clomonitor.io/docs/" },
      { name: "LFX Insights", focus: "activity and contributor analytics", url: "https://docs.linuxfoundation.org/lfx/insights/v3-beta-version-current/project-overview-page" },
      { name: "OpenSSF Scorecard", focus: "automated security-practice checks", url: "https://scorecard.dev/" },
    ],
    provenance: {
      provider: "GitHub REST API + OpenSSF Scorecard",
      accessMode: token ? "server credential" : "public API",
      coverage: result.coverage,
      trendCoverage: "Weekly trends use the latest 100 GitHub items in a rolling 12-week window and are explicitly bounded when the result cap is reached.",
      staleThresholdDays: boundedStaleDays,
      staleBefore,
      definitions: {
        p0: 'Open issues carrying the exact label "P0".',
        needsTriage: "Open issues with no labels.",
        awaitingReview: result.awaitingReviewDefinition,
        blocked: 'Open pull requests carrying the exact label "blocked".',
        activeContributors: "Unique commit authors represented in the bounded 12-week commit sample.",
      },
    },
  };
}

async function fetchExactCounts(client, repo, staleBefore) {
  const query = (qualifiers) => client.search(`repo:${repo} ${qualifiers}`);
  const [openIssues, staleIssues, criticalIssues, needsTriage, openPulls, awaitingReview, blockedPulls] = await Promise.all([
    query("is:issue is:open"), query(`is:issue is:open updated:<${staleBefore}`), query('is:issue is:open label:"P0"'),
    query("is:issue is:open no:label"), query("is:pr is:open"), query("is:pr is:open draft:false review:none"),
    query('is:pr is:open label:"blocked"'),
  ]);
  return {
    confidence: "high",
    coverage: "Exact GitHub Search counts for the configured repository.",
    awaitingReviewDefinition: "Open, non-draft pull requests with no submitted review.",
    issues: { open: openIssues.total_count, stale: staleIssues.total_count, p0: criticalIssues.total_count, needsTriage: needsTriage.total_count },
    pullRequests: { open: openPulls.total_count, awaitingReview: awaitingReview.total_count, blocked: blockedPulls.total_count },
  };
}

async function fetchBoundedPublicCounts(client, repo, repository, staleBefore) {
  const encodedRepo = encodeRepoPath(repo);
  const [openItems, openPulls] = await Promise.all([
    client.get(`/repos/${encodedRepo}/issues?state=open&per_page=100&sort=updated&direction=desc`),
    client.get(`/repos/${encodedRepo}/pulls?state=open&per_page=100&sort=updated&direction=desc`),
  ]);
  const sampledIssues = openItems.filter((item) => !item.pull_request);
  const labelNames = (item) => (item.labels || []).map((label) => String(label?.name || label).toLowerCase());
  const openPullCount = openPulls.length;
  return {
    confidence: "bounded",
    coverage: "Repository totals plus the 100 most recently updated open issues and pull requests; queue subsets may be lower bounds.",
    awaitingReviewDefinition: "Open, non-draft pull requests with one or more requested reviewers in the bounded public snapshot.",
    issues: {
      open: Math.max(sampledIssues.length, Number(repository.open_issues_count || 0) - openPullCount),
      stale: sampledIssues.filter((issue) => String(issue.updated_at || "") < `${staleBefore}T00:00:00Z`).length,
      p0: sampledIssues.filter((issue) => labelNames(issue).includes("p0")).length,
      needsTriage: sampledIssues.filter((issue) => (issue.labels || []).length === 0).length,
    },
    pullRequests: {
      open: openPullCount,
      awaitingReview: openPulls.filter((pull) => !pull.draft && (pull.requested_reviewers || []).length > 0).length,
      blocked: openPulls.filter((pull) => labelNames(pull).includes("blocked")).length,
    },
  };
}

async function fetchGitHubSecurity(client, encodedRepo) {
  const [dependabot, codeScanning] = await Promise.all([
    client.tryGet(`/repos/${encodedRepo}/dependabot/alerts?state=open&per_page=100`),
    client.tryGet(`/repos/${encodedRepo}/code-scanning/alerts?state=open&per_page=100`),
  ]);
  const available = [dependabot, codeScanning].some((result) => result.status === "available");
  return {
    status: available ? "available" : "permission-required",
    dependabotOpen: dependabot.status === "available" ? arrayData(dependabot).length : null,
    codeScanningOpen: codeScanning.status === "available" ? arrayData(codeScanning).length : null,
    coverage: "Up to 100 open alerts per GitHub security source; unavailable values are never treated as zero.",
  };
}

async function fetchOpenSsfScorecard({ repo, apiBase, fetchImpl }) {
  const base = String(apiBase || DEFAULT_SCORECARD_API_BASE).replace(/\/+$/, "");
  try {
    const response = await fetchImpl(`${base}/projects/github.com/${encodeRepoPath(repo)}`, {
      headers: { accept: "application/json", "user-agent": "caipe-oss-repo-report-card" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return { status: "unavailable", score: null, date: null, checks: [] };
    const payload = await response.json().catch(() => ({}));
    const checks = Array.isArray(payload.checks)
      ? payload.checks.map((check) => ({ name: check.name, score: check.score, reason: check.reason })).sort((a, b) => Number(a.score) - Number(b.score)).slice(0, 5)
      : [];
    const score = numberOrNull(payload.score);
    return score === null
      ? { status: "unavailable", score: null, date: payload.date || null, checks: [] }
      : { status: "available", score, date: payload.date || null, checks };
  } catch {
    return { status: "unavailable", score: null, date: null, checks: [] };
  }
}

function buildCommunity({ commits, contributors, contributorsResult, communityProfile, repository, recentIssues }) {
  const active = new Set();
  for (const item of commits) {
    const identity = item?.author?.login || item?.commit?.author?.email || item?.commit?.author?.name;
    if (identity) active.add(String(identity).toLowerCase());
  }
  const files = communityProfile.files || {};
  return {
    totalContributors: contributors.length,
    totalContributorsIsLowerBound: contributors.length >= 100,
    activeContributors: active.size,
    watchers: repository.subscribers_count ?? repository.watchers_count ?? 0,
    engagementInteractions: recentIssues.reduce((sum, issue) => sum + 1 + Number(issue?.comments || 0), 0),
    engagementSampleSize: recentIssues.length,
    communityHealthPercent: numberOrNull(communityProfile.health_percentage),
    hasContributing: Boolean(files.contributing),
    hasCodeOfConduct: Boolean(files.code_of_conduct),
    hasSecurityPolicy: Boolean(files.security),
    hasLicense: Boolean(files.license || repository.license),
    coverage: contributorsResult.status === "available" ? describeBoundedCoverage(contributorsResult, contributors, "contributors") : "Contributor count unavailable from GitHub.",
  };
}

function buildReadinessAssessment({ repository, repositoryPaths, commits, scorecard }) {
  const spdx = repository.license?.spdx_id || null;
  const allowedLicense = new Set(["Apache-2.0", "MIT", "BSD-2-Clause", "BSD-3-Clause", "ISC", "MPL-2.0"]);
  const commitMessages = commits.map((item) => String(item?.commit?.message || ""));
  const signedOffCommits = commitMessages.filter((message) => /(^|\n)Signed-off-by:\s*.+<[^>]+>/i.test(message)).length;
  const doc = (...candidates) => candidates.some((candidate) => repositoryPaths.has(candidate.toLowerCase()));
  const checks = [
    readinessCheck("Legal", "Project license", spdx && spdx !== "NOASSERTION" ? (allowedLicense.has(spdx) ? "pass" : "manual") : "warn", spdx ? `Detected SPDX license: ${spdx}.` : "No machine-readable repository license was detected.", "GitHub repository metadata"),
    readinessCheck("Legal", "Dependency license audit", "manual", "Review direct and infrastructure dependencies against the target foundation policy; repository metadata cannot prove transitive license compatibility.", "Manual or SBOM/license scanner"),
    readinessCheck("Contribution", "DCO sign-off evidence", commits.length ? (signedOffCommits === commits.length ? "pass" : "warn") : "unavailable", commits.length ? `${signedOffCommits}/${commits.length} sampled commits contain a Signed-off-by trailer.` : "No commit sample was available.", "Bounded GitHub commit sample"),
    readinessCheck("Contribution", "DCO or CLA enforcement", "manual", "Commit trailers are evidence, not proof of enforcement; verify a DCO app, ruleset, or CLA check in repository settings.", "Manual repository-settings verification"),
    readinessCheck("Governance", "Governance document", doc("governance.md", ".github/governance.md", "docs/governance.md") ? "pass" : "warn", doc("governance.md", ".github/governance.md", "docs/governance.md") ? "GOVERNANCE.md detected." : "No standard governance document path was detected.", "Git tree"),
    readinessCheck("Governance", "Maintainers and ownership", doc("maintainers.md", ".github/maintainers.md") && doc(".github/codeowners", "codeowners") ? "pass" : "warn", "Checks for MAINTAINERS.md and CODEOWNERS; organizational diversity and bus factor still require review.", "Git tree + manual review"),
    readinessCheck("Governance", "Contributor ladder", doc("contributor_ladder.md", "docs/contributor_ladder.md") ? "pass" : "warn", doc("contributor_ladder.md", "docs/contributor_ladder.md") ? "Contributor ladder detected." : "No CONTRIBUTOR_LADDER.md was detected.", "Git tree"),
    readinessCheck("Community", "Contributing guide", doc("contributing.md", ".github/contributing.md") ? "pass" : "warn", doc("contributing.md", ".github/contributing.md") ? "Contributing guide detected." : "No CONTRIBUTING.md was detected.", "Git tree"),
    readinessCheck("Community", "Code of conduct", doc("code_of_conduct.md", ".github/code_of_conduct.md") ? "pass" : "warn", doc("code_of_conduct.md", ".github/code_of_conduct.md") ? "Code of conduct detected." : "No CODE_OF_CONDUCT.md was detected.", "Git tree"),
    readinessCheck("Community", "Roadmap", doc("roadmap.md", "docs/roadmap.md") ? "pass" : "warn", doc("roadmap.md", "docs/roadmap.md") ? "Roadmap detected." : "No ROADMAP.md was detected.", "Git tree"),
    readinessCheck("Community", "Independent adoption", doc("adopters.md", "users.md") ? "manual" : "warn", doc("adopters.md", "users.md") ? "Adopter evidence file detected; independence and production usage require review." : "No standard adopter evidence file was detected.", "Git tree + manual review"),
    readinessCheck("Security", "Security policy", doc("security.md", ".github/security.md") ? "pass" : "warn", doc("security.md", ".github/security.md") ? "SECURITY.md detected." : "No SECURITY.md was detected.", "Git tree"),
    readinessCheck("Security", "OpenSSF practices", scorecard.status === "available" ? (Number(scorecard.score) >= 7 ? "pass" : "warn") : "unavailable", scorecard.status === "available" ? `OpenSSF Scorecard: ${Number(scorecard.score).toFixed(1)}/10.` : "OpenSSF Scorecard data was unavailable.", "OpenSSF Scorecard"),
    readinessCheck("Neutrality", "Vendor-neutral governance", "manual", "Review maintainer affiliations, voting caps, decision records, cross-organization reviews, and neutral project infrastructure.", "Manual governance review"),
    readinessCheck("Foundation", "Transfer and contribution agreements", "manual", "When applicable, verify project-transfer consensus, trademark/domain ownership, and signed contribution agreements.", "Manual foundation-process review"),
  ];
  return {
    model: "oss-foundation-readiness.v1",
    summary: checks.reduce((counts, check) => ({ ...counts, [check.status]: (counts[check.status] || 0) + 1 }), {}),
    caveat: "Evidence-based readiness signals, not a foundation acceptance grade. Manual checks require human and foundation review.",
    checks,
  };
}

function readinessCheck(dimension, criterion, status, evidence, source) {
  return { dimension, criterion, status, evidence, source };
}

function extractRepositoryPathMap(result) {
  const tree = objectData(result).tree;
  return new Map(
    (Array.isArray(tree) ? tree : [])
      .filter((entry) => entry?.type === "blob" && entry.path)
      .map((entry) => [String(entry.path).toLowerCase(), String(entry.path)]),
  );
}

async function fetchOwnershipEvidence({ client, encodedRepo, repositoryPathMap, contributors }) {
  const maintainersPath = findRepositoryPath(repositoryPathMap, [
    "maintainers.md",
    ".github/maintainers.md",
    "docs/maintainers.md",
  ]);
  const codeownersPath = findRepositoryPath(repositoryPathMap, [
    ".github/codeowners",
    "codeowners",
    "docs/codeowners",
  ]);
  const [maintainersResult, codeownersResult] = await Promise.all([
    maintainersPath
      ? client.tryGet(`/repos/${encodedRepo}/contents/${encodeFilePath(maintainersPath)}`)
      : Promise.resolve(unavailable("MAINTAINERS file not detected")),
    codeownersPath
      ? client.tryGet(`/repos/${encodedRepo}/contents/${encodeFilePath(codeownersPath)}`)
      : Promise.resolve(unavailable("CODEOWNERS file not detected")),
  ]);

  const maintainerText = decodeGitHubContent(maintainersResult);
  const codeownersText = decodeGitHubContent(codeownersResult);
  const maintainerEntries = meaningfulLines(maintainerText, 20);
  const codeownerEntries = meaningfulLines(codeownersText, 30);
  const maintainerHandles = uniqueHandles(maintainerEntries.join("\n"));
  const codeownerHandles = uniqueHandles(codeownerEntries.join("\n"));
  const topContributors = contributors
    .filter((item) => item?.login)
    .slice(0, 10)
    .map((item) => ({ login: String(item.login), contributions: numberOrNull(item.contributions) }));

  return {
    maintainers: {
      status: maintainersResult.status,
      path: maintainersPath,
      handles: maintainerHandles,
      entries: maintainerEntries,
    },
    codeowners: {
      status: codeownersResult.status,
      path: codeownersPath,
      handles: codeownerHandles,
      entries: codeownerEntries,
    },
    topContributors,
    caveat:
      "MAINTAINERS and CODEOWNERS are repository-declared ownership evidence. Top contributors are activity evidence and must not be described as maintainers unless the repository says so.",
  };
}

function findRepositoryPath(repositoryPathMap, candidates) {
  for (const candidate of candidates) {
    const actual = repositoryPathMap.get(candidate.toLowerCase());
    if (actual) return actual;
  }
  return null;
}

function decodeGitHubContent(result) {
  if (result.status !== "available") return "";
  const payload = objectData(result);
  if (payload.encoding !== "base64" || typeof payload.content !== "string") return "";
  try {
    return Buffer.from(payload.content.replace(/\s/g, ""), "base64").toString("utf8").slice(0, 16_384);
  } catch {
    return "";
  }
}

function meaningfulLines(text, limit) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("<!--"))
    .slice(0, limit)
    .map((line) => line.slice(0, 240));
}

function uniqueHandles(text) {
  return [...new Set(String(text || "").match(/@[A-Za-z0-9](?:[A-Za-z0-9-]{0,37})/g) || [])].slice(0, 30);
}

export function aggregateWeekly(items, dateSelector, start, end) {
  return aggregateWeeklyWeighted(items, dateSelector, () => 1, start, end);
}

export function aggregateWeeklyWeighted(items, dateSelector, valueSelector, start, end) {
  const buckets = [];
  const cursor = startOfUtcWeek(start);
  const last = startOfUtcWeek(end);
  while (cursor <= last) {
    buckets.push({ week: cursor.toISOString().slice(0, 10), value: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  const byWeek = new Map(buckets.map((bucket) => [bucket.week, bucket]));
  for (const item of items) {
    const date = new Date(dateSelector(item));
    if (Number.isNaN(date.getTime())) continue;
    const bucket = byWeek.get(startOfUtcWeek(date).toISOString().slice(0, 10));
    if (bucket) bucket.value += Math.max(0, Number(valueSelector(item) || 0));
  }
  return buckets.slice(-TREND_WEEKS);
}

function buildStarHistory(stargazers, currentStars, generatedAt) {
  const daily = new Map();
  for (const item of stargazers) {
    if (!item?.starred_at) continue;
    const day = String(item.starred_at).slice(0, 10);
    daily.set(day, (daily.get(day) || 0) + 1);
  }
  let running = Math.max(0, Number(currentStars || 0) - [...daily.values()].reduce((sum, value) => sum + value, 0));
  const points = [...daily].sort(([left], [right]) => left.localeCompare(right)).map(([date, additions]) => ({ date, value: running += additions }));
  points.push({ date: generatedAt.slice(0, 10), value: Number(currentStars || 0) });
  return [...new Map(points.map((point) => [point.date, point])).values()].sort((a, b) => a.date.localeCompare(b.date));
}

function startOfUtcWeek(value) {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date;
}

function describeBoundedCoverage(result, items, noun) {
  if (result.status !== "available") return `${noun} unavailable from GitHub.`;
  return items.length >= 100 ? `Latest 100 ${noun}; values are lower bounds.` : `${items.length} ${noun} returned in the reporting window.`;
}

function arrayData(result) {
  return result?.status === "available" && Array.isArray(result.data) ? result.data : [];
}

function objectData(result) {
  return result?.status === "available" && result.data && !Array.isArray(result.data) ? result.data : {};
}

function unavailable(reason) {
  return { status: "unavailable", reason, data: null };
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeRepoName(repo) {
  const value = String(repo || "").trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new GitHubDashboardError("Enter a repository as owner/repo or a GitHub repository URL.", { status: 400, code: "invalid_repository" });
  }
  return value;
}

function createGitHubClient({ token, apiBase, fetchImpl }) {
  const base = String(apiBase || DEFAULT_GITHUB_API_BASE).replace(/\/+$/, "");
  const defaultHeaders = { accept: "application/vnd.github+json", "user-agent": "caipe-oss-repo-report-card", "x-github-api-version": "2022-11-28" };
  if (token) defaultHeaders.authorization = `Bearer ${token}`;

  async function request(path, options = {}) {
    let response;
    try {
      response = await fetchImpl(`${base}${path}`, { headers: { ...defaultHeaders, ...(options.accept ? { accept: options.accept } : {}) } });
    } catch (error) {
      throw new GitHubDashboardError(`GitHub could not be reached: ${error instanceof Error ? error.message : "network error"}`, { code: "github_unreachable" });
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const rateLimited = response.status === 403 && response.headers?.get?.("x-ratelimit-remaining") === "0";
      const status = response.status === 404 ? 404 : response.status === 401 ? 401 : response.status === 403 ? 403 : 502;
      const code = rateLimited ? "github_rate_limited" : response.status === 404 ? "repository_not_found" : "github_request_failed";
      const fallback = response.status === 404 ? "Repository not found or the server credential cannot access it." : rateLimited ? "GitHub API rate limit reached. Configure a server credential or retry later." : "GitHub rejected the repository request.";
      throw new GitHubDashboardError(payload.message || fallback, { status, code });
    }
    return payload;
  }

  return {
    get: request,
    async tryGet(path, options) {
      try { return { status: "available", data: await request(path, options) }; }
      catch (error) { return unavailable(error instanceof Error ? error.message : "request failed"); }
    },
    search(query) { return request(`/search/issues?per_page=1&q=${encodeURIComponent(query)}`); },
  };
}

function encodeRepoPath(repo) {
  return repo.split("/").map(encodeURIComponent).join("/");
}

function encodeFilePath(path) {
  return String(path).split("/").map(encodeURIComponent).join("/");
}

function buildSummary(repo, issues, pullRequests) {
  const urgent = issues.p0 + pullRequests.blocked;
  if (urgent > 0) return `${repo} has ${urgent} critical or blocked item${urgent === 1 ? "" : "s"} requiring maintainer attention.`;
  if (issues.needsTriage + pullRequests.awaitingReview > 0) return `${repo} has no P0 or blocked work, with triage and review queues still open.`;
  return `${repo} has no critical, blocked, untriaged, or unreviewed work in the current GitHub snapshot.`;
}

function buildRisks({ issues, pullRequests, staleDays, bounded }) {
  const risks = [];
  if (issues.p0 > 0) risks.push({ severity: "high", title: `${issues.p0} P0 issue${issues.p0 === 1 ? "" : "s"}`, rationale: "Critical issues should be assigned and dispositioned first." });
  if (pullRequests.blocked > 0) risks.push({ severity: "high", title: `${pullRequests.blocked} blocked pull request${pullRequests.blocked === 1 ? "" : "s"}`, rationale: "Blocked changes may delay delivery or a release." });
  if (issues.stale > 0) risks.push({ severity: "medium", title: `${issues.stale} issue${issues.stale === 1 ? "" : "s"} stale for ${staleDays}+ days`, rationale: "Old work can hide obsolete requests and unowned commitments." });
  if (!risks.length) risks.push({ severity: "low", title: bounded ? "No critical risk detected in the bounded snapshot" : "No critical repository risk detected", rationale: "No P0 issues, blocked pull requests, or stale issues were found in the current coverage." });
  return risks;
}

function buildRecommendations({ issues, pullRequests }) {
  const actions = [];
  if (issues.p0 > 0) actions.push("Assign an owner and next milestone to every P0 issue.");
  if (pullRequests.blocked > 0) actions.push("Resolve blocked pull requests before starting lower-priority review work.");
  if (pullRequests.awaitingReview > 0) actions.push(`Review the ${pullRequests.awaitingReview} pull request${pullRequests.awaitingReview === 1 ? "" : "s"} flagged for review attention.`);
  if (issues.needsTriage > 0) actions.push(`Label and prioritize the ${issues.needsTriage} untriaged issue${issues.needsTriage === 1 ? "" : "s"}.`);
  if (issues.stale > 0) actions.push("Close, refresh, or reassign stale issues after maintainer review.");
  if (!actions.length) actions.push("Keep the current triage and review cadence; no queue intervention is indicated.");
  return actions;
}

function buildMaintainerAsks({ issues, pullRequests }) {
  const asks = [];
  if (issues.p0 + pullRequests.blocked > 0) asks.push({ priority: "high", title: "Clear the critical path", detail: `Review ${issues.p0} P0 issue${issues.p0 === 1 ? "" : "s"} and ${pullRequests.blocked} blocked pull request${pullRequests.blocked === 1 ? "" : "s"}.` });
  if (pullRequests.awaitingReview > 0) asks.push({ priority: "medium", title: "Balance the review queue", detail: `${pullRequests.awaitingReview} open pull request${pullRequests.awaitingReview === 1 ? "" : "s"} are flagged for review attention.` });
  if (issues.needsTriage + issues.stale > 0) asks.push({ priority: "medium", title: "Run backlog hygiene", detail: `${issues.needsTriage} issue${issues.needsTriage === 1 ? "" : "s"} need triage and ${issues.stale} are stale.` });
  if (!asks.length) asks.push({ priority: "low", title: "Maintain the current cadence", detail: "No urgent maintainer intervention is indicated by this snapshot." });
  return asks;
}
