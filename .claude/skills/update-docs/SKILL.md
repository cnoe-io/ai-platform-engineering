---
name: update-docs
description: >
  Audit and update all documentation moving parts for ai-platform-engineering.
  Checks release blog posts, features page, agent docs, homepage version strings,
  Docusaurus version config, and sidebar completeness. Fixes what is stale and
  reports what needs manual attention.
  Use after cutting a release, adding a new agent, or updating platform features.
---

# update-docs

Audit every documentation surface in `ai-platform-engineering` and fix what is out of date.

---

## What this skill checks

| # | Surface | Stale when… |
|---|---------|-------------|
| 1 | **Release blog posts** | A git tag exists with no matching `docs/releases/` file |
| 2 | **Homepage version string** | Helm `--version` in `docs/src/pages/index.tsx` doesn't match latest git tag |
| 3 | **Docusaurus version config** | `lastVersion` in `docusaurus.config.ts` doesn't match latest git tag |
| 4 | **Docusaurus version snapshot** | A tag exists but no `versioned_docs/version-X.Y.Z/` snapshot |
| 5 | **Features page** | `docs/src/pages/features.tsx` tiles don't reflect new feature docs in `docs/docs/features/` |
| 6 | **Agent docs** | A directory under `ai_platform_engineering/agents/` has no matching `docs/docs/agents/<name>.md` |
| 7 | **Sidebar completeness** | A directory under `docs/docs/` is not referenced in `docs/sidebars.ts` |
| 8 | **Navbar version label** | The `0.4.X (Latest)` label in the navbar version dropdown is behind the latest tag |

---

## Execution context

Runs in two modes:

- **Coding agent** (Claude Code) — runs `git`, `find`, `grep` directly and writes fixes to disk.
- **Chat-only** — renders a checklist of findings; states which files to edit and what to change.

---

## Step 1 — Collect ground truth

Run all of the following in parallel.

```bash
# Latest stable git tag
LATEST=$(git tag --sort=-version:refname | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | head -1)
echo "Latest tag: $LATEST"

# All release tags
git tag --sort=-version:refname | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$'

# Existing release blog posts (extract version from filename)
ls docs/releases/*.md 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | tr '-' '.'

# Current lastVersion in docusaurus config
grep 'lastVersion' docs/docusaurus.config.ts

# Current Helm version string on homepage
grep -o "'--version [0-9.]*'" docs/src/pages/index.tsx ||
  grep -o '"--version [0-9.]*"' docs/src/pages/index.tsx ||
  grep 'version' docs/src/pages/index.tsx | grep helm | head -3

# Versioned snapshots
ls docs/versioned_docs/

# Agent implementation directories
ls ai_platform_engineering/agents/

# Agent doc files
ls docs/docs/agents/*.md 2>/dev/null | xargs -I{} basename {} .md

# Feature doc files
ls docs/docs/features/*.md 2>/dev/null | xargs -I{} basename {} .md

# Top-level docs directories
ls -d docs/docs/*/

# Sidebar entries
grep -E "^\s+'[a-z]" docs/sidebars.ts | head -40
```

---

## Step 2 — Run the audit

For each check, produce a **PASS ✅** or **STALE ⚠️** result.

### Check 1 — Release blog posts

Compare every git tag against `docs/releases/`.

```bash
for tag in $(git tag --sort=-version:refname | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$'); do
  slug=$(echo $tag | tr '.' '-')
  match=$(ls docs/releases/*release-${slug}.md 2>/dev/null | wc -l)
  echo "$tag: $match post(s)"
done
```

- If a tag has 0 posts → **STALE**: call `/release-docs` for that version, or flag for manual creation.
- If a post exists → **PASS**.

### Check 2 — Homepage version string

```bash
LATEST=$(git tag --sort=-version:refname | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | head -1)
grep -n "$LATEST\|--version" docs/src/pages/index.tsx | head -5
```

- If the Helm `--version` value ≠ `$LATEST` → **STALE**: update `HELM_CMD` constant and any hardcoded version strings in `index.tsx`.
- Fix: replace every occurrence of the old version string with `$LATEST`.

### Check 3 — Docusaurus `lastVersion`

```bash
grep 'lastVersion' docs/docusaurus.config.ts
```

- If `lastVersion` ≠ `$LATEST` → **STALE**: update `lastVersion` in `docs/docusaurus.config.ts`.

### Check 4 — Versioned snapshot exists

```bash
ls docs/versioned_docs/
```

- If `versioned_docs/version-$LATEST/` does not exist → **STALE**: run:

