---
description: {{DESCRIPTION}}
---

## User Input

```text
{{ARG_REF}}
```

You **MUST** consider the user input before proceeding (if not empty).

## Outline

Browse the CAIPE skill catalog and **execute skills inline from the live
gateway**, without writing them to disk. This is the "live escape hatch":
useful for one-off experiments, trying skills you haven't installed yet,
or running a guaranteed-fresh version of a skill that's also installed
locally.

For routine use, prefer the locally-installed copies (just type
`/<skill-name>`), and run `/update-skills` when you want to pull catalog
changes onto disk.

## SECURITY — never expose the API key

- **NEVER** print, echo, or display the API key value in any output, log, or message.
- **NEVER** include the key literally in any bash command shown to the user.
- All API calls MUST go through the `caipe-skills.py` helper below which keeps the key internal.

## Modes

Parse `{{ARG_REF}}` to determine the mode:

| Pattern | Mode | Example |
|---------|------|---------|
| (empty) | **Browse** — list all skills | `/{{COMMAND_NAME}}` |
| `<query>` | **Search** — find matching skills | `/{{COMMAND_NAME}} pipeline` |
| `run <name>` | **Run** — fetch & execute inline | `/{{COMMAND_NAME}} run create-ci-pipeline` |

To install or refresh on-disk copies, use the dedicated `/update-skills`
slash command instead of doing it inline here.

## API Helper

All API calls go through a small Python helper that the gateway hosts.
The helper keeps the API key out of shell history, reads config from
`~/.config/caipe/config.json`, and is identical for every agent. It uses
`uv run` with PEP 723 inline script metadata so dependencies are managed
automatically — no separate `pip install` step required.

**Reduce approval prompts (optional):** add the helper to your Claude Code
sandbox allowlist so it runs without a confirmation dialog each time:

```json
{ "allowedTools": ["Bash(uv run ~/.config/caipe/caipe-skills.py*)"] }
```

### One-time setup (first run only)

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
# preferred (uv manages deps automatically)
uv run ~/.config/caipe/caipe-skills.py QUERY
INCLUDE_CONTENT=true uv run ~/.config/caipe/caipe-skills.py SKILL_NAME

# fallback if uv is not installed
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

### Fallback — if caipe-skills.py is unavailable

If the helper download fails or the file is missing, call the API directly.
The required auth header is **`X-Caipe-Catalog-Key`**:

```bash
curl -fsSL "{{BASE_URL}}/api/skills?source=github&q=QUERY" \
  -H "X-Caipe-Catalog-Key: $(python3 -c "import json,os; cfg=json.load(open(os.path.expanduser('~/.config/caipe/config.json'))); print(cfg['api_key'])")"
```

Or set `INCLUDE_CONTENT=true` as a query param for full skill body:

```bash
curl -fsSL "{{BASE_URL}}/api/skills?source=github&q=SKILL_NAME&include_content=true" \
  -H "X-Caipe-Catalog-Key: <your-api-key>"
```

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
   INCLUDE_CONTENT=true uv run ~/.config/caipe/caipe-skills.py SKILL_NAME
   ```
2. Parse the JSON response. Extract the `content` field from the first matching skill.
3. If no match: report the error and suggest `/{{COMMAND_NAME}}` to browse.
4. **Execute the skill inline**: Treat the fetched `content` as if it were a slash command
   prompt. Follow its instructions in the current conversation — do NOT save it to disk.
   The content is the full skill markdown (with frontmatter, steps, etc.).
5. Confirm at the start: "Running skill `<name>` (fetched live from gateway)..."

## Notes

- API path: `/api/skills` — no `/v1/` prefix
- `source=github` for GitHub hub skills, `source=gitlab` for GitLab, `source=default` for built-in
- `repo=owner/repo` to filter by a specific hub repository
- To browse all: `/{{COMMAND_NAME}}` — to search: `/{{COMMAND_NAME}} <query>`
- To run live: `/{{COMMAND_NAME}} run <name>`
- To install or refresh on-disk copies: use `/update-skills` (separate slash command).
