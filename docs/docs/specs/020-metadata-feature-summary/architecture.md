---
sidebar_position: 1
id: 020-metadata-feature-summary-architecture
sidebar_label: Architecture
---

# Architecture: Metadata Detection Feature - Implementation Summary

**Date**: 2025-10-31

## What Was Implemented

### Server Side (ai-platform-engineering) - ✅ WORKING

1. **Metadata Parser** (`metadata_parser.py`)
   - Detects when agent asks for user input
   - Extracts structured fields from markdown lists
   - Returns JSON with field metadata (name, description, required, type)

2. **Agent Executor** (`agent_executor.py`)
   - Integrates metadata_parser
   - Wraps responses in JSON when `ENABLE_METADATA_DETECTION=true`
   - Backward compatible - returns plain text if disabled or no metadata found

3. **System Prompt** (`prompt_config.deep_agent.yaml`)
   - Delegation strategy: call sub-agents first, let them request inputs
   - Anti-duplication rules: don't repeat sub-agent responses
   - Clarification guidelines: only ask if tool is ambiguous

4. **Configuration** (`docker-compose.dev.yaml`)
   - Added `ENABLE_METADATA_DETECTION=true` flag
   - Feature is opt-in and backward compatible

### Client Side (caipe-cli) - ⚠️ NEEDS DEBUG

1. **Chat Interface** (`chat_interface.py`)
   - Updated field mapping: `name`, `description`, `required` (was `field_name`, `field_description`)
   - Added required/optional indicators
   - Parses structured JSON responses

2. **Issue**: Client hangs after showing execution plan start marker `⟦`
   - Possible causes:
     - Streaming not completing properly
     - JSON response causing parsing error
     - Race condition in render timing


## Files Changed

### ai-platform-engineering:
- `metadata_parser.py` (**NEW**, staged)
- `agent_executor.py` (staged)
- `prompt_config.deep_agent.yaml` (staged)
- `docker-compose.dev.yaml` (staged)
- `agent_aws/agent.py` (staged)

### caipe-cli:
- `chat_interface.py` (modified, not staged)
- `a2a_client.py` (modified, not staged)


## Next Steps

1. **Debug caipe-cli hanging issue**
   - Check if streaming completion event is being received
   - Verify JSON parsing doesn't cause exceptions
   - Test with DEBUG=true to see detailed logs

2. **Commit server-side changes** (ready to commit)
   ```bash
   cd ai-platform-engineering
   git commit -m "feat: Add metadata detection for user input requests"
   ```

3. **Fix and test client**, then commit separately


## Backward Compatibility

✅ **Fully backward compatible**:
- Old agents (without metadata): Work as before, return plain text
- New agents (with metadata disabled): Work as before
- New agents (with metadata enabled): Return structured JSON only when detecting input requests
- Client: Handles both plain text and JSON responses



## Related

- Spec: [spec.md](./spec.md)
