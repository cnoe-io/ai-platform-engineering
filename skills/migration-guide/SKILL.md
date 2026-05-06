---
name: migration-guide
description: >
  Generate a migration guide between two ai-platform-engineering chart releases.
  Diffs the Helm values schema, highlights breaking changes, renamed keys, new
  required fields, and deprecated options. Produces a step-by-step upgrade
  runbook with before/after YAML snippets. Use when a user is upgrading their
  values.yaml to a new chart version or asks "what changed between 0.4.x and 0.4.y".
---

# Migration Guide Generator

Produce a structured upgrade guide between two `ai-platform-engineering` Helm
chart versions. The output covers breaking changes, renamed/moved keys, new
required fields, removed defaults, and a copy-paste runbook to upgrade an
existing `values.yaml`.

---

## Execution context

This skill runs in two contexts:

- **Coding agent** (Claude Code, Cursor, etc.) with shell access — run `helm`
  commands directly and write the guide to `docs/migration/<from>-to-<to>.md`.
- **Chat-only assistant** (CAIPE chat, Slack bot, web UI) — render every
  command output and the final guide as fenced code blocks the user can copy.

Detect the context from available tools: if a `Bash` / shell-execution tool is
available, use it. Otherwise, render everything as markdown the user can run
manually.

---

## Step 1 — Gather inputs

Ask the user for:

1. **From version** — the chart version they are upgrading *from* (e.g. `0.4.5`)
2. **To version** — the chart version they are upgrading *to* (e.g. `0.4.8`)
3. **Their existing `values.yaml`** — optional; paste or provide a path. Used to
   flag which changed keys actually affect them.
4. **Environment** — `dev` / `preview` / `prod` / `vm` (affects which
   environment-specific notes to highlight)

---

## Step 2 — Fetch default values for both versions

```bash
FROM_VERSION=<from>
TO_VERSION=<to>
CHART=oci://ghcr.io/cnoe-io/charts/ai-platform-engineering

helm show values "$CHART" --version "$FROM_VERSION" > /tmp/values-from.yaml
helm show values "$CHART" --version "$TO_VERSION"   > /tmp/values-to.yaml
```

If `helm` is unavailable, instruct the user to run these commands and paste
the output.

---

## Step 3 — Diff the values

```bash
diff -u /tmp/values-from.yaml /tmp/values-to.yaml > /tmp/values-diff.patch
cat /tmp/values-diff.patch
```

Then also fetch the chart metadata to get release notes if available:

```bash
helm show chart "$CHART" --version "$TO_VERSION" | grep -A 20 "annotations\|description"
```

---

## Step 4 — Analyse the diff

Read the diff and classify every changed line into one of these categories:

| Category | Criteria |
|---|---|
| **Breaking** | Key renamed, removed, or type changed; old value silently ignored |
| **New required** | New key with no default; chart errors without it |
| **New optional** | New key with a working default; no action needed unless you want non-default |
| **Deprecated** | Key still works but emits a warning or will be removed next version |
| **Default changed** | Key exists in both but default value changed |
| **Structural** | Section moved to a different parent (e.g. `global.foo` → `agent.foo`) |

For each category, extract the specific keys and produce before/after YAML snippets.

**Key patterns to look for:**

- `global.*` changes — affect all subcharts; always breaking if key removed
- `tags.*` — feature-flag changes; new tags may need explicit `true`/`false`
- `caipe-ui.config.*` — env vars injected into caipe-ui ConfigMap
- `supervisor-agent.env.*` — supervisor environment
- `*.externalSecrets.*` — new secret keys the chart now expects from Vault
- `*.image.*` — default image tags or repositories changed
- Image tag pinned to a prebuild tag → removed (now uses chart `appVersion`)

---

## Step 5 — Produce the migration guide

Write the guide in this structure:

