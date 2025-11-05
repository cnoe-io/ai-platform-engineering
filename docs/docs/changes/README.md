# AI Platform Engineering - Change Documentation

This directory contains documentation of significant changes, features, and architectural decisions made to the AI Platform Engineering project.

## Directory Structure

### 📁 `architecture/`
Core architectural decisions and designs:
- **streaming-architecture.md** - Platform Engineer streaming architecture (comprehensive)
- **2024-10-25-sub-agent-tool-message-streaming.md** - Sub-agent tool message streaming details
- **2025-10-27-a2a-event-flow-architecture.md** - A2A event flow architecture
- **Architecture.md** - Main architecture overview
- **2024-10-22-a2a-intermediate-states.md** - A2A intermediate states
- **2024-10-22-enhanced-streaming-feature.md** - Enhanced streaming feature design

### 📁 `features/`
Feature implementations and enhancements:
- **date-handling.md** - Consolidated date/time handling across agents
- **metadata-feature-summary.md** - Metadata feature overview
- **metadata-input-implementation.md** - Metadata input implementation details
- **streaming-text-fix.md** - Streaming text rendering fixes
- **prompt-configuration.md** - Prompt configuration system
- **prompt-templates-readme.md** - Prompt template documentation

### 📁 `integrations/`
Third-party integrations and external systems:
- **aws-integration.md** - AWS ECS and backend integration (consolidated)
- **agent-forge-setup.md** - Agent Forge Docker build and workflow setup (consolidated)

### 📁 `refactoring/`
Major refactoring efforts:
- **agent-refactoring-summary.md** - Overall agent refactoring summary
- **base-agent-refactor.md** - Base agent refactoring details
- **implementation-summary.md** - Implementation summary

### 📁 `platform/`
Platform-specific documentation:
- **TODO_BASED_EXECUTION_PLAN.md** - TODO-based execution plan implementation

### 📁 `utils/`
Utility and common functionality:
- **CONTEXT_MANAGEMENT.md** - Auto context management for LangGraph agents
- **CONTEXT_CONFIG_ENV_VARS.md** - Context configuration environment variables

### 📁 `agents/`
Agent-specific change documentation (organized by agent name)

### 📁 `archived/`
Historical documents kept for reference (10 files)

## Consolidation Summary

This directory was reorganized on 2025-11-05 to:
1. **Remove duplicates**: Eliminated 1 exact duplicate file
2. **Consolidate related docs**: Combined 10 files into 4 consolidated documents
3. **Organize by category**: Created logical subdirectories for better navigation
4. **Archive historical docs**: Moved 10 outdated documents to `archived/`

### Before → After
- **42 files in root** → **32 files organized in 8 subdirectories**
- **Streaming docs**: 3 files → 1 comprehensive file
- **Date handling**: 3 files → 1 consolidated file
- **AWS integration**: 2 files → 1 consolidated file
- **Agent Forge**: 2 files → 1 consolidated file

## Finding What You Need

- **Architecture questions?** → Start with `architecture/Architecture.md`
- **Feature implementation?** → Check `features/`
- **Integration setup?** → Look in `integrations/`
- **Historical context?** → Browse `archived/`

## Contributing

When adding new change documentation:
1. Use descriptive filenames with dates: `YYYY-MM-DD-feature-name.md`
2. Place in the appropriate subdirectory
3. Update this README if adding a significant document
4. Consider consolidating with existing docs when appropriate

