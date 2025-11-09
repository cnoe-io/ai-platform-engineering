# AI Platform Engineering - Change Documentation

This directory contains documentation of significant changes, features, and architectural decisions made to the AI Platform Engineering project.

## ADR Status Taxonomy

Each document is classified with one of the following statuses:

- **🟢 In-use**: Currently implemented and actively used in production
- **🟡 Proposed**: Planned or partially implemented, not yet in production
- **🔴 Abandoned**: Deprecated, replaced, or no longer actively maintained

## Current Structure

All documentation files are in the root of this directory, organized by date and topic.

## Documentation by Category

### 🏗️ Architecture & Core Design
- **2025-11-05-architecture.md** - Main architecture overview (consolidated) [🟢 In-use]
- **2024-10-22-streaming-architecture.md** - Original streaming architecture [🔴 Superseded by platform-engineer-streaming]
- **2024-10-23-platform-engineer-streaming-architecture.md** - Platform Engineer streaming specifics [🟢 In-use]
- **2024-10-25-sub-agent-tool-message-streaming.md** - Sub-agent tool message streaming [🟢 In-use]
- **2025-10-27-a2a-event-flow-architecture.md** - A2A event flow architecture [🟢 In-use]
- **2024-10-22-a2a-intermediate-states.md** - A2A intermediate states design [🟢 In-use]

### ✨ Features & Enhancements
- **2025-11-05-date-handling.md** - Date/time handling across agents (consolidated) [🟢 In-use]
- **2025-10-27-agents-with-date-handling.md** - Agents with date handling capabilities [🟢 In-use]
- **2025-10-27-automatic-date-time-injection.md** - Automatic date/time injection [🟢 In-use]
- **2025-10-27-date-handling-guide.md** - Date handling implementation guide [🟢 In-use]
- **2025-10-31-metadata-feature-summary.md** - Metadata feature overview [🟡 Partially implemented]
- **2025-10-31-metadata-input-implementation.md** - Metadata input details [🟡 Partially implemented]
- **2025-10-31-streaming-text-fix.md** - Streaming text rendering fixes [🟢 In-use]
- **2024-10-22-enhanced-streaming-feature.md** - Enhanced streaming feature design [🟢 In-use]
- **2025-11-05-todo-based-execution-plan.md** - TODO-based execution plan [🟢 In-use]
- **2025-11-07-user-input-metadata-format.md** - User input metadata format with prefix [🟢 In-use]

### 🔧 Configuration & Prompts
- **2024-10-22-prompt-configuration.md** - Prompt configuration system [🟢 In-use]
- **2024-10-23-prompt-templates-readme.md** - Prompt template documentation [🟢 In-use]
- **2025-11-05-context-config-env-vars.md** - Context configuration environment variables [🟢 In-use]
- **2025-11-05-context-management.md** - Auto context management for LangGraph agents [🟢 In-use]

### 🔌 Integrations
- **2025-11-05-aws-integration.md** - AWS integration (consolidated) [🟢 In-use]
- **2025-10-27-aws-backend-comparison.md** - AWS backend comparison [🟢 In-use]
- **2025-10-27-aws-ecs-mcp-integration.md** - AWS ECS MCP integration [🟢 In-use]
- **2025-11-05-agent-forge-setup.md** - Agent Forge setup (consolidated) [🟢 In-use]
- **2025-10-30-agent-forge-docker-build.md** - Agent Forge Docker build [🟢 In-use]
- **2025-10-30-agent-forge-workflow-setup.md** - Agent Forge workflow setup [🟢 In-use]

### 🔄 Refactoring & Implementation
- **2024-10-22-agent-refactoring-summary.md** - Agent refactoring overview [🟢 In-use]
- **2024-10-22-base-agent-refactor.md** - Base agent refactoring [🟢 In-use]
- **2024-10-22-implementation-summary.md** - Implementation summary [🟢 In-use]

