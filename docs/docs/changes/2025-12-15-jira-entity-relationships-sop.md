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

---

## Real-World Query Examples

These are actual user queries and the correct SOP to handle them.

### Query 1: "What is the sprint assigned to SDPL-687?"

**User Intent**: Get sprint information for a specific issue

**SOP**:
```python
# Step 1: Get the issue with sprint field
issue = get_issue(
    issue_key="SDPL-687",
    fields="summary,status,sprint,customfield_10020"  # sprint is often customfield_10020
)

# The sprint field will contain:
# - sprint name
# - sprint id
# - sprint state (active/closed/future)
```

**Tool Sequence**:
1. `get_issue(issue_key="SDPL-687", fields="summary,status,sprint")`

**Expected Response**:
```
Issue SDPL-687 is assigned to:
- Sprint: Cisco-FY26Q2-S8
- State: active
- Start: 2025-01-06
- End: 2025-01-20
```

---

### Query 2: "Points completed per developer for sprints: Cisco-FY26Q2-S7, S8, S9"

**User Intent**: Aggregate story points by developer across multiple named sprints

**SOP**:
```python
# Step 1: Find the project's scrum board
boards = get_all_boards(project_key_or_id="SDPL", board_type="scrum")
board_id = boards["values"][0]["id"]

# Step 2: Get ALL sprints for the board (to find by name)
all_sprints = get_board_sprints(board_id=board_id, max_results=100)

# Step 3: Filter sprints by name to get sprint IDs
target_sprint_names = ["Cisco-FY26Q2-S7", "Cisco-FY26Q2-S8", "Cisco-FY26Q2-S9"]
sprint_ids = {s["name"]: s["id"] for s in all_sprints["values"] if s["name"] in target_sprint_names}

# Step 4: For each sprint, get completed issues with points
for sprint_name, sprint_id in sprint_ids.items():
    issues = get_sprint_issues(
        sprint_id=sprint_id,
        jql="status in (Done, Resolved, Closed)",
        fields="summary,assignee,customfield_10021,status"  # 10021 is often Story Points
    )

    # Aggregate points by assignee
    for issue in issues["issues"]:
        developer = issue["fields"]["assignee"]["displayName"]
        points = issue["fields"].get("customfield_10021", 0) or 0
        # Accumulate...
```

**Tool Sequence**:
1. `get_all_boards(project_key_or_id="SDPL", board_type="scrum")` - Get board ID
2. `get_board_sprints(board_id=X, max_results=100)` - Get all sprints to find by name
3. `get_sprint_issues(sprint_id=Y, jql="status in (Done,Resolved,Closed)", fields="assignee,customfield_10021")` - For each sprint
4. **Agent aggregates data** and formats table

**Expected Response**:
```
| Developer Name    | Cisco-FY26Q2-S7 | Cisco-FY26Q2-S8 | Cisco-FY26Q2-S9 |
|-------------------|-----------------|-----------------|-----------------|
| John Smith        | 13              | 8               | 5               |
| Jane Doe          | 8               | 13              | 10              |
| Bob Wilson        | 5               | 5               | 8               |
```

---

### Query 3: "Report of points resolved per developer for last 3 sprints in SDPL"

**User Intent**: Find recent sprints automatically, then aggregate

**SOP**:
```python
# Step 1: Get the scrum board
boards = get_all_boards(project_key_or_id="SDPL", board_type="scrum")
board_id = boards["values"][0]["id"]

# Step 2: Get CLOSED sprints (most recent first)
# Note: API returns sprints in order, closed sprints are the completed ones
closed_sprints = get_board_sprints(board_id=board_id, state="closed", max_results=50)

# Step 3: Sort by end date descending, take last 3
# (sprints have completeDate field when closed)
recent_sprints = sorted(
    closed_sprints["values"],
    key=lambda s: s.get("completeDate", ""),
    reverse=True
)[:3]

# Step 4: For each sprint, aggregate as in Query 2
```

**Tool Sequence**:
1. `get_all_boards(project_key_or_id="SDPL", board_type="scrum")`
2. `get_board_sprints(board_id=X, state="closed", max_results=50)` - Get closed sprints
3. **Agent sorts by completeDate** to find "last 3"
4. `get_sprint_issues(sprint_id=Y, ...)` - For each of 3 sprints
5. **Agent aggregates** and formats

**Common Issue**: The agent may find OLD sprints if it doesn't sort by date!

---

### Query 4: "Execute JQL and show Sprint/Points"

**User Intent**: Run specific JQL, extract sprint and points fields

