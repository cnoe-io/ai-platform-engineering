---
name: release-docs
description: >
  Generate release notes and a migration guide for ai-platform-engineering.
  Produces docs/releases/<version>.md (what changed, who should upgrade, highlights)
  and docs/migration/<from>-to-<to>.md (breaking changes, renamed keys, upgrade runbook).
  Use when cutting a release, when a user asks "what changed in 0.4.x", or when
  upgrading their values.yaml to a new chart version.
---

# Release Notes + Migration Guide Generator

Produce two documents for an `ai-platform-engineering` release:

1. **`docs/releases/<to>.md`** — human-readable release notes (changelog narrative,
   highlights, known issues).
2. **`docs/migration/<from>-to-<to>.md`** — operator upgrade guide (breaking changes,
   renamed Helm keys, new required fields, step-by-step runbook).

---

## Execution context

Runs in two modes:

- **Coding agent** (Claude Code, Cursor) with shell access — run `git` and `helm`
  commands directly and write files to disk.
- **Chat-only** (CAIPE chat, Slack, web UI) — render output as fenced markdown blocks
  the user can copy; note which commands to run manually.

Detect by whether a `Bash`/shell tool is available.

---

## Step 1 — Gather inputs

Ask the user for:

| Input | Example | Required |
|-------|---------|----------|
| **To version** | `0.4.8` | Yes |
| **From version** | `0.4.7` | Yes (defaults to previous tag) |
| **User's `values.yaml`** | paste or path | No — enables personal impact analysis |
| **Environment** | `dev` / `preview` / `prod` / `vm` | No — enables env-specific notes |

If from/to are not provided, detect from the repo:

```bash
# latest two semver tags
git tag --sort=-version:refname | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | head -2
```

---

## Step 2 — Collect raw data

Run all of the following in parallel where possible.

### 2a — Git log between versions

```bash
git log <from>..<to> --oneline --no-merges
```

Also fetch full PR bodies for non-chore commits to get context:

```bash
# for each PR number in the log, e.g. (#1324):
gh pr view <number> --json title,body,labels
```

### 2b — Helm values diff

```bash
CHART=oci://ghcr.io/cnoe-io/charts/ai-platform-engineering
helm show values "$CHART" --version <from> > /tmp/values-from.yaml
helm show values "$CHART" --version <to>   > /tmp/values-to.yaml
diff -u /tmp/values-from.yaml /tmp/values-to.yaml
```

### 2c — Chart metadata

```bash
helm show chart "$CHART" --version <to>
```

### 2d — CHANGELOG.md (already machine-generated)

```bash
# Entries between the two version headers
sed -n '/^## <to>/,/^## <from>/p' CHANGELOG.md
```

---

## Step 3 — Classify changes

### Classify git commits

| Type | Criteria |
|------|----------|
| **Feature** | `feat(*)` commits |
| **Fix** | `fix(*)` commits |
| **Security** | commits touching Dockerfile, securityContext, PSS/PSA |
| **Breaking** | commit body contains "BREAKING CHANGE" or PR label `breaking-change` |
| **Chore / Internal** | `chore`, `refactor`, `ci`, `test` — omit from user-facing notes |

### Classify Helm values diff lines

| Category | Criteria |
|----------|----------|
| **Breaking** | Key renamed, removed, or type changed; old value silently ignored |
| **New required** | New key with no default; chart errors without it |
| **New optional** | New key with working default; no action needed |
| **Deprecated** | Key still works but will be removed |
| **Default changed** | Same key, different default value |

---

## Step 4 — Write `docs/releases/<to>.md`

```markdown
# Release Notes — ai-platform-engineering <to>

> Released: <date>  
> Chart: `oci://ghcr.io/cnoe-io/charts/ai-platform-engineering:<to>`  
> Previous release: [<from>](../<from>.md)

## Highlights

<2-4 sentence narrative of the most significant changes in plain English.
Focus on operator/user impact, not internal implementation details.>

## What's New

### <Feature area 1>
- **<Title>** — <one-line description linking to PR #NNNN>

### <Feature area 2>
- ...

## Bug Fixes

