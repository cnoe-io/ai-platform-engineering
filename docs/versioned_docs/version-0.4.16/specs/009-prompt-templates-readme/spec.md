---
sidebar_position: 2
sidebar_label: Specification
title: "2024-10-23: Common Prompt Templates"
---

# Common Prompt Templates

**Status**: 🟢 In-use
**Category**: Configuration & Prompts
**Date**: October 23, 2024

This document explains how to use the common prompt template utilities located in `prompt_templates.py` to create consistent, reusable system instructions for AI Platform Engineering agents.

## Overview

The `prompt_templates.py` module provides:

1. **Reusable prompt templates** - Common patterns like graceful error handling
2. **Building block functions** - Tools to construct system instructions programmatically
3. **Predefined guidelines** - Standard response guidelines and important notes
4. **Response formats** - XML coordination and simple status formats


## Benefits

### ✅ Consistency
- All agents use the same error handling patterns
- Standardized response formats across the platform
- Common guidelines ensure uniform behavior

### ✅ Maintainability
- Updates to common patterns propagate to all agents
- Easy to add new standard guidelines
- Single source of truth for prompt patterns

### ✅ Reduced Duplication
- No more copy-paste between agent system instructions
- Reusable building blocks for different agent types
- Shared templates for common scenarios

### ✅ Better Organization
- Clear separation between agent-specific logic and common patterns
- Modular system instructions that are easy to understand
- Structured approach to building complex prompts


## Best Practices

1. **Start with `scope_limited_agent_instruction()`** for simple agents
2. **Use `build_system_instruction()`** for complex agents with multiple capabilities
3. **Always include graceful error handling** for production agents
4. **Combine standard guidelines** rather than writing custom ones
5. **Use AgentCapability** to structure capabilities consistently
6. **Test prompt changes** across multiple agents when updating common templates


## Related

- Architecture: [architecture.md](./architecture.md)
