# caipe-cli feature enhancements

## Overview

Incremental CLI improvements for terminal chat: richer prompts, session management, diagnostics, optional local model mode, and tighter Grid integration—without changing the default remote dynamic-agent architecture.

## Enhancements

| Phase | Features |
|-------|----------|
| **P1 — Chat UX** | `@file` / `@glob:` attachments, LLM `/compact`, tool visibility + `chat.tool-approval`, `chat.plain-markdown`, default agent config |
| **P1 — Ops** | `caipe init`, `caipe doctor`, `caipe sessions list\|resume` |
| **P2 — Platform** | `caipe mcp list\|connect`, `/delegate`, `caipe diff` |
| **P3 — Local** | `caipe local` (Anthropic/LiteLLM env) with read/write/bash tools |

## Acceptance criteria

- [x] `@path` and `@glob:pattern` expand into the user message before send
- [x] `/compact` summarizes history via one agent turn (not slice-only)
- [x] `caipe sessions list|resume <id>`
- [x] `caipe init` creates project memory template
- [x] `caipe doctor` checks auth, agents, BFF health
- [x] `chat.plain-markdown`, `chat.default-agent`, `chat.tool-approval` config keys
- [x] `caipe mcp list` and `caipe mcp connect <provider>`
- [x] `/delegate <agent> <message>` switches agent for one turn
- [x] `caipe diff` shows git diff summary in repo
- [x] `caipe local` runs local model + read/write/bash tools when env configured

## Non-goals

- Replacing CAIPE dynamic agents with an embedded LangGraph runtime in the CLI
- Matching or naming a specific third-party terminal coding product
