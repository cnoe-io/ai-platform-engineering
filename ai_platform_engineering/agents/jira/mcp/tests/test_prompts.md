# Jira MCP Test Prompts - SRI Project

Comprehensive test prompts for all Jira MCP tools, focused on SRI project and testing reflection/autonomous retry behavior.

## 🟢 Level 1: Simple Prompts (Single Tool Call)

### Projects
1. "List all Jira projects"
2. "Show me the SRI project details"
3. "What projects do I have access to?"

### Issues - Read
4. "Get details for issue SRI-164"
5. "Show me issue SRI-9945"
6. "What's the status of SRI-164?"

### Issues - Search
7. "Find all bugs in the SRI project"
8. "Show me my assigned issues in SRI"
9. "List all open issues in SRI project"
10. "Find issues in SRI created in the last 7 days"
11. "Search for issues with 'kubernetes' in the title in SRI project"
12. "Find all issues in SRI with label 'urgent'"

### Users
13. "Find user with email sri.aradhyula@cisco.com"
14. "Search for users named 'Sri'"
15. "Get my user details"

### Comments
16. "Get all comments on issue SRI-164"
17. "Show me the comments on SRI-9945"

### Boards
18. "List all Scrum boards for SRI"
19. "Show me board 82"
20. "Get all boards for the SRI project"

### Sprints
21. "Get details for sprint 5829"
22. "Show me all sprints on board 82"
23. "List active sprints in SRI"

### Filters
24. "Search for filters for SRI project"
25. "List my filters"

### Fields
26. "Show me all custom fields"
27. "Get field info for 'Story Points'"
28. "Find the Epic Link field"

### Transitions
29. "What transitions are available for SRI-164?"
30. "Show me possible status changes for SRI-9945"

---

## 🟡 Level 2: Medium Complexity (2-3 Tool Calls)

### Issue Creation Workflows
31. "Create a bug in the SRI project titled 'API timeout issue' with description 'Users experiencing timeouts'"
32. "Create a story in SRI project about implementing dark mode and assign it to me"
33. "Create a task in SRI project with 3 story points and set priority to High"

### Issue Updates
34. "Update SRI-164 status to In Progress and add a comment saying 'Working on this now'"
35. "Change the assignee of SRI-9945 to sri.aradhyula@cisco.com and add 2 story points"
36. "Update issue SRI-164 description and add label 'urgent'"

### Sprint Management
37. "Create a new sprint named 'Sprint 42' on board 82 with start date tomorrow and end date in 2 weeks"
38. "Move issue SRI-164 to the current sprint on board 82"
39. "Get all issues in sprint 5829 and show me which ones are still open"

### Board Operations
40. "Get all issues on board 82 and filter by status 'In Progress'"
41. "Show me all epics on board 82 and their progress"
42. "List all sprints on board 82 and show the active one"

### Comment Management
43. "Add a comment to SRI-164 saying 'Fixed the bug' and then get all comments to verify"
44. "Add a comment to SRI-9945 with status update"

### Epic Management
45. "Find the best epic in SRI project for issue SRI-164 and link them"
46. "Show me all issues under epic SRI-1000"
47. "Find all epics in SRI project updated in the last 30 days"

### Filter and Board Creation
48. "Create a filter for SRI project with JQL 'project = SRI ORDER BY Rank' and then create a Scrum board using it"
49. "Search for existing filters for the SRI project, if none exist create one"

---

## 🔴 Level 3: Complex Prompts (4+ Tool Calls, Multi-Step Workflows)

**These prompts test REFLECTION & AUTONOMOUS RETRY behavior:**

### 1. Verification with Explicit Confirmation (Tests YES/NO requirement)
"I just updated SRI-164 priority to P3. Can you check the details and confirm if it actually updated or not?"

**Expected behavior:**
- Fetch current state
- Compare with requested change
- Explicitly start with "✅ Yes, it was updated to P3" or "❌ No, it wasn't updated"
- Then show supporting details

---

