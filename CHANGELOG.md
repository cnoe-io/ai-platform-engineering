## 0.3.2 (2026-04-15)

## 0.3.1-rc.2 (2026-04-15)

### Feat

- **ui**: add skills gateway visual editor and /skills/gateway route (#1220)

### Fix

- **setup**: guard ConfigMap patches and enable ip_forward at runtime (#1221)
- **ci**: add contents:write permission to notify-release jobs (#1219)

## 0.3.1-rc.1 (2026-04-15)

## 0.3.0-rc.8 (2026-04-15)

## 0.3.0-rc.7 (2026-04-15)

### Fix

- **slack-bot,supervisor**: streaming newlines, msg_too_long resilience, A2A skills injection (#1218)

### Refactor

- **ui**: simplify skills gallery and remove unused types

## 0.3.0-rc.6 (2026-04-14)

## 0.3.0-rc.5 (2026-04-14)

### Fix

- **rag**: rename ExampleEntityMatch to ExampleStructuredEntityMatch in common models (#1200)

## 0.3.0-rc.4 (2026-04-14)

### Feat

- **rag**: add Jira issue ingestor and UI read-only datasource support (#988)

### Fix

- **streaming**: restore 0.2.41 streaming UX with marker gate fixes and middleware toggles (#1210)
- **ui**: auth hardening + credentials_ref env var validation (#1211)

## 0.3.0-rc.3 (2026-04-13)

## 0.2.43-rc.40 (2026-04-13)

### Feat

- **ui**: add /auth/reauth-complete page for new-tab OIDC re-auth flow

### Fix

- **ingestors**: defer credential validation to runtime in slack/webex ingestors
- **compose**: remove slack-ingestor and webex-ingestor services
- **deps**: re-lock agent uv.lock files to pin beautifulsoup4==4.14.3
- **deps**: pin beautifulsoup4==4.14.3 in utils and regenerate lock files
- **deps**: regenerate utils/uv.lock after langgraph 1.0.10 to 1.1.6 bump
- **deps**: upgrade langgraph 1.0.10 to 1.1.6 in all agents and utils
- **ui**: remove unused RefreshCw import and unused result variable
- **ui**: remove debug auth routes and harden token expiry guard

## 0.2.43-rc.39 (2026-04-12)

### Fix

- **docker**: force HTTP/1.1 for kubectl downloads to avoid HTTP/2 errors (#1197)

## 0.2.43-rc.38 (2026-04-12)

### Fix

- **docker**: add retry flags to glab curl download in Dockerfile.a2a (#1194)

## 0.2.43-rc.37 (2026-04-12)

### Feat

- **ci**: add weekly security CVE tracking issue workflow (#1191)

### Fix

- **supervisor**: replace RemoveMessage with synthetic ToolMessage for orphaned tool calls (#1195)
- **rag**: rename fetch_datasources_and_entity_types to list_datasources_and_entity_types in prompt (#1070)
- **docs**: replace broken relative spec link with GitHub URL (#1190)
- **docs**: escape angle bracket in plan.md to fix MDX build failure (#1189)

## 0.2.43-rc.36 (2026-04-12)

### Fix

- **deps**: fix 31 Dependabot alerts — protobuf, starlette, urllib3, transformers, ecdsa (#1183)

## 0.2.43-rc.35 (2026-04-12)

### Fix

- **deps**: upgrade langchain-core/langgraph/go-stdlib — post-1179 security scan alerts (#1182)

## 0.2.43-rc.34 (2026-04-12)

### Fix

- **deps**: bump gh CLI version from 2.63.2 to 2.89.0 in Dockerfile.a2a (#1181)

## 0.2.43-rc.33 (2026-04-12)

### Fix

- **deps**: upgrade fastmcp, starlette, fastapi, scrapy, tj-actions — HIGH security alerts (#1180)

## 0.2.43-rc.32 (2026-04-12)

### Fix

- **supervisor**: exclude format_markdown tool in structured response mode (#1074)
- **ui**: deduplicate package-lock.json via npm install (#1177)

## 0.2.43-rc.31 (2026-04-12)

### Fix

- **deps**: upgrade vulnerable dependencies — pypdf, langgraph, uv, webpack-dev-server, github-mcp-server (#1179)

## 0.2.43-rc.30 (2026-04-12)

### Fix

- **aws**: omit --profile flag when no AWS_ACCOUNT_LIST profiles are configured (#1071)

## 0.2.43-rc.29 (2026-04-12)

### Fix

- **deps**: upgrade langgraph 1.0.9→1.1.6 and langchain 1.2.6→1.2.15 to fix ImportError in CI (#1178)

## 0.2.43-rc.28 (2026-04-10)

### Fix

- **deps**: regenerate uv.lock to fix locked sync in Docker build (#1175)
- **setup**: production setup fixes — MetalLB, Docker FORWARD, Duo SSO (#1101)

## 0.2.43-rc.27 (2026-04-10)

## 0.2.43-rc.26 (2026-04-10)

### Fix

- **deps**: upgrade vulnerable dependencies across all agents and subpackages (#1173)

## 0.2.43-rc.25 (2026-04-10)

### Feat

- **ui**: upgrade UI dependencies and components for v0.2.0 (#1171)

### Fix

- **supervisor**: unify single/distributed binding, streaming conformance, RAG caps (#1151)
- **ci**: sync appVersion with chart version bump (#1174)
- **ci**: pin action refs in sync-release-branches to fix workflow file issue (#1163)

## 0.2.43-rc.24 (2026-04-10)

### Fix

- **ui**: guard login for chat urls (#1158)

## 0.2.43-rc.23 (2026-04-10)

### Fix

- **slack-bot**: add missing default field in test_config_loaded_from_file_path (#1165)

## 0.2.43-rc.21 (2026-04-10)

### Fix

- **github-mcp**: bump Go builder image to 1.25-alpine (#1170)

## 0.2.43-rc.22 (2026-04-10)

### Fix

- OIDC group display, task builder tools, and supervisor response format (#1140)

## 0.3.0-rc.2 (2026-04-09)

### Fix

- code scanning alert no. 1832: Artifact poisoning (#1159)

## 0.2.43-rc.20 (2026-04-09)

### Feat

- **github-mcp**: add template support to create_repository tool (#1155)

## 0.2.43-rc.19 (2026-04-09)

### Fix

- **slack-bot**: mount botConfig as file, add PDB and maxUnavailable=0 (#1154)

## 0.2.43-rc.18 (2026-04-09)

### Feat

- Default enable metrics endpoints (#1064)

## 0.2.43-rc.17 (2026-04-09)

### Fix

- **ci**: do not prebuild rag on .github file changes
- **ci**: prebuild supervisor when only subagent changes if single-node
- **ci**: use single-node syntax match for prebuilds w/o -
- **aigateway**: update multiple llm providers in a batch and use lock to fix race condition
- **ui**: fix conversations tab pagination and search

## 0.2.43-rc.16 (2026-04-07)

### Feat

- **dynamic-agents**: add ModelRetryMiddleware to dynamic agent runtime
- **supervisor**: add ModelRetryMiddleware, gate GitHub MCP tools, bump cnoe-agent-utils

## 0.2.43-rc.15 (2026-04-07)

### Feat

- **ui**: add AI suggest buttons, CodeMirror editor, and markdown preview to custom agent builder
- **ui**: add AI suggest proxy route for custom agent builder
- **dynamic-agents**: add generic AI assistant suggest endpoint

### Fix

- **ui**: fix team-shared agents missing from new chat list and prevent header tab wrapping

## 0.2.43-rc.14 (2026-04-07)

### Feat

- **rag**: add multi-org support to GitHub ingestor
- **rag**: add multi-account support to AWS ingestor
- **rag**: auto-track document_count in Client.ingest_documents
- **ui**: add filter chip UI to MCPToolsView
- **ui**: add custom metadata filter support in SearchView
- **rag**: add nested metadata filtering support

### Fix

- **ui**: update AgentTimeline test to match removed streaming cursor
- **dynamic-agents**: redact internal error details from /invoke response
- **dynamic-agents**: handle MCP tool errors gracefully and surface in UI
- **ui**: remove streaming cursor and use consistent markdown rendering in dynamic agent timeline
- **rag**: support typed filter values for bool fields in search and MCP tools
- **rag**: update ingestors for auto document_count tracking
- **ui**: fix $project exclusion/expression mix in conversations pipeline
- **ui**: avoid MongoDB 100MB $lookup limit in conversations endpoint
- **rag**: read reload_interval from top-level field instead of metadata
- **ui**: widen filter key and value inputs in SearchView
- **ui**: show reload interval for all datasources with reload_interval

### Refactor

- **rag**: rename graph entity to structured entity

## 0.2.43-rc.13 (2026-04-06)

### Feat

- **slack-bot**: add escalation workflows, fix feedback/streaming bugs (#1123)

## 0.2.43-rc.12 (2026-04-06)

### Fix

- **deps**: pin langchain-core==1.2.26 to fix CVE-2025-68664 (#1125)

## 0.2.43-rc.11 (2026-04-06)

## 0.2.43-rc.10 (2026-04-06)

## 0.2.43-rc.9 (2026-04-06)

### Fix

- **dev**: local dev no-SSO mode, Jira ADF descriptions, Docker networking (#1129)

## 0.2.43-rc.8 (2026-04-06)

### Feat

- **dynamic-agents**: add OIDC_REQUIRED_DYNAMIC_AGENTS_GROUP env var

## 0.2.43-rc.7 (2026-04-06)

### Feat

- **security**: Grype Scan — rename, add container scanning for all 35 images, block on critical (#1126)

### Refactor

- consolidate A2A server into shared abstraction (#1116)

## 0.2.43-rc.6 (2026-04-04)

### Fix

- **mcp**: move host/port from FastMCP() constructor to mcp.run()
- **dev**: replace caipe-supervisor profile with caipe-supervisor-distributed
- **dev**: add caipe-supervisor-distributed profile alias and optional slack-bot deps
- **dev**: add caipe-supervisor-all-in-one service for single-node mode

## 0.2.43-rc.5 (2026-04-03)

## 0.2.43-rc.4 (2026-04-02)

### Feat

- **db**: auto-migrate web feedback on app startup (#1109)

### Fix

- **deps**: upgrade nltk==3.9.4, fastmcp==3.2.0, mcp==1.26.0 for critical CVEs (#1103)

## 0.2.43-rc.3 (2026-04-02)

### Feat

- **admin**: enhanced platform statistics with Slack integration and unified filters (#1094)

## 0.2.43-rc.2 (2026-04-02)

### Fix

- **subagent**: raise truncation limit to let eviction system work
- **subagent**: truncate all string elements in tuple returns
- **subagent**: truncate content inside (content, artifact) tuples
- **docker**: install gh CLI in supervisor container
- **subagent**: normalize MCP tool results for content_and_artifact format

### Refactor

- **subagent**: make _truncate_any shape-agnostic

## 0.2.43-rc.1 (2026-04-02)

### Feat

- add Grype container scan on version tag push (#1084)

## 0.2.42-rc.14 (2026-04-02)

## 0.2.42-rc.13 (2026-04-02)

### Fix

- **rag**: restore per-result fetch_document markers + raise cap to 10 + 49 tests (#1069)

## 0.2.42-rc.12 (2026-04-01)

### Feat

- **github**: deploy GitHub MCP server as separate HTTP pod (#1077)
- create snyk-container.yml

### Fix

- pin all GitHub Actions to immutable commit SHAs (#1082)
- use workflow_run to post coverage comments from fork PRs (#1081)

## 0.2.42-rc.11 (2026-04-01)

### Feat

- **backstage-ingestor**: add BACKSTAGE_AUTH_MODE for multi-mode auth

## 0.2.42-rc.10 (2026-03-31)

### Feat

- **ui**: add data freshness visibility and cleanup controls
- **rag**: add safe bulk cleanup with failed job protection
- **rag**: update all ingestors to use get_fresh_until()
- **rag**: add fresh_until calculation and reload_interval field

### Fix

- **ui**: add formatRelativeTimeCompact to test mocks
- **rag**: remove unused DEFAULT_RELOAD_INTERVAL import

### Refactor

- **ui**: use shared formatRelativeTimeCompact utility

## 0.2.42-rc.9 (2026-03-31)

### Feat

- **supervisor**: add tool error resilience, workflow introspection, and form pre-population (#1062)

## 0.2.42-rc.8 (2026-03-27)

### Feat

- **rag**: improve MCP search tools and UI

### Fix

- **rag**: remove unused pytest import

### Refactor

- **rag**: standardize ruff formatting to 2-space indentation

## 0.2.42-rc.7 (2026-03-26)

### Feat

- **aws**: add AWS CLI and kubectl tools to single-node AWS subagent
- **helm**: propagate global.checkpointPersistence to all agent subcharts (#1023)

### Fix

- **single-node**: use built-in system prompts for all subagents

### Refactor

- **aws**: remove dynamic args schema — profiles covered by system prompt

## 0.2.42-rc.6 (2026-03-25)

### Feat

- **skills**: skills middleware integration with gateway API (#1024)

## 0.2.42-rc.5 (2026-03-25)

### Feat

- **dynamic-agents**: add LOG_LEVEL env var and reduce log verbosity
- **dynamic-agents**: add backend cancellation for stop button
- **dynamic-agents**: add progressive turn loading and chat download
- **dynamic-agents**: add timeline UI for streaming agent responses
- **dynamic-agents**: add namespace correlation for subagent SSE events
- **ui**: redesign inline event cards with interleaved rendering
- **ui**: show tool/subagent calls inline in chat panel

### Fix

- restore streaming cursor and remove unused variable
- **dynamic-agents**: clear sseEvents before HITL resume stream
- **dynamic-agents**: persist sseEvents to messages and auto-collapse sections
- **dynamic-agents**: fix timeline race condition on message interrupt
- **dynamic-agents**: persist turnStatus for interrupted/cancelled turns
- **ui**: simplify HITL state check, add thinking indicator
- **dynamic-agents**: include built-in tools for subagents
- **dynamic-agents**: increase botocore timeout for Bedrock LLM
- **ui**: prevent visual flash on conversation switch
- **ui**: reset agent info on conversation switch to prevent stale theme
- **ui**: eliminate duplicate API calls on chat startup
- **ui**: simplify inline event card args display
- **sse**: properly encode newlines in SSE content events
- **ui**: handle SSE newlines - empty data: becomes \n
- **ui**: improve typing indicator and fix markdown newlines

### Refactor

- **dynamic-agents**: simplify agent panel and collapse by default
- **dynamic-agents**: unify DA history loading with standard chat
- **ui**: unify streaming/final markdown rendering in chat
- **dynamic-agents**: remove final_result event and runtimeStatus

## 0.2.42-rc.4 (2026-03-25)

### Feat

- **slack**: replace custom MCP with korotovsky/slack-mcp-server v1.2.3 (#1036)

## 0.2.42-rc.3 (2026-03-24)

### Feat

- **victorops**: multi-org support via VICTOROPS_ORGS env var

## 0.2.42-rc.2 (2026-03-24)

## 0.2.42-rc.1 (2026-03-24)

### Feat

- **argocd**: add directory_recurse parameter to create_application

### Fix

- **slack-bot**: prevent posting to main channel when thread message is deleted (#1034)
- **slack-ingestor**: detect lookback_days config changes and trigger full re-ingestion (#1035)
- **executor**: plan step attribution, false final answer, and sub-agent source bugs (#1025)
- **ui**: auto-sync system task configs when task_config.yaml changes

## 0.2.41 (2026-03-19)

### Feat

- **checkpointer**: per-agent MongoDB checkpoint isolation with auto-prefix (#1017)
- **dynamic-agents**: add file deletion from context panel
- **dynamic-agents**: add loading state and simplify file tree
- **dynamic-agents**: add files tree to context panel
- **helm**: change default imagePullPolicy from Always to IfNotPresent since we do not do stable/latest tags anymore
- **subagents**: centralise MCP mode variabled into utils
- **helm**: add mcp deployments in parent chart for single-node HTTP case
- **helm**: subagent level llm secrets will be moved to use agentSecrets instead
- **ci**: branch with *-single-node-* will not prebuild subagent images
- **helm**: add support for subagent level mcp variables and add user_input subagent prompt file mount
- rename "caipe" subagent to "user_input" subagent
- allow sub-agent level MCP mode + addr

### Fix

- **ui**: detect stale system templates in seed status check (#1020)
- **dynamic-agents**: rename logging.py to avoid stdlib collision
- **feedback**: fix DM scoring name, align Langfuse scores across Slack and UI (#1018)
- **task-config**: handle GraphInterrupt correctly as expected and not an exception error
- **helm**: remove mongodb runtime dependency
- further renaming of caipe to user_input that were missing
- **helm**: ensure single-node creates each subagent prompt configs and some cleanups

### Refactor

- **dynamic-agents**: use API endpoint for todos instead of SSE events
- **dynamic-agents**: consolidate SSE event system into stream_events.py

## 0.2.40 (2026-03-18)

### Feat

- **ui**: make built-in skills configurable and non-deletable (#1014)
- **confluence**: add configurable title-based page filtering for ingestion (#996)
- **dynamic-agents**: add per-agent gradient theme support
- **dynamic-agents**: add export YAML and clone agent actions
- **ui**: allow addMessage to preserve message IDs from checkpointer
- **ui**: load Dynamic Agent chat history on conversation open
- **dynamic-agents**: add conversations router with messages and clear endpoints
- **dynamic-agents**: switch to MongoDB checkpointer for persistent chat history
- **dynamic-agents**: add langgraph-checkpoint-mongodb dependency
- **dynamic-agents**: add admin Conversations tab for managing chat history
- **ui**: implement DynamicAgentChatPanel for phase 1 of persistent chat history

### Fix

- **dynamic-agents**: use os._exit(1) to forcefully terminate process
- **dynamic-agents**: use sys.exit(1) to ensure process terminates
- **dynamic-agents**: require MongoDB at startup with retry logic
- **dynamic-agents**: use arrow symbol in gradient theme labels
- **ui**: default thinking panel to collapsed for completed messages (#1011)
- **dynamic-agents**: update conversations.py to use UserContext parameter
- **ui**: audit chat preservation, loading UX, admin navigation, and report-a-problem (#1010)
- **ui**: add yaml dependency and fix streaming route types
- **ui**: use getAuthenticatedUser for Dynamic Agent streaming routes

### Refactor

- **dynamic-agents**: extract fatal_exit() function for reusability
- **dynamic-agents**: simplify agent_runtime.py
- **dynamic-agents**: consolidate user context into single UserContext object
- **dynamic-agents**: simplify SSE error handling
- **dynamic-agents**: consolidate access control into auth/access.py
- **dynamic-agents**: consolidate logging into logging.py
- **dynamic-agents**: rename middleware/ to auth/
- **dynamic-agents**: remove BUILTIN_TOOLS distinction
- **dynamic-agents**: make stream trackers stateless
- **dynamic-agents**: remove dead code
- **dynamic-agents**: remove prompts/ folder and extension prompt feature

## 0.2.39 (2026-03-17)

### BREAKING CHANGE

- Model config field renamed from 'id' to 'model'

### Feat

- **ui,slack-bot**: add structured timeline and plan-mode streaming (#985)
- **docs**: implement helm chart documentation generator (#1003)
- **aws-agent**: block kubectl get/describe secrets and sanitize output (#977)
- **persistence**: add Redis, Postgres, and MongoDB checkpoint and store persistence (#909)
- **docker**: add build context and volume mounts for RAG dev services (#986)
- **dynamic-agents**: add HITL forms using HumanInTheLoopMiddleware pattern
- **ui**: add VictorOps icon to integration orbit (#972)
- **dynamic-agents**: add conversation ID display and improve logging
- **dynamic-agents**: add builtin tools and API restructuring
- **dynamic-agents**: add llmSecret support for LLM credentials
- **dynamic-agents**: add seedConfig support for MCP servers and agents
- properly support all llm providers
- **single-node**: allow sub-agent level llm key
- **helm**: add dynamic-agents feature flags to caipe-ui config
- **helm**: add dynamic-agents subchart
- **dynamic-agents**: add CI/CD infrastructure
- **dynamic-agents**: add config-driven seed agents and MCP servers
- **dynamic-agents**: persist MCP warnings across chat messages
- **dynamic-agents**: add resilient MCP connections, restart runtime, and session logging
- **dynamic-agents**: add team sharing UI for visibility selection
- **custom-agents**: warn users when MCP tools are unavailable
- **custom-agents**: UX makeover with step wizard and improved tools UI
- **dynamic-agents**: fix model/provider sync and enhance UI
- **dynamic-agents**: add model selection with provider support
- **dynamic-agents**: add fetch_url built-in tool with domain ACL
- **dynamic-agents**: add subagent delegation support
- **dynamic-agents**: add Langfuse tracing support
- **ui**: separate chat views for Platform Engineer and Dynamic Agents
- **ui**: improve Dynamic Agents chat UX with agent selection
- **ui**: add Dynamic Agents admin UI and chat integration
- **dynamic-agents**: add FastAPI backend service for dynamic agent builder
- **slack-bot**: add podAnnotations support to helm chart (#943)
- **slack-bot**: add podAnnotations support to helm chart (#943)

### Fix

- **slack-bot**: improve kb search prompt for better retrieval and confidence assessment (#1009)
- **setup**: support curl-pipe execution and add welcome banner (#1004)
- **docs**: resolve broken links, fix Helm chart symlinks, and fix setup script (#1002)
- **ui**: respect DYNAMIC_AGENTS_ENABLED flag and reorder Custom Agents tab
- **docs**: add Docusaurus id to helm-docs templates for symlinked chart pages (#990)
- **caipe**: allow file writes after form collection
- **caipe**: allow CAIPE subagent to write files after form collection
- **task-config**: simplify Jira step display text
- **task-config**: move Jira step to end and only create ticket on error
- **task-config**: auto-merge on auto_approve and consistent Jira failure-only logic
- **middleware**: prevent write_todos infinite loop via after_model hook
- **dynamic-agents**: load all seed config (models, servers, agents) at startup
- **dynamic-agents**: read SEED_CONFIG_PATH env var for models config
- **dynamic-agents**: use timezone-aware datetime and add auth guard
- **dynamic-agents**: remove unused asyncio import
- **dynamic-agents**: initialize default-enabled builtin tools in config
- **dynamic-agents**: use /healthz for health probes
- **dynamic-agents**: correct transport type in example comments
- **dynamic-agents**: resolve circular import for session_id_var
- **dynamic-agents**: use JSON array format for CORS_ORIGINS config
- **charts**: update dynamic-agents dependency version to 0.2.38
- **helm**: update dynamic-agents dependency version to 0.2.36
- **dynamic-agents**: make disabled agents read-only and fix subagent filtering
- **ui**: prevent context panel overlay on narrow viewports
- **dynamic-agents**: fix model selector parsing for IDs containing colons
- **dynamic-agents**: handle MCP server connection failures gracefully
- **dynamic-agents**: use removeprefix for tool name prefix stripping
- **dynamic-agents**: truncate agent description in list view
- **dynamic-agents**: display warning events in Events panel
- **dynamic-agents**: handle warning SSE events in client
- **ui**: show 'Unknown' for deleted agents in chat list
- **dynamic-agents**: invalidate runtime cache when agent config changes
- **dynamic-agents**: show team agents to their owners
- **ui**: prevent sidebar flicker when switching conversations
- **ui**: reactive agent_id loading and enhanced Agent Info tab
- **ui**: preserve agent_id when loading conversations from server
- **ui**: correct API response parsing in NewChatButton
- **task-config**: only create Jira ticket on deployment failure
- **middleware**: catch task errors and continue workflow instead of crashing
- **middleware**: handle task errors gracefully instead of crashing workflow
- **github-mcp**: handle branch already exists in create_branch gracefully
- **deepagent**: prevent write_todos infinite loop when all tasks completed
- **policy**: include policy.lp in helm chart and handle empty policy file
- **auth**: forward OAuth2 token in /api/agents/tools proxy route

### Refactor

- **ui**: proxy write operations to dynamic-agents backend
- **charts**: replace task_config and policy with stubs
- **dynamic-agents**: use timezone-aware datetimes throughout
- **dynamic-agents**: rename model to model_id in models config
- **dynamic-agents**: move imports to top of files
- **dynamic-agents**: rename model config 'id' to 'model'
- **dynamic-agents**: replace verbose SSE events with structured JSON
- **ui**: remove AgentSelector from chat panel header

## 0.2.38 (2026-03-11)

### Feat

- improve manual release by splitting steps for easier retry

### Fix

- **ci**: github action to trigger ci properly in a new step

## 0.2.37 (2026-03-11)

### Fix

- prevent auto-redirect to shared/public conversations leaking context_id across users

## 0.2.36 (2026-03-09)

### Feat

- **policy**: add two-tier policy system with dynamic tool discovery
- **ui**: add Task Builder card to home page platform capabilities
- sub-agent to use context summarisation + refine search req
- **rag**: replace single graph_tools_enabled toggle with individual per-tool flags
- use Github app to bypass branch protection rule during release
- **task-builder**: scope custom workflows per-user
- **supervisor**: inject self-service workflows into prompt via middleware
- **agent-github**: connect to GitHub Copilot MCP API in multi-node mode (#907)

### Fix

- **a2a**: make user_id passing conditional in agent executor (#937)
- **tasks**: apply env var substitution to MongoDB-sourced task configs
- **single-node**: load GitHub MCP tools via local go run server
- **single-node**: return USER_FORM_SUBMITTED signal from CAIPEAgentResponse
- **aigateway**: handle key alias conflict from parallel tool calls
- **ui**: remove X close button from input form header
- **aigateway**: filter spend activity by user's API key
- **single-node**: send text artifact before input_required status
- **single-node**: robust HITL resume parsing and local MongoDB support
- **supervisor**: port Phase 1/Phase 2 error recovery to single-node agent
- **docker**: include vault_utils.py in supervisor image
- resolve merge conflicts with main

### Refactor

- **ui**: use dynamic APP_NAME in task builder instead of hardcoded CAIPE

## 0.2.35 (2026-03-05)

### Feat

- **aigateway**: add Vault integration and single-node agent configuration (#898)
- **ui**: add admin audit logs with export and owner search (#894)
- **ui**: add dashboard-style home page with shared conversations and insights (#896)
- **ui**: admin - add feedback visibility, NPS campaigns, and admin audit mode (#893)

### Fix

- **victorops**: fix deployment issues in victorops agent (#903)
- **slack-bot**: silence unhandled reaction event warnings (#905)
- **docs**: escape MDX curly braces in ADR to fix Docusaurus build (#902)

## 0.2.34 (2026-03-04)

### Feat

- **ui**: add share with everyone for conversations (#891)
- **ui**: live status, input-required, and unviewed message indicators (#892)
- **task-builder**: add live workflow discovery and MongoDB integration for single-node dev
- **task-builder**: add UX enhancements to visual workflow editor
- **task-builder**: add visual Task Builder with MongoDB persistence
- **ui**: add preferences modal with categorized feature flags (#865)
- add custom mention prompts (#888)
- **rag**: add configurable MCP server for RAG (#875)
- **ui**: add multiselect toggle and comma-separated values to metadata form (#880)
- **memory**: add cross-thread store and automatic fact extraction (#861)

### Fix

- **rag**: use dynamic RAG tool names instead of hardcoded list
- **rag**: make MCP authentication optional
- **ui**: use bulk API for initial datasource job fetching
- **chart**: use tags for caipe-ui and slack-bot instead of global conditions (#885)
- sub-agent needs to handle gracefully when no secret is needed
- **slack-bot**: disable retryable writes for DocumentDB compatibility (#886)
- **slack-bot**: correct image repository to caipe-slack-bot (#884)

## 0.2.33 (2026-03-03)

### Feat

- **caipe-ui**: add existingSecret support for pre-existing secrets (#862)

### Fix

- **ci**: replace pull_request_target with pull_request for security
- **auth**: return 401 when unauthenticated on protected routes (#882)
- **docs**: escape nested quotes in ADR front matter title (#881)
- **slack-bot**: skip duplicate CAIPE_URL in env map loop (#879)

## 0.2.32 (2026-03-02)

### Feat

- **slack-bot**: add X-Client-Source header and parent Helm chart wiring
- **slack-bot**: upstream Slack bot integration into CAIPE platform

### Fix

- delete old files
- move slack-bot chart under ai-platform-engineering chart
- **slack-bot**: move Dockerfile to build/ and add to release-finalize
- **slack-bot**: add CI and pre-release workflows for slack bot Docker build
- **slack-bot**: bump slack-bot chart version to 0.2.31
- **slack-bot**: add DM handler, use APP_NAME variable, and simplify streaming (#868)
- **slack-bot**: fix gitleaks false positive and UI test assertion
- **slack-bot**: address review issues from forge-slack-bot upstream validation
- **github**: multi-node uses gh CLI, single-node uses MCP STDIO

## 0.2.31 (2026-02-28)

### Fix

- align netutils chart alias and disable secrets for demo agents (#871)

## 0.2.30 (2026-02-28)

### Refactor

- rename network_utility agent to netutils (NetUtils) (#870)

## 0.2.29 (2026-02-27)

### Feat

- add agent-weather and agent-petstore to helm chart (#869)

## 0.2.28 (2026-02-27)

### Feat

- **aigateway**: deterministic Webex message and Helm task config

### Fix

- linter err
- more gracefully handle error such as context too large, recursion limit etc
- correctly handle final output when recursion limit is hit
- **multi-node**: execution plan parsing, user email propagation, form submission, and SSO config
- **ui**: prevent HITL form from reappearing after workflow completion
- **ci**: pin deps/build stages to BUILDPLATFORM in caipe-ui Dockerfile
- **build**: regenerate uv.lock to sync with pyproject.toml

### Refactor

- **helm**: symlink task_config.yaml from charts data and remove list_self_service_tasks tool

## 0.2.27 (2026-02-26)

### Feat

- make skill-templates independent of caipe-ui.enabled (#836)
- **victorops**: Add Agent victorops aka Splunk On-call (#858)

## 0.2.26 (2026-02-26)

### Feat

- **agent**: add network utility agent and MCP server (#855)
- **rag-server**: add MCPAuthMiddleware to enforce auth on /mcp routes

### Fix

- **deps**: upgrade cnoe-agent-utils to 0.3.11 (#860)
- **build**: add retry logic to npm install for transient registry errors (#859)

## 0.2.25 (2026-02-25)

### Feat

- handle existing LLM keys, persist form on refresh, show selections

### Fix

- correctly send final structured output to the UI when user input is required
- **rag**: resolve RBAC crash in ontology agent reverse proxy
- **streaming**: use supervisor final message for final_result artifact
- **aigateway**: remove extraneous f-string prefix in tools.py

## 0.2.24 (2026-02-25)

### Feat

- **ui**: add interactive changelog viewer to System Settings dialog (#851)

### Fix

- **ui**: persist skill_content and related fields on skill creation (#852)

## 0.2.23 (2026-02-25)

### Fix

- **ui**: auth redirect, loading spinner, theme visibility, and session resilience (#850)
- **supervisor**: repair streaming failures from json scoping and orphaned tool calls (#842)

## 0.2.22 (2026-02-24)

### Feat

- Support comma-separated OAUTH2_CLIENT_IDS for cid validation (#849)
- **rag**: add batch job status endpoint for efficient datasource polling (#845)
- **ui**: add response field to CAIPEAgentResponse for form chat text
- **tools**: add terraform_fmt tool and fix filesystem state consistency
- set USE_STRUCTURED_RESPONSE true by default (#840)
- **single-node**: add structured response support and ResponseFormat tool notifications

### Fix

- **ui**: default canViewAdmin to true for pre-upgrade JWT sessions (#837)
- **docker-compose**: remove jarvis from all-agents profile (#848)
- get rid of ResponseFormat as sonnet sometimes uses this instead and breaks
- make it work with newer claude models that do not support prefilling
- **agent**: make CAIPEAgentResponse response field optional
- **tools**: use correct InjectedState import for tool_result_to_file
- **agent**: emit execution plan when write_todos is called
- **agent**: fix execution plan bug
- **github-mcp**: make octicon icons optional for Go embed
- **ui**: add missing A2AEvent type import to ChatPanel
- **single-node**: fix ResponseFormat parsing, HITL handler, and UI overflow
- **ui**: restore agent-config types from skills builder feature
- **ui**: sync agent-config store and types with main
- **ui**: restore agent-builder components lost during merge
- **chart**: remove self-service env defaults that override envFrom

## 0.2.21 (2026-02-23)

### Feat

- **ui**: replace previewMode with configurable envBadge (#834)
- **ui**: make admin dashboard read-only for non-admin authenticated users (#833)
- **ui**: env-configurable personalization defaults, new themes, and unified settings menu (#832)
- **ui**: refactor Create Workflow into Skills Builder Editor with skills in helm chart (#829)

### Fix

- **ui**: team-shared conversations not appearing for team members (#831)
- **confluence-ingestor**: track document_count per ingested page (#818)

## 0.2.20 (2026-02-20)

### Feat

- **ui**: auto-enable follow_external_links when sitemap mode is selected
- **ui**: show follow_external_links option for sitemap crawl mode
- **webloader**: show sitemap URL in job success message
- **chart**: add agent-weather dependency and remoteAgent bypass for single-node
- **ui**: add support to UI's admin page for prometheus metrics dashboard (#826)
- **ui**: add WORKFLOW_RUNNER_ENABLED feature flag (#823)
- **github-mcp**: add invite_user_to_org tool and parameterize task config

### Fix

- **webloader**: don't append /sitemap.xml when URL already points to a sitemap
- **webloader**: disable Scrapy telnet console
- **webloader**: propagate CloseSpider reason to job error message
- **webloader**: fail with clear error when sitemap URLs point to different domain
- **webloader**: detect canonical domain from sitemap URLs
- **webloader**: add robust sitemap discovery with fallback chain
- **webloader**: fix sitemap discovery for subdirectory paths
- **ci**: strip pre-release suffix before version arithmetic in helm-pre-release
- **ui**: clear stale HITL form after submission
- **rag**: resolve web-ingestor tight loop caused by reload interval mismatch (#817)
- **ui**: show amber RAG Disconnected badge when only RAG is offline (#821)
- **task-config**: handle empty repos and fix step numbering in deploy task
- persist user input on the UI after refresh or page return
- **rag**: prioritize JWT auth over trusted network (#815)
- **confluence-ingestor**: accept CONFLUENCE_API_TOKEN as fallback for CONFLUENCE_TOKEN (#814)

### Refactor

- **webloader**: add job_id prefix to all spider log messages
- move field_values sorting from code to task config

## 0.2.19 (2026-02-18)

### Feat

- **ui**: add reload interval UI and help popup for RAG ingest
- **rag**: add per-datasource reload interval for webloader
- **ui**: support comma-separated OIDC_GROUP_CLAIM values
- **ui**: remove X-Identity-Token header from RAG proxy
- **rag**: implement tiered groups resolution with Redis caching
- **rag**: add userinfo endpoint support for fetching user groups

### Fix

- **supervisor**: send supervisor synthesis as final_result in single sub-agent scenario (#809)
- **github**: fix streaming
- **github**: fix github mcp
- **remote-a2a**: add remote weather agent and add github mcp
- **ui**: restore HITL resume flow for form submissions
- **a2a**: construct resume Command from plain text form submissions
- **prompt**: add final_answer_instructions to platform system prompt template
- sync UI code with main and regenerate webex mcp uv.lock
- resolve merge conflicts with main (RAG proxy comments, auth-config docs)
- **rag**: fix lint issues in rbac.py

### Refactor

- **rag**: always fetch userinfo for user claims (email + groups)

## 0.2.18 (2026-02-17)

### Feat

- **single-node**: add user email context, fix recursion limit, and fix webex mcp
- **rag-ui**: add 'Restrict to this page' button for SPA tab scraping
- Return trace_id to clients for Langfuse feedback (#805)

### Fix

- **rag**: improve web crawler with streaming ingestion, redirect handling, and JS rendering
- **ui**: replace hardcoded CAIPE references with configurable appName (#806)
- mongodb sts can NOT rely on labels that are dependent on the chart version (#804)

## 0.2.17 (2026-02-13)

### Fix

- manual release is missing ci-caipe-ui
- lint err
- don't call _get_final_content if using response_format_tool
- ui to render field_options correctly with the new structured final output using field_values
- Merge origin/main into feat/add-structured-response-v2

## 0.2.16 (2026-02-13)

### Feat

- **ui**: track message sender identity for shared conversations
- **ui**: show user first name instead of 'You' in chat messages
- introduce new was_task_successful and depricate request_user_input if USE_STRUCTURED_RESPONSE is true
- add support for USE_STRUCTURED_RESPONSE where LLM uses structured response tool call as its final output
- **a2a**: add source agent tracking for sub-agent message grouping
- agent resilience, registry exclusions, and infra improvements
- **rag-stack**: add PodDisruptionBudgets for Milvus components
- add agentgateway helm chart under ai-platform-engineering
- introduce new was_task_successful and depricate request_user_input if USE_STRUCTURED_RESPONSE is true
- add support for USE_STRUCTURED_RESPONSE where LLM uses structured response tool call as its final output
- **ui**: add configurable favicon via NEXT_PUBLIC_FAVICON_URL
- **ui**: rename Agentic Workflows to Skills and add icon customization
- **rag**: add slim ingestors variant and consolidate CI matrix
- **github**: add private key path passthrough and clean up env example
- **github**: add token sanitization to prevent credential leakage
- **github**: add GitHub App token auto-refresh for MCP authentication
- **ui**: add user insights page, enhanced admin dashboard, and chat performance improvements
- **ui**: add crash recovery with interrupted message detection and task polling
- **ui**: add copy-to-clipboard for access token and ID token in user menu
- **ui**: add conversation archive with soft-delete, restore, and auto-purge
- **ui**: add silent token refresh and dismiss persistence for expiry guard
- **ui**: persist chat messages and A2A events to MongoDB for cross-device sync
- **ui**: sync UI personalization to MongoDB for cross-device persistence
- **ui**: implement team management — view details, manage members, delete teams
- **ui**: add branding env vars to docker-compose and helm values
- **ui**: replace NEXT_PUBLIC_ with runtime config via /api/config
- **rag-server**: reduce Docker image size by making HuggingFace optional
- **helm**: simplify rag-server config to use generic env map
- **embeddings**: add LiteLLM proxy support for embeddings
- **auth**: add X-Identity-Token header support for ID token claims extraction
- **ingestors**: add status messages for JavaScript rendering mode
- **build**: add Playwright/Chromium support to ingestors image
- **ingestors**: add backwards compatibility for deprecated settings fields
- **ui**: display document and chunk metrics in ingest view
- **server**: add chunk count tracking and cleanup utility
- **ingestors**: integrate Scrapy loader into web ingestor
- **common**: add ScrapySettings model and job metrics tracking
- **ingestors**: add Scrapy-based web loader infrastructure
- **a2a**: emit per-task tool notifications for deterministic workflows
- simplify deployment to single-node deep agent architecture

### Fix

- **ui**: auto-select conversation and preserve messages on tab switch
- resolve lint errors in dedup tests and agent_executor
- **streaming**: extend dedup to _handle_task_complete and add comprehensive tests
- **streaming**: deduplicate sub-agent content in single-agent scenarios
- merge conflict
- add default env var for supervisor with new USE_STRUCTURED_RESPONSE
- **ui**: correct WorkflowHistoryView import path after skills rename
- **lint**: remove unused imports and variables in test files
- **docs**: add gitlab agent to sidebar navigation
- add default env var for supervisor with new USE_STRUCTURED_RESPONSE
- **slack-ingestor**: always update datasource timestamp to prevent infinite sync loops
- replace hardcoded AIGATEWAY_SERVER_URL with env var reference
- **build**: include multi-agent tests in make test target
- **test**: correct env var scoping in registry exclusion tests
- do not trust llm gateway-api is not a chart
- agentgateway requires gateway-api
- need to install agentgateway CRD
- correct repo
- try
- v2.2.0-main does not exist despite being referenced in docs
- **ui**: use upsert in favorites API to avoid 404 race condition
- **ui**: update remaining Agentic Workflows references to Skills
- **web-ingestor**: use consistent HTTP error formatting for sitemap and robots.txt failures
- **web-ingestor**: report HTTP errors for sitemap, robots.txt, and batch ingestion to job status
- uv lock
- **docs**: escape email in MDX to fix Docusaurus build
- **github**: remove unused timezone import to fix lint error
- **agent-github**: add langchain as direct dependency for langfuse tracing
- **ui**: resolve TypeScript build failure in ChatPanel
- **ui**: fix session expiry by enabling token refresh on updateSession
- **ui**: update stale messages in MongoDB after streaming completes
- **ui**: improve code block rendering for shell commands
- **ui**: respect user scroll position during agent streaming
- **ui**: prevent long text from overflowing chat messages to the right
- **ui**: resolve infinite re-login loop when session is expiring
- **ui**: remove title prop from Lucide icons to fix TypeScript build error
- **ui**: sync follow-up messages across devices and fix event accumulation
- **ui**: add Safari SSE streaming polyfill for A2A compatibility
- **ui**: sync conversation deletions across browsers and devices
- **ui**: sync conversation ID between client and MongoDB to fix share dialog
- **ui**: storage mode always showing localStorage on client
- **ci**: fix CAIPE UI Tests workflow and Jest tests
- **ui**: runtime env script order and storage-mode re-check
- **docs**: resolve MDX compilation and broken link errors breaking GH Pages build
- **lint**: remove unnecessary f-string prefix
- **lint**: remove unused imports and delete scripts folder
- **ingestors**: correct metadata structure for source URL in documents
- **a2a**: prevent primary stream crash on nameless ToolMessages
- **ui**: restore entrypoint.sh env-config.js for runtime env injection
- **ui**: use dynamic getConfig for caipeUrl in health hook
- **ci**: resolve ruff lint errors and duplicate TypeScript declarations
- **agents**: fix github subagent and single node deep agent
- **rag**: fix rag tool initialisation
- **agents**: fix webex, backstage, jira agents
- **ui**: remove container healthcheck and align RAG_SERVER_URL usage
- **ui**: replace build-time env vars with runtime PublicEnvScript injection
- **ci**: ensure caipe-ui builds on RC tag pushes

### Refactor

- **ui**: remove ENABLE_SUBAGENT_CARDS flag and Agent Stream card boxes
- **ui**: remove localStorage cache in MongoDB mode, use upsert for messages
- **ui**: move Personal Insights to user menu, replace Recent Prompts with Skill Usage
- **ui**: rename Agentic Workflows to Agent Skills
- **ui**: use Palette icon for UI Personalization button
- **ui**: rename Settings to UI Personalization with Paintbrush icon
- **ui**: replace /api/config fetch with window.__APP_CONFIG__ injection
- **ui**: replace useConfig() with getConfig()/config imports

### Perf

- **ui**: fix scroll performance, A2A Debug rendering, and history re-renders

## 0.2.15 (2026-02-05)

### Feat

- **ui,rag**: add RAG disable feature and trusted network config
- **ui**: add version display in System Status popover
- **gitlab**: add MCP server config and comprehensive documentation
- **rag**: add JWT authentication and RBAC documentation
- **ci**: enhance CAIPE UI test coverage reporting in PRs
- **ci**: add CAIPE UI test automation and fix test mocks
- **ui**: add mongodbEnabled to config system
- **docker**: add CAIPE UI service with MongoDB integration
- **docker**: add CAIPE UI with MongoDB profiles and enable flag
- **ui**: compress streaming events in A2A timeline views
- **ui**: redesign A2A timeline with trace view and fix workflow history thumbnail
- **ui**: move workflow history to right panel and improve UX
- **ui**: add A2A timeline view and fix workflow thumbnail markdown rendering
- **charts**: integrate MongoDB and update CAIPE UI configuration
- **charts**: add ingress redirect template for domain migration
- **charts**: add MongoDB Helm subchart for CAIPE UI persistence
- **ui**: add dedicated workflow history page
- **ui**: back button now opens workflow history panel
- **ui**: add CAIPE spinner overlay while saving workflow
- **ui**: migrate favorites from localStorage to MongoDB
- **ui**: add structured user input form rendering
- **backend**: add UserInputMetaData artifact support for request_user_input
- **ui**: improve OIDC info dialog and fix auth initialization
- **ui**: add AuthGuard to all knowledge-bases and admin pages
- **ui**: disable admin tab when MongoDB is not configured
- **ui**: restore three-panel chat layout with MongoDB persistence
- **agentic-workflows**: enhance execution output with fullscreen and copy features
- add favorites and edit functionality to quick-start templates
- move 'Run in Chat' to quick-start dialog
- add 'Run in Chat' button to agent builder
- **sidebar**: implement hover-based visibility for share and delete buttons
- **sidebar**: add resizable width, truncation indicator, and dynamic text expansion
- add agent builder UI and MongoDB chat history improvements
- **ui**: add admin dashboard, teams management, and various UI improvements
- **ui**: make agents selection optional in Use Case Builder
- **ui**: implement share button and dialog for conversations
- **ui**: integrate MongoDB persistence with chat UI
- **ui**: implement complete MongoDB persistence with Next.js API routes
- **dev**: add mongo-express web UI for MongoDB management
- **backend**: integrate chat API routes with FastAPI server
- **ui**: complete Phase 3 - share dialog and status UI
- **ui**: implement Phase 3 core - UUID routing and MongoDB integration
- **backend**: implement Phase 2 - audit logging and notifications
- **backend**: implement MongoDB chat history backend (Phase 1)
- **dev**: add MongoDB service to docker-compose.dev.yaml
- **rag**: ui improvements for rbac, configs and readme
- **rag**: auth rework for user and ingestor
- **ui**: unified connection status popup
- **ingestor**: add OAuth2 client credentials authentication support
- **auth**: implement JWT validation for RAG server with multi-provider support
- **ui**: add rag rbac to knowledge-bases tab
- **ui**: add ingestor type availability logic; fix icons
- **ui**: add back ingestors section
- **task-config**: update self service tasks
- **streaming**: enable subagent token streaming
- **task-config**: initial task config implementation
- **ui**: add manual refresh token button to test token validity
- **ui**: display refresh token metadata in OIDC token dialog

### Fix

- **ui**: improve Docker build network resilience for npm ci
- lint/js issues
- **rag**: crash when collectiond doesnt exist
- some layout fixes; node details card
- graph view now works
- **ui**: knowledgebases page now defaults to search
- **ui**: search bar improvements
- **ui**: redesigned datasources section
- **gitlab**: escape curly braces in prompt configs and set INFO log level
- **lang**: fix splunk specific gitlab instance
- **code**: lint
- **rag**: resolve linting errors in RAG server restapi
- **ui**: implement hybrid auth for RAG proxy with JWT Bearer and OAuth2Proxy fallback
- **ui**: restore TypeScript strict mode with pragmatic relaxations
- **ui**: resolve TypeScript compilation errors for production build
- **ci**: resolve syntax error in CAIPE UI tests workflow
- **ui**: add ZoomIn and ZoomOut imports to A2A timeline
- **ui**: add missing compression function and zoom imports
- **ui**: add missing imports for A2A timeline modal
- **ui**: resolve React hooks order violation in ChatUUIDPage
- clean-up
- replace Azure OpenAI endpoint with generic example
- replace Outshift-specific URLs with generic examples
- **ui**: extract run ID from wrapped API response
- **ui**: make handleEvent async to await workflow saves
- **ui**: ensure workflow saves complete before navigation
- **ui**: ensure workflow status updates even when navigating away
- **ui**: improve workflow history UX and handle incomplete runs
- **ui**: parse wrapped API response for favorites
- **ui**: resolve workflow execution history not saving due to React closure issue
- **ui**: handle undefined favorites in MongoDB response
- **ui**: extract UserInputMetaData from DataPart in A2A artifacts
- **ui**: bind fetch to window context to prevent illegal invocation error
- **ui**: update agent card endpoint to non-deprecated URL
- **ui**: improve chat input box positioning and width
- ensure input textbox remains visible and accessible
- resolve chat panel scroll and context panel persistence issues
- remove ... icon
- **ui**: improve chat history text truncation when sidebar resizes
- **ui**: feedback popover opens for both thumbs up and down
- **ui**: improve feedback button UX and fix icon spacing
- **ui**: persist conversation titles to MongoDB on auto-generation
- **ui**: prevent SSR API calls causing crash loop
- **ui**: hide share button for legacy localStorage conversations
- **ui**: resolve new conversation creation and TypeScript build errors
- **ui**: resolve TypeScript build errors for MongoDB integration
- **ui**: improve UX for sharing legacy conversations
- **ui**: resolve infinite authorization loop with automatic session recovery
- **ui**: resolve AuthGuard infinite loading on login
- **ui**: add graceful error handling for legacy conversations
- **ui**: new chat button now creates MongoDB conversations
- **ui**: render share dialog as centered modal overlay
- **ui**: sync conversations to MongoDB on creation
- **ui**: center share dialog on screen
- **ui**: auto-initialize users and improve share search
- **ui**: update API routes for Next.js 15+ async params
- **ui**: correct authOptions import path in api-middleware
- **backend**: make MongoDB lifespan accept app parameter
- **backend**: correct FastAPI/Starlette app mounting order
- **ui**: add API proxy rewrites for MongoDB chat backend
- **backend**: properly mount chat API routes on FastAPI
- **ui**: redirect /chat to UUID-based conversation URL
- remove webui from build
- clear results in search
- **ui**: better UX for knowledge base page
- **ui**: fix the flickering kb page
- remove old webui references
- linting issues
- **rag**: use upsert instead of add
- lint
- **rag**: add missing lock file
- **ui**: add permission tooltip with new user-info endpoint
- **rag**: cleaner response for user-info endpoint
- **ui**: get permissions directly from RAG server
- **webex**: fix mcp tools in webex agent and update tasks
- **create-github-repo**: fix mcp tools and add backstage step
- **ui**: prevent AuthGuard from getting stuck on 'Verifying authorization'

### Refactor

- **charts**: reorganize MongoDB under caipe-ui context
- **ui**: complete branding update for login/logout pages
- **ui**: update branding to Multi-Agent Collaboration & Workflow Automation
- remove all MongoDB integration from entire project

### Perf

- **ui**: optimize A2A trace view timeline scaling and tick spacing
- **ui**: reduce workflow history auto-refresh from 3s to 15s

## 0.2.14 (2026-01-28)

### Fix

- **ui**: resolve TypeScript build error blocking CI

## 0.2.13 (2026-01-28)

### Feat

- **ui**: add user context tracking to backend messages
- **ui**: add Popover component
- **ui**: display integration tags in connection status
- **ui**: enhance user menu and connection status
- **ui**: add horizontal scroll to markdown tables
- **ui**: add advanced theme settings with gradient controls
- **ui**: move Tech section to user menu as 'About'
- **ui**: apply gradient themes across all pages, icons, and widgets
- **ui**: add gradient theme selector with 5 theme options
- **ui**: implement @mention autocomplete for agent selection
- **ui**: move stop button to text input area
- **ui**: enhance textbox focus state with stronger visual feedback
- **ui**: replace textarea with auto-growing textarea component
- **ui**: add ui path routing
- **tests**: add Make targets for CAIPE UI tests
- **ui**: make OIDC refresh token support optional and gracefully degrade
- **ui**: implement OIDC refresh token support for seamless authentication
- **docs**: add CAIPE UI section to sidebar navigation
- **makefile**: add documentation site targets
- **ui**: enhance A2A debug panel with execution plan and full event streaming
- **ui**: implement runtime configuration and enhance SSO user menu
- **helm**: add external secrets and configmap support for caipe-ui
- **usecases**: add edit functionality and fix placeholder detection
- **ui**: migrate to @a2a-js/sdk and improve streaming UX
- **ui**: add retry button to regenerate responses
- **a2a**: improve streaming reliability and UI performance
- **helm**: add caipe-ui subchart with ingress support
- **ui**: add RAG integration, layout settings, and dark mode improvements
- **helm**: add caipe-ui subchart with ingress support
- **ui**: add download button for A2A events in debug panel
- **ui**: persist tool notifications with collapsible history
- add Docker build targets and fix nginx.conf
- **ci**: add CAIPE UI Docker build workflow and reorganize Dockerfile
- add caipe-ui make targets for running the UI
- **ui**: add visual feedback to JSON copy button in A2A debug
- **ui**: add Linux logo and fix favicon
- **ui**: update IntegrationOrbit with official full-color logos
- **ui**: add GitHub PR Review use case with input form
- **ui**: use full-color original SVG logos in task list
- **ui**: add official agent logos to task list and agent selector
- **ui**: implement agent-forge features - feedback, copy, tasks, agent selection
- **ui**: persist A2A events, tasks, and output to localStorage
- **ui**: implement per-conversation streaming state
- **ui**: add Tasks tab to ContextPanel for execution plan display
- **ui**: expand streaming output by default during streaming
- **ui**: full-width two-panel layout for login and logout
- **ui**: add integration orbit animation to logout page
- **ui**: update integration logos with accurate SVG icons
- **ui**: disable panel resizing on Use Cases tab
- **ui**: add resizable panels for sidebar, chat, and context
- **ui**: show descriptive tool notifications with wrench emoji
- **ui**: show connected URL in status indicator
- **ui**: persist chat history to localStorage
- **ui**: add branded loading screen component
- **ui**: add logout page and improve auth flow
- **ui**: add font options and settings panel
- **ui**: make OIDC group claim configurable
- **ui**: add OIDC SSO with group-based authorization
- add caipe-ui using a2ui, copilotkit

### Fix

- **ui**: prevent session expiry flickering between modal and redirect
- **ui**: convert connection status tooltip to popover
- **ui**: font family selection now applies correctly
- **ui**: rename 'Advanced' to 'OIDC Token' in user menu
- **ui**: use CSS variables for background gradients and gradient text
- **ui**: apply gradient theme CSS variables to components
- **ui**: completely disable resume auto-scroll button during streaming
- **ui**: prevent auto-scroll button from appearing during fast streaming
- **ui**: remove outer box highlight on textarea focus
- **ui**: move copy and retry buttons to bottom of user messages
- **ui**: align message padding with input section
- **docs**: fix broken link in a2ui-integration.md
- **tests**: fix failing Jest tests and add fetch mock
- **ui**: handle SSO token expiry gracefully with user notifications
- **ci**: handle docs-only changes gracefully in CAIPE UI workflow
- **docs**: resolve MDX build errors and broken links
- **ui**: add display content for empty task and status events
- **gitlab**: remove unused import
- **docker**: remove extra code
- **helm**: fix small issues with backstage ingestor docker compose and code
- correct condition
- **caipe-ui**: bump chart version
- **ui**: resolve all TypeScript build errors for CI
- **ui**: add mongodb dependency and fix TypeScript type errors
- **a2a**: detect [FINAL ANSWER] marker to send final_result artifacts
- **ui**: always store task and tool events for Tasks panel
- **ui**: treat complete_result as internal artifact, not final result
- **ui**: change caipe-ui port to 3000
- **ui**: read OIDC config from .env file
- **ui**: cleaner code block styling without text highlighting
- **ui**: improve code block detection and add copy button
- **ui**: fix multiple TypeScript errors for production build
- **ui**: provide initial value for useRef in tooltip
- **ui**: update PanelSize API - use asPercentage instead of percentage
- **ui**: properly handle status-update events to mark message final
- **ui**: properly handle complete_result with full content replacement
- **ui**: always append streaming chunks, only replace for final result
- **ui**: handle A2A message events for complete content streaming
- **ui**: handle partial_result artifact as complete content
- **ui**: remove tool notification badges from chat panel
- **ui**: clear A2A events when deleting active conversation
- **ui**: use A2A append flag for proper streaming behavior
- **ui**: replace content for complete_result artifacts
- **ui**: prevent duplicate content and auto-complete tasks
- **ui**: improve tool notifications in chat panel
- **ui**: improve SSO redirect and integration orbit logos
- **ui**: improve Backstage logo to fit container
- **ui**: change ArgoCD logo background to dark color
- **ui**: resolve hydration mismatch in IntegrationOrbit
- **ui**: add missing lib/ files and fix UUID generation for A2A
- **ui**: auto-submit message when selecting a use case
- **ui**: match agent-forge feedback button behavior exactly
- **ui**: place contextId inside message for A2A conversation continuity
- **ui**: prevent raw JSON toggle from closing A2A event card
- **ui**: pass thread ID for multi-turn conversations & fix user attributes
- **ui**: blend animation and panel backgrounds seamlessly
- **ui**: add turbopack config for Next.js 16
- **ui**: update resizable panels to use v4 API
- **ui**: pass user name and email from OIDC profile to session
- **ui**: make font preview section respond to selection
- **ui**: fix settings panel not showing
- **ui**: fix React child rendering error in ContextPanel
- **ui**: add spin animation and improve login loading screen
- **rbac**: add email validation, audit logging, role validation, and improve documentation

### Refactor

- **ui**: update tech stack to show only actively used technologies
- **ui**: remove [FINAL ANSWER] logic, display streamed content as-is
- **ui**: simplify ContextPanel with Tasks as default tab

### Perf

- **ui**: optimize chat performance and prevent OOM issues

## 0.2.12 (2026-01-22)

### Feat

- **spec-kit**: add Cursor rules for CAIPE development
- initialize Spec Kit at repository root

### Fix

- **supervisor**: synthesize results from all sub-agents in multi-agent queries

## 0.2.11 (2026-01-21)

### Feat

- add authn to rag-stack chart
- add role/userinfo to ui, fix ingestor type not availalbe
- add RBAC to rag server endpoints

### Fix

- extract context_id from supervisor message metadata for conversation continuity
- **ci**: make helm rc bump to directly trigger pre-release push
- **ci**: force re-registration of workflow_run trigger
- lint issues
- add missing models
- do not include agentForge CI in the finalise and fix arm64 build

## 0.2.10 (2026-01-20)

### Fix

- **redis**: use Recreate strategy with persistent volumes

## 0.2.9 (2026-01-20)

### Feat

- **supervisor**: add [FINAL ANSWER] marker to filter thinking messages
- **tools**: consolidate utility tools into utils/agent_tools
- **tools**: add git auth support and beads-github sync
- **platform-engineer**: integrate new utility tools into deep agent
- **tools**: add utility tools for git, grep, wget, curl, glob, and memory
- **aws**: add tracing configuration and disable A2A framework tracing
- **rag**: Refactor Confluence ingestor to use json-based configuration
- **gitlab**: add GitLab agent configuration and minimal prompt config
- **gitlab**: add GitLab agent
- **beads**: add A2A Streaming Improvements epic and tasks
- add beads (bd) issue tracking system
- use new helm chart GHCR oci://ghcr.io/cnoe-io/charts/* so it does not collide with legacy charts
- new release pipeline to automate helm version and image tagging
- **confluence-rag**: Implement confluence rag ingestor v2

### Fix

- **executor**: prevent duplicate responses when sub-agent completes
- **supervisor**: add prominent [FINAL ANSWER] instruction to core constraints
- **tests**: update tool tests to match string-based return API
- updates
- wrong helm chart version committed by accident
- use URL token injection for git authentication
- update comment
- **a2a**: prevent streaming output duplication
- **rag**: Set correct RELOAD_INTERVAL for datasource refresh
- **gitlab**: remove unused task
- **tracing**: configure LangGraph model with agent name for proper observations
- **rag**: Allow discovery with fewer entities
- inf loop bug; hf api token

### Refactor

- **executor**: simplify agent_executor and add streaming fix
- **executor**: remove unused routing logic and dead code
- **a2a**: remove redundant import aliases
- move git tools to utils with GitHub/GitLab support
- **tools**: move git_* tools to GitHub agent
- **tools**: move memory tool to separate PR

## 0.2.8 (2025-12-22)

### Feat

- **helm**: make rag prompt configurable

### Fix

- **docker-compose.yaml**: add rag_web_ingestor
- **helm**: make grafana dashboard label configurable
- rag tool and prompt optimizations
- critical fix for ingestor

## 0.2.6 (2025-12-16)

### Feat

- add langfuse to agent ontology
- **prompts**: make analyze_query mandatory for all queries
- **agents**: add SOPs, table formatting, and context scoping to Confluence, PagerDuty, AWS
- **splunk**: add Splunk Cloud Platform MCP log search integration
- **langmem**: add proactive pre-flight context check to supervisor
- **langmem**: add centralized LangMem utility with observability
- **multi-agents**: add langmem dependency for supervisor
- **agents**: implement comprehensive context management and error recovery
- **agents**: add intelligent tool output truncation for context management
- **github-agent**: add gh CLI tool for workflow log retrieval and debugging
- **prompts**: add GitHub Actions log retrieval from URLs
- **agents**: add MCP tool error handling to prevent A2A stream closure
- **prompts**: add GitHub agent formatting SOP and context awareness

### Fix

- clean-up
- reconcile
- **docker-compose.dev.yaml**: revert to stable
- add MAX_SEARCH_RESULTS and WARN_SEARCH_RESULTS for argocd agent
- neo4j port
- rag image
- docker-compose fix
- minor bugfix; docker-compose fixes
- accept/reject buttons api in UI
- argocd ingestor additional id keys
- content too large err, return 400 if no ontology; better batching
- better err handling for ontology agent
- explicit rag reference instructions
- **ci**: add uv to PATH in lint workflow
- **prompts**: escape curly braces in JSON examples for Python format()
- add analyze_query as llm query
- add analyze_query as llm query
- updates
- **langmem**: fix API call and prevent orphaned tool calls
- **supervisor**: respect ENABLE_STREAMING env var
- **streaming**: resolve Queue is closed race condition and improve error handling
- **agents**: improve error parsing for TaskGroup and async errors
- **prompts**: make RAG lookup conditional
- **supervisor**: improve orphaned tool call recovery UX
- **prompts**: remove biased examples from GitHub Actions debugging SOP
- **supervisor**: fix ToolMessage and SystemMessage imports
- **agents**: update to non-deprecated create_agent API
- **agents**: correct LangMem API usage and import order
- **github-agent**: add GH_TOKEN environment variable for gh CLI authentication
- **docker-compose.yaml**: add RAG_SERVER_URL

### Refactor

- **prompt**: reconcile jarvis prompt with deep_agent optimizations
- **prompt**: make source citation generic and add prompt chaining
- **prompt**: make agent prefixes generic in supervisor prompt
- **prompts**: replace analyze_query with [Agent] prefix format
- **agents**: use LLMFactory for LangMem summarization

## 0.2.5 (2025-12-12)

### Feat

- webui ingest view now supports pagination
- **docs**: add development guide
- add github ingestor
- move confluence to use official mcp image by default in helm
- **build**: add test-agent-argocd target for agent unit tests
- **confluence**: apply sooperset/mcp-atlassian to production docker-compose
- **confluence**: replace custom MCP server with sooperset/mcp-atlassian
- **aws**: improve ECR URL parsing and repository search
- **supervisor**: add AWS agent for Kubernetes debugging
- **jira**: enhance MCP error handling and epic linking workflow
- auto-inject current date into ALL agent queries globally
- **aws**: auto-inject current date into every query
- **aws**: add smart date usage - only fetch dates when actually needed
- **aws**: add smart namespace auto-discovery for kubectl operations
- **aws**: add kubectl logs support and documentation
- **aws**: add Phase 7 - Kubernetes pods status to EKS health check SOP
- **aws**: add EKS kubectl tool with temporary kubeconfig management
- **aws**: add comprehensive EKS cluster health check SOP
- **aws**: broaden planning workflow triggers beyond 'all' queries
- **aws**: implement planning mode with reflection sub-agent
- upgrade langchain to 1.x for deepagents compatibility
- **aws**: integrate deepagents for context management and auto-offloading
- **aws**: prompt agent to ask for account when not specified
- **docker**: add AWS CLI, kubectl, jq and multi-account configuration
- **supervisor**: update AWS agent routing to support all services and cost queries
- **aws**: enhance AWS agent system prompt for multi-account and cost queries
- **aws**: add AWS CLI tool with cross-account support and reflection capabilities
- add reflection and autonomous retry to supervisor and jira agents
- **jira**: add explicit update verification and confirmation workflow
- **jira**: add intelligent field handling and fallback for custom fields
- **jira**: add filter management tools and board creation workflow
- **jira**: add comprehensive MCP tools and enhanced security
- **docker**: add section headers and slim transport configuration
- **docker**: refactor docker-compose.dev.yaml for better configurability
- **agent-forge**: improve build workflow and add local build tooling
- **supervisor**: add ambiguous terms clarification for multi-agent queries
- **jira**: add reflection and auto-retry strategy for failed searches
- **jira**: add get_epic_issues tool and improve agent reliability
- **jira**: add read-only mode, mock responses, and improve error propagation
- **jira**: implement dynamic field discovery and schema validation
- add grafana dashboard to helm chart
- add grafana-dashboard
- rag intertation with supervisor
- also update docker-compose files in main dir to volume mount
- just some more logging
- bump charts
- make all sub-agent prompts configurable
- also enable metric from each sub-agent
- default metric to false and use global with helper
- add prometheus metrics support

### Fix

- remove unused var
- update .gitleaksignore
- remove agent_rag pyproject/uv
- lint issues
- remove redis bloom filter logi
- remove kw queries
- docker-compose updates
- webloader ingestor bugs
- webex ingestor bugs
- default sync interval, github graph entity id keys
- argocd ingestor bug
- ingestor sleeping logic, better entity type format
- neo4j entity_type bug, consume results
- graphrag async logic bug
- **aws**: include tools.py and agent_strands.py in Docker builds
- **aws**: use relative imports in agent_executor
- lint & icons
- ui bugs, neo4j bugs, langchain issues
- dissapearing relations
- confluence mcp requires TRANSPORT: "streamable-http" to work
- make agent-confluence use the same env var names as official confluence mcp
- correct chart version bump
- **uv.lock**: update agent_github
- add rag-stack subchart import-values back for automatic cm rendering
- **jira**: return error JSON instead of raising exceptions in MCP tools
- **agent-runtime**: add jwt deps for github/webex/weather and petstore build arg
- **jira**: resolve pydantic default handling in MCP tools
- **argocd**: add utils as explicit dependency with proper versioning
- **deps**: align utils dependencies with workspace and regenerate argocd lock
- **build**: include agent uv.lock files in Docker builds for reproducible builds
- **build**: use --locked flag to enforce committed lock files in Docker builds
- **build**: improve agent test isolation and prevent MCP test conflicts
- **jira-mcp**: update tests to match error JSON return behavior
- **argocd-mcp**: use uv run python for test execution
- **argocd-mcp**: add dependency installation to test target
- **komodor**: remove from system prompt
- **confluence**: remove healthcheck from mcp-confluence in dev compose
- **confluence**: remove Authorization header for sooperset/mcp-atlassian HTTP mode
- **supervisor**: remove Komodor references from platform engineer
- **jira**: replace exceptions with error JSON in comments.py
- **jira**: replace exceptions with error JSON in issues, boards, sprints
- **jira**: prevent duplicate issue creation on epic linking failures
- update langchain import for langchain 1.x compatibility
- add missing prometheus_client dependency to weather and template agents
- add missing AGENT_NAME build arg for agent-petstore
- **supervisor**: remove get_current_date requirement for AWS queries
- **aws**: prevent agent from hallucinating resource names
- **aws**: correct reflection sub-agent key from 'prompt' to 'system_prompt'
- **aws**: add checkpointer to deepagents for state persistence
- **aws**: remove StateBackend explicit initialization in deepagents
- **aws**: remove 'default' profile option from AWS CLI tool
- make to do more resilient by handling duplicate icon issue
- correctly handle different llm content types (list for aws bedrock, str for azure openai)
- bump Chart.yaml
- Update Chart.lock
- bump rag-stack dependency
- answer format for rag
- Update pre-release-a2a-rag
- Update pre-release-a2a-rag.yml
- **jira-mcp**: remove unused imports and f-string prefix
- **jira**: add browse_url to all MCP tool responses
- **jira**: use actual Jira base URL instead of placeholder in links
- **jira**: resolve circular import and fix check_read_only function
- **jira**: remove unused imports in test files
- **ci**: add QEMU setup for multi-platform Docker builds
- updates
- **a2a**: restore max_retries=1 default and tool error tracking
- bump caipe chart version
- disable auto-eval
- bump Chart.yaml
- update agent-ontology chart
- bump chart
- rag chart for v2 ingestor
- update slack ingestor readme
- remove old code, ui bug fixes
- add/update readmes
- remove agent_rag (deprecated)
- rag tool optimisations, crash fix
- lint fixes
- update .gitleaksignore
- GH workflow
- search optimisations, fixed tests and ui fixes
- correct mount path for prompt-config
- **docs**: fix MDX compilation errors in workshop files
- rufflint
- **lint**: fix linting
- **komodor**: improve system prompt and fix a2a noise
- **lint**: fix linting
- **test**: add komodor test prompt
- **lint**: fix linting
- **komodor**: regenerate mcp from openapi spec

### Refactor

- **aws**: make system prompt generic and fix linting issues
- **argocd-mcp**: pin dependencies to latest compatible versions
- **deps**: clean up and align pyproject.toml files
- **build**: remove redundant dev dependencies and pytest config
- **build**: add individual MCP test targets for granular testing
- **build**: decouple test targets for better modularity
- **aws**: remove company-specific references from system prompt
- **aws**: rename agent.py to agent_strands.py
- **aws**: replace company-specific references with generic placeholders
- remove Komodor agent from supervisor configuration
- **aws**: update Strands agent imports and AWS CLI tool integration

### Perf

- **aws**: optimize agent performance with reduced timeouts and semaphores
- **langgraph**: increase recursion limit to 100 for large batch operations

## 0.2.4 (2025-11-24)

### Feat

- **argocd**: add Link column to ArgoCD application tables
- enhance agent prompts and capabilities
- **argocd**: implement two-tier search with automatic exhaustive fallback
- update agents and configuration files

### Fix

- **tests**: ensure test file changes are committed
- **tests**: mock LLMFactory instead of patching env vars for CI reliability
- resolve linting errors

## 0.2.3 (2025-11-21)

### Feat

- bump chart

### Fix

- **workaround**: add ENABLE_ARTIFACT_STREAMING to docker-compose
- updates
- set LLM_PROVIDER env var in test fixtures
- improve complete_result handling and remove ENABLE_ARTIFACT_STREAMING flag
- make agent to dynamically decide available agents
- correct rag-server image repository and bump chart to 0.4.10
- **ci**: prevent docs deployment on tag pushes
- chart was not bumped with prompt config change

### Refactor

- change logger.info to logger.debug for detailed streaming logs

## 0.2.2 (2025-11-20)

### BREAKING CHANGE

- incident_engineer module is no longer available
- Platform engineer agent now uses structured outputs
exclusively. Legacy response formats are no longer supported.

### Feat

- **template**: add PetStore MCP server implementation
- **prompts**: add error handling and security guardrails
- bump chart
- much shorter system prompt for deep supervisor agent
- cahrt bump for prompt config
- ontology agent rewrite for scale
- add webex and argocdv3 ingestors, fix dummy ingestor
- add embeddings factory; separate webloader
- **tools**: add workspace operations and utility tools
- **mcp**: add standardized entry points for MCP servers
- **structured-outputs**: implement structured output support for agents
- **platform-engineer**: implement structured outputs and workspace tools

### Fix

- **docker**: update prompt config path and fix whitespace
- **ci**: correct workflow ID in trigger script
- **ci**: correct workflow ID in trigger script
- **integration**: resolve make quick-sanity test failures
- **logging**: reduce log noise
- **platform-engineer**: filter sub-agent completion signals and preserve DataPart artifacts
- wip 2045
- **prompt**: escape curly braces in TODO example to prevent format() errors
- **executor**: prevent duplicate messages from final response events
- remove tests
- updates
- **agent**: handle tool failures and LangGraph validation errors
- Add 'graph_rag' profile to docker-compose services
- **dev**: updates to jarvis docker-compose
- deal with unseen artifact err
- jira agent tools to hardcode fix for wrong tool calls with params
- **docs**: updates to agent-ops
- **ci**: trigger agent-forge manually
- **docs**: vidcast updates
- reconcile
- reconcile
- **docker-compose**: add MCP host bindings, healthchecks, and configurable prompt path
- deploy script to include GraphRAG services and exclude by default
- embeddings_model typo
- docker-compose: NGINX_ENVSUBST_TEMPLATE_SUFFIX formatting
- **docker-compose**: update profile
- **a2a**: disable structured output by default
- better deep agent prompt and etc
- work with jarvis will required/optional fields
- maintain context id
- webui graph rewrite
- fix backstage ingestor
- add slack ingestor
- fix k8s ingestor
- fix aws ingestor
- Dockerfile fixes
- remove pandas from rag server
- don't build the webui image in main docker-compose
- backstage JWT token is using ES256
- resolve structured outputs compatibility issues
- **a2a**: return brief completion message to prevent content duplication
- **config**: escape template placeholders in YAML prompt config
- **helm**: bump v0.4.5
- **ci**: remove invalid branch prefix from agent-forge SHA tags
- **ci**: ignore argocd and komodor agent tests with missing dependencies
- **docker**: correct agent template name and improve extra_hosts docs
- **docker**: correct agent name for petstore services in docker-compose

### Refactor

- **executor**: make duplicate detection deterministic and update prompt configs
- **petstore**: migrate to BaseLangGraphAgent and shared utilities
- remove agent initialization capabilities greeting and improve prompt config

## 0.2.1 (2025-11-07)

### BREAKING CHANGE

- Agents must now use UserInputMetaData JSON format instead of plain text when requesting user input
- Update A2A protocol field naming from camelCase to snake_case
- Replace artifactId with artifact_id throughout codebase
- Replace messageId with message_id in streaming events
- Replace taskId with task_id in context handling
- Replace contextId with context_id across protocol
- Replace lastChunk with last_chunk in streaming
- Update TypeScript schema in Agent Forge frontend to match

### Feat

- enhance user input transformation with detailed recipe
- add user input metadata format and improve agent orchestration
- add UserInputMetaData format and automatic error retry logic
- enhance agent system with parallel execution and improved UX
- parallelize MCP client initialization with graceful failure handling
- add MCP initialization retry logic with configurable timeouts
- add grep_virtual_file tool for efficient large output search
- add critical directive to preserve sub-agent output details
- add GitHub CI/CD failure analysis directive to system prompt
- enhance multi-agent queries with unified tabulated results
- add our github repo link easy for mobile
- maintain same defaults and properly bump charts
- add redis persistence, external secrets v1 support, and fix dependencies
- add info on PR template
- allow helm pre-release on fork PRs using label
- Use more standard pattern for Helm ingress
- build agent-forge on push to main and remove cronjob
- Support multi-platform Docker builds (AMD64 + ARM64)
- Update agent-forge Dockerfile for AMD64 compatibility
- refactor a2a stream with common code and fix agent-forge workflow
- add prompt templates and agent integration improvements
- Add execution plan markers and creation confirmation policy
- Major streaming architecture improvements and prompt enhancements
- update a2a streaming and agent improvements
- implement A2A streaming and common code refactoring
- refactor a2a_stream with common code
- major ingestor refactor
- add retry when 429 Too many requests
- add istio support and extraDeploy for custom resources

### Fix

- Docker Compose dev file not starting properly
- **docs**: fix npm build errors and broken links
- **agent-aws**: change default AWS agent backend to 'strands'
- disable test-rag-all target in Makefile
- update uv.lock for agent-rag Docker build
- escape curly braces in YAML template for Python format()
- resolve agntcy-app-sdk 0.4.0 compatibility issues
- Remove deprecated A2AProtocol import from agntcy_remote_agent_connect
- Derive a2a_topic directly from agent card name
- Fix agent registry to use agent-card.json endpoint
- Update all agent dependencies to use slim-bindings 0.4.1
- resolve pyproject.toml workspace dependency conflicts
- Change mcp-argocd from workspace to path dependency in argocd agent
- Remove ai_platform_engineering/agents/argocd/mcp from workspace members
- Prevent uv dependency resolution conflicts during Docker builds
- correct indentation errors in Python streaming code
- Fix indentation in agent_executor.py streaming logic
- Fix indentation in base_langgraph_agent_executor.py
- Fix indentation in helpers.py event processing
- Fix indentation in webex agent a2a_server helpers
- use hybrid architecture for A2A tool visibility and streaming
- remove prompts.py subagent generation at import time
- use CustomSubAgents with tools=[] to avoid write_todos conflicts
- stream ToolMessage content to display formatted TODO lists
- enforce A2A agents as tools instead of Deep Agent subagents
- work with CORS for id token auth
- deep_agent prompt with correct {}
- command syntax in user-interfaces.md
- correct ingress path templating and consistent rag ingress
- **docker-compose**: use stable image
- **prompt_config.deep_agent.yaml**: updates
- Logging of authentication configuration
- agent-forge ci gh action
- lint
- Build agent-forge Docker image for AMD64 only
- use shell to cd into workspace directory before starting
- run yarn from workspace root to access state files
- simplify Dockerfile to copy all files at once
- copy .yarn directory to Docker container for Yarn 4.9.4 binary
- remove unnecessary Node.js setup and build steps from workflow
- resolve yarn workspace state file issue in agent-forge build
- updates
- **docker**: align docker-compose contexts with Dockerfile changes
- **docker**: include __main__.py files in agent Docker builds
- resolve RAG unit tests virtual environment and module import issues
- **agents/template**: resolve Docker build failure in CI
- **build**: export PYTHONPATH for all agent run targets
- **build**: add PYTHONPATH and fix RAG server venv detection
- **build**: correct Dockerfile paths in Makefiles to use absolute paths
- **build**: update Makefiles to use repository root as Docker build context
- **docker**: correct RAG Dockerfile paths and enable supervisor builds for prebuild branches
- **docker**: correct A2A directory paths in agent Dockerfiles
- **docker**: correct MCP directory path in agent Dockerfiles
- update weather agent dockerfile
- update rag agent dockerfile
- update webex agent dockerfile
- update confluence agent dockerfile
- resolve Docker build context issues for RAG and A2A agents
- **ci**: resolve RAG agent Docker build context issues
- **ci**: resolve Docker build context issues for agent containers
- **splunk**: apply automatic linting fixes
- resolve test suite issues and enable linting
- restore RAG direct routing and add streaming tests
- Weather and Webex agent environment and MCP configuration
- Update Weather and Webex agent Docker configurations
- **async-streaming**: wip
- **async-streaming**: wip
- Fix linting issues and verify tests pass
- lint and tests
- better docker-compose and temporarily disable aws
- webui with new ingestors
- get agent_ontology with new common libs
- add rag_ontology tests; lots of bugs fixed
- server improvements
- update common module
- graph ui improvements - working buttons
- agent_ontology bug fixes; using tool instead of structured output
- e2e tests for rag components
- add e2e tests; bug fixes; more info in healthz
- agent-rag uses MCP instead of direct DB access
- **auth**: Fix shared key authentication not loading middleware
- rag broken links
- docs - broken links
- docs sidebar - remove unused pages
- rag-arch image
- delete old docs
- update rag docs
- updates
- updates
- updates

### Refactor

- integrate MCP retry logic directly into initialization
- Weather and Webex agents to use BaseLangGraphAgent
- GitHub agent to use BaseLangGraphAgent for consistent streaming
- Move prompt_config.yaml to charts directory and relocate docs
- Refactor AWS agent to use BaseStrandsAgent and BaseStrandsAgentExecutor
- **a2a**: move a2a agent and bindings code to common library

## 0.1.19 (2025-10-22)

### Feat

- **helm**: Add flexible prompt configuration with default and deep agent modes
- up to date helm and external secrets doc
- **helm**: add promptConfig override support
- adding job termination, reload and search weights
- add mcp server for RAG
- add Claude Agent SDK template with A2A and MCP protocol bindings
- add dev version of complete
- allow supervisor agent to work with any remote agent
- add condition to rag-stack and fix webui;
- new rag-stack chart
- add agent_skill_examples in prompt_config
- add ENABLE_<agent> to supervisor cm
- use skills example config
- agent-rag can now filter
- dynamic docker-compose generation with persona-based profiles
- add dynamic docker-compose generator and persona configuration
- add agent-aws-slim and agent-petstore-slim services

### Fix

- better idpbuilder docs;
- **docs**: gh pages
- remove redundant test-data
- add e2e tests; rm local tests
- ui improvements
- RAG ingestion and retrieval bug fixes
- **ci**: Correct dependency verification pattern for helm packages
- **ci**: Skip version check when only Chart.lock changes
- **helm**: skip packaging if chart version already published
- **helm**: ensure rag-stack dependencies always packaged in ai-platform-engineering
- lint and tests
- webui improvements
- uv-lock
- RAG tests; add url santization
- **docs**: use idpbuilder scripts from git repo
- **gha**: updates
- **gha**: updates
- **gha**: updates
- **lint**: updates
- **unit-tests**: updates
- **unit-tests**: multi-agent tests
- **gha**: update supervisor ci name
- **unit tests**: clean-up
- **gha**: build on .github changes
- **gha**: build on .github changes
- **gha**: build on .github changes
- **gha**: update names
- working docker-compose.caipe-complete-with-tracing
- correctly handle aws bedrock streaming format
- rufflint
- make AWS agent to run in executor to prevent blocking
- make supervisor agent work dynamically
- rufflint
- remove empty file
- use fields from pydantic model
- **rag**: add init tests, add delete_all function
- **docker-compose**: use latest
- remove unnecessary files
- optimise search with weighted ranker
- fix
- delete ai.yaml
- no rag name or
- rag-stack needs agentExports
- add rag to supervisor cm
- wrong env place
- fix
- all neo4j hardcoded to port 7687
- handle when chart does not exist in main yet
- update chart version correctly for pre-release
- **README.md**: re-trigger build
- **README.md**: re-trigger the build
- **.dockerignore**: include all rag sources
- **README.md**: retrigger build
- exclude from supervisor, but include clients
- remove `knowledge-bases` .dockerignore
- change to .gitleaksignore
- add nosec to neo4j instantation
- lint
- **rag**: webui nginx; logging; prompt improvements
- agent_rag footnote for filtering
- code comments
- lint errors
- lint
- change dense metric L2 -> COSINE
- agent_rag now checks for graph ontology
- lint

### Refactor

- **multi-agents**: consolidate agent registry with convention-based configuration

## 0.1.18 (2025-10-06)

### Fix

- **rag**: build on all tags

## 0.1.17 (2025-10-06)

## 0.1.16 (2025-10-04)

### BREAKING CHANGE

- none
Closes: #324

### Feat

- **agents**: enhance jira agent and add argocd tests
- **agents**: enhance jira agent and add argocd tests
- add connectors
- add common utils
- unified rag server
- migrate ontology and rag agent
- **deepagents**: add deepagents package locally
- **backstage**: add TechDocs tools for improved documentation access
- disable graphrag in helm chart until fixed
- add tags to helm dependencies
- current experiment-dev-use2-1 values

### Fix

- resolve RAG agent connection issues
- lint
- agent_rag is now like all other agents
- **docker-compose**: remove dev volume mount
- updates
- docker-compose; integrate rag with supervisor attempt
- updates
- **agent-rag**: update uv.lock
- **rag**: update docker compose and bring back clients
- optipnal disable graph-rag; prompt tweaks; raw_query tweaks
- rag-query-test
- agent_rag prompts lint
- Makefile
- gh-workflow, linting, small bugs
- remove deprecated kb_rag
- remove deprecated graph_rag
- fix dockerfiles and docker compose
- remove redundant client and pytest files
- remove more redundant license, changelog etc.
- remove redundant license, changelog etc.
- add package-lock.json for webui
- un-ignore package-lock.json
- add pywright to gitignore
- **format**: deep agents ruff fixes
- **format**: add ruff linting fixes
- **streaming**: remove response format from system prompt
- **streaming**: enable structured output
- **merge**: fix conflicts
- **merge**: fix conflicts
- **backstage**: update lockfile after adding pyyaml dependency
- **idpbuilder**: update docs
- actually bump main chart version
- remove a2a-stable tag reference;
- for now always set is_task_complete as True in order to avoid Queue is closed err
- **kb-rag-agent**: prevent ExternalSecret creation when data is empty
- **idpbuilder**: update paths
- use helm dependency imports
- add note on why slim is a condition
- slim will have to be a condition
- disable all tags by default
- remove all condition
- no condition path by default
- updates
- Remove undefined imports from evals __init__.py
- remove test_extractor.py error file
- pin kb-rag services to sha-f3a1a25
- fix workshop4 to specific version

### Refactor

- improve RAG agent configuration and testing
- **argocd**: modernize string formatting in server.py

## 0.1.15 (2025-09-19)

### Fix

- **ci**: A2A/MCP builds

## 0.1.14 (2025-09-19)

### BREAKING CHANGE

- helm chart version bumped to 0.2.3

### Feat

- **auth**: update A2A authentication configuration
- add additional authentication options for A2A protocol
- add missing agent deployments for aws, splunk, webex, komodor

### Fix

- **ci**: A2A/MCP build and publish on main/tags
- **ci**: A2A/MCP build and publish on main/tags
- **ci**: A2A/MCP build and publish on main/tags
- **A2A_AUTH_SHARED_KEY**: set default to false
- CHANGESET.md
- lint
- updates
- correct commit count for prebuild GHAs

## 0.1.13 (2025-09-18)

### Feat

- upgrade Jira agent to API v3

### Fix

- undo helm values.yaml

## 0.1.12 (2025-09-17)

### BREAKING CHANGE

- test command now runs both general and RAG module tests
- Redis service port name changed from 'http' to 'redis'

### Feat

- idpbuilder values
- add OAuth2 authentication support for A2A protocol
- add integration test workflows and improve agent Docker build automation
- updating collection name from rag-default to rag-united
- backend data management improvements for milvus and redis
- adding addtional config in web UI frontend
- add prebuild docker image github actions
- Only build images if relevant change
- Adding streamable http to Webex agent
- Adding initial, optional Webex agent
- Adding streamable http to Webex agent
- Adding initial, optional Webex agent
- use routing evaluator and tool match evalutor and use the expected ouptut in the dataset
- implement new llm-trajectory match evaluator
- redesign the trajectory and tool call match evaluator
- **trace**: redesign trace processing method to get the tool call
- **evals**: refactor evaluator architecture and switch to OpenAI
- **evals**: add unified trajectory evaluator with graceful LLM fallback
- **evals**: link dataset traces with platform engineer execution
- **evals**: add auto-detection for Langfuse host in upload script
- add expected_output support and separate upload functionality
- add eval service
- major helm chart refactor
- implement memory-optimized batch processing for URL loading
- update agents documentation and sidebar
- enhance coverage reporting with detailed metrics and tables
- **tests**: add comprehensive test suite with memory monitoring and scale tests
- add AWS agent to include cost explorer MCP (#251)
- add kb-rag-web to helm chart
- add the aws agent to platform engineer (#246)
- Addition of Agent Splunk (#247)
- use a2a card to dynamically create client
- added redis db management backend
- added reranking
- frontend now supports RAG config
- add multiple llm provider support for graphrag

### Fix

- updates
- adding generic to custom parser to scrap sites like wikipedia
- updating docker compose for the workshop
- **gha**: update for tags
- gha litellm typo fix
- **mcp-docker-build**: add webex mcp
- update sidebars.ts
- updated loader.py
- updated rag_api
- dividing rag_api for added flexibility and readiness
- adding init file
- changed variable name from UNIFLIED_COLLECTION_NAME TO DEFAULT_COLLECTION_NAME
- renaming: rag_united --> rag_default
- docker compose
- **graph-rag**: lint
- **graph-rag**: heuristics improvements, use graph db to store relation candidates
- correct mcp image builds - use OR not AND
- improve the prebuild github actions
- add litellm to mcp as well
- fixed conflicts between main
- also modify supervisor agent
- AND not OR
- lint
- fix slim to work
- Add queue closed error protection to prevent crashes during shutdown
- unit tests and quick sanity
- ruff linter
- minor formatting in splunk
- added webex to platform engineer
- adding logs to webex mcp
- adding webex to workflows
- updating docker compose
- adding init files to webex client
- **docker-compose.dev**: add p2p-tracing profile to nexigraph
- no default env in kb-rag-server chart
- **evals**: resolve linting issues and remove hardcoded local paths
- **evals**: update evaluation datasets with correct agent names and enable tests
- **evals**: remove unnecessary .python-version and fix Dockerfile
- **evals**: improve A2A client integration and add Azure OpenAI support
- remove relative import
- update docker-compose networking and ports for p2p-tracing
- resolve Docker compose issues for evaluation webhook
- update weather agent dependencies and Docker configuration
- kb-agent-rag requires milvus secret
- smaller milvus res
- remove excessive resource requests
- remove node selector and limit eph storage
- further cleanup
- remove unsued env
- bring latest milvus vals and template milvus uri
- try more delay
- revert wrong change
- default llmSecrets in kb-rag-server
- correct liveness and readiness port for kb-rag-agent
- kb-rag-server also requires llm secret
- copy working milvus values
- move milvus to the parent chart
- milvus is INSIDE kb-rag-stack...
- remove deprecated isMultiAgent
- correct appVersion
- properly fix kb-rag-agent secrets
- modify kb-rag-stack for the same change
- resolve unit test failures and improve memory optimization
- mcp_splunk symlink to be in-repo relative
- **rag**: restructure package to use rag.server.* namespace
- **docker**: update Dockerfile for new package structure
- **rag**: update coverage configuration for new package structure
- **helm**: bump chart version to 0.1.18
- **rag**: restructure KB-RAG package with proper scoping
- **ci**: resolve KB-RAG Stack Helm chart test failures
- **ci**: resolve Helm chart test failures in GitHub Actions
- **docs**: resolve broken links causing Docusaurus build failures
- **ci**: add proper download links for coverage artifacts
- correct XML attribute access for coverage parsing
- handle missing main coverage and improve coverage reporting
- update remaining uv.lock files and add coverage debugging
- update uv.lock files to resolve Docker build issues
- add debugging and error handling for coverage XML parsing
- update uv.lock files to resolve Docker build issues
- remove stray 'p' character causing JavaScript ReferenceError
- add --index-strategy unsafe-best-match for PyTorch CPU installation
- use --extra-index-url instead of --index-url for PyTorch CPU installation
- update a2a-sdk dependency format and workspace configuration
- resolve a2a-sdk dependency issue in CI
- install CPU-only PyTorch in RAG tests to avoid NVIDIA packages
- Pin all a2a-sdk versions to 0.2.16
- Add missing fs import in GitHub Actions workflow
- Resolve Docker build workspace member issues
- Exclude RAG module tests from main test suite
- Remove Poetry dependencies and migrate RAG module to UV
- unit tests and linting
- lint
- **rag**: replace incorrect ascrape method with proper LangChain async methods
- optimize memory usage by streaming page processing (#253)
- **kb-rag-redis**: correct service port configuration to match deployment (#252)
- add milvus to parent chart
- updates
- updates
- update kb-rag-server
- update kb-rag-server
- **kb-rag-agent**: restore
- **kb-rag-stack**: add condition: agent.enabled
- remove kb-rag-agent dedicated chart
- updates
- just add a new subchart for now
- default no SA
- **aws**: ruff lint
- broken links
- updates
- remove debug line
- **aws-agent**: ruff lint
- fixed readme and created agent container
- add try/except when agent is unreachable
- docker compose dev
- docker compose dev
- docker compose dev
- docker compose dev
- add misc utils - run coroutine in sync
- cleanup how we do agent enabled
- ruff lint
- **graph-rag**: qa agent now fetches properties before raw query
- created was being updated regardless
- ruff linter
- clean kb-rag workflow to reduce space usage
- ruff linter
- ruff linter
- added dockerignore
- updated docker compose
- update uv lock
- include in pyproject
- get rid of non existing func
- much simpler fix :)()(
- ruff linter
- **workshop**: mission4: rag-agent docker port -> 8020
- **workshop**: mission4: rag-agent docker port -> 8020
- **workshop**: mission4: switch to main tag for github agent
- **workshop**: mission7
- **workshop**: mission7
- **github**: add load_dotenv
- updates sidebars.ts for docs
- png to svg
- png to svg
- **workshop**: mission4: add restart policy to docker compose
- updating port number for kb-rag
- typo for logger message
- **workshop**: switch mission4 to a different env file
- **weather**: add self.mcp_api_key

### Refactor

- **evals**: improve eval run naming with readable timestamp format
- **evals**: clean up directory structure and remove obsolete files
- remove hardcoded agent detection and use dynamic regex patterns
- create kb-rag-stack

## 0.1.10 (2025-08-26)

### Fix

- **petstore**: add PETSTORE_API_KEY support
- correct petstore mcp env var name
- Update README.md (#230)

## 0.1.9 (2025-08-26)

### Fix

- **github**: add ENABLE_MCP_TOOL_MATCH feature flag (#229)
- ruff lint
- rag ingestion crash; workshop docker file

## 0.1.8 (2025-08-25)

### Feat

- **argocd**: add argocd sanity tests for local argocd kind instance (#224)

### Fix

- **petstore/weather**: bug fixes (#225)
- **docs**: escape  in Jira MCP comparison table for MDX compatibility
- update navigation

## 0.1.7 (2025-08-25)

### Feat

- **workshop**: add workshop 7 docker-compose
- add http mcp remote support for petstore and weather agents
- implement job tracking and ingestion progress for URL processing
- initialize frontend for KB RAG with React, Vite, and Tailwind CSS
- create dev mission docker file
- add petstore to docker-compose.weather
- add multi-agent dynamic connectivity and petstore refactor
- add weather agent with stdio mcp server
- adding rag-ingestion pipeline
- **brand**: update docs to CAIPE branding (#211)
- add eval prompts (#191)
- **docker**: use multi-stage builds to reduce container size (#198)
- add a new graphrag helm chart

### Fix

- docker-compose.mission2.yaml
- **weather**: use remove URL (#223)
- **workshop**: remove langfuse components from mission 7
- **workshop**: add network host to langfuse web
- **workshop**: remove rag from mission 7
- **workshop**: remove profiles from docker compose 7
- **docs**: update solution architecture
- **docs**: update solution architecture
- **docs**: update solution architecture
- add docker build for kb-rag ui
- add mission docker-compose, add prgress message for chunked doc
- **README.md**: add start history (#217)
- lint errors and argocd mcp bugs (#218)
- ruff lint
- **argocd**: test and validate mcp after auto-generation changes (#215)
- update reference/source when outputting answer
- default top_k for query 10 -> 3, better log
- add empty document fields instead of omitting
- kb-rag-agent image
- add weather for a2a build gh action
- lint
- petstore agent and refactors
- Dockerfile, add page counter
- **argocd**: add VERIFY_SSL and ARGOCD_VERIFY_SSL support in mcp (#209)
- removing knowledge base from .dockerignore
- **argocd.md**: update kubectl context
- **kb**: add init file to make it a package
- **kb**: add init file to make it a package
- **common.mk**: make run-mcp
- adding init files
- platform engineering workflow push to main
- **docker-compose**: remove a2a- prefix (#200)
- docker latest images with uv.lock (#199)
- replace dotenv to python-dotenv
- **uv**: add dotenv
- **uv**: add dotenv
- remove bad file change
- bump all chart v and app v
- mount path
- fix multiagent volume mount and clean up
- no lb
- fix2
- fix"
- neo4j official chart
- redis
- no probe
- similar env fix
- correct var names
- set storage class default to gp2 for now
- wrong secretRef path
- create json file and make graphrag optional
- add SA field

## 0.1.5 (2025-08-15)

### Feat

- fix Langfuse trace ID propagation in multi-agent system (#195)
- **helm**: add useRemoteMcpServer to use remote MCP server (#193)
- add mcp http support to helm chart (#190)

### Fix

- Dockerfile improvements and add .dockerignore (#197)
- fix missing sub helm chart bump
- mcp dockerfile to give .venv permissions (#192)

## 0.1.4 (2025-08-12)

### Fix

- **build**: update workflow triggers
- **build**: remove a2a prefix for agent container images
- **build**: build and publish agents on every push to main and tags

## 0.1.3 (2025-08-12)

### Feat

- add slim to helm chart (#187)
- use agntcy-app-sdk to integrate with agntcy slim (#171)
- **graph-rag**: add evaluation and tests
- embed vidcast in idpbuilder doc
- add a new pre-release helm chart github action
- output URL to help user.
- updated kb-rag from agent-rag
- implement distributed tracing across all agents (#139)
- add idpbuilder docs (#142)
- allow external url as the A2A url (#122)
- intial commit incident engineer (#111)
- **graph_rag**: create nexigraph graph rag system (#97)
- **rag**: doc load, embed, vector store, retrieve (#96)
- updates
- updates
- remove dependency.yml
- updates
- update OSS artifacts and github actions
- add some colours to the docs code block
- add doc for eks deployment
- **helm**: add command and args to deployment
- **helm**: publish chart
- add CORS and use LLMFactory
- use cnoe_agent_utlis
- publish helm
- added ci pipeline
- added ci pipeline
- added A2A server and re-formatted
- add A2A integration and new MCP server (#5)
- Use cnoe utlis to get rid of llm_factory to encompass latest LLMs
- added google's A2A server and client side
- short term memory to the agent
- add helm publish
- add CORS and fix lint errors
- use cnoe_agent_utlis instead of llm_factory
- add agent forge
- **agent-komodor**: add komodor agent
- add script to automate Helm configuration for new agents
- **docs**: add docs website
- implement dual-mode docker-compose and update the readme and example env
- **tracing**: use env to enable tracing
- monkey patch a2a noise
- implement langfuse v3
- publish helm
- added ci pipeline
- added ci pipeline
- added A2A server and re-formatted
- add A2A integration and new MCP server (#5)
- adding confluence agent
- publish helm
- added ci pipeline
- added ci pipeline
- added A2A server and re-formatted
- add A2A integration and new MCP server (#5)
- add agent-a2a-docker-build.yml
- add mcp server support (#45)
- **helm**: Implement helm chart (#42)
- propogate context_id from user client LangGraph thread_id (#34)
- **Dockerfile**: add multi-arch support
- **cors**: add CORS and update ACP/A2A graph entry point (#11)
- add A2A integration and new MCP server (#5)
- adding 6th agent backstage
- allow custom prompts via YAML config and restore original agent/platform prompt defaults

### Fix

- **build**: add latest tag for agent builds
- add kb-rag to Platform Registry
- readding new clients to kb-rag
- updated-docker compose
- format in agent a2a docker builder
- **a2a-docker**: publish on main and tags
- mcp docker improvements (#186)
- quick sanity tests and docker-compose files (#185)
- **quick-sanity**: add komodor variables
- **quick-sanity**: clean-up workspace
- **quick-sanity**: update variables
- **quick-sanity**: update runner name
- **quick-sanity**: use caipe-integration-test-runner
- **mcp**: use mcp-xxx container names
- **ipdbuilder**: update idpbuild docs (#182)
- linting, add eval results for graph-rag
- **graph-rag**: give similar relations when evluating
- **README.md**: add note to latest docs
- docs images need to be svg not png
- update chunk number
- using the right azure embeddings
- updating prompts
- ruff linter
- loaded kb-rag into caipe's environment
- another version number
- updated a2a version
- surpress milvus logs
- github workflows
- renamed kb-rag to rag to fix import errors
- updated kb_rag
- fixed breaking change
- updated docker-build
- added kb-rag
- updated docker builder
- updated docker build
- **docs**: update tracing docs
- add profiles to graph_rag/nexigraph services
- remove a2a from nexigraph images
- add ghcr.io prefix to images
- nexigraph client path
- nexigraph build path
- docker-compose graphrag image
- **docs**: nexigraph agent names
- helm correct externalSecret templating
- agent-jira and agent-confluence (#133)
- ruff lint
- **graph-rag**: adding tests for heuristics; better heuristics; more accurate evalaution
- helm chart agent-forge needs http for healthcheck
- always pull and expose external url
- **lint**: errors
- **supervisor_agent**: system prompt optimization and use agent tools (#117)
- **atlassian**: remove agent-atlassian (#116)
- add tools, utils and meeting recordings
- **docs**: ics file path
- **docs**: ics file path
- **docs**: ics file path
- **README.md**: update arch diagram
- ruff linter fails (#102)
- allow multiple ports for agents
- **tracing**: enable tracing in local build docker-compose
- remove GOOGLE_API_KEY dependency
- **docker-compose**: restore
- import error
- **prompts**: update backstage import
- **docker-compose**: create multiple profiles build, latest (#98)
- **a2a-docker**: update triggers
- **clean-up**: remove helm charts
- remove .DS_Store
- reconcile updates
- migrate agent-pagerduty
- ruff linter
- updated line length ruff linter
- deleted tests
- updated mcp server to reflect correct imports
- updated imports
- docker action build
- cleanup of agent-template
- updated dependencies
- updates
- **Makefile**: clean-up targets
- updates to code
- reconcile PR comments
- add ai_platform_engineering/agents/argocd/build/Dockerfile.mcp
- **lint**: reconcile
- **ci**: run A2A parallel build on PR push
- **langgraph**: updates
- **clean-up**: remove redundant files
- **ci**: build all agent docker images
- updates
- updates
- add Dockerfile.a2a
- **agents**: update Dockerfile.a2a file and clean-up
- update build/Dockerfile.a2a
- **docs**: authors.yml
- **docs**: broken link
- correct sidebar order
- helm deployment rendering fix
- update app and chart versions to 0.1.3 and adjust secret reference logic in deployment.yaml
- correct conditional logic for secret reference in deployment.yaml
- update app and chart versions to 0.1.2 and adjust values for backstage plugin
- lint errors in add-new-agent-helm-chart.py
- agent-forge should be port 3000
- bump helm chart patch version
- updated stable tag
- mcp server api/catalog fixes
- remove .keep files
- **Dockerfile**: use python:3.13-slim
- client side context_id
- server side context_id
- ruff lint changes
- async error fixed.
- lint errors
- lint github actions
- **Dockerfile**: use python:3.13-slim
- updates
- updates
- client side context_id
- server side context_id
- remove AzureChatOpenAI in agent
- remove AzureChatOpenAI in agent
- **jira**: update search results
- lint errors
- add CORS support
- add ruff in ci pipeline
- ci errors
- remove acp docker build
- remove GOOGLE_API_KEY
- README.md
- **acp**: update run-acp based on latest wfsm changes
- **acp**: update run-acp based on latest wfsm changes
- update GHA
- **acp**: update run-acp based on latest wfsm changes
- **SECURITY.md**: add CNOE steering committe email
- update docker-build-push.yaml
- update copyright headers
- add argocd_mcp submodule
- **Dockerfile**: use python:3.13-slim
- **helm**: publish helm chart
- server side context_id
- client_slide_context_id
- add CORS support
- ruff pipeline
- ci errors
- ci updates
- remove GOOGLE_API_KEY
- **acp**: update agent.json
- **acp**: update agent.json
- updated .gtihub
- added dockerfile.a2a and acp
- path changed for docker acp and a2a
- update a2a and acp docker
- updated docker files in .github
- remove invalid async context usage with MultiServerMCPClient
- technical issue with data retrieval
- pagerduty token and logs
- **docs**: updates
- **README.md**: updates
- **README.md**: updates
- **README.md**: updates
- **README.md**: updates
- **README.md**: updates
- **docs**: update README.md
- **Dockefile**: use python:3.13-slim
- **helm**: change default service port to 8000
- **helm**: rename chart to agent-github
- ruff linter
- use LLMFactory and lint errors
- remove acp docker build
- ruff lint
- client side context_id
- server side context_id
- **docs**: add some under construction anchors
- **docs**: add github issues
- **docs**: broken link
- **docs**: update usecases
- **.env.example**: remove it to fix linter
- helm gh wf with correct paths
- helm chart push on merge
- **docs**: updates
- Update user-interfaces.md
- broken links
- **komodor-agent**: only deploy komodor agent if use docker compose override
- **komodor-agent**: use llm factory instead of langchain library
- update python script name
- reconcile
- **docs**: README.md
- **docs**: updates
- **docs**: updates
- **docs**: updates
- **docs**: update sidebars.ts
- **docs**: add blog and simplify
- updates
- editUrl link
- **docs**: update edit links
- **docs**: github action publishing update baseUrl
- **docs**: github action publishing
- **docs**: github action publishing
- **docs**: github action publishing
- add langfuse reference
- updates
- merge updates
- add missing import os
- updates
- updates
- client side context_id
- server side context_id
- remove AzureChatOpenAI in agent
- remove AzureChatOpenAI in agent
- **jira**: update search results
- lint errors
- add CORS support
- add ruff in ci pipeline
- ci errors
- remove acp docker build
- remove GOOGLE_API_KEY
- README.md
- **acp**: update run-acp based on latest wfsm changes
- **acp**: update run-acp based on latest wfsm changes
- update GHA
- **acp**: update run-acp based on latest wfsm changes
- **SECURITY.md**: add CNOE steering committe email
- update docker-build-push.yaml
- update copyright headers
- add argocd_mcp submodule
- docker container build
- fixed agent tools
- updates
- updates
- client side context_id
- server side context_id
- remove AzureChatOpenAI in agent
- remove AzureChatOpenAI in agent
- **jira**: update search results
- lint errors
- add CORS support
- add ruff in ci pipeline
- ci errors
- remove acp docker build
- remove GOOGLE_API_KEY
- README.md
- **acp**: update run-acp based on latest wfsm changes
- **acp**: update run-acp based on latest wfsm changes
- update GHA
- **acp**: update run-acp based on latest wfsm changes
- **SECURITY.md**: add CNOE steering committe email
- update docker-build-push.yaml
- update copyright headers
- add argocd_mcp submodule
- helm chart workflow improvements
- correctly add global secretName
- **argocd**: update poetry.lock
- **multi_agents**: rename mas->multi_agents
- github actions workflows
- **gha**: typo
- **poetry**: updates
- build docker errors
- update test dependencies
- unit tests
- lint
- import errors
- **query-params**: Don't add query param to request if None (#44)
- **Dockerfile**: use python:3.13-slim
- **api**: support nested body parameters and fix boolean types
- **helm**: default service port 8000
- **helm**: version 0.1.1
- **helm**: Update image.tag in values.yaml
- **helm**: updates
- **helm**: updates
- **helm**: updates
- **helm**: only trigger on tags
- **test**: lint errors
- **helm**: update gh workflow
- **helm**: update gh workflow
- **README.md**: update local dev tasks
- temporarily remove api_v1_applications_manifestsWithFiles
- update mcp_server bindings (#33)
- **README.md**: updates
- **README.md**: update architecture diagram
- add MCP_VERIFY_SSL for local development and update README (#32)
- rename to A2A_HOST and A2A_PORT (#31)
- **acp**: docker image
- updates to A2A client (#22)
- update to use argocd
- updates with AGENT_NAME
- **MAINTAINERS.md**: updates
- **README.md**: status badgese
- update README.md
- **README.md**: demos
- **README.md**: project structure
- **README.md**: update badges
- **agent.json**: update to conform to new specification (#12)
- **README.md**: update mcp server link
- import error for a2a and python3 (#9)
- **protocols**: add a2a-sdk and update makefile (#10)
- README.md
- **acp**: update run-acp based on latest wfsm changes
- **acp**: update run-acp based on latest wfsm changes
- update GHA
- **acp**: update run-acp based on latest wfsm changes
- **SECURITY.md**: add CNOE steering committe email
- update docker-build-push.yaml
- update copyright headers
- add argocd_mcp submodule
- updates
- updates
- prompt_config.yaml
- add prompt_config_example.yaml
- minor fixes
- updates
- **Makefile**: update run-ai-platform-engineer and set run as default target
- **docker-compose**: comment out agentconnect by default
- add incident_engineer placeholder
- **env**: use .env instead of .env.foo per agent
- **docker-compose**: restore agentconnect ui
- add CORS and update system prompt
- **a2a**: update docker-compose bring up
- **Makefile**: add setup-venv
- update the default AGENT_PORT 8000
- updates
- unittest, lint and container name
- updates
- **Dockerfile**: update ci
- updates

### Refactor

- prompt config to use structure output. Use UV, langgraph==0.5.3, a2a-sdk==0.2.16 (#155)
- **docs**: simplify the top level menu (#110)
- **agent-atlassian**: remove and update that it is split into Jira and Confluence agents (#103)
- **multi_agents**: move build directory
- update Makefile, Dockerfiles, and clients for LangGraph agent deployment
- with latest changes
- create protocol_bindings directory for acp/a2a/mcp
- updated a2a, acp, mcp and docker addition
- updated previous acp and standardized new format.
- with latest changes
- create protocol_bindings directory for acp/a2a/mcp
- with latest changes
- create protocol_bindings directory for acp/a2a/mcp
- **external-secrets**: improve secret name handling and update configuration examples
- **monorepo**: rename mas->multi_agents, use seperate mcp python project
- **agent-argocd**: collapse to ai-platform-engineering
- clean-up old code and update docs (#38)
- docker support, clean-up, new chat client interface (#13)
- create protocol_bindings directory for acp/a2a/mcp
- optimize system prompt from a2a cards and skills
