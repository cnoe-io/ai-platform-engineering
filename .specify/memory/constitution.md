# AI Platform Engineering - Spec Kit Constitution

## Project Overview

**AI Platform Engineering (CAIPE)** is a multi-agent system for platform engineers, enabling AI-powered automation of DevOps and SRE tasks through specialized agents that integrate with tools like ArgoCD, AWS, Jira, Splunk, PagerDuty, and more.

## Core Principles

### 1. Agent-First Architecture
- Each domain (ArgoCD, AWS, Jira, etc.) has a dedicated agent with specialized knowledge
- The Supervisor agent orchestrates multi-agent collaboration via A2A protocol
- Agents communicate through standardized A2A (Agent-to-Agent) protocol

### 2. MCP Server Pattern
- Each agent has an MCP (Model Context Protocol) server for tool access
- MCP servers provide paginated, memory-safe access to external systems
- Strict limits on response sizes to prevent OOM issues

### 3. LangGraph-Based Agents
- All agents are built on LangGraph for stateful, graph-based execution
- Support for interrupts, checkpoints, and human-in-the-loop workflows
- TypedDict state management with clear node definitions

### 4. A2A Protocol Compliance
- All inter-agent communication follows Google's A2A protocol
- Support for streaming via SSE with artifact updates
- Task lifecycle: created → working → completed/failed/canceled

## Repository Structure

```
ai-platform-engineering/
├── ai_platform_engineering/
│   ├── agents/                  # Individual domain agents
│   │   ├── argocd/             # ArgoCD agent + MCP server
│   │   ├── aws/                # AWS agent + MCP server
│   │   ├── jira/               # Jira agent + MCP server
│   │   ├── splunk/             # Splunk agent + MCP server
│   │   └── ...                 # Other agents
│   ├── multi_agents/           # Multi-agent orchestration
│   │   ├── platform_engineer/  # Platform Engineer supervisor
│   │   └── supervisor/         # Supervisor base classes
│   ├── knowledge_bases/        # RAG and knowledge management
│   └── utils/                  # Shared utilities
├── ui/                         # CAIPE UI (Next.js)
├── charts/                     # Helm charts for K8s deployment
├── docker-compose/             # Generated compose files
├── docs/                       # Documentation (Docusaurus)
│   └── docs/changes/          # Architecture Decision Records
├── integration/                # Integration tests
└── scripts/                    # Build and utility scripts
```

## Development Standards

### Conventional Commits (Required)
All commits must follow conventional commit format with DCO sign-off:
```
<type>(<scope>): <description>

Signed-off-by: Name <email>
```

### Architecture Decision Records
Major architectural changes must be documented in `docs/docs/changes/` following the ADR template.

### Testing Requirements
- Unit tests for utilities and functions
- Integration tests for agent interactions
- MCP server tests for tool functionality

## Key Technologies

| Component | Technology |
|-----------|------------|
| Agents | Python 3.11+, LangGraph, LangChain |
| MCP Servers | FastMCP, httpx |
| Multi-Agent | A2A Protocol, SSE streaming |
| UI | Next.js 16, React 19, Tailwind CSS |
| Deployment | Docker, Kubernetes, Helm |
| Documentation | Docusaurus |

## Spec Kit Usage

This Spec Kit tracks specifications for:
- New agent implementations
- MCP server features
- Multi-agent orchestration patterns
- Integration improvements
- Performance optimizations

Specs should be created in `.specify/specs/` with clear acceptance criteria and implementation plans.
