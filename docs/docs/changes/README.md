# AI Platform Engineering - Change Documentation

This directory contains documentation of significant changes, features, and architectural decisions made to the AI Platform Engineering project.

## Current Structure

All documentation files are in the root of this directory, organized by date and topic.

## Documentation by Category

### 🏗️ Architecture & Core Design
- **2025-11-05-architecture.md** - Main architecture overview (consolidated)
- **2024-10-22-streaming-architecture.md** - Original streaming architecture
- **2024-10-23-platform-engineer-streaming-architecture.md** - Platform Engineer streaming specifics
- **2024-10-25-sub-agent-tool-message-streaming.md** - Sub-agent tool message streaming
- **2025-10-27-a2a-event-flow-architecture.md** - A2A event flow architecture
- **2024-10-22-a2a-intermediate-states.md** - A2A intermediate states design

### ✨ Features & Enhancements
- **2025-11-05-date-handling.md** - Date/time handling across agents (consolidated)
- **2025-10-27-agents-with-date-handling.md** - Agents with date handling capabilities
- **2025-10-27-automatic-date-time-injection.md** - Automatic date/time injection
- **2025-10-27-date-handling-guide.md** - Date handling implementation guide
- **2025-10-31-metadata-feature-summary.md** - Metadata feature overview
- **2025-10-31-metadata-input-implementation.md** - Metadata input details
- **2025-10-31-streaming-text-fix.md** - Streaming text rendering fixes
- **2024-10-22-enhanced-streaming-feature.md** - Enhanced streaming feature design
- **2025-11-05-todo-based-execution-plan.md** - TODO-based execution plan

### 🔧 Configuration & Prompts
- **2024-10-22-prompt-configuration.md** - Prompt configuration system
- **2024-10-23-prompt-templates-readme.md** - Prompt template documentation
- **2025-11-05-context-config-env-vars.md** - Context configuration environment variables
- **2025-11-05-context-management.md** - Auto context management for LangGraph agents

### 🔌 Integrations
- **2025-11-05-aws-integration.md** - AWS integration (consolidated)
- **2025-10-27-aws-backend-comparison.md** - AWS backend comparison
- **2025-10-27-aws-ecs-mcp-integration.md** - AWS ECS MCP integration
- **2025-11-05-agent-forge-setup.md** - Agent Forge setup (consolidated)
- **2025-10-30-agent-forge-docker-build.md** - Agent Forge Docker build
- **2025-10-30-agent-forge-workflow-setup.md** - Agent Forge workflow setup

### 🔄 Refactoring & Implementation
- **2024-10-22-agent-refactoring-summary.md** - Agent refactoring overview
- **2024-10-22-base-agent-refactor.md** - Base agent refactoring
- **2024-10-22-implementation-summary.md** - Implementation summary

### 🤖 Agent-Specific
- **2025-11-05-backstage-agent-changelog.md** - Backstage agent changes

### 📝 Session & Context
- **2024-10-25-session-context.md** - Session context management

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

## Document Statistics

- **Total documents**: 30 markdown files
- **Architecture docs**: 6 files
- **Feature docs**: 9 files
- **Configuration docs**: 4 files
- **Integration docs**: 6 files
- **Refactoring docs**: 3 files
- **Agent-specific docs**: 1 file
- **Session/Context docs**: 1 file

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
