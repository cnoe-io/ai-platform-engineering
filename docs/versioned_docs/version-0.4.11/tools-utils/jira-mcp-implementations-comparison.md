# JIRA MCP Tools Comparison

## Overview

This comparison analyzes three different approaches to implementing JIRA tools via Model Context Protocol (MCP):

1. **AWS OpenAPI JIRA** - Auto-generated from filtered Jira OpenAPI spec (AgentCore Gateway)
2. **AWS JIRA Integration** - AWS integration provider via AgentCore dropdown
3. **CNOE Jira MCP Server** - Community-built MCP server

## Tool Count Summary

| Implementation | Total Tools | Approach |
|----------------|-------------|----------|
| AWS OpenAPI JIRA | 44 tools | Auto-generated from OpenAPI spec (filtered to `&lt;2MB`) |
| AWS JIRA Integration | 35 tools | Pre-built AWS integration |
| CNOE Jira MCP Server | 26 tools | Custom-built MCP server |

## Feature Coverage Comparison

### Core Issue Operations

| Feature | AWS OpenAPI | AWS Integration | CNOE MCP |
|---------|-------------|-----------------|----------|
| Get Issue | ✅ getIssue | ✅ getIssue | ✅ get_issue |
| Create Issue | ✅ createIssue | ✅ createIssue | ✅ create_issue |
| Update Issue | ✅ editIssue | ✅ editIssue | ❌ |
| Delete Issue | ✅ deleteIssue | ✅ deleteIssue | ✅ delete_issue |
| Bulk Create | ✅ createIssues | ❌ | ✅ batch_create_issues |
| Assign Issue | ✅ assignIssue | ❌ | ❌ |

### Search & Query

| Feature | AWS OpenAPI | AWS Integration | CNOE MCP |
|---------|-------------|-----------------|----------|
| JQL Search | ✅ searchForIssuesUsingJql | ✅ SearchIssues | ✅ search |
| JQL Search (POST) | ✅ searchForIssuesUsingJqlPost | ❌ | ❌ |
| Search Fields | ❌ | ❌ | ✅ search_fields |
| Project Issues | ❌ | ❌ | ✅ get_project_issues |
| Board Issues | ❌ | ❌ | ✅ get_board_issues |

### Comments & Attachments

| Feature | AWS OpenAPI | AWS Integration | CNOE MCP |
|---------|-------------|-----------------|----------|
| Add Comment | ✅ addComment | ✅ addComment | ❌ |
| Get Comments | ✅ getComments | ✅ getComments | ❌ |
| Update Comment | ✅ updateComment | ✅ updateComment | ❌ |
| Delete Comment | ✅ deleteComment | ✅ deleteComment | ❌ |
| Add Attachment | ✅ addAttachment | ✅ addAttachment | ✅ upload_attachment |
| Get Attachments | ❌ | ✅ getAttachmentContent | ✅ get_issue_attachments |
| Download Attachment | ❌ | ❌ | ✅ download_attachment |

### Agile Features (Boards & Sprints)

| Feature | AWS OpenAPI | AWS Integration | CNOE MCP |
|---------|-------------|-----------------|----------|
| Get Boards | ❌ | ✅ GetAllBoards | ✅ get_agile_boards |
| Get Board Info | ❌ | ✅ getBoard | ❌ |
| Get Sprints | ❌ | ✅ getAllSprints | ✅ get_sprints_from_board |
| Create Sprint | ❌ | ✅ createSprint | ✅ create_sprint |
| Update Sprint | ❌ | ✅ updateSprint | ✅ update_sprint |
| Delete Sprint | ❌ | ✅ deleteSprint | ❌ |
| Move to Sprint | ❌ | ✅ moveIssuesToSprintAndRank | ❌ |
| Move to Backlog | ❌ | ✅ moveIssuesToBacklog | ❌ |

### Workflow & Transitions

| Feature | AWS OpenAPI | AWS Integration | CNOE MCP |
|---------|-------------|-----------------|----------|
| Get Transitions | ✅ getTransitions | ✅ getTransitions | ✅ get_transitions |
| Do Transition | ✅ doTransition | ✅ DoTransition | ✅ transition_issue |
| Get Statuses | ✅ getAllStatuses | ✅ searchStatuses | ❌ |

### Project Management

| Feature | AWS OpenAPI | AWS Integration | CNOE MCP |
|---------|-------------|-----------------|----------|
| Get All Projects | ✅ getAllProjects | ✅ listProjects | ❌ |
| Get Project | ✅ getProject | ✅ getProject | ❌ |
| Create Project | ✅ createProject | ✅ createProject | ❌ |
| Update Project | ✅ updateProject | ✅ updateProject | ❌ |
| Delete Project | ✅ deleteProject | ✅ deleteProject | ❌ |
| Search Projects | ✅ searchProjects | ✅ searchProjects | ❌ |

