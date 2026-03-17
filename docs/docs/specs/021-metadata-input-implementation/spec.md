---
sidebar_position: 2
sidebar_label: Specification
title: "2025-10-31: CopilotKit-Style Metadata Input Implementation"
---

# CopilotKit-Style Metadata Input Implementation

**Status**: 🟡 Proposed (Superseded by 2025-11-07-user-input-metadata-format.md with UserInputMetaData prefix)
**Category**: Features & Enhancements
**Date**: October 31, 2025

## Overview

This implementation adds dynamic metadata input forms to the Agent Forge UI, similar to CopilotKit's interface. When the agent requires user input, a compact, interactive form is displayed with the appropriate input fields.


## Features

✅ **Dual Support**:
- Artifact metadata from `artifact-update` events
- JSON response parsing with `require_user_input` and `metadata.input_fields`

✅ **Dynamic Form Generation**:
- Text, number, email, password, textarea inputs
- Select dropdowns with predefined options
- Boolean toggles/switches
- Field validation (required, min/max, pattern, length)

✅ **Compact UI Design**:
- Reduced padding and margins
- Smaller font sizes
- Markdown rendering for descriptions
- Inline required badges

✅ **Markdown Support**:
- Full markdown rendering in description field
- Supports **bold**, lists, and other markdown syntax


## Testing Strategy

To test the implementation:

1. Send a message that requires input
2. Agent should respond with JSON containing `require_user_input: true`
3. Verify the form renders with correct fields
4. Fill out the form and submit
5. Check that data is sent back to agent as JSON


## Related

- Architecture: [architecture.md](./architecture.md)