**SOP**:
```python
# Use search_issues with explicit fields
results = search_issues(
    jql="project = SDPL AND sprint in (73390, 75033, 71590) ORDER BY created DESC",
    fields="key,summary,sprint,customfield_10021",  # Include sprint and points
    max_results=100
)

# Format as table
for issue in results["issues"]:
    key = issue["key"]
    sprint = issue["fields"].get("sprint", [{}])[0].get("name", "No Sprint")
    points = issue["fields"].get("customfield_10021", 0) or 0
    print(f"| {key} | {sprint} | {points} |")
```

**Tool Sequence**:
1. `search_issues(jql="...", fields="key,summary,sprint,customfield_10021")`
2. **Agent formats** the table

**Important**: Sprint and Story Points are often custom fields! Common mappings:
- `sprint` or `customfield_10020` - Sprint field
- `customfield_10021` or `customfield_10026` - Story Points

---

## Field Discovery: Finding Sprint and Points Fields

The sprint and story points fields are **custom fields** that vary by Jira instance!

**SOP to discover field IDs**:
```python
# Step 1: Get a known issue with sprint/points
issue = get_issue(issue_key="SDPL-687", fields="*all")

# Step 2: Look for fields containing "sprint" or "point"
# Common patterns:
# - customfield_10020: Sprint
# - customfield_10021: Story Points
# - customfield_10026: Story point estimate

# Step 3: Or use field discovery
fields = list_fields()  # Returns all field metadata
sprint_field = next(f for f in fields if "sprint" in f["name"].lower())
points_field = next(f for f in fields if "story point" in f["name"].lower())
```

---

## Sprint Naming Conventions

Many organizations use naming patterns. Help the agent understand:

| Pattern | Example | Meaning |
|---------|---------|---------|
| `{Team}-FY{YY}Q{Q}-S{N}` | Cisco-FY26Q2-S7 | Fiscal Year 26, Q2, Sprint 7 |
| `Sprint {N}` | Sprint 42 | Simple numbering |
| `{Project} Sprint {N}` | SDPL Sprint 15 | Project-prefixed |
| `{Date Range}` | Jan 6-20 | Date-based |

When user says "last 3 sprints", the agent should:
1. Get all sprints for the board
2. Sort by `completeDate` (for closed) or `startDate` (for all)
3. Take the most recent N

---

## Troubleshooting Common Failures

### Issue: "No sprints found"
**Cause**: Wrong board, or board is Kanban (no sprints)
**Fix**:
```python
# Check board type first
boards = get_all_boards(project_key_or_id="SDPL")
for board in boards["values"]:
    print(f"{board['name']}: {board['type']}")  # Only 'scrum' has sprints
```

### Issue: "Sprint field is empty"
**Cause**: Issue not assigned to any sprint (in backlog)
**Fix**: Issue is valid, just not in a sprint

### Issue: "Story points not showing"
**Cause**: Using wrong custom field ID
**Fix**: Use field discovery to find the correct field ID for your instance

### Issue: "Wrong sprints returned for 'last 3'"
**Cause**: Not sorting by date, or mixing board sprints
**Fix**:
```python
# Sort by completeDate for closed sprints
sprints = sorted(closed_sprints, key=lambda s: s["completeDate"], reverse=True)[:3]
```

### Issue: "Points showing as null"
**Cause**: Issues don't have story points estimated
**Fix**: Filter for issues with points: `jql="project = SDPL AND 'Story Points' > 0"`

---

## Agent Prompt Template for Sprint Queries

When user asks about sprints, the agent should:

```
1. IDENTIFY the project key from the query
   - "SDPL-687" → project = "SDPL"
   - "SDPL project" → project = "SDPL"

2. FIND the scrum board for that project
   - get_all_boards(project_key_or_id="SDPL", board_type="scrum")
   - If no scrum board → "This project uses Kanban, no sprints available"

3. GET sprints based on need:
   - Specific sprint by NAME → get_board_sprints() then filter by name
   - Last N sprints → get_board_sprints(state="closed"), sort by date
   - Active sprint → get_board_sprints(state="active")

4. GET issues with required fields:
   - get_sprint_issues(sprint_id, fields="assignee,customfield_10021")
   - ALWAYS include sprint and points custom fields

5. AGGREGATE and FORMAT:
   - Group by developer/assignee
   - Sum story points
   - Format as requested table
```

---

## Related Documents

- [Jira MCP README](../../../ai_platform_engineering/agents/jira/mcp/README.md)
- [Jira Agile REST API](https://developer.atlassian.com/cloud/jira/software/rest/intro/)
- [Board API Reference](https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/)
- [Sprint API Reference](https://developer.atlassian.com/cloud/jira/software/rest/api-group-sprint/)