```bash
cd docs && npm run docusaurus -- docs:version $LATEST
```

Then update `docusaurus.config.ts` to add the new version entry and set it as `lastVersion`.

### Check 5 — Features page vs feature docs

```bash
# Titles in the features page
grep "title:" docs/src/pages/features.tsx | grep -oP "(?<=')[^']+(?=')"

# Feature doc files that exist
ls docs/docs/features/*.md | xargs -I{} basename {} .md
```

- For each `docs/docs/features/<name>.md` that has no matching tile in `features.tsx` → **STALE**: add a tile.
- Report the list; ask the user which new features to add tiles for before editing.

### Check 6 — Agent docs coverage

```bash
# Agent implementation directories
AGENTS=$(ls -d ai_platform_engineering/agents/*/ 2>/dev/null | xargs -I{} basename {})

# Agent doc files (basename without .md)
AGENT_DOCS=$(ls docs/docs/agents/*.md 2>/dev/null | xargs -I{} basename {} .md)

# Find gaps
for agent in $AGENTS; do
  echo $AGENT_DOCS | grep -qw "$agent" && echo "✅ $agent" || echo "⚠️  $agent — missing docs/docs/agents/$agent.md"
done
```

- For each missing agent doc → **STALE**: scaffold a stub from the template at `docs/docs/agents/template.md`.

Scaffold command:

```bash
cp docs/docs/agents/template.md docs/docs/agents/<agent-name>.md
# Then replace placeholder values: agent name, description, capabilities
```

### Check 7 — Sidebar completeness

```bash
# All top-level doc section dirs
DOC_DIRS=$(ls -d docs/docs/*/ | xargs -I{} basename {})

# What's referenced in sidebars.ts
SIDEBAR_REFS=$(grep -oE "\"[a-z-]+/[a-z-]+" docs/sidebars.ts | cut -d'"' -f2 | cut -d'/' -f1 | sort -u)

for dir in $DOC_DIRS; do
  echo $SIDEBAR_REFS | grep -qw "$dir" && echo "✅ $dir in sidebar" || echo "⚠️  $dir — not in sidebars.ts"
done
```

- For missing sidebar entries → **STALE**: add the directory to `docs/sidebars.ts` under the appropriate category.

### Check 8 — Navbar version label

```bash
grep "label.*Latest" docs/docusaurus.config.ts
```

- If the label says `X.Y.Z (Latest)` but `$LATEST` ≠ X.Y.Z → **STALE**: update the label.

---

## Step 3 — Apply fixes

Apply fixes in this order (each is independent):

1. **Homepage version** — find-replace the old version string in `docs/src/pages/index.tsx`
2. **Docusaurus config** — update `lastVersion` and the version label
3. **Version snapshot** — run `npm run docusaurus -- docs:version $LATEST` if missing
4. **Missing agent stubs** — scaffold from template for each uncovered agent
5. **Sidebar gaps** — append missing dir entries to `docs/sidebars.ts`
6. **Missing release posts** — delegate to `/release-docs` for each unposted tag

For checks 5 (features page tiles), always ask the user before writing — new feature tiles need copy that only the team can confirm.

---

## Step 4 — Report

After all checks and fixes, produce a summary table:

```
## Docs Health Report  <date>

| Check | Status | Action taken |
|-------|--------|--------------|
| Release posts | ✅ / ⚠️ | Created N posts / N missing, run /release-docs for: X.Y.Z |
| Homepage version | ✅ / ⚠️ | Updated X.Y.Z → A.B.C |
| lastVersion config | ✅ / ⚠️ | Updated |
| Version snapshot | ✅ / ⚠️ | Created versioned_docs/version-A.B.C |
| Features page | ✅ / ⚠️ | N tiles match / N new features need tiles: [list] |
| Agent docs | ✅ / ⚠️ | Scaffolded stubs for: [list] |
| Sidebar | ✅ / ⚠️ | Added entries for: [list] |
| Navbar label | ✅ / ⚠️ | Updated |
```

If nothing is stale, say so explicitly: "All docs surfaces are up to date."

---

## Guidelines

- Never delete existing release posts, even for yanked versions.
- Never auto-write features page tiles — copy must be human-approved.
- Agent stubs are scaffolds only — flag them clearly with a `<!-- TODO: fill in capabilities -->` comment.
- If `lastVersion` is updated, also update the version entry label (e.g. `0.4.9 (Latest)`).
- All file writes must follow the project's conventional commit style; suggest a commit message.
- If `git tag` shows no semver tags, report "no versioned releases found" and skip version checks.
