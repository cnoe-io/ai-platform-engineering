# ADR: Webex Bot Integration Architecture

**Date**: 2026-03-18
**Status**: Accepted
**Category**: Integration

## Problem Statement

CAIPE needs a Webex bot integration to serve users on the Webex platform, providing the same capabilities as the existing Slack bot (A2A streaming, HITL forms, feedback collection).

## Alternatives Considered

| Alternative | Pros | Cons |
|-------------|------|------|
| **A. Shared integration layer (extract common code)** | DRY; single maintenance point | Modifies stable Slack bot; risk of regression; Rule of Three not met (only 2 integrations) |
| **B. Copy modules into Webex bot (selected)** | Zero risk to Slack bot; independent development; fast iteration | Code duplication (~1200 LoC) |
| **C. webex_bot library** | Quick start | Sporadically maintained; limited control over WebSocket lifecycle |
| **D. Webhook-based** | Standard pattern | Requires public endpoint; doesn't fit containerized deployment model |

## Solution

**Selected: Alternative B** — Copy platform-agnostic modules into the Webex bot codebase with Webex-specific adaptations.

### Key Decisions

1. **WebSocket via WDM** (not webhooks): Uses the jarvis-agent pattern for WebSocket connection via Cisco WDM device registration. No public endpoints needed.

2. **Hybrid streaming** (not real-time edits): Webex has no native streaming API. Uses "Working..." → periodic updates → final message approach.

3. **Copy, don't extract** (deferred commonization): The Slack bot is not modified. Shared modules (A2A client, event parser, session manager, OAuth2 client) are copied with minimal adaptations. Commonization deferred until a third integration triggers the Rule of Three.

4. **Space authorization via OIDC**: Reuses the existing CAIPE UI OIDC authentication for space authorization rather than implementing a separate Webex OAuth integration.

5. **In-memory device cache** (no pickle): Unlike jarvis-agent, device registration data is cached in-memory only, avoiding unsafe deserialization.

### Components Changed

- `ai_platform_engineering/integrations/webex_bot/` — New integration (19 source files)
- `ui/src/app/api/admin/integrations/webex/` — New API routes (3 files)
- `ui/src/types/mongodb.ts` — Added AuthorizedWebexSpace type
- `ui/src/lib/mongodb.ts` — Added authorized_webex_spaces collection
- `build/Dockerfile.webex-bot` — New Dockerfile
- `docker-compose.yaml` / `docker-compose.dev.yaml` — Added webex-bot service
- `charts/ai-platform-engineering/charts/webex-bot/` — New Helm subchart

### Trade-offs

- **Code duplication accepted**: ~1200 lines of duplicated code between Slack and Webex bots. This is an explicit trade-off for zero-risk deployment alongside the stable Slack bot.
- **Future commonization**: When a third integration is added (e.g., Microsoft Teams), the shared modules should be extracted into `integrations/common/`.