### User Management

| Feature | AWS OpenAPI | AWS Integration | CNOE MCP |
|---------|-------------|-----------------|----------|
| Get Current User | ✅ getCurrentUser | ❌ | ✅ get_current_user_account_id |
| Find Users | ✅ findUsers | ✅ findUsers | ❌ |
| Create User | ✅ createUser | ❌ | ❌ |
| Get User | ✅ getUser | ❌ | ❌ |
| Remove User | ✅ removeUser | ❌ | ❌ |
| Find Assignable | ✅ findAssignableUsers | ❌ | ❌ |
| User Operations | ❌ | ❌ | ✅ handle_user_operations |
| Get All Users | ❌ | ✅ getAllUsers | ❌ |

### Work Tracking

| Feature | AWS OpenAPI | AWS Integration | CNOE MCP |
|---------|-------------|-----------------|----------|
| Add Worklog | ✅ addWorklog | ❌ | ✅ add_worklog |
| Get Worklog | ✅ getIssueWorklog | ❌ | ✅ get_worklog |
| Bulk Delete Worklogs | ✅ bulkDeleteWorklogs | ❌ | ❌ |
| Get Changelogs | ❌ | ❌ | ✅ batch_get_changelogs |

### Metadata & Configuration

| Feature | AWS OpenAPI | AWS Integration | CNOE MCP |
|---------|-------------|-----------------|----------|
| Get Fields | ✅ getFields | ❌ | ❌ |
| Get Priorities | ✅ getPriorities | ✅ getPriorities | ❌ |
| Get Resolutions | ✅ getResolutions | ❌ | ❌ |
| Get Issue Types | ✅ getIssueAllTypes | ✅ getIssueTypesForProject | ❌ |
| Get Server Info | ✅ getServerInfo | ❌ | ❌ |
| Create Metadata | ✅ getCreateIssueMeta | ❌ | ❌ |
| Create Priority | ✅ createPriority | ❌ | ❌ |
| Create Resolution | ✅ createResolution | ❌ | ❌ |
| Create Issue Type | ✅ createIssueType | ❌ | ❌ |
| Create Custom Field | ✅ createCustomField | ❌ | ❌ |

### Issue Linking

| Feature | AWS OpenAPI | AWS Integration | CNOE MCP |
|---------|-------------|-----------------|----------|
| Create Link | ❌ | ❌ | ✅ create_issue_link |
| Remove Link | ❌ | ❌ | ✅ remove_issue_link |
| Get Link Types | ❌ | ❌ | ✅ get_link_types |
| Link to Epic | ❌ | ❌ | ✅ link_to_epic |

### Labels

| Feature | AWS OpenAPI | AWS Integration | CNOE MCP |
|---------|-------------|-----------------|----------|
| Get All Labels | ❌ | ✅ getAllLabels | ❌ |

## Key Differences

### 1. AWS OpenAPI JIRA (44 tools)
- **Strengths**:
  - Most comprehensive coverage of core JIRA operations
  - Excellent metadata and configuration management
  - Strong user management capabilities
  - Auto-generated from official OpenAPI spec ensures accuracy
- **Weaknesses**:
  - No Agile/Sprint features (likely filtered out for size)
  - Missing issue linking functionality
  - No attachment download capability

### 2. AWS JIRA Integration (35 tools)
- **Strengths**:
  - Best Agile/Sprint support with board management
  - Good balance of features
  - Includes sprint ranking and backlog management
  - Label management support
- **Weaknesses**:
  - Limited metadata operations
  - No user creation/deletion
  - Missing worklog functionality

### 3. CNOE Jira MCP Server (26 tools)
- **Strengths**:
  - Excellent issue linking capabilities
  - Unique features like batch changelog retrieval
  - Complete attachment handling (upload/download)
  - Worklog management
  - Epic linking support
- **Weaknesses**:
  - No project management operations
  - Limited metadata access
  - No comment management

## Recommendations

- **For Core JIRA Operations**: AWS OpenAPI provides the most comprehensive coverage
- **For Agile Teams**: AWS Integration offers the best sprint and board management
- **For Advanced Workflows**: CNOE MCP Server has unique features like issue linking and changelog tracking
- **For Automation**: AWS OpenAPI's metadata access enables dynamic form building and validation

## Implementation Notes

- AWS OpenAPI was filtered from >3MB to &lt;2MB to meet AgentCore Gateway limits, which explains missing Agile features
- AWS Integration appears to be a curated subset focusing on common operations
- CNOE MCP Server seems designed for specific workflow automation use cases