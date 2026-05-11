---
id: prebuild-flow
title: Prebuild Flow — Images & Helm Charts
sidebar_label: Prebuild Flow
sidebar_position: 7
description: How prebuild Docker images and Helm charts are built and published from pull request branches, and how the version-bump system works.
---

# Prebuild Flow — Images & Helm Charts

Every `prebuild/*` branch automatically builds and publishes Docker images and Helm charts to GHCR so you can test changes before they merge.

---

## Overview

```
prebuild/feat/my-change  →  pr-version-bump.yml
                             ├── bumps pyproject.toml + uv.lock (always)
                             ├── bumps Chart.yaml (prebuild/* or helm-chart-bump label)
                             ├── prebuild-helm.yml  →  ghcr.io/.../prebuild-helm-charts/
                             └── prebuild-<service>.yml  →  ghcr.io/.../prebuild/<service>
```

---

## 1 — Version Bump (`pr-version-bump.yml`)

Every PR against `main` or `release/*` triggers the version bump workflow. It runs in two modes depending on what changed:

### Full bump (image-affecting changes)

Triggered when any of these paths change:

| Path | Meaning |
|---|---|
| `ai_platform_engineering/**` | Python agent or supervisor code |
| `build/**` | Dockerfiles |
| `ui/**` | CAIPE web UI |
| `pyproject.toml` / `uv.lock` | Python package metadata |

**What gets bumped:**
- `pyproject.toml` → new `x.y.z-dev.N` (or `-rc.N`, `-hotfix.N`)
- `uv.lock` → regenerated
- **All** `Chart.yaml` files → `version` + `appVersion` + all local dependency refs

### Chart-only bump

Triggered when only `charts/**` files change (no image-affecting paths).

**What gets bumped:**
- `pyproject.toml` + `uv.lock` → still bumped (N stays the same, `-chart.M` appended to version)
- Only **changed** charts → `version` field gets `-chart.M` suffix incremented
- Parent charts cascade up automatically (e.g., if `rag-stack` changed, `ai-platform-engineering` also bumps)
- `appVersion` is **not** changed (no new image was built)

### Version tag shapes

| Branch | Example tag |
|---|---|
| `main` (full) | `0.4.9-dev.6` |
| `main` (chart-only) | `0.4.9-dev.6-chart.1` |
| `release/0.4.9` (full) | `0.4.9-rc.2` |
| `release/0.4.9` (chart-only) | `0.4.9-rc.2-chart.1` |

---

## 2 — Prebuild Helm Charts (`prebuild-helm.yml`)

### When it runs

| Trigger | Condition |
|---|---|
| Branch | `prebuild/*` prefix |
| Label | `helm-prerelease` on any PR |

The workflow skips if a new commit was just made by the version-bump bot (it re-runs on the next push instead).

### What it does

1. **Detects changed charts** — diffs HEAD against the PR base to find which of `rag-stack` and `ai-platform-engineering` changed
2. **Injects prebuild version** — temporarily overrides `Chart.yaml` `version` and `appVersion` with the computed prebuild tag (does not commit this)
3. **Downloads dependencies** — `helm dependency update` fetches neo4j, milvus, etc.
4. **Packages and pushes** to `oci://ghcr.io/cnoe-io/prebuild-helm-charts/`
5. **Comments on the PR** with the exact `helm upgrade --install` command to use

### Install a prebuild chart

```bash
# From the PR comment, e.g.:
helm upgrade --install ai-platform \
  oci://ghcr.io/cnoe-io/prebuild-helm-charts/ai-platform-engineering \
  --version 0.4.9-dev.6
```

### Cleanup

`prebuild-cleanup-helm.yml` runs automatically when the PR is closed or merged and removes the published versions from GHCR.

---

## 3 — Prebuild Docker Images

Each service has its own workflow under `.github/workflows/prebuild-<service>.yml`.

### When each image builds

All prebuild image workflows share the same gate: **branch must start with `prebuild/`**. They also do their own path-based change detection so an unrelated push doesn't rebuild every image.

| Workflow | Builds when these paths change |
|---|---|
| `prebuild-supervisor-agent.yml` | `build/Dockerfile`, `ai_platform_engineering/multi_agents/**`, `ai_platform_engineering/agents/**`, `ai_platform_engineering/utils/**` |
| `prebuild-a2a-sub-agent.yml` | Individual A2A sub-agent directories |
| `prebuild-a2a-rag.yml` | RAG ingestor and query pipeline |
| `prebuild-mcp-agent.yml` | MCP server agent directories |
| `prebuild-caipe-ui.yml` | `ui/**` |
| `prebuild-dynamic-agents.yml` | Dynamic agents operator |
| `prebuild-slack-bot.yml` | Slack bot |
| `prebuild-skill-scanner.yml` | `.claude/skills/**` |

### Tag format

```
{branch-name-sanitized}-{commit-count-ahead-of-base}
```

Example: branch `prebuild/feat/new-agent`, 3 commits ahead of `main` →

```
ghcr.io/cnoe-io/prebuild/ai-platform-engineering:feat-new-agent-3
```

The sanitization replaces `/` with `-` and strips the `prebuild/` prefix.

### Use a prebuild image in your values

```yaml
supervisor:
  image:
    repository: ghcr.io/cnoe-io/prebuild/ai-platform-engineering
    tag: feat-new-agent-3
```

---

## 4 — Labels reference

| Label | Effect |
|---|---|
| `dev` | Auto-applied to all normal PRs to `main`. Cosmetic only — marks the PR flow. |
| `helm-prerelease` | Triggers prebuild Helm chart publishing even on non-`prebuild/*` branches. |
| `helm-chart-bump` | **Pending** (PR [#1344](https://github.com/cnoe-io/ai-platform-engineering/pull/1344)) — will gate Chart.yaml version bumps so they only happen on `prebuild/*` branches or when this label is explicitly set. |

### Why `helm-chart-bump` currently does nothing

PR #1344 (not yet merged) introduces the gating logic. On the current `main`, Chart.yaml files are bumped on every qualifying PR regardless of any label. The `helm-chart-bump` label is being reserved so it works correctly the moment #1344 merges — no retroactive relabelling needed.

Once #1344 merges, the behaviour will change:

| Branch / Label | `pyproject.toml` + `uv.lock` bumped | `Chart.yaml` bumped |
|---|---|---|
| Any PR (no label) | ✅ | ❌ |
| PR with `helm-chart-bump` | ✅ | ✅ |
| `prebuild/*` branch | ✅ | ✅ |
| `release/*` branch | ✅ | ✅ |

---

## 5 — Putting it together: typical `prebuild/*` PR

```
1. Push commit to prebuild/feat/my-change
2. pr-version-bump.yml fires:
   a. Detects full vs chart-only change
   b. Bumps pyproject.toml, uv.lock, Chart.yaml
   c. Commits "chore: bump version to 0.4.9-dev.7"
3. Push from bot triggers again:
   a. Version files already up to date → skip_commit=true
   b. prebuild-helm.yml fires → publishes helm chart to GHCR, comments on PR
   c. prebuild-<service>.yml fires for each affected service → pushes Docker image
4. PR comment appears with:
   - Helm install command for the prebuild chart
   - Docker image tag for each service built
```

The double-trigger (step 2 then 3) is intentional: the prebuild helm/image workflows only fire when `new_commit != true` to avoid publishing stale artifacts from the intermediate bot commit.