- **<scope>**: <description> ([#NNNN](https://github.com/cnoe-io/ai-platform-engineering/pull/NNNN))

## Security

- <Any security-context, PSS, or CVE-related changes>

## Breaking Changes

> ⚠️ See the [Migration Guide](<from>-to-<to>.md) for upgrade instructions.

<If none:>
No breaking changes. Drop-in upgrade from <from>.

## Known Issues

<If none:>
None known at this time.

## Upgrade

```bash
helm upgrade ai-platform-engineering \
  oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \
  --version <to> \
  -f your-values.yaml
```

Full upgrade instructions: [Migration Guide](<from>-to-<to>.md)
```

---

## Step 5 — Write `docs/migration/<from>-to-<to>.md`

```markdown
# Migration Guide: ai-platform-engineering <from> → <to>

## Overview

<One paragraph: overall theme, e.g. "Adds AWS MCP server, introduces
call-limit middleware, moves to PSS-Baseline security contexts — no
values.yaml changes required for most operators.">

## Helm Values Changes

<If no diff:>
No Helm values changes between <from> and <to>.
Drop-in upgrade — no values.yaml edits required.

<If diff exists, use the sections below:>

### Breaking Changes

#### 1. <Change title>

**Affected key**: `global.foo.bar`

**Before (<from>)**:
```yaml
global:
  foo:
    bar: "old-value"
```

**After (<to>)**:
```yaml
global:
  foo:
    bar: "new-value"   # required
```

**Why**: <reason>

**Action**: Update your `values.yaml`. If left unchanged, <consequence>.

---

### New Required Fields

#### 1. `<key>`

```yaml
<key>: <default>   # <description>
```

**Action**: No action for the default. Set to `<non-default>` to enable <feature>.

---

### Default Value Changes

| Key | Old default | New default | Impact |
|-----|------------|------------|--------|
| `caipe-ui.config.NODE_ENV` | `development` | `production` | Set explicitly if running locally |

---

### Deprecated / Removed Keys

| Key | Removed in | Replacement |
|-----|-----------|-------------|
| `tags.skill-scanner` | <to> | `global.skillScanner.enabled` |

---

## Upgrade Runbook

### 1. Update chart version

```bash
# GitOps / config.json
"chart_version": "<to>"

# Or Helm directly
helm upgrade ai-platform-engineering \
  oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \
  --version <to> \
  -f your-values.yaml
```

### 2. Apply values.yaml changes

<Paste exact diffs for each breaking change. One code block per change.>

### 3. Remove deprecated keys

Remove from your `values.yaml`:
- `<deprecated-key-1>`
- `<deprecated-key-2>`

### 4. Sync / redeploy

**ArgoCD (GitOps)**:
```bash
argocd app sync <app-name> --prune
```

**Local Docker Compose**:
```bash
docker compose pull && docker compose up -d
```

### 5. Verify

```bash
# All pods healthy
kubectl get pods -n <namespace>

# ExternalSecrets synced
kubectl get externalsecrets -n <namespace>

# New components running (adjust for your release)
kubectl get deploy -n <namespace>
```

---

## Personal Impact Analysis

<If the user provided their values.yaml:>
Cross-reference against the breaking-changes list above. Only keys that
appear in the user's file are flagged below.

| Key | Found in your values.yaml | Action |
|-----|--------------------------|--------|
| `global.foo.bar` | ✅ yes (`line 42`) | ⚠️ ACTION REQUIRED — update to new value |
| `tags.skill-scanner` | ✅ yes | ⚠️ ACTION REQUIRED — replace with `global.skillScanner.enabled` |

<If the user did not provide their values.yaml:>
Provide your `values.yaml` and re-run this skill to get a personalised
impact checklist.

---

## Full Values Diff

<details>
<summary>Raw diff (<from> → <to>)</summary>

```diff
<paste diff output>
```

</details>
```

---

## Step 6 — Write files to disk (coding agent)

```bash
mkdir -p docs/releases docs/migration

# Write release notes
cat > docs/releases/<to>.md << 'EOF'
<generated content>
EOF

# Write migration guide
cat > docs/migration/<from>-to-<to>.md << 'EOF'
<generated content>
EOF
```

Commit:

```bash
git add docs/releases/<to>.md docs/migration/<from>-to-<to>.md
git commit -s -m "docs: add release notes and migration guide for <from> → <to>"
```

---

## Guidelines

- Show concrete before/after YAML for every breaking change — never prose-only
- For breaking changes, state the *consequence* of not updating
- Keep the runbook linear — steps 1–5 should be self-contained without cross-references
- If `helm show values` is unavailable (auth, network), note the command and ask the user to paste output — never guess at the diff
- Highlight environment-specific notes (VM kind clusters use `standard` storageClass; EKS uses `gp2`/`gp3`)
- For `ExternalSecret` additions, list the exact Vault path and key the chart now expects
- Omit `chore`, `ci`, `test`, and `refactor` commits from user-facing release notes
- If there are zero helm value changes, say so explicitly and reassure it is a drop-in upgrade
