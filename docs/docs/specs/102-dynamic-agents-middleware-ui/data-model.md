# Data Model: Extended Middleware Registry

## Existing entities (unchanged)

**MiddlewareSpec** (Python dataclass, in-memory registry):
- `cls`: type — the middleware class
- `default_params`: dict[str, Any] — default param values
- `enabled_by_default`: bool
- `allow_multiple`: bool
- `label`: str — display name for UI
- `description`: str — tooltip text for UI
- `model_params`: bool — whether to render model selector in UI
- `param_schema`: dict[str, str] — maps param key → UI type hint

**MiddlewareEntry** (Pydantic, stored in MongoDB):
- `type`: str — registry key
- `enabled`: bool
- `params`: dict[str, Any] — flat key-value params

## New registry entries

| Key | label | allow_multiple | model_params | params |
|-----|-------|----------------|--------------|--------|
| `summarization` | Conversation Summarization | False | True | trigger_tokens, trigger_messages, keep_messages |
| `human_in_the_loop` | Human-in-the-Loop | False | False | tool_names, description_prefix |
| `shell_tool` | Shell Tool | False | False | workspace_root, tool_name |
| `filesystem_search` | Filesystem File Search | False | False | root_path, use_ripgrep, max_file_size_mb |

## Param type mapping

| Middleware | Param | Python type | param_schema | Default |
|------------|-------|-------------|--------------|---------|
| summarization | trigger_tokens | int | "number" | 4000 |
| summarization | trigger_messages | int | "number" | 50 |
| summarization | keep_messages | int | "number" | 20 |
| human_in_the_loop | tool_names | str | "string" | "" |
| human_in_the_loop | description_prefix | str | "string" | "Tool execution requires approval" |
| shell_tool | workspace_root | str | "string" | "" |
| shell_tool | tool_name | str | "string" | "shell" |
| filesystem_search | root_path | str | "string" | "" |
| filesystem_search | use_ripgrep | bool | "boolean" | True |
| filesystem_search | max_file_size_mb | int | "number" | 10 |

## No schema migration needed

`MiddlewareEntry.params` is `dict[str, Any]` in MongoDB — no collection schema changes. New middleware types are additive; existing agents are unaffected.
