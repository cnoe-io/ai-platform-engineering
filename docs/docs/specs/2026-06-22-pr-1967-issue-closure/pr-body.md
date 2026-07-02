## Summary

* **Credentials & secrets**: Enriches secret metadata with usage references, storage/encryption details, and creator attribution; adds `SecretProtectionDetails` UI; removes standalone audit panel in favor of inline protection context; extends BFF routes and `secret-service` for usage lookup and masked previews.
* **MCP + AgentGateway**: Fronts all enabled HTTP/SSE MCP servers through AgentGateway (config bridge, mcp-targets BFF, endpoint normalization); adds endpoint probe and test-tool APIs; per-row OpenFGA permissions on the MCP Servers tab; full edit path for AgentGateway-managed rows (supersedes #1960); rewrites `Authorization` credential headers to `X-CAIPE-Provider-Token`.
* **Agents & workflows**: Tightens dynamic-agent team grants (use vs manage); reconciles platform MCP/agent OpenFGA tuples on startup; delegates workflow BFF calls to the invoking user's bearer for Webex/Slack agents.
* **Agent context HMAC (G1/G2, #1920/#1928)**: Wires `CAIPE_AGENT_CONTEXT_HMAC_SECRET` through Helm for **dynamic-agents** and **openfga-authz-bridge** (`agentContext.existingSecret`), documents it in `.env.example`, patches it in `setup-caipe.sh` → `caipe-ui-secret`, and logs a startup warning when AgentGateway is on without the secret. See [Agent context HMAC](../../security/rbac/agent-context-hmac.md).
* **Platform wiring**: Updates dynamic-agents MCP client token forwarding, dev compose (OpenFGA reconcile default, workflow OAuth2), Webex WDM reconnect hardening, and RBAC E2E specs.

## Commits (incremental)

1. `feat(credentials): integrate secrets UX with AgentGateway MCP routing` — base PR commit
2. `feat(mcp): add AgentGateway upstream resolver and credential helpers`
3. `feat(agentgateway): propagate MCP credential headers through bridge`
4. `feat(mcp): add list permissions and gate MCP server actions in UI`
5. `feat(agents): scope ownership checks and tighten team member grants`
6. `feat(rbac): reconcile platform MCP and agent OpenFGA tuples on startup`
7. `feat(workflows): delegate workflow BFF calls to invoking user bearer`
8. `fix(rbac): allow team workflow owners to run without team membership`
9. `fix(ui): flip popovers when viewport space is limited`
10. `feat(credentials): harden secret dialog and add workspace regression e2e`
11. `test(e2e): expand MCP permission and workflow agent regression coverage`
12. `fix(webex): improve WDM reconnection and device registration handling`
13. `fix(jira): harden MCP API client error handling`
14. `chore(compose): default OpenFGA reconcile on and add workflow OAuth2 env`
15. `feat(workflows): improve Webex workflow run tool responses and guidance`
16. `fix(webex): reduce duplicate pairing prompts and harden identity lookup`

## Agent context HMAC (`CAIPE_AGENT_CONTEXT_HMAC_SECRET`)

Shared symmetric secret used when MCP calls go through **AgentGateway**:

- **Signers** (dynamic-agents, caipe-ui BFF probe/test-tool) attach `X-CAIPE-Agent-Context` + HMAC signature naming the calling `agent_id`.
- **Verifier** (openfga-authz-bridge) checks the signature, then enforces `user can_use agent:<id>` and `agent:<id> can_call tool:<server>/<tool>` on `tools/call`.

Without it, only the coarse user-level `mcp_gateway:list` gate runs — per-agent `allowed_tools` may 403.

**G1 (Helm):** `dynamic-agents.agentContext.existingSecret` + bridge wiring via `caipe-ui-secret`; chart `NOTES.txt` warning.
**G2 (bootstrap):** `.env.example`, `setup-caipe.sh` patch/generate, dynamic-agents startup warning.

Full doc: [Agent context HMAC](../../security/rbac/agent-context-hmac.md)

## Test plan

- [ ] `cd ui && npm run lint && npm test -- --runInBand src/lib/credentials src/components/credentials src/components/dynamic-agents src/app/api/mcp-servers src/app/api/credentials`
- [ ] `cd deploy/agentgateway && uv run pytest tests/test_config_bridge.py`
- [ ] `cd ai_platform_engineering/dynamic_agents && uv run pytest tests/test_mcp_client_token_forwarding.py tests/test_workflow_api_client.py tests/test_workflow_user_delegation.py`
- [ ] `uv run pytest tests/test_dynamic_agents_chart_keycloak_env.py` (HMAC `secretKeyRef` + NOTES warning)
- [ ] Manual: create MCP server with secret header binding → probe endpoint → test tool call via AgentGateway route
- [ ] Manual: credentials workspace — create/rotate/share secret, verify usage references and protection details
- [ ] E2E: `RUN_RBAC_REGRESSION=1 npm run test:e2e:rbac-regression` (includes credentials, MCP, workflow delegation mocks)

## Linked issues

Fixes #1930
Fixes #1929
Fixes #1942
Fixes #1920
Fixes #1928
Fixes #1911

Relates to #1931 — workflow user-bearer delegation is implemented; live Webex bot → agent → team workflow validation is tracked in `docs/docs/specs/2026-06-22-pr-1967-issue-closure/plan.md` (gap G5).

Supersedes closed PR #1960.

## Follow-up gaps (post-merge)

See `docs/docs/specs/2026-06-22-pr-1967-issue-closure/plan.md` for jwtAuth guardrails (G3, P2), admin FGA tab parity (G4, P2), #1931 live E2E (G5, P3), and workflow image rollout (#1968, G6, P4). **G1/G2 (HMAC Helm + bootstrap) are done** — see [Agent context HMAC](../../security/rbac/agent-context-hmac.md).
