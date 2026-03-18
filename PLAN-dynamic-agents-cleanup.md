# Dynamic Agents Cleanup Plan

Goal: Simplify the Dynamic Agents codebase, remove unused code, and reduce misdirections for newcomers.

## 1. Remove `prompts/` Folder

**Status:** DONE

Changes made:
- Deleted `prompts/` folder entirely (`__init__.py`, `extension.py`)
- Removed `default_extension_prompt_path` setting from `config.py`
- Simplified `_build_system_prompt()` to just return `config.system_prompt`
- Simplified `_build_subagent_prompt()` to just return `subagent_config.system_prompt`
- Updated ARCHITECTURE.md and README.md to remove prompts/ references

The extension prompt feature was removed entirely because:
- It added complexity with unclear value
- Changes to extension prompt wouldn't affect existing conversations (checkpoints)
- The agent's `system_prompt` field is the single source of truth

---

## 2. Dead Code Removal

**Status:** Pending

### Backend - Unused Classes/Methods

| File | Lines | Item | Reason |
|------|-------|------|--------|
| `models.py` | 318-322 | `ChatEvent` class | Defined but never used anywhere |
| `mongo.py` | 231-237 | `can_user_modify_agent()` | Never called, access control done inline |
| `stream_trackers.py` | 80-83 | `ToolTracker.get_tool_name()` | Never called |
| `stream_trackers.py` | 85-87 | `ToolTracker.is_builtin()` | Never called, check done inline in `stream_events.py` |
| `stream_trackers.py` | 193-221 | `TodoTracker.process_tool_result()` | Never called |
| `stream_trackers.py` | 223-225 | `TodoTracker.get_current_todos()` | Never called |
| `config.py` | 57 | `default_model_id` setting | Never used |

### Backend - Local Artifacts to Delete

| File | Reason |
|------|--------|
| `src/dynamic_agents/models_config.yaml` | Untracked local dev artifact, models come from `config.yaml` |

### UI - Unused Imports

| File | Line | Item |
|------|------|------|
| `available-subagents/route.ts` | 14 | `SubAgentRef` imported but never used |

---

## 3. Access Control Consolidation

**Status:** Pending (consider for later)

**Problem:** 4 different access control functions doing similar visibility checks:

| File | Function | Lines |
|------|----------|-------|
| `routes/chat.py` | `_can_use_agent()` | 38-61 |
| `routes/agents.py` | `_can_view_agent()` | 332-350 |
| `routes/conversations.py` | `_can_access_conversation()` | 52-72 |
| `services/mongo.py` | `can_user_modify_agent()` | 231-237 (unused) |

**Recommendation:** Consolidate into a single `access_control.py` module with:
- `can_view_agent(agent, user)` - visibility check
- `can_use_agent(agent, user)` - visibility + enabled check
- `can_modify_agent(agent, user)` - ownership/admin check
- `can_access_conversation(conversation, user)` - ownership/sharing check

---

## 4. SSE Generator Consolidation

**Status:** Pending (consider for later)

**Problem:** `_generate_sse_events()` and `_generate_resume_sse_events()` in `chat.py` are ~80% identical.

**Location:** `routes/chat.py` lines 64-151 and 219-270

**Recommendation:** Extract common logic into a shared helper function.

---

## 5. Consistency Fixes

**Status:** Pending (low priority)

### Mixed Typing Styles
| File | Issue |
|------|-------|
| `middleware/auth.py` | Uses `Optional[T]` while rest of codebase uses `T \| None` |

### Inconsistent Config Access (UI)
| File | Issue |
|------|-------|
| `ui/src/app/api/dynamic-agents/route.ts` | Uses `process.env.DYNAMIC_AGENTS_URL` directly instead of `getServerConfig()` |

---

## 6. Large File Consideration

**Status:** Pending (consider for later)

`agent_runtime.py` is 1034 lines - the largest file in the service.

**Potential splits:**
- Extract stream handling into `stream_handler.py`
- Extract subagent/tool building into `agent_builder.py`

**Decision:** Leave for now - the file is cohesive around the `AgentRuntime` class. Splitting may introduce unnecessary indirection.

---

## Priority Order

1. **Remove `prompts/` folder** - simplifies structure, one less folder
2. **Dead code removal** - low risk, immediate cleanup
3. **Access control consolidation** - medium effort, reduces duplication
4. **SSE generator consolidation** - medium effort, reduces duplication
5. **Consistency fixes** - low priority, cosmetic
6. **Large file splitting** - defer unless needed

---

## Notes

- Breaking backward compatibility is acceptable
- `config.yaml` is the single source of truth for configuration
- Simplicity over flexibility - remove unused features rather than maintaining them
