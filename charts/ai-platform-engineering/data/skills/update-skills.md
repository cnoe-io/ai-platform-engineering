---
description: {{DESCRIPTION}}
---

## User Input

```text
{{ARG_REF}}
```

You **MUST** consider the user input before proceeding (if not empty).

## Outline

Refresh locally-installed CAIPE skills from the live catalog. You are
**agent-driven**: fetch the catalog, diff against on-disk SKILL.md files,
and **prompt the user per changed skill** before writing anything. The
user is in the loop on every change — never overwrite silently unless
they passed `--force` in the input.

This is the safe, explicit alternative to silent background updates.

## SECURITY — never expose the API key

- **NEVER** print, echo, or display the API key value in any output, log, or message.
- **NEVER** include the key literally in any bash command shown to the user.
- All API calls MUST go through `~/.config/caipe/caipe-skills.py` which keeps the key internal.

## Argument parsing

Parse `{{ARG_REF}}` (may be empty) for these flags:

| Flag | Effect |
|------|--------|
| `--force` | Skip both the top-level prompt and per-skill prompts; behave as if the user picked `approve-all` and answered `overwrite` for every locally-modified skill. |
| `--dry-run` | Print what would change but don't write anything. |
| `<skill-name>` | Limit refresh to one skill. May be combined with `--force`. |

Default (no flags): interactive per-skill prompts.

## Steps

### 1. Locate the install manifest

The install manifest records which on-disk skills CAIPE owns. Two paths:

- **User-wide install:** `~/.config/caipe/installed.json`
- **Project-local install:** `./.caipe/installed.json` (relative to the
  current working directory)

Check both. If both exist, the project-local manifest takes precedence
for skills it lists; user-wide owns the rest. If neither exists, report
"No CAIPE skills installed — run the Quick install one-liner from the
Skills API Gateway first" and stop.

### 2. Fetch the live catalog

```bash
INCLUDE_CONTENT=true uv run ~/.config/caipe/caipe-skills.py
```

(No skill-name arg = list everything.) Parse the JSON. The response
shape is `{ "skills": [{"name": ..., "description": ..., "content": ..., "ancillary_files": {...}}] }`.

If the helper errors with "no base_url configured" or similar: tell the
user to re-run the Quick install one-liner so the helper gets seeded
with the gateway URL, then stop.

### 3. Locate on-disk skills

For each entry in the manifest, the `path` field points at the
installed file. For `skills` layout (Claude Code, Cursor, opencode), the
file is `<dir>/<skill-name>/SKILL.md`; the parent directory may also
contain ancillary files (`scripts/`, `references/`, `assets/`).

For `commands` layout, the file is `<dir>/<skill-name>.<ext>` (single
file, no ancillaries).

### 4. Build the change set

For each skill that exists in **both** the manifest and the catalog:

1. Read the local SKILL.md.
2. Compare to `catalog.skills[].content` for the matching name.
3. Classify into one of:
   - **unchanged** — local matches catalog. Drop from the change set.
   - **catalog-updated** — local matches the manifest's last-installed
     snapshot, but catalog has a newer version.
   - **locally-modified** — local differs from both the catalog and the
     manifest's last-installed snapshot (i.e. the user hand-edited it).
     If the manifest doesn't store a content hash, treat any local
     difference as locally-modified (safer assumption).

Also build:
- A **new-in-catalog** list (catalog skills not in the manifest).
- A **removed-from-catalog** list (manifest entries not in the catalog).

If every list is empty: print "Everything up to date." and stop.

### 5. Ask the user how to handle the batch (once, up front)

Print a one-screen summary of what changed:

```
Catalog refresh — proposed changes:
  ~ 4 skills updated upstream (catalog-updated)
  ! 1 skill modified locally (locally-modified)
  + 2 new skills available
  - 1 skill removed from catalog
```

Then ask: **"How do you want to review? [individual/approve-all/abort]"**

- `individual` (default if user just hits enter) → walk every change one
  at a time with a per-skill prompt (step 6).
- `approve-all` → equivalent to `--force` for the rest of the run; skip
  per-skill prompts. Still respects the `--dry-run` flag.
- `abort` → exit without writing anything.

Skip this top-level prompt if `--force` was passed on the command line
(behave as if the user picked `approve-all`).

### 6. Per-skill prompts (individual mode)

For each entry in the change set, present a one-line summary, then ask
the appropriate question:

**catalog-updated** (`~ <skill-name>`):
> Replace? [y/n/diff]
- `y` → write the new SKILL.md (and ancillaries, see step 7).
- `n` → skip this skill.
- `diff` → show a unified diff (`diff -u <local> <(echo "$new")`) and re-ask.

**locally-modified** (`! <skill-name>`):
Tell the user explicitly that they have local edits, then ask:
> Local edits detected. [keep/overwrite/diff/backup-and-overwrite]
- `keep` → leave local file alone.
- `overwrite` → replace with catalog version (local edits lost).
- `diff` → show unified diff and re-ask.
- `backup-and-overwrite` → copy current file to `<path>.local-backup-<UTC-timestamp>` then overwrite with catalog version.

**new-in-catalog** (`+ <skill-name>`):
> Install? [y/n]

**removed-from-catalog** (`- <skill-name>`):
> Remove local copy? [y/n]

### 7. Apply approved changes (atomic writes)

For every approved change from step 6:

1. **Atomic write**: write the new content to a sibling tempfile in the
   same directory (`<path>.caipe-tmp.<pid>`), then `mv` it into place.
   A Ctrl-C mid-run must never leave a half-written SKILL.md.
2. **Ancillary files** (`skills` layout only): for each file in
   `catalog.skills[].ancillary_files`, write it atomically.
3. **Orphan ancillaries**: for each file on disk under `<skill-dir>/`
   that is NOT in `ancillary_files` AND NOT `SKILL.md`:
   - In `individual` mode: ask "Remove orphaned `<rel-path>`? [y/n]".
   - In `approve-all` / `--force` mode: remove without prompting.
4. **Removals** (removed-from-catalog approvals): `rm -rf` the skill
   directory (skills layout) or `rm` the single file (commands layout).
   Drop the manifest entry.
5. **Manifest update**: refresh each touched entry's `installed_at`
   timestamp and content hash. Preferred path:
   ```bash
   uv run ~/.config/caipe/caipe-skills.py --register <abs-path>
   ```
   Fallback if `--register` isn't available: rewrite `installed.json`
   directly via tempfile + atomic rename. Never edit the manifest
   in-place.

### 8. Summary

At the end, print a short summary:

```
Refreshed 3 skills, installed 1 new, removed 2, skipped 1 (local edits).
Manifest: ~/.config/caipe/installed.json
```

If `--dry-run`, prefix every action with `[dry-run]` and write nothing.

## Notes

- This is an **agent-driven** flow: you (the agent) do the diffing and
  prompting using your own Read/Write/Bash tools. There's no compiled
  binary that does this — by design, so the user can see exactly what's
  about to change.
- For project-local installs, the `./.caipe/installed.json` file should
  be gitignored unless the team explicitly wants to share installed-skill
  history. Add `.caipe/` to `.gitignore` if it's not already there.
- The catalog API is rate-limited; one fetch per `/{{COMMAND_NAME}}`
  invocation is plenty.
- If the gateway is unreachable: report "Catalog unreachable — refresh
  is a network operation. Try again when online." and stop. Don't try
  to refresh from cache.
