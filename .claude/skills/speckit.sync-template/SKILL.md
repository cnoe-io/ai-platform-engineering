<!-- Sync with upstream repo-template updates -->
<!-- AUTO-GENERATED — DO NOT EDIT -->
<!-- Source: .specify/templates/commands/sync-template.md -->
<!-- Regenerate: make generate-agent-files -->

---
description: Sync with upstream repo-template updates
scripts:
  sh: scripts/bash/sync-template.sh "$ARGUMENTS"
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty). Valid arguments: `--check` (preview only, no writes), `--force` (apply without prompting), a specific version string like `v1.2.0`.

## Outline

You are syncing this repository with the upstream `cisco-eti/repo-template`. Follow these steps exactly.

### Step 1 — Read current state

1. Read `.specify/upstream.yml`.
   - Extract `source` (e.g., `cisco-eti/repo-template`), `version` (current applied version), `overrides` (list of files to skip).
2. If `.specify/upstream.yml` does not exist, halt and tell the user: "This repo has no .specify/upstream.yml. Initialize it first using the template at [cisco-eti/repo-template](https://github.com/cisco-eti/repo-template)."

### Step 2 — Discover latest release

1. Use the GitHub API to find the latest release of the upstream repo:
   `GET https://api.github.com/repos/<source>/releases/latest`
2. Extract `tag_name` (e.g., `v1.1.0`) and `assets` (find the ZIP asset and `manifest.json` asset).
3. If the user specified a version in `$ARGUMENTS`, use that version instead of latest.
4. Compare `tag_name` to current `version`:
   - If equal: report "Already at latest version <version>. Nothing to do." and stop (unless `--force` was passed).

### Step 3 — Read the manifest

1. Download `manifest.json` from the release assets.
2. Parse:
   - `semver_bump`: `"major"`, `"minor"`, or `"patch"`
   - `changed_files`: list of files changed in this release
   - `breaking_files`: list of files with breaking changes
   - `changelog_url`: link to view details

### Step 4 — Determine what to apply

1. Start with `changed_files` from the manifest.
2. Remove any file listed in `.specify/upstream.yml` `overrides` — these are skipped.
3. Remaining files = **apply set**.
4. Intersect `apply set` with `breaking_files` → **breaking set** (files in apply set that are also breaking).

### Step 5 — Preview (always show before writing)

Print a summary table:

```text
Upstream version: v1.0.0 → v1.1.0 (MINOR bump)

Files to apply:
  docs/plan/SKILLS.md                      [updated]
  .claude/skills/speckit.new-skill/SKILL.md    [added]

Files skipped (overrides):
  docs/plan/CONSTITUTION.md                [override — local version preserved]

Breaking changes: none
```

If `--check` was passed, stop here. Do not write any files.

If `semver_bump` is `"major"`:

- Print: "⚠️  MAJOR version bump — this includes constitutional or breaking changes."
- Print the list of breaking files with a note about each.
- Ask the user: "Do you want to proceed? Constitutional changes require human review. (yes/no)"
- If no: stop.

### Step 6 — Apply files

1. Download and extract the release ZIP.
2. For each file in the apply set:
   a. If the local file does not exist: write it directly (new addition).
   b. If the local file exists: show a unified diff, then overwrite it.
3. Update `.specify/upstream.yml`:
   - Set `version` to the new version tag (strip the `v` prefix: `1.1.0`)
   - Set `pinned_at` to today's date (ISO 8601)
   - Leave `overrides` unchanged.
4. Report: "Sync complete. Applied <N> files. Version updated to <version>."

### Step 7 — Post-sync guidance

After a successful sync:

- If any `docs/plan/` files were updated: "Tip: Review the updated docs/plan/ files. If the ARCHITECTURE.md or CONSTITUTION.md was updated, compare with your project-specific overrides."
- If any `.claude/skills/` or `.agents/skills/` were updated: "New or updated skills are available. Run `/speckit.specify --help` or check .claude/skills/ for changes."
- If the bump was MAJOR: "MAJOR sync applied. Verify your override files are still consistent with the new template base."
