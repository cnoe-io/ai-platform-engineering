# Release Notes — ai-platform-engineering 0.4.8

> Released: 2026-05-06
> Chart: `oci://ghcr.io/cnoe-io/charts/ai-platform-engineering:0.4.8`
> Previous release: [0.4.7](release-0.4.7.md)

## Highlights

0.4.8 introduces a new AWS MCP server, configurable call-limit middlewares for the supervisor, and Kubernetes Pod Security Standards Baseline compliance across all Helm charts. A tracing fix resolves silent OTLP batch drops to Langfuse caused by oversized spans, and several long-standing compatibility and correctness bugs are resolved.

## What's New

### AWS MCP Server
- **`mcp-aws` agent** — new FastMCP server exposing `aws_cli_execute` and `eks_kubectl_execute` as MCP tools over HTTP/SSE; supports opt-in `INSTALL_AWS_CLI=true` / `INSTALL_KUBECTL=true` Docker build args; automatically built as `ghcr.io/cnoe-io/mcp-aws` ([#1324](https://github.com/cnoe-io/ai-platform-engineering/pull/1324))

### Supervisor Call-Limit Middlewares
- **`ToolCallLimitMiddleware`** — caps total tool invocations per run via `TOOL_CALL_LIMIT` env var; prevents agents from hammering external tools in a loop
- **`ModelCallLimitMiddleware`** — caps total LLM inference calls per run via `MODEL_CALL_LIMIT` env var; prevents infinite reasoning loops
- **`SummarizationMiddleware`** (opt-in) — compresses conversation history when approaching token/message thresholds; uses the same model as the supervisor
- All limits individually toggleable and configurable via env vars / Helm configmap ([#1319](https://github.com/cnoe-io/ai-platform-engineering/pull/1319))

### Kubernetes Pod Security Standards
- **PSS Baseline compliance** — all Helm chart subcharts now set default `securityContext` satisfying the PSS Baseline profile; Restricted profile requirements met except `readOnlyRootFilesystem` (left `false` for agents that write to the filesystem at runtime) ([#1337](https://github.com/cnoe-io/ai-platform-engineering/pull/1337))

### Skills Gateway
- **Admin scan override** — force-trigger a skills scan from the admin UI without waiting for the scheduled interval
- **Hub-crawl pagination and caps** — GitLab tree API now paginated up to `max_tree_pages`; GitHub `truncated: true` flag detected; both providers surface truncation status in the UI
- **Live crawl console** — real-time crawl output visible in the admin UI ([#1338](https://github.com/cnoe-io/ai-platform-engineering/pull/1338))

## Bug Fixes

- **tracing**: surgical content scrubbing in a new `SkillScrubberSpanProcessor` removes skill/workflow content from OTLP spans before export; hard cap on span attribute size prevents 413 drops to Langfuse ([#1330](https://github.com/cnoe-io/ai-platform-engineering/pull/1330))
- **mcp**: remove trailing slash from default HTTP MCP path — FastMCP issues a 307 redirect for `/mcp/`; streamable-http clients do not follow redirects, causing tool-load failures on startup ([#1339](https://github.com/cnoe-io/ai-platform-engineering/pull/1339))
- **ui**: suppress synthetic `"Task <status> (ID: ...)"` filler messages in chat — these placeholders from A2A `Task` events with no artifacts were showing as actual agent output ([#1275](https://github.com/cnoe-io/ai-platform-engineering/pull/1275))
- **slack-bot**: use correct Slack mention syntax for subteam/usergroup IDs (`<!subteam^{id}>`) vs individual users (`<@{id}>`) in escalation messages ([#1341](https://github.com/cnoe-io/ai-platform-engineering/pull/1341))
- **setup**: replace bash 4+ case conversion (`${var,,}`) with POSIX-compatible `tr` — fixes silent failures on macOS bash 3.2 for back-navigation and "all" agent selection ([#1340](https://github.com/cnoe-io/ai-platform-engineering/pull/1340))

## Breaking Changes

No breaking changes. Drop-in upgrade from 0.4.7.

## Known Issues

None known at this time.

## Upgrade

```bash
helm upgrade ai-platform-engineering \
  oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \
  --version 0.4.8 \
  -f your-values.yaml
```

Full upgrade instructions: [Migration Guide: 0.4.7 → 0.4.8](migration-0.4.7-to-0.4.8.md)