### 🐛 Bug Fixes & Performance
- **2025-11-08-platform-engineer-final-response-parsing.md** - Platform Engineer final response parsing and DataPart implementation [🟢 In-use]
- **2025-11-05-a2a-artifact-streaming-fix.md** - A2A artifact streaming race condition fix [🟢 In-use]
- **2025-11-05-argocd-oom-analysis.md** - ArgoCD OOM protection analysis [🟢 In-use]
- **2025-11-05-mcp-argocd-pagination-summary.md** - MCP ArgoCD pagination implementation [🟢 In-use]
- **2025-11-05-oom-protection-summary.md** - OOM protection summary [🟢 In-use]
- **2025-11-05-oom-protection-diagram.md** - OOM protection architecture diagram [🟢 In-use]

### 🤖 Agent-Specific
- **2025-11-05-backstage-agent-changelog.md** - Backstage agent changes [🟢 In-use]

### 📝 Session & Context
- **2024-10-25-session-context.md** - Session context management [🟢 In-use]

## Quick Reference Guide

### Looking for...
- **Architecture overview?** → `2025-11-05-architecture.md`
- **Streaming implementation?** → `2024-10-23-platform-engineer-streaming-architecture.md`
- **Date/time handling?** → `2025-11-05-date-handling.md`
- **AWS integration?** → `2025-11-05-aws-integration.md`
- **Agent Forge setup?** → `2025-11-05-agent-forge-setup.md`
- **Context management?** → `2025-11-05-context-management.md`
- **Prompt configuration?** → `2024-10-22-prompt-configuration.md`
- **Metadata features?** → `2025-10-31-metadata-feature-summary.md`
- **DataPart & structured responses?** → `2025-11-08-platform-engineer-final-response-parsing.md`
- **A2A artifact streaming?** → `2025-11-05-a2a-artifact-streaming-fix.md`
- **OOM protection?** → `2025-11-05-oom-protection-summary.md`
- **ArgoCD pagination?** → `2025-11-05-mcp-argocd-pagination-summary.md`

## Document Statistics

- **Total documents**: 37 markdown files
- **🟢 In-use**: 38 documents
- **🟡 Proposed**: 2 documents
- **🔴 Abandoned**: 2 documents

### By Category
- **Architecture docs**: 6 files (4 In-use, 2 Abandoned)
- **Feature docs**: 11 files (9 In-use, 2 Proposed)
- **Configuration docs**: 4 files (4 In-use)
- **Integration docs**: 6 files (6 In-use)
- **Refactoring docs**: 3 files (3 In-use)
- **Bug Fixes & Performance docs**: 6 files (6 In-use)
- **Agent-specific docs**: 1 file (1 In-use)
- **Session/Context docs**: 1 file (1 In-use)

## Recent Consolidations (2025-11-05)

Several related documents were consolidated:
- **Architecture**: Multiple architecture docs → `2025-11-05-architecture.md`
- **Date Handling**: 3 date-related docs → `2025-11-05-date-handling.md`
- **AWS Integration**: 2 AWS docs → `2025-11-05-aws-integration.md`
- **Agent Forge**: 2 setup docs → `2025-11-05-agent-forge-setup.md`

Original files remain for reference and historical context.

## Contributing

When adding new change documentation:

1. **File naming**: Use format `YYYY-MM-DD-descriptive-name.md`
2. **Content**: Include date, author (optional), summary, and details
3. **Updates**: Update this README when adding significant documentation
4. **Consolidation**: Consider consolidating related docs when appropriate

### Document Template

```markdown
# Feature/Change Name

**Date**: YYYY-MM-DD

## Summary
Brief description of the change/feature

## Background
Context and motivation

## Implementation
Technical details

## Impact
What changed and why it matters
```

## Maintenance

This README should be updated when:
- New significant documentation is added
- Documents are consolidated or reorganized
- Category structure changes
