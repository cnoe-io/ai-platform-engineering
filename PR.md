# Title

feat(dynamic-agents): skills integration, subagent fixes, and agent editor UX

# Description

Integrates user-created skills from the `agent_skills` MongoDB collection into dynamic agents, fixes several subagent bugs, and delivers a round of backend refactoring and UI polish for the agent editor.

## Skills Integration (headline)

Dynamic agents can now leverage skills authored in the Skills Builder. During agent creation, users select skills from the `agent_skills` collection; at runtime the backend loads them, converts their content to SKILL.md files, and injects them into the agent's system context.

### Backend
- **`services/skills.py`** (new) — `load_skills()` queries MongoDB by both `id` and `_id`, with a three-step content fallback (`skill_content → skill_template → tasks[0].llm_prompt`) to handle all authoring modes. `build_skills_files()` and helpers are inlined to avoid an `ai_platform_engineering` import dependency.
- **`services/agent_runtime.py`** — Calls `load_skills()` at init, tracks `_failed_skills` and emits a warning event to the client when any skill fails to load (mirrors the MCP server pattern).
- **`skills_middleware/loaders/agent_skill.py`** — Added `tasks.0.llm_prompt` to the MongoDB projection and the same three-step content fallback.

### UI — SkillsSelector
- New step in the agent editor wizard (before subagents) with split selected/available lists, inline search, multi-tag filters, two-line rows (name + badges / description), and a "Clear all" link.
- Skill count is a UI-only guardrail: orange warning at >100, blocked at >500.

## Subagent Fixes (from earlier commits)

- **MCP tool mounting** — Route layer now fetches MCP server configs for subagents too (`get_agent_mcp_servers()` on MongoDBService), so subagents no longer silently get zero MCP tools.
- **Avatar/gradient rendering** — AG-UI adapter re-emits `onToolStart` with parsed args from `TOOL_CALL_ARGS`, letting the timeline manager resolve subagent identity during streaming.
- **Context sidebar** — Subagent MCP servers now appear in the sidebar.

## Agent Config Refactors

- **ID prefixes** — New entities get prefixed IDs (`agent-`, `mcp-`, `skill-`); existing documents are unaffected.
- **Model object** — `model_id`/`model_provider` nested into `model: {id, provider}` with a Pydantic `model_validator` for backward compat.
- **Runtime split** — `agent_runtime.py` (1224 lines) split into `agent_runtime.py`, `streaming.py`, `runtime_cache.py`, and `skills.py`.
- **Encoder rename** — `encoders/` → `stream_encoders/`, absorbed `langgraph_stream_helpers.py`.

## UI Polish

- Agent editor UX improvements (overflow fix, tool args progressive streaming, compact built-in tools picker)

## Type of Change

- [x] Bugfix
- [x] New Feature
- [ ] Breaking Change
- [x] Refactor
- [ ] Documentation
- [ ] Other (please describe)

## Checklist

- [x] I have read the [contributing guidelines](CONTRIBUTING.md)
- [x] I have verified this change is not present in other open pull requests
- [x] All code style checks pass
- [x] All new and existing tests pass

> **Note:** This PR was developed with assistance from an AI coding agent (Claude).
