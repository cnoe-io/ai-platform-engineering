# Jira Entity Relationships SOP

**Date**: 2025-12-15  
**Status**: 🟢 In-use  
**Author**: Sri Aradhyula  
**Scope**: Jira Agent MCP Tools  

## Overview

This document defines the relationships between Jira Agile entities and the correct order of operations for the Jira Agent to traverse and manage them.

## Entity Hierarchy

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              JIRA PROJECT                                │
│                           (e.g., "PROJ", "SCRUM")                        │
│                                                                          │
│  project_key: "PROJ"                                                     │
│  project_id: 10001                                                       │
│  Contains: Issues, Versions, Components                                  │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
                                │ A project can have MULTIPLE boards
                                │ A board is filtered by project_key
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                               BOARD                                      │
│                    (Scrum Board or Kanban Board)                         │
│                                                                          │
│  board_id: 1                                                             │
│  board_type: "scrum" | "kanban" | "simple"                               │
│  filter_id: 10100 (JQL filter that defines board scope)                  │
│  location: { type: "project", projectKeyOrId: "PROJ" }                   │
│                                                                          │
│  SCRUM boards have: Sprints, Backlog                                     │
│  KANBAN boards have: Columns only (no sprints)                           │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
                                │ Only SCRUM boards have sprints
                                │ Sprints are created ON a board (origin_board_id)
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                              SPRINT                                      │
│                     (Only for Scrum Boards)                              │
│                                                                          │
│  sprint_id: 37                                                           │
│  origin_board_id: 1 (board where sprint was created)                     │
│  state: "future" | "active" | "closed"                                   │
│  start_date: "2025-01-01T00:00:00.000Z"                                  │
│  end_date: "2025-01-14T00:00:00.000Z"                                    │
│  goal: "Complete user authentication"                                    │
│                                                                          │
│  Contains: Issues assigned to this sprint                                │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
                                │ Issues are assigned TO a sprint
                                │ Issues belong to a PROJECT, displayed on BOARD
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                               ISSUE                                      │
│                    (Story, Task, Bug, Epic, etc.)                        │
│                                                                          │
│  issue_key: "PROJ-123"                                                   │
│  project_key: "PROJ" (from issue_key prefix)                             │
│  sprint: [37] (can be in ONE active sprint)                              │
│  status: "To Do" | "In Progress" | "Done"                                │
│                                                                          │
│  Issues NOT in a sprint are in the BACKLOG                               │
└─────────────────────────────────────────────────────────────────────────┘
```

## Key Relationships

### 1. Project → Board (One-to-Many)
- A **Project** can have **multiple Boards**
- A **Board** is typically associated with **one Project** (via filter)
- Query: `get_all_boards(project_key_or_id="PROJ")`

### 2. Board → Sprint (One-to-Many, Scrum only)
- A **Scrum Board** can have **multiple Sprints**
- A **Sprint** belongs to **one Board** (`origin_board_id`)
- Query: `get_board_sprints(board_id=1)`

### 3. Sprint → Issues (One-to-Many)
- A **Sprint** contains **multiple Issues**
- An **Issue** can be in **one active Sprint** at a time
- Query: `get_sprint_issues(sprint_id=37)`

### 4. Board → Issues (Filtered view)
- A **Board** displays **Issues** matching its filter
- Issues are not "owned" by a board, just displayed on it
- Query: `get_board_issues(board_id=1)`

### 5. Backlog (Special case)
- Issues **not assigned to any sprint** are in the **Backlog**
- Backlog is accessed via the Board
- Query: `get_backlog_issues(board_id=1)`

## Standard Operating Procedures

### SOP 1: Get All Sprints for a Project

```python
# Step 1: Get project key (if only project name is known)
project = get_project(project_key="PROJ")

# Step 2: Find boards for this project
boards = get_all_boards(project_key_or_id="PROJ")

# Step 3: For each SCRUM board, get its sprints
for board in boards["values"]:
    if board["type"] == "scrum":
        sprints = get_board_sprints(board_id=board["id"])
```

**Tool Sequence**:
1. `get_project(project_key)` - Validate project exists
2. `get_all_boards(project_key_or_id)` - Find scrum boards
3. `get_board_sprints(board_id)` - Get sprints for each board

### SOP 2: Get Issues in Current Sprint

```python
# Step 1: Get the board
boards = get_all_boards(project_key_or_id="PROJ", board_type="scrum")
board_id = boards["values"][0]["id"]

# Step 2: Get active sprint
sprints = get_board_sprints(board_id=board_id, state="active")
sprint_id = sprints["values"][0]["id"]

# Step 3: Get issues in that sprint
issues = get_sprint_issues(sprint_id=sprint_id)
```

**Tool Sequence**:
1. `get_all_boards(project_key_or_id, board_type="scrum")` - Find the board
2. `get_board_sprints(board_id, state="active")` - Get active sprint
3. `get_sprint_issues(sprint_id)` - Get issues in sprint

### SOP 3: Add Issue to Sprint

```python
# Step 1: Ensure issue exists
issue = get_issue(issue_key="PROJ-123")

# Step 2: Find the target sprint
sprints = get_board_sprints(board_id=1, state="active")
sprint_id = sprints["values"][0]["id"]

