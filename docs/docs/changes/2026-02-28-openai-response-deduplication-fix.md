# OpenAI Response Deduplication — Investigation & Fix

## Problem

When using OpenAI models (`gpt-4o`, `gpt-5-mini`, `gpt-5.2`) through CAIPE,
the chat UI shows human-readable text **followed by a raw JSON blob** and then
the same text repeated:

```
## Current weather — Allen, Texas, US
| Temperature | 77.1 °F |
...
{"status":"completed","message":"## Current weather — Allen, Texas, US\n..."}
## Current weather — Allen, Texas, US
...
```

Anthropic Claude and AWS Bedrock do **not** exhibit this behavior.

---

## Root Cause

OpenAI's `PlatformEngineerResponse` structured output is streamed as
**plain `message.content` text**, not as a tool call. The upstream
`agent.py` in its post-stream parsing (PRIORITY 2 and 3 paths) calls
`handle_structured_response()` but does **not** set
`from_response_format_tool = True` on the resulting `final_response` dict.

This causes `agent_executor.py` to take the wrong code path
(`from_response_format_tool=False`), falling back to `_get_final_content()`
which joins all of `supervisor_content` — a mix of clean text and raw
`PlatformEngineerResponse` JSON — producing duplicated output.

### Why Bedrock/Claude are unaffected

Bedrock and Claude emit structured responses as tool calls, which are handled
in the PRIORITY 1 path where `from_response_format_tool` is already
correctly set to `True`. They never enter the PRIORITY 2/3 paths.

### Key code locations

| File | Path | What |
|------|------|------|
| `agent.py` | `multi_agents/platform_engineer/protocol_bindings/a2a/agent.py` | Streaming orchestration; PRIORITY 1/2/3 post-stream parsing |
| `agent_executor.py` | `multi_agents/platform_engineer/protocol_bindings/a2a/agent_executor.py` | Final content assembly; uses `from_response_format_tool` flag |
| `response_format.py` | `multi_agents/platform_engineer/response_format.py` | `PlatformEngineerResponse` Pydantic model |
| `deep_agent.py` | `multi_agents/platform_engineer/deep_agent.py` | `USE_STRUCTURED_RESPONSE` env var |

---

## Fix Applied

**Location**: `agent.py`, `stream()` method — PRIORITY 2 and PRIORITY 3 paths.

**Change**: After `handle_structured_response()` successfully parses a
`PlatformEngineerResponse` (indicated by `is_task_complete` being non-None),
set `from_response_format_tool = True`:

```python
# PRIORITY 2 — using final AIMessage content
final_response = self.handle_structured_response(final_content)
if final_response.get('is_task_complete') is not None:
    final_response['from_response_format_tool'] = True

# PRIORITY 3 — using accumulated AI content (same fix)
final_response = self.handle_structured_response(accumulated_text)
if final_response.get('is_task_complete') is not None:
    final_response['from_response_format_tool'] = True
```

This directs `agent_executor.py` to use the clean parsed `.message` content
from the structured response instead of the raw `supervisor_content`
accumulation.

### Deployment method

The fix is deployed via a Kubernetes ConfigMap (`agent-fix`) that replaces
`agent.py` inside the supervisor pod:

```
ConfigMap: agent-fix  (from scripts/agent_fix.py)
Mount:     /app/ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent.py
Scope:     caipe-supervisor-agent deployment only
```

This is managed by `setup-caipe.sh` → `post_deploy_patches()` →
`_create_agent_fix_configmap()` + `_apply_agent_fix_volume()`.

### Backward compatibility

- **Bedrock**: Unaffected — uses PRIORITY 1 (tool-call) path; the fix code
  is never reached.
- **Claude**: Unaffected — same reason as Bedrock.
- **OpenAI**: Fixed — PRIORITY 2/3 paths now correctly set the flag.

---

## Test Results

### Models tested

| Model | Prompt | Result |
|-------|--------|--------|
| `gpt-4o` | "Weather in Allen, Texas" | Clean output, no JSON blobs |
| `gpt-4o` | "run network diagnostics on google.com" | Clean output, no duplication |
| `gpt-5-mini` | "Weather in Allen, Texas" | Clean output, no JSON blobs |
| `gpt-5-mini` | "run network diagnostics on google.com" | Clean output, no duplication |
| `gpt-5.2` | "Weather in Allen, Texas" | Clean output, no JSON blobs |
| `gpt-5.2` | "run network diagnostics on google.com" | Clean output, no duplication |

### Verification method

```bash
curl -s -X POST http://localhost:8000/ \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"t","method":"message/send",
       "params":{"message":{"role":"user",
         "parts":[{"kind":"text","text":"Weather in Allen TX"}],
         "messageId":"t1"}}}' | python3 -c "
import sys, json
r = json.load(sys.stdin)
final = [a for a in r['result']['artifacts'] if a['name']=='final_result'][0]
text = ''.join(p['text'] for p in final['parts'] if p['kind']=='text')
has_json = '{\"status\"' in text
print('HAS RAW JSON:', has_json)
print(text[:500])
"
```

Expected: `HAS RAW JSON: False`

---

## Approaches Considered and Rejected

### 1. Stripping JSON in `_get_final_content` (Option A)

Regex-based stripping of `PlatformEngineerResponse` JSON blobs from the
joined `supervisor_content`. Rejected as fragile "monkey patching" — it
treats symptoms rather than the root cause.

### 2. Filtering in `_handle_streaming_chunk` (Option B)

Skipping JSON blobs before appending to `supervisor_content`. Rejected for
the same reason — operates on symptoms and is hard to maintain.

### 3. `USE_STRUCTURED_RESPONSE=false` (Option C)

Disables structured output entirely. Rejected as it changes response quality
and removes a feature rather than fixing the integration.

### 4. Patching `_handle_task_complete` via `sitecustomize.py` (Fix 3)

The original `sitecustomize.py` approach patched `_handle_task_complete` to
extract `.message` when `from_response_format_tool=True`. This failed because
`from_response_format_tool` was never `True` for OpenAI — the exact root
cause this investigation identified.

---

## Current Patch State

| Patch | ConfigMap | Scope | Status |
|-------|-----------|-------|--------|
| Schema fix (`additionalProperties:false`) | `agent-patches` | All agents | Working |
| httpx redirect (`follow_redirects=True`) | `agent-patches` | All agents | Working |
| OpenAI response dedup (`from_response_format_tool=True`) | `agent-fix` | Supervisor | Working |

---

## File References

| File | Description |
|------|-------------|
| `scripts/agent_fix.py` | Patched `agent.py` with the two-line fix |
| `scripts/agent_executor_fix.py` | Original `agent_executor.py` (unmodified, for reference) |
| `scripts/setup-caipe.sh` | Deployment script managing ConfigMaps and patches |
| Upstream repo | <https://github.com/cnoe-io/ai-platform-engineering> |
