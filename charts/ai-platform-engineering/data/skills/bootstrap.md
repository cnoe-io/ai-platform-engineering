---
description: {{DESCRIPTION}}
---

## User Input

```text
$ARGUMENTS
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

Parse `$ARGUMENTS` to determine the mode:

| Pattern | Mode | Example |
|---------|------|---------|
| (empty) | **Browse** — list all skills | `/{{COMMAND_NAME}}` |
| `<query>` | **Search** — find matching skills | `/{{COMMAND_NAME}} pipeline` |
| `run <name>` | **Run** — fetch & execute inline | `/{{COMMAND_NAME}} run create-ci-pipeline` |
| `install <name>` | **Install** — save locally | `/{{COMMAND_NAME}} install create-ci-pipeline` |
| `update` | **Update** — refresh all locally installed skills | `/{{COMMAND_NAME}} update` |

## API Helper

Use this python3 snippet for ALL API calls. Replace `QUERY` with the search
term (empty string to list all) and set `INCLUDE_CONTENT` to `true` when you
need the full skill markdown:

```bash
python3 -c "
import json, urllib.request, urllib.parse, os, sys
cfg = {}
for p in [os.path.expanduser('~/.config/caipe/config.json'), os.path.expanduser('~/.config/grid/config.json')]:
    if os.path.isfile(p):
        cfg = json.load(open(p)); break
key = cfg.get('api_key', os.environ.get('CAIPE_CATALOG_KEY', ''))
base = cfg.get('base_url', os.environ.get('CAIPE_BASE_URL', '{{BASE_URL}}'))
if not key:
    print(json.dumps({'error': 'No API key. Create ~/.config/caipe/config.json with {\"api_key\": \"<key>\"}'}))
    sys.exit(0)
q = ' '.join(sys.argv[1:])
include = os.environ.get('INCLUDE_CONTENT', '')
params = {'source': 'github', 'q': q, 'page': '1', 'page_size': '50'}
if include:
    params['include_content'] = 'true'
qs = urllib.parse.urlencode(params)
req = urllib.request.Request(f'{base}/api/skills?{qs}', headers={'X-Caipe-Catalog-Key': key})
resp = urllib.request.urlopen(req, timeout=15)
print(resp.read().decode())
" QUERY
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

1. Call the API helper with `QUERY` set to the exact skill name and `INCLUDE_CONTENT=true`:
   ```bash
   INCLUDE_CONTENT=true python3 -c "..." SKILL_NAME
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
