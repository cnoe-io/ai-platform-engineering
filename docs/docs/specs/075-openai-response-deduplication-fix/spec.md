---
sidebar_position: 2
sidebar_label: Specification
title: "2026-02-28: OpenAI Response Deduplication — Investigation & Fix"
---

# OpenAI Response Deduplication — Investigation & Fix

## Motivation

When using OpenAI models (`gpt-4o`, `gpt-5-mini`, `gpt-5.2`) through CAIPE,
the chat UI shows human-readable text **followed by a raw JSON blob** and then
the same text repeated. See [architecture.md](./architecture.md) for the duplicated output example.

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


## Testing Strategy

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


## Related

- Architecture: [architecture.md](./architecture.md)