```markdown
# Migration Guide: ai-platform-engineering <from> → <to>

## Summary

One-paragraph description of the overall theme of this release
(e.g. "Adds skill-scanner support, moves seed config from dynamic-agents
to caipe-ui, drops legacy prebuild image overrides").

## Breaking Changes

### 1. <Change title>

**Affected key**: `global.foo.bar`

**Before (<from>)**:
​```yaml
global:
  foo:
    bar: "old-value"
​```

**After (<to>)**:
​```yaml
global:
  foo:
    bar: "new-value"   # required
​```

**Why**: <reason — e.g. renamed to align with upstream chart convention>

**Action**: Update your `values.yaml`. If left unchanged, <consequence>.

---

## New Required Fields

### 1. <Field name>

**Key**: `global.skillScanner.enabled`

**Default values.yaml snippet**:
​```yaml
global:
  skillScanner:
    enabled: false   # set to true to deploy the in-cluster scanner
​```

**Action**: No action required for the default. Set to `true` to enable the
skill scanner service.

---

## Default Value Changes

| Key | Old default | New default | Impact |
|---|---|---|---|
| `caipe-ui.config.NODE_ENV` | `development` | `production` | Change if running locally |

---

## Deprecated / Removed Keys

| Key | Removed in | Replacement |
|---|---|---|
| `tags.skill-scanner` | <to> | `global.skillScanner.enabled` |
| `caipe-ui.config.SKILL_SCANNER_URL` (manual) | <to> | Auto-wired when `global.skillScanner.enabled=true` |

---

## Upgrade Runbook

Step-by-step instructions to upgrade an existing deployment.

### 1. Update chart version

In your `config.json` (or wherever chart version is pinned):
​```json
{
  "chart_name": "ai-platform-engineering",
  "chart_version": "<to>"
}
​```

### 2. Apply required values.yaml changes

<For each breaking change, paste the specific diff the user needs to make>

### 3. Remove deprecated keys

Remove these keys from your `values.yaml` (no longer recognised):
- `tags.skill-scanner`
- `caipe-ui.config.SKILL_SCANNER_URL` (if you set it manually)

### 4. Sync / redeploy

For GitOps (ArgoCD):
​```bash
# After merging values changes, trigger a sync
argocd app sync <app-name> --prune
​```

For local docker compose:
​```bash
docker compose pull && docker compose up -d
​```

### 5. Verify

​```bash
# Check all pods healthy
kubectl get pods -n <namespace>

# Check ExternalSecrets synced
kubectl get externalsecrets -n <namespace>

# Confirm new components running (e.g. skill-scanner)
kubectl get deploy -n <namespace> | grep skill-scanner
​```

---

## Full Diff

<details>
<summary>Raw values diff (<from> → <to>)</summary>

​```diff
<paste diff output here>
​```

</details>
```

---

## Step 6 — Check user's values.yaml (if provided)

If the user provided their existing `values.yaml`, cross-reference it against
the breaking changes list and flag only the keys that actually appear in their
file. Prefix each flagged item with `⚠️ ACTION REQUIRED` and skip items that
don't affect them.

---

## Step 7 — Write the guide to disk (coding agent only)

```bash
mkdir -p docs/migration
# Write the guide to the appropriate file
```

File path: `docs/migration/<from>-to-<to>.md`

Commit message: `docs: add migration guide for <from> → <to>`

---

## Guidelines

- Always show concrete before/after YAML — never describe a change in prose only
- For breaking changes, explain the *consequence* of not updating, not just the diff
- Keep the runbook linear: a user should be able to follow steps 1–5 without
  referring back to the breaking-changes section
- If `helm show values` is unavailable (network, auth), note which commands to
  run and ask the user to paste output — do not guess at the diff
- Highlight environment-specific notes (e.g. VM kind clusters use `standard`
  storageClass, not EBS) when the user specified their environment
- For `ExternalSecret` additions: list the exact Vault path and property the
  new secret key maps to, based on the pattern in the chart defaults
