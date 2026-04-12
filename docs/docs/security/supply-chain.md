# Supply Chain Security

CAIPE maintains a layered supply chain security posture that spans dependency management, static analysis, container hardening, and continuous vulnerability scanning. Every control described here is enforced automatically in CI — no manual steps are required to stay compliant.

## Dependency Pinning

### Python

Every Python dependency across all subpackages (`pyproject.toml` files) must be pinned to an exact version using `==`. Range specifiers (`>=`, `~=`, `^`) are **not allowed** for direct dependencies.

```toml
# ✅ Correct — exact pin
"fastmcp==3.2.3"
"pydantic==2.12.5"

# ❌ Not allowed — range specifier
"fastmcp>=3.2.0"
```

**Why exact pins?** Range specifiers allow the resolver to silently upgrade a package the next time a lock file is regenerated. An exact pin means the version you test is the version that ships.

**Enforcement:** The [`check-pinned-deps`](https://github.com/cnoe-io/ai-platform-engineering/blob/main/.github/workflows/check-pinned-deps.yml) CI gate runs `scripts/check_pinned_deps.py` on every PR and `main` push. The job fails if any `pyproject.toml` or `package.json` contains an unpinned dependency.

### Node.js / JavaScript

The same exact-pin requirement applies to `package.json` files in the UI and bot packages. The `check-pinned-deps` workflow enforces this for Node.js alongside Python.

## Reproducible Builds with `uv.lock`

Every Python subpackage with its own `pyproject.toml` ships a committed `uv.lock` file. `uv.lock` captures the fully-resolved dependency graph — including all transitive dependencies — at a specific commit.

**What this means:**
- `uv sync --locked` reproduces the exact environment used in CI and container builds, regardless of when it runs
- No transitive dependency drift between developer machines, CI, and production images
- The lock file is the source of truth; `pyproject.toml` defines the constraints

**Lock file locations:**

| Component | Lock file |
|-----------|-----------|
| Supervisor agent | `uv.lock` (repo root) |
| RAG server | `ai_platform_engineering/knowledge_bases/rag/server/uv.lock` |
| RAG ingestors | `ai_platform_engineering/knowledge_bases/rag/ingestors/uv.lock` |
| RAG common | `ai_platform_engineering/knowledge_bases/rag/common/uv.lock` |
| RAG ontology agent | `ai_platform_engineering/knowledge_bases/rag/agent_ontology/uv.lock` |
| Each A2A/MCP agent | `ai_platform_engineering/agents/<name>/{a2a,mcp}/uv.lock` |

**Enforcement:** The [`uv-lock-check`](https://github.com/cnoe-io/ai-platform-engineering/blob/main/.github/workflows/uv-lock-check.yml) CI gate runs `scripts/check_uv_lock_sync.sh` on every PR and `main` push. It re-runs `uv lock --check` across all subpackages and fails if any lock file is out of sync with its `pyproject.toml`.

## Vulnerability Scanning (Grype)

CAIPE uses [Anchore Grype](https://github.com/anchore/grype) for vulnerability scanning, configured via the [`security-scan`](https://github.com/cnoe-io/ai-platform-engineering/blob/main/.github/workflows/security-scan.yml) workflow. Scan results are uploaded as SARIF to [GitHub Code Scanning](https://github.com/cnoe-io/ai-platform-engineering/security/code-scanning).

### Filesystem scan (PRs and main)

Runs on every pull request to `main` and every push to `main`. Scans the full repository filesystem against Grype's vulnerability database.

| Setting | Value | Why |
|---------|-------|-----|
| `severity-cutoff` | `critical` | Blocks merge on critical-severity findings |
| `fail-build` | `true` | Hard block — PRs cannot merge with open criticals |
| `only-fixed` | `true` | Only report CVEs that have a known patched version available |
| `output-format` | `sarif` | Results uploaded to GitHub Code Scanning for tracking |

The `only-fixed: true` flag is the key policy decision. It eliminates two noise categories that would otherwise inflate the alert count:
- **False positives** — Grype's database occasionally maps a CVE to a broader version range than the actual affected range (e.g., a CVE whose NVD entry lists `≤0.9.5` but whose `patched:` field is `null` because the NVD entry predates the fix being published). `only-fixed: true` skips these entirely.
- **No-upstream-fix CVEs** — Some packages have open CVEs with no available patch (e.g., a CVE in a transitive dep where the upstream maintainer has not yet released a fix). There is no actionable remediation, so blocking on these provides no security benefit.

### Container image scan (tags and manual dispatch)

Runs on every version tag push (e.g., `0.2.3`) and via `workflow_dispatch`. Scans all published container images from GHCR.

| Setting | Value | Why |
|---------|-------|-----|
| `severity-cutoff` | `high` | Wider net for published images (high + critical) |
| `fail-build` | `false` | Informational — does not block tag publication |
| `only-fixed` | `true` | Same policy as filesystem scan |

Container images scanned include all A2A sub-agents, MCP servers, the supervisor, UI, RAG components, and bots. Each image gets its own SARIF category (e.g., `grype-agent-github`, `grype-caipe-ui`) for independent tracking in GitHub Code Scanning.

### Trigger matrix

| Event | Filesystem scan | Container scan |
|-------|----------------|----------------|
| Pull request → `main` | ✅ blocking | ✗ |
| Push to `main` | ✅ blocking | ✗ |
| Push tag (e.g. `0.2.3`) | ✅ informational | ✅ informational |
| `workflow_dispatch` | ✅ informational | ✅ informational |

## Static Analysis (CodeQL)

GitHub's CodeQL engine runs on every PR and `main` push, covering all four language categories present in the repository:

| Language | Scope |
|----------|-------|
| `python` | Supervisor agent, sub-agents, MCP servers, RAG stack |
| `javascript-typescript` | CAIPE UI (Next.js / React), bot frontends |
| `go` | Go-based tooling and utilities |
| `actions` | GitHub Actions workflow files |

CodeQL results are also uploaded as SARIF to GitHub Code Scanning. Any `error`-severity finding blocks the PR.

## GitHub Actions Security

### SHA-pinned actions

Every third-party GitHub Action in `.github/workflows/` is pinned to a full commit SHA rather than a mutable tag:

```yaml
# ✅ Immutable — SHA will never be reassigned
uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6

# ❌ Not used — tag can be force-pushed
uses: actions/checkout@v4
```

This prevents tag-hijacking supply chain attacks where a compromised upstream maintainer pushes malicious code to an existing tag.

### Step Security Harden Runner

Every workflow job starts with the [Step Security Harden Runner](https://github.com/step-security/harden-runner):

```yaml
- name: Harden runner
  uses: step-security/harden-runner@fa2e9d605c4eeb9fcad4c99c224cee0c6c7f3594 # v2.16.0
  with:
    egress-policy: audit
```

The harden runner monitors network egress during the job and generates a report of all outbound connections. In `audit` mode it logs without blocking; this baseline is used to identify unexpected network calls that could indicate a compromised action.

### Least-privilege permissions

Workflow files declare only the permissions they actually need. Most jobs run with `contents: read` only. The security scan workflow adds `security-events: write` solely to upload SARIF results:

```yaml
permissions:
  contents: read
  security-events: write  # required to upload SARIF to GitHub Code Scanning
```

## Commit and Contribution Controls

### DCO (Developer Certificate of Origin)

Every commit must include a DCO sign-off line:

```
Signed-off-by: Your Name <your.email@example.com>
```

This is enforced by the Probot DCO app on every PR. Sign-off is added automatically with `git commit -s`. The DCO certifies that the contributor has the right to submit the code under the project's open-source license.

### Conventional Commits

The [`conventional_commits`](https://github.com/cnoe-io/ai-platform-engineering/blob/main/.github/workflows/conventional_commits.yml) workflow enforces the [Conventional Commits](https://www.conventionalcommits.org/) specification on every PR title and commit message. This provides a structured audit trail and enables automated changelog generation.

### No proprietary content

The [`check-proprietary-content`](https://github.com/cnoe-io/ai-platform-engineering/blob/main/.github/workflows/check-proprietary-content.yml) workflow scans every changed file in a PR for patterns associated with proprietary infrastructure (internal domains, email suffixes, internal team names). Any match blocks the PR and posts a comment identifying the exact lines. This prevents accidental leakage of internal tooling references into the open-source repository.

## Container Image Hardening

All runtime container images follow a two-stage build pattern to minimize the attack surface:

### Multi-stage builds

```dockerfile
# Stage 1: builder — full toolchain, installs dependencies
FROM python:3.13-slim AS builder
RUN uv sync --locked --no-dev

# Stage 2: runtime — only what's needed to run
FROM python:3.13-slim
COPY --from=builder /app /app
```

The builder stage installs compilers and build tools that are **not copied** to the final image. Only the compiled artifacts and application code ship.

### Non-root user

All agent containers run as a dedicated non-root user with a fixed UID:

```dockerfile
RUN groupadd -r appuser && useradd -r -g appuser -u 1001 -m appuser
USER appuser
```

Running as UID 1001 (non-root) limits the blast radius of a container breakout — a compromised process cannot write to system paths or install packages.

### Locked dependency installs

Container builds install from the committed `uv.lock` file using `uv sync --locked`. This guarantees the image contains exactly the dependency versions that passed CI, with no resolver re-execution at build time.

## Dependabot

GitHub Dependabot is configured for the repository and generates alerts when a dependency version is matched against a known vulnerability in the GitHub Advisory Database. Dependabot alerts feed into the same GitHub Code Scanning interface as Grype and CodeQL results, providing a unified view.

## Alert Lifecycle

GitHub Code Scanning alerts are lifecycle-managed as follows:

1. **Auto-close on fix** — When a scan runs on `main` (or a PR branch) and a previously-reported finding is no longer present (e.g., because a dependency was upgraded), the alert is automatically closed by GitHub.

2. **`only-fixed: true` prevents noise accumulation** — Findings for CVEs with no available patch are never reported in the first place, so the alert list reflects only actionable items.

3. **Ghost alert dismissal** — Alerts created by scans of PR merge-refs (`refs/pull/N/merge`) or deleted branches can persist in the alert list even after the CVE is remediated, because GitHub has no new scan of that ref to close them against. These can be dismissed via the GitHub API with reason `"false positive"` or `"won't fix"` as appropriate.

4. **SARIF categories** — Each scan type uploads to a named category (`grype-filesystem`, `grype-<image-name>`, `codeql-python`, etc.). GitHub tracks alerts per category, so a filesystem alert and a container alert for the same CVE are tracked independently.