### 2. Update Verification with Retry (Tests autonomous fallback)
"Check if SRI-164 priority was successfully updated to P3. If it wasn't, update it now using whatever field works, then verify again and tell me explicitly if it succeeded."

**Expected behavior:**
- Check current state
- If not P3: Try custom field → fallback to standard if fails
- Verify final state
- Explicit YES/NO answer with before/after comparison

---

### 3. Complete Issue Creation Workflow (Tests complex workflow)
"Create a ticket in the current sprint under SRI project. Put it in the RAG/Performance epic if it exists. The ticket is about cleaning up the RAG database in production and running a full Slack re-ingestion now that the Redis bug is fixed. Give it 2 story points and High priority. Then verify everything was set correctly."

**Expected behavior:**
- Find current sprint (retry if not found)
- Search for RAG epic (retry with broader search if 0 results)
- Create with priority (try custom → fallback to standard)
- Add to sprint
- Link to epic
- Set story points
- **REFLECTION**: Fetch created issue and explicitly confirm all values

---

### 4. Sprint Report with Actions (Complex workflow)
"Generate a sprint report for sprint 5829: Show me all completed issues, all incomplete issues, total story points completed vs planned, and list any issues that were added mid-sprint. For incomplete issues, add a comment asking for blockers."

**Expected behavior:**
- Get sprint issues
- Categorize by status
- Calculate story points
- Identify mid-sprint additions
- Add comments to incomplete issues
- **REFLECTION**: Confirm comment count added

---

### 5. Epic Organization with Smart Retry (Multi-step with exhaustive search)
"Find all unassigned issues in the SRI project backlog, then find the top 5 most recent epics in SRI, and suggest which epic each orphan issue should belong to based on their summaries."

**Expected behavior:**
- Search unassigned issues
- If 0 results → try 30d → 90d → all time
- Get recent epics
- Analyze and suggest mappings
- **REFLECTION**: Did I suggest mappings or just list issues?

---

### 6. Board Cleanup with Actions (Tests reflection + verification)
"On SRI project board 82, find all issues that have been in 'In Progress' status for more than 30 days. Add a comment to each asking for a status update. Then check if they're in an active sprint - if not, move them back to backlog. Finally, confirm how many issues were updated."

**Expected behavior:**
- Filter issues by status and age
- Add comments
- Check sprint status
- Move to backlog if needed
- **REFLECTION**: "✅ I updated 5 issues: added comments to all, moved 3 to backlog"

---

### 7. Smart Epic Finder with Exhaustive Retry (Tests autonomous exploration)
"I have a new issue about Kubernetes pod crashes in the authentication service. Find me the best epic in SRI project to link it to."

**Expected behavior:**
- Search epics with text: "kubernetes"
- If 0 results → try "authentication"
- If 0 results → try "pod" or "service"
- If 0 results → get all SRI epics and analyze
- **REFLECTION**: Must recommend specific epic, not just "no results"

---

### 8. Failed Update with Smart Recovery (Tests fallback chain)
"Update SRI-164: set priority to P1 (or High if P1 doesn't work), add label 'urgent', move to 'In Progress' status, and assign to me. Then verify each change was applied successfully."

**Expected behavior:**
- Try priority P1 custom field → fallback to High
- Add label
- Update status
- Assign
- **REFLECTION**: Explicit YES/NO for each: "✅ Priority: YES (High), ✅ Label: YES, ✅ Status: YES, ✅ Assignee: YES"

---

### 9. Cross-Issue Analysis with Retry (Complex search and analysis)
"Find all bugs in SRI project created in the last 60 days. Group them by assignee. For unassigned bugs, suggest who should be assigned based on who has worked on similar bugs before."

**Expected behavior:**
- Search bugs with 60 day filter
- If 0 results → try 90d → all time
- Group by assignee
- Analyze historical assignments
- **REFLECTION**: Must suggest assignees, not just list bugs

---

