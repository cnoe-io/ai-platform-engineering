---
title: Platform Capabilities
description: Complete catalog of released CAIPE user, administrator, and operator capabilities.
---

# Platform Capabilities

CAIPE is an open-source AI platform for building, deploying, governing, and
operating AI agents and agentic workflows for platform engineering.

CAIPE provides a complete cloud-native AI platform combining agent creation,
runtime execution, workflow automation, skills and MCP integrations, enterprise
knowledge, persistent memory, identity and authorization, observability, and
multi-channel user experiences.

This catalog describes capabilities present in the released platform. A
deployment can hide a capability when its service, feature flag, storage
dependency, or authorization policy is not enabled.

## User Capabilities

| Capability | What it provides | Availability |
|---|---|---|
| Home | Entry points, recent conversations, personal insights, and shared conversations | Always available after sign-in; insights and sharing require persistent storage |
| Chat | Streaming agent conversations, tool activity, files, feedback, history, and sharing | An accessible chat agent and runtime must be configured |
| Dynamic Agents | No-code agent creation with prompts, models, MCP tools, skills, subagents, and workflow access | Requires persistent storage and the Dynamic Agents deployment |
| Skills | Browse, author, import, revise, scan, and install reusable skills | Gallery is available in the Web UI; some actions require storage, scanner, or gateway configuration |
| Workflows | Build and run multi-step agent automations | `WORKFLOWS_ENABLED=true` |
| Knowledge Bases | Ingest, search, group, and govern enterprise knowledge | `RAG_ENABLED` is enabled and the RAG service is reachable |
| Schedules | Run agent prompts on recurring or one-time schedules | Dynamic Agents, MongoDB-compatible storage, and `SCHEDULER_ENABLED=true` |
| Autonomous tasks | Review and manage tasks owned by autonomous agents | `ENABLE_AUTONOMOUS_AGENTS=true` and the user has an eligible agent |
| Credentials | Connect OAuth applications and store protected secrets for tools | Credentials and user connections are enabled |
| Personal settings | Appearance, default agents, notifications, account access, and developer diagnostics | Available after sign-in; individual settings depend on deployment capabilities |

## Administrator Capabilities

| Area | Capabilities |
|---|---|
| Teams & Users | User access, roles, teams, memberships, shared resources, and optional identity-directory synchronization |
| Platform configuration | Platform defaults and release announcements |
| Resources | Agent configuration, autonomous execution, MCP catalog, RAG, Skill Hubs, service accounts, and credential administration |
| Integrations | Slack channel and Webex space onboarding, routing, access, and diagnostics |
| Insights | Adoption statistics, agent and workflow activity, skill metrics, and user feedback |
| Metrics & Health | Runtime metrics, dependency health, build information, and authorization metrics |
| Security & Policy | Pre-sign-in access, AI review, publication approvals, access exploration, RBAC checks, audits, identity health, and migrations |

Admin destinations are fail-closed. CAIPE displays only the destinations the
current identity is authorized to view and that the deployment has enabled.

## Platform and Operator Capabilities

- Docker Compose and Kubernetes/Helm deployment paths
- Config-driven bootstrap for models, MCP servers, agents, and workflows
- MongoDB-compatible persistence for shared platform state
- OAuth/OIDC authentication and team-aware authorization
- OpenFGA relationship-based access control
- Service accounts for non-human callers
- Audit events, health checks, metrics, and tracing integrations
- Web, CLI, Slack, and Webex client surfaces
- RAG ingestion, search, collections, graph exploration, and MCP search tools
- GitOps-friendly configuration and secret-provider integrations

## Released Runtime

Dynamic Agents is CAIPE's released agent runtime. It executes configured agents,
streams their activity to clients, connects models and tools, and persists
conversation and runtime state when storage is configured.

Harness Engine is a future architecture direction and is not documented here as
a released capability.

## Continue

- [User Guide](../user-guide/index.md)
- [Administrator Guide](../admin-guide/index.md)
- [Custom Agents](./custom-agents.md)
- [Security](../security/index.md)

