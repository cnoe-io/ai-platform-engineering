---
sidebar_position: 2
sidebar_label: Specification
title: "2025-11-07: User Input Metadata Format with Prefix Detection"
---

# User Input Metadata Format with Prefix Detection

**Status**: 🟢 In-use
**Category**: Features & Enhancements
**Date**: November 7, 2025

## Overview

Implemented a structured metadata format for collecting user input in Agent-Forge when sub-agents or tools require additional information. The platform-engineer agent now uses a `UserInputMetaData:` prefix to signal that interactive input fields should be rendered.


## Field Type Reference

| Type | Use Case | Example |
|------|----------|---------|
| `text` | Short text input | Names, titles, identifiers, usernames |
| `textarea` | Long text input | Descriptions, comments, code snippets |
| `number` | Numeric input | IDs, counts, percentages |
| `select` | Dropdown selection | Priority levels, branch names, statuses |
| `boolean` | Yes/No toggle | Feature flags, confirmation switches |


## Testing Strategy

### Test Queries:

1. **GitHub PR Creation:**
   ```
   "Create a GitHub pull request"
   ```

2. **Jira Issue Creation:**
   ```
   "Create a new Jira issue"
   ```

3. **Configuration Update:**
   ```
   "Update configuration setting"
   ```

### Expected Behavior:

1. Agent responds with `UserInputMetaData:` prefixed JSON
2. Agent-Forge detects prefix and parses JSON
3. Interactive form is rendered with specified fields
4. User fills out form and submits
5. Agent continues workflow with provided data


## Benefits

1. **Structured Data Collection** - Consistent format for user input across all agents
2. **Rich Input Types** - Support for text, numbers, selections, and toggles
3. **Clear Detection** - Prefix-based detection is explicit and reliable
4. **Validation Support** - MetadataInputForm handles field validation
5. **Better UX** - Interactive forms instead of free-text prompts
6. **Type Safety** - Structured JSON with defined field types
7. **Extensible** - Easy to add more field types in the future


## Related

- [2025-10-31: Metadata Input Implementation](./2025-10-31-metadata-input-implementation.md) - Original metadata implementation
- [Agent-Forge Backstage Plugin](../tools-utils/agent-forge-backstage-plugin.md) - Plugin documentation
- [A2A Protocol](../architecture/index.md) - Agent-to-Agent communication

---

**Date:** November 7, 2025
**Status:** ✅ Complete
**Signed-off-by:** Sri Aradhyula `<sraradhy@cisco.com>`



- Architecture: [architecture.md](./architecture.md)