# Step 3: Move issue to sprint
move_issues_to_sprint(sprint_id=sprint_id, issues=["PROJ-123"])
```

**Tool Sequence**:
1. `get_issue(issue_key)` - Validate issue exists
2. `get_board_sprints(board_id, state="active"|"future")` - Find target sprint
3. `move_issues_to_sprint(sprint_id, issues)` - Add issues to sprint

### SOP 4: Get Backlog Issues

```python
# Step 1: Get the board
boards = get_all_boards(project_key_or_id="PROJ", board_type="scrum")
board_id = boards["values"][0]["id"]

# Step 2: Get backlog issues
backlog = get_backlog_issues(board_id=board_id)
```

**Tool Sequence**:
1. `get_all_boards(project_key_or_id)` - Find the board
2. `get_backlog_issues(board_id)` - Get backlog items

### SOP 5: Create New Sprint

```python
# Step 1: Get the board ID
boards = get_all_boards(project_key_or_id="PROJ", board_type="scrum")
board_id = boards["values"][0]["id"]

# Step 2: Create sprint on that board
sprint = create_sprint(
    name="Sprint 42",
    origin_board_id=board_id,
    goal="Complete authentication module",
    start_date="2025-01-15T00:00:00.000+00:00",
    end_date="2025-01-29T00:00:00.000+00:00"
)
```

**Tool Sequence**:
1. `get_all_boards(project_key_or_id, board_type="scrum")` - Find the board
2. `create_sprint(name, origin_board_id, goal, start_date, end_date)` - Create sprint

## Common Mistakes to Avoid

### ❌ Mistake 1: Trying to get sprints without board_id
```python
# WRONG: There's no "get sprints by project" API
sprints = get_sprints_for_project("PROJ")  # ❌ Doesn't exist!

# CORRECT: Get sprints via the board
boards = get_all_boards(project_key_or_id="PROJ", board_type="scrum")
sprints = get_board_sprints(board_id=boards["values"][0]["id"])  # ✅
```

### ❌ Mistake 2: Creating sprint without origin_board_id
```python
# WRONG: origin_board_id is REQUIRED
sprint = create_sprint(name="Sprint 1")  # ❌ Missing board!

# CORRECT: Always provide origin_board_id
sprint = create_sprint(name="Sprint 1", origin_board_id=1)  # ✅
```

### ❌ Mistake 3: Expecting sprints on Kanban boards
```python
# WRONG: Kanban boards don't have sprints
sprints = get_board_sprints(board_id=kanban_board_id)  # ❌ Returns empty!

# CORRECT: Only query sprints for scrum boards
if board["type"] == "scrum":
    sprints = get_board_sprints(board_id=board["id"])  # ✅
```

### ❌ Mistake 4: Not validating project/board exists first
```python
# WRONG: Assuming project exists
sprints = get_board_sprints(board_id=999)  # ❌ May fail with 404!

# CORRECT: Validate first
boards = get_all_boards(project_key_or_id="PROJ")
if boards.get("values"):
    sprints = get_board_sprints(board_id=boards["values"][0]["id"])  # ✅
```

## API Reference Quick Guide

| Entity | Get All | Get One | Create | Update | Delete |
|--------|---------|---------|--------|--------|--------|
| **Project** | `list_projects()` | `get_project(key)` | N/A | N/A | N/A |
| **Board** | `get_all_boards()` | `get_board(id)` | `create_board()` | N/A | `delete_board()` |
| **Sprint** | `get_board_sprints(board_id)` | `get_sprint(id)` | `create_sprint()` | `update_sprint()` | `delete_sprint()` |
| **Issue** | `search_issues(jql)` | `get_issue(key)` | `create_issue()` | `update_issue()` | `delete_issue()` |
| **Backlog** | `get_backlog_issues(board_id)` | N/A | N/A | N/A | N/A |

## Sprint States

| State | Description | Transitions |
|-------|-------------|-------------|
| `future` | Sprint is planned but not started | → `active` |
| `active` | Sprint is currently running (only ONE per board) | → `closed` |
| `closed` | Sprint is completed | (final state) |

## Agent Prompt Guidance

When the user asks about sprints, the agent should:

1. **Always clarify the project** if not specified
2. **Find the board first** before querying sprints
3. **Check board type** - only scrum boards have sprints
4. **Handle pagination** - boards/sprints/issues can have many results

### Example Agent Response Pattern

```
User: "Show me the current sprint for project PROJ"

Agent thinking:
1. Need to find board(s) for project PROJ
2. Filter for scrum boards only
3. Get active sprint from the board
4. Get issues in that sprint

Agent actions:
1. get_all_boards(project_key_or_id="PROJ", board_type="scrum")
2. get_board_sprints(board_id=X, state="active")
3. get_sprint_issues(sprint_id=Y)
```

## Related Documents

- [Jira MCP README](../../../ai_platform_engineering/agents/jira/mcp/README.md)
- [Jira Agile REST API](https://developer.atlassian.com/cloud/jira/software/rest/intro/)
- [Board API Reference](https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/)
- [Sprint API Reference](https://developer.atlassian.com/cloud/jira/software/rest/api-group-sprint/)

