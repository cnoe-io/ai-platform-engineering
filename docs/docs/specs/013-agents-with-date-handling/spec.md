---
sidebar_position: 2
sidebar_label: Specification
title: "2025-10-27: Agents with Enhanced Date Handling"
---

# Agents with Enhanced Date Handling

**Status**: 🟢 In-use (Part of consolidated date handling feature)
**Category**: Features & Enhancements
**Date**: October 27, 2025 (Consolidated into 2025-11-05-date-handling.md)

## Overview

All agents automatically receive current date/time in their system prompts via `BaseLangGraphAgent._get_system_instruction_with_date()`.

This document lists agents that have **enhanced date handling guidelines** enabled (`include_date_handling=True` or `DATE_HANDLING_NOTES`).


## Coverage Summary

- **Total Agents**: 10+ (all BaseLangGraphAgent-based)
- **With Enhanced Date Handling**: 10
- **Coverage**: 100% of time-sensitive agents


## Benefits

1. **No Tool Calls**: Agents don't need to call external date tools
2. **Zero Latency**: Date available immediately in prompt
3. **Consistent Behavior**: All agents calculate from same reference point
4. **Better UX**: Users can use natural language like "today", "last week"
5. **Accurate Results**: Agents convert relative dates correctly


## Related

- **Implementation Guide**: [Date Handling Guide](./2025-10-27-date-handling-guide.md)
- **Changelog**: [Automatic Date/Time Injection](./2025-10-27-automatic-date-time-injection.md)
- **Prompt Templates**: `utils/prompt_templates.py`
- **Base Agent**: `utils/a2a_common/base_langgraph_agent.py`



- Architecture: [architecture.md](./architecture.md)