### 10. Release Planning Workflow (Ultimate complexity)
"I'm planning the next release for SRI project. Show me all epics, calculate total story points for each epic, show completion percentage, identify any epics with no issues or no story points, and create a summary report with recommendations."

**Expected behavior:**
- Get all SRI epics
- For each: get child issues + calculate points
- Calculate completion %
- Identify gaps
- **REFLECTION**: Generate COMPLETE report with recommendations
- If story points field fails → try field discovery → try different field IDs

---

### 11. Dependency Analysis with Smart Retry (Advanced workflow)
"For issue SRI-164, show me all linked issues (blocks, is blocked by, relates to). For each blocking issue, check its status. If any blockers are not in progress, add a comment mentioning the dependency on SRI-164."

**Expected behavior:**
- Get issue links
- Categorize types
- Check each blocker status
- Add comments conditionally
- **REFLECTION**: "✅ Found 3 blocking issues, added comments to 2 that weren't in progress"

---

### 12. Search with Zero Results Retry (Tests exhaustive exploration)
"Find all issues assigned to me in the SRI project from the last 7 days"

**Expected behavior:**
- Try assignee search with 7 days
- If 0 results → Try 30 days
- If still 0 → Try 90 days
- If still 0 → Try all time
- If still 0 → Try as reporter instead
- Report all attempts made

---

## 🔥 Level 4: Ultimate Stress Test (Combines Everything)

### The Complete Verification and Recovery Flow
"I need to verify that yesterday's update worked. Check if SRI-164 priority is actually P3 now. If it's not, update it to P3 (try different field types if needed), then verify again and tell me explicitly if the update succeeded or failed."

**Expected behavior:**
1. Fetch current state
2. Check if priority = P3
3. If NO:
   - Try update with custom field
   - If fails → Try standard field
   - If fails → Try field discovery
4. Fetch state again
5. Compare before/after
6. Explicitly answer: "✅ Yes, I successfully updated it to P3" or "❌ No, the update failed because..."
7. Show evidence (before/after comparison)

---

## 📊 Testing Strategy

### Recommended Test Order:
1. **Start with Level 3 #2** - Tests verification issue (your original problem)
2. **Then Level 3 #3** - Tests complex creation with reflection
3. **Then Level 3 #6** - Tests bulk operations with explicit confirmation
4. **Then Level 3 #10** - Ultimate complexity test

### What to Look For:

✅ **Good Reflection Behavior:**
- Agent explicitly answers the question asked
- Uses YES/NO for verification questions
- Tries 3-4 different approaches before giving up
- Reports all attempts made
- Verifies final state after updates

❌ **Bad Behavior (Old way):**
- Just dumps current state without YES/NO
- Gives up after first failure
- Shows results without confirming they answered the question
- Doesn't try alternative approaches

---

## 🎯 Success Criteria

For each complex prompt, the agent should:
- ✅ Try 3+ different approaches if initial approach fails
- ✅ Explicitly answer "Did I do what was asked?" 
- ✅ Use YES/NO for verification questions
- ✅ Report all attempts made before final answer
- ✅ Not give up after first "0 results" or "field error"
- ✅ Autonomously retry with different parameters/tools/queries

---

## 📝 Setup Requirements

- **Test project**: SRI
- **Test board ID**: 82
- **Test sprint ID**: 5829
- **Test issue keys**: SRI-164, SRI-9945, SRI-1000
- **Test user**: sri.aradhyula@cisco.com

---

## 🔧 Tools Tested

All prompts collectively test these MCP tools:
- `get_issue`, `search_issues`, `create_issue`, `update_issue`
- `get_sprint`, `create_sprint`, `move_issues_to_sprint`
- `get_board`, `get_board_issues`, `get_board_sprints`, `get_board_epics`
- `get_comments`, `add_comment`
- `create_filter`, `search_filters`
- `get_field_info`, `list_custom_fields`, `get_epic_link_field`
- `get_project`, `list_projects`
- Field discovery and fallback mechanisms
- Autonomous retry and reflection logic
