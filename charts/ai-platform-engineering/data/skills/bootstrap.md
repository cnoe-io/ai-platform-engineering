---
description: {{DESCRIPTION}}
---

## User Input

```text
{{ARG_REF}}
```

You **MUST** consider the user input before proceeding (if not empty).

## Outline

Browse the CAIPE skill catalog, fetch skills on demand from the gateway,
and execute them inline — no local copy required. Skills are always fresh.

## SECURITY — never expose the API key

- **NEVER** print, echo, or display the API key value in any output, log, or message.
- **NEVER** include the key literally in any bash command shown to the user.
- All API calls MUST go through the python3 helper below which keeps the key internal.

## Modes

Parse `{{ARG_REF}}` to determine the mode:

| Pattern | Mode | Example |
|---------|------|---------|
| (empty) | **Browse** — list all skills | `/{{COMMAND_NAME}}` |
| `<query>` | **Search** — find matching skills | `/{{COMMAND_NAME}} pipeline` |
| `run <name>` | **Run** — fetch & execute inline | `/{{COMMAND_NAME}} run create-ci-pipeline` |
| `install <name>` | **Install** — save locally | `/{{COMMAND_NAME}} install create-ci-pipeline` |
| `update` | **Update** — refresh all locally installed skills | `/{{COMMAND_NAME}} update` |

## API Helper

All API calls go through a small stdlib-only Python helper that the
gateway hosts. The helper keeps the API key out of shell history, reads
config from `~/.config/caipe/config.json`, and is identical for every
agent.

### One-time bootstrap (first run only)

If `~/.config/caipe/caipe-skills.py` does not exist, fetch it once:

```bash
mkdir -p ~/.config/caipe
curl -fsSL "{{BASE_URL}}/api/skills/helpers/caipe-skills.py" \
  -o ~/.config/caipe/caipe-skills.py
```

To upgrade later, re-run the same `curl` — the file is small and always
served fresh (`Cache-Control: no-store`).

### Calling the helper

Replace `QUERY` with the search term (omit to list all skills). Set
`INCLUDE_CONTENT=true` when you need the full skill markdown:

```bash
python3 ~/.config/caipe/caipe-skills.py QUERY
INCLUDE_CONTENT=true python3 ~/.config/caipe/caipe-skills.py SKILL_NAME
```

Useful flags (all optional):

| Flag | Purpose |
|------|---------|
| `--source github` | Catalog source (default `github`; also `gitlab`, `default`). |
| `--repo owner/name` | Restrict to a specific hub repository. |
| `--page N --page-size 50` | Pagination (page-size 1-100). |
| `--include-content` | Same as `INCLUDE_CONTENT=true`. |
| `--api-key …` / `--base-url …` | Override config (rarely needed). |

The helper prints the catalog JSON to stdout on success, or a JSON
`{"error": "..."}` envelope on client-side errors (no key, bad config).
On HTTP / network errors it writes a short message to stderr and exits 1.

## Steps — Browse / Search mode

1. Call the API helper with `QUERY` set to the user's search (or empty for all).
2. Parse the JSON response and display results as a table:

   | # | Name | Description |
   |---|------|-------------|
   | 1 | skill-name | Short description |

3. If no results: report "No skills found for `<query>`" and suggest broadening.
4. Ask the user what they'd like to do: **run** a skill (fetch & execute) or **install** it locally.

## Steps — Run mode (fetch-on-invoke)

This is the **primary** mode. Skills are fetched live and executed without saving to disk.

1. Call the API helper with the exact skill name and `INCLUDE_CONTENT=true`:
   ```bash
   INCLUDE_CONTENT=true python3 ~/.config/caipe/caipe-skills.py SKILL_NAME
   ```
2. Parse the JSON response. Extract the `content` field from the first matching skill.
3. If no match: report the error and suggest `/{{COMMAND_NAME}}` to browse.
4. **Execute the skill inline**: Treat the fetched `content` as if it were a slash command
   prompt. Follow its instructions in the current conversation — do NOT save it to disk.
   The content is the full skill markdown (with frontmatter, steps, etc.).
5. Confirm at the start: "Running skill `<name>` (fetched live from gateway)..."

## Steps — Install mode (save locally)

Use when the user explicitly wants a local copy (e.g., for offline use).

1. Call the API helper with `INCLUDE_CONTENT=true` and `QUERY` set to the skill name.
2. Extract the `content` field from the matching skill.
3. Save to the appropriate command directory for this project (e.g.
   `.claude/commands/<skill-name>.md`, `.cursor/commands/<skill-name>.md`,
   or `.specify/templates/commands/<skill-name>.md` if those directories exist).
4. Confirm: "Skill `<name>` installed."

## Steps — Update mode (refresh installed skills)

1. List all `.md` files in the local commands directory that are NOT `{{COMMAND_NAME}}.md` or `speckit.*.md`.
2. For each file, extract the skill name from the filename (strip `.md`).
3. Fetch each from the API with `INCLUDE_CONTENT=true`.
4. Overwrite the local file with the fetched content.
5. Report what was updated.

## Notes

- API path: `/api/skills` — no `/v1/` prefix
- `source=github` for GitHub hub skills, `source=gitlab` for GitLab, `source=default` for built-in
- `repo=owner/repo` to filter by a specific hub repository
- To browse all: `/{{COMMAND_NAME}}` — to search: `/{{COMMAND_NAME}} <query>`
- To run live: `/{{COMMAND_NAME}} run <name>` — to install locally: `/{{COMMAND_NAME}} install <name>`
