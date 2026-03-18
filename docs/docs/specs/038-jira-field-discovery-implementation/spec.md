---
sidebar_position: 2
sidebar_label: Specification
title: "2025-12-04: Jira Field Discovery and Schema Validation Implementation"
---

# Jira Field Discovery and Schema Validation Implementation

**Date**: 2025-12-04
**Status**: 🟢 In-use
**Type**: Enhancement
**Components**: Jira MCP Server, Field Discovery, Issue Operations

## Motivation

The Jira MCP server previously used hardcoded field names and formats when creating or updating issues. This caused several problems:

1. **Epic Link Failures**: Different Jira instances use different custom field IDs for "Epic Link" (e.g., `customfield_10014` vs `customfield_10015`)
2. **No Schema Validation**: Field values weren't validated against Jira's schema, leading to API errors
3. **Manual ADF Conversion**: Users had to manually convert descriptions to Atlassian Document Format (ADF)
4. **Poor Error Messages**: When fields failed, users got cryptic errors without suggestions
5. **Custom Field Limitations**: No easy way to use custom fields by name


## Updated Issue Operations

### `create_issue` - Enhanced

**Before**:
```python
# Had to manually format everything
await create_issue(
    project_key="PROJ",
    summary="My Task",
    description={  # Manual ADF format!
        "type": "doc",
        "version": 1,
        "content": [...]
    },
    additional_fields={
        "customfield_10014": "PROJ-123"  # Had to know field ID!
    }
)
```

**After**:
```python
# Automatic field discovery and normalization
await create_issue(
    project_key="PROJ",
    summary="My Task",
    description="Plain text description",  # Auto-converts to ADF!
    additional_fields={
        "Epic Link": "PROJ-123",  # Use field name!
        "Story Points": 5,         # Auto-normalizes to correct type
        "assignee": "account-id"   # Auto-converts to {"accountId": "..."}
    }
)
```

**Features**:
- ✅ Auto-converts description to ADF
- ✅ Resolves field names to IDs
- ✅ Normalizes values by type
- ✅ Provides helpful error messages
- ✅ Suggests similar fields on errors

### `update_issue` - New Function

```python
from mcp_jira.tools.jira.issues import update_issue

# Update issue with field discovery
await update_issue(
    issue_key="PROJ-123",
    fields={
        "summary": "New title",
        "description": "Updated description",  # Auto-converted to ADF
        "Epic Link": "PROJ-100",               # Resolved to customfield_*
        "Story Points": 8,
        "assignee": "account-id-abc123",       # Normalized to {"accountId": "..."}
        "labels": ["bug", "urgent"]             # Normalized to array format
    },
    notify_users=True
)
```

**Features**:
- ✅ Same field discovery as `create_issue`
- ✅ Selective field updates (only specify fields to change)
- ✅ Optional user notifications
- ✅ Helpful error messages with suggestions

### `batch_create_issues` - Enhanced

```python
await batch_create_issues(
    issues=json.dumps([
        {
            "project_key": "PROJ",
            "summary": "Task 1",
            "issue_type": "Story",
            "description": "Plain text",  # Auto-converted!
            "Epic Link": "PROJ-100",      # Field name resolution!
            "Story Points": 5
        },
        {
            "project_key": "PROJ",
            "summary": "Task 2",
            "issue_type": "Bug",
            "components": ["Frontend"]
        }
    ])
)
```

**Features**:
- ✅ Batch operations with field discovery
- ✅ Per-issue field normalization
- ✅ Helpful error messages for each issue

### `link_to_epic` - Enhanced

**Before**: Used hardcoded Agile API

**After**: Multi-method approach with field discovery

```python
await link_to_epic(issue_key="PROJ-123", epic_key="PROJ-100")
```

**Linking Strategy**:
1. **Method 1**: Use dynamically discovered Epic Link field (`customfield_*`)
2. **Method 2**: Try `parent` field (next-gen/team-managed projects)
3. **Method 3**: Fallback to Agile API `/rest/agile/1.0/epic/{epic}/issue`

**Benefits**:
- ✅ Works across different Jira instance configurations
- ✅ No hardcoded field IDs
- ✅ Clear error messages showing all attempted methods


## Testing Strategy

### Manual Testing
```bash
# Create issue with field discovery
curl -X POST http://localhost:8000/mcp/call/create_issue \
  -H "Content-Type: application/json" \
  -d '{
    "project_key": "PROJ",
    "summary": "Test Issue",
    "description": "Plain text description",
    "additional_fields": {
      "Epic Link": "PROJ-100",
      "Story Points": 5
    }
  }'

# Update issue
curl -X POST http://localhost:8000/mcp/call/update_issue \
  -H "Content-Type: application/json" \
  -d '{
    "issue_key": "PROJ-123",
    "fields": {
      "summary": "Updated title",
      "Epic Link": "PROJ-200"
    }
  }'

# Get field info
curl -X POST http://localhost:8000/mcp/call/get_field_info \
  -H "Content-Type: application/json" \
  -d '{"field_name": "Epic Link"}'
```


## Benefits

### 1. **Portability**
- Code works across different Jira instances
- No hardcoded field IDs
- Automatically adapts to instance configuration

### 2. **Developer Experience**
- Use human-readable field names
- Automatic type conversion
- Clear error messages with suggestions

### 3. **Robustness**
- Schema validation prevents API errors
- Type normalization ensures correct formats
- Fallback mechanisms for epic linking

### 4. **Maintainability**
- Single source of truth for field metadata
- Centralized normalization logic
- Easy to extend with new field types


## Related Files

### New Files
- `ai_platform_engineering/agents/jira/mcp/mcp_jira/utils/field_discovery.py`
- `ai_platform_engineering/agents/jira/mcp/mcp_jira/utils/adf.py`
- `ai_platform_engineering/agents/jira/mcp/mcp_jira/utils/field_handlers.py`

### Modified Files
- `ai_platform_engineering/agents/jira/mcp/mcp_jira/tools/jira/issues.py`
  - Enhanced: `create_issue`, `batch_create_issues`
  - New: `update_issue`, `_normalize_additional_fields`
- `ai_platform_engineering/agents/jira/mcp/mcp_jira/tools/jira/links.py`
  - Enhanced: `link_to_epic` (multi-method with field discovery)
- `ai_platform_engineering/agents/jira/mcp/mcp_jira/server.py`
  - Registered: `update_issue` tool
- `ai_platform_engineering/agents/jira/mcp/mcp_jira/utils/__init__.py`
  - Exported: ADF and field discovery utilities


## Related

- [Atlassian Document Format (ADF)](https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/)
- [Jira REST API - Fields](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-fields/)
- [Jira REST API - Create Issue](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issue-post)
- [Jira REST API - Update Issue](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issue-issueidorkey-put)


- Architecture: [architecture.md](./architecture.md)
