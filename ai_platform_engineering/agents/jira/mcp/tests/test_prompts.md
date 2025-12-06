# Jira MCP Test Prompts

Comprehensive test prompts for all Jira MCP tools, organized by complexity level.

## 🟢 Level 1: Simple Prompts (Single Tool Call)

### Projects
1. "List all Jira projects"
2. "Show me the SRI project details"
3. "Search for projects with 'platform' in the name"
4. "What projects do I have access to?" (Don't work)

### Issues - Read
5. "Get details for issue SRE-9945"
6. "Show me issue PROJ-123"
7. "What's the status of SRE-100?"

### Issues - Search
8. "Find all bugs in the SRI project"
9. "Show me my assigned issues"
10. "List all open issues in PLATFORM project"
11. "Find issues created in the last 7 days"
12. "Search for issues with 'kubernetes' in the title"

### Users
13. "Find user with email john.doe@example.com"
14. "Search for users named 'Sarah'"
15. "Get user details for account ID 12345"

### Comments
16. "Get all comments on issue SRE-9945"
17. "Show me the comments on PROJ-123"

### Boards
18. "List all Scrum boards"
19. "Show me board 82"
20. "Get all boards for the SRI project"

### Sprints
21. "Get details for sprint 5829"
22. "Show me all sprints on board 82"
23. "List active sprints"

### Filters
24. "Search for filters named 'Board Filter'"
25. "Get filter 12345"
26. "List my filters"

### Fields
27. "Show me all custom fields"
28. "Get field details for 'customfield_10001'"

### Transitions
29. "What transitions are available for SRE-9945?"
30. "Show me possible status changes for PROJ-123"

---

## 🟡 Level 2: Medium Complexity (2-3 Tool Calls)

### Issue Creation Workflows
31. "Create a bug in the SRI project titled 'API timeout issue' with description 'Users experiencing timeouts'"
32. "Create a story in PLATFORM project about implementing dark mode and assign it to me"
33. "Create a task in SRE project with 3 story points and set priority to High"

### Issue Updates
34. "Update SRE-9945 status to In Progress and add a comment saying 'Working on this now'"
35. "Change the assignee of PROJ-123 to john.doe@example.com and add 2 story points"
36. "Update issue SRE-100 description and add label 'urgent'"

### Sprint Management
37. "Create a new sprint named 'Sprint 42' on board 82 with start date tomorrow and end date in 2 weeks"
38. "Move issue SRE-9945 to the current sprint on board 82"
39. "Get all issues in sprint 5829 and show me which ones are still open"

### Board Operations
40. "Get all issues on board 82 and filter by status 'In Progress'"
41. "Show me all epics on board 82 and their progress"
42. "List all sprints on board 82 and show the active one"

### Comment Management
43. "Add a comment to SRE-9945 saying 'Fixed the bug' and then get all comments to verify"
44. "Update comment 67890 on issue SRE-100 with new text and show the result"

### Epic Management
45. "Find the best epic in SRI project for issue SRE-9945 and link them"
46. "Show me all issues under epic SRE-1000"
47. "Find all epics in PLATFORM project updated in the last 30 days"

### Filter and Board Creation
48. "Create a filter for SRI project with JQL 'project = SRI ORDER BY Rank' and then create a Scrum board using it"
49. "Search for existing filters for the SRI project, if none exist create one"

---

## 🔴 Level 3: Complex Prompts (4+ Tool Calls, Multi-Step Workflows)

### Complete Issue Creation Workflow
50. "Create me a ticket in the current sprint under SRI. Put it in the epic you feel is best suited for it. The ticket is about cleaning up the RAG db in production and running a full slack ingest. Give it 2 points."
    - Steps: Get current sprint → Search for best epic → Create issue → Link to epic → Add to sprint → Set story points

51. "I need a new bug ticket in PLATFORM project assigned to sarah@example.com about the login timeout issue. Add it to the current sprint, set priority to Critical, add label 'security', and put a comment explaining the impact."
    - Steps: Search user → Get current sprint → Create issue → Assign → Add to sprint → Set priority → Add label → Add comment

52. "Create a new feature in SRI project for implementing OAuth2 authentication. Find the security epic and link it there. Add it to the next sprint. Set it to 5 story points and assign to the team lead."
    - Steps: Search for security epic → Get sprints → Identify next sprint → Create issue → Link to epic → Add to sprint → Set points → Search team lead → Assign

### Board and Sprint Setup
53. "Create a new Scrum board named 'Q1 Platform Team' for the PLATFORM project. Then create a sprint called 'Sprint 1' starting next Monday for 2 weeks. Finally, move all unassigned issues from the backlog into this sprint."
    - Steps: Create filter → Create board → Create sprint → Get backlog issues → Move issues to sprint

54. "Set up a new Kanban board for the SRI project with a filter showing only bugs and tasks. Then find all open bugs in the project and add them to the board backlog."
    - Steps: Create filter with JQL → Create Kanban board → Search bugs → Move to backlog

### Issue Migration/Reorganization
55. "Find all issues in the SRE project that are not assigned to any epic, then find the top 3 most recent epics, and suggest which epic each orphan issue should belong to based on their summaries."
    - Steps: Get issues without epic → Search recent epics → Get epic details → Analyze and suggest matches

56. "Show me all issues in sprint 5829 that are still open. For each one, check if it has story points assigned. If not, analyze the issue and suggest appropriate story points based on complexity."
    - Steps: Get sprint issues → Filter open → Check story points field → Analyze → Suggest points

### Cross-Project Analysis
57. "Find all issues assigned to me across all projects in the last 30 days. Group them by project and show me which ones are blockers or critical. For any that are overdue, add a comment asking for status update."
    - Steps: Search issues assigned to me → Filter by date → Group by project → Filter priority → Check due date → Add comments

58. "I'm doing a sprint planning. Show me the SRI project board 82, get all issues in the backlog without epics, find the top 5 active epics, and suggest which epic each backlog issue should go into. Then create a new sprint for next week."
    - Steps: Get board → Get backlog → Get issues without epic → Search epics → Match issues to epics → Create sprint

### Reporting and Analysis
59. "Generate a sprint report for sprint 5829: Show me all completed issues, all incomplete issues, total story points completed vs planned, and list any issues that were added mid-sprint. For incomplete issues, add a comment asking for blockers."
    - Steps: Get sprint → Get issues → Categorize by status → Calculate points → Identify mid-sprint additions → Add comments

60. "Find all bugs in the PLATFORM project created in the last 60 days. Group them by assignee. For unassigned bugs, find the team members who typically work on similar issues and suggest assignments."
    - Steps: Search bugs → Filter by date → Group by assignee → Get unassigned → Search historical assignments → Suggest assignees

### Epic Management Workflow
61. "Create a new epic in SRI project called 'RAG Performance Improvements'. Then find all existing issues with 'RAG' or 'performance' in the title from the last 90 days and link them to this epic. Finally, move all linked issues to the current sprint."
    - Steps: Create epic issue → Search related issues → Link issues to epic → Get current sprint → Move issues

62. "Show me epic SRE-1000 and all its child issues. For each child issue, check if it has an assignee. For unassigned ones, look at who created them and suggest assigning back to creator if they're active in the project."
    - Steps: Get epic → Get child issues → Check assignee field → Get creator → Check creator activity → Suggest assignment

### Board Cleanup and Maintenance
63. "On board 82, find all issues that have been in 'In Progress' status for more than 30 days. Add a comment to each asking for a status update. Then check if they're in an active sprint - if not, move them back to backlog."
    - Steps: Get board issues → Filter status and date → Add comments → Check sprint → Move to backlog if needed

64. "Review the backlog for board 82. Find any issues without story points, any issues without epics, and any issues without assignees. Create a summary report listing these gaps and suggest owners based on who has worked on similar issues."
    - Steps: Get backlog → Check points → Check epics → Check assignees → Search similar issues → Find historical assignees → Generate report

### Release Planning
65. "I'm planning the next release. Show me all epics in SRI project. For each epic, get all child issues and calculate total story points. Show completion percentage. Identify any epics with no issues or no story points assigned."
    - Steps: Search epics → Get child issues for each → Sum story points → Calculate completion → Identify incomplete epics

66. "Create a comprehensive view of sprint 5829: List all issues grouped by epic, show story points per epic, identify any issues blocking others, list all issues that moved in/out during the sprint, and calculate velocity."
    - Steps: Get sprint → Get issues → Group by epic → Calculate points → Check links for blockers → Track issue movements → Calculate velocity

### Automation Workflows
67. "Find all issues in the SRI project that are marked 'Done' but still in an active sprint. Move them to the closed sprint, add a completion comment with today's date, and if they have no resolution, set it to 'Fixed'."
    - Steps: Search done issues → Check sprint status → Get closed sprint → Move issues → Add comments → Update resolution

68. "Set up a new team board: Create a Scrum board for PLATFORM project, create 3 sprints (current, next, future), set up a filter for only stories and bugs, populate the first sprint with high-priority items from the backlog, and assign team roles."
    - Steps: Create filter → Create board → Create 3 sprints → Search high-priority backlog items → Move to sprint → Search team members → Assign

### Dependency Management
69. "For issue SRE-9945, show me all linked issues (blocks, is blocked by, relates to). For each blocking issue, check its status. If any blockers are not in progress, find the assignee and add a comment mentioning the dependency."
    - Steps: Get issue links → Categorize link types → Check status → Get assignees → Add comments with mentions

70. "Analyze dependencies for sprint 5829: Find all issues that are blocked by other issues. Check if the blocking issues are in the same sprint or backlog. Create a dependency report showing risks and suggest which issues to move or prioritize."
    - Steps: Get sprint issues → Get all issue links → Filter blocked issues → Check blocker locations → Analyze risk → Generate report

---

## 🔥 Level 4: Expert/Complex Multi-Workflow (8+ Tool Calls)

### Complete Sprint Retrospective
71. "Run a complete retrospective for sprint 5829: (1) Get all issues and categorize by status, (2) Calculate velocity and compare to previous sprint, (3) Find all issues that missed the sprint, (4) Identify recurring bug patterns, (5) Find team members with overloaded assignments, (6) Create a retrospective epic with sub-tasks for improvements, (7) Add retrospective notes as comments."
    - 15+ steps across multiple tools

### Project Onboarding
72. "Set up a new team member: (1) Create a welcome epic, (2) Find all beginner-friendly issues across projects, (3) Create an onboarding board with these issues, (4) Create a sprint for their first 2 weeks, (5) Assign the issues to the new member, (6) Add detailed comments on each issue with context and resources, (7) Create a filter for their work."
    - 12+ steps

### Technical Debt Audit
73. "Perform a technical debt audit for SRI project: (1) Find all issues labeled 'tech-debt', (2) Group by component/area, (3) Calculate total story points, (4) Find issues older than 6 months, (5) Create a tech-debt epic if it doesn't exist, (6) Link all tech-debt issues to it, (7) Prioritize based on age and impact, (8) Create a cleanup sprint, (9) Add analysis comments."
    - 18+ steps

### Cross-Project Release Coordination
74. "Coordinate a multi-project release: (1) Find all issues tagged 'v2.0' across SRI and PLATFORM projects, (2) Check completion status of each, (3) Identify blockers, (4) Create a release board, (5) Create a release epic in each project, (6) Link issues to respective epics, (7) Validate all have story points, (8) Create integration test issues, (9) Set up release sprint, (10) Generate release notes from completed issues."
    - 20+ steps

### Team Capacity Planning
75. "Plan next quarter's capacity: (1) Get all team members from SRI project, (2) For each member, find their average velocity over last 3 sprints, (3) Identify upcoming PTO/holidays, (4) Calculate available capacity, (5) Get all epics, (6) Estimate epic complexity, (7) Assign epics to team members based on capacity and expertise, (8) Create sprints for the quarter, (9) Distribute issues across sprints."
    - 25+ steps

---

## Test Categories Summary

### By Tool Coverage
- **Issues**: 1, 5-12, 31-35, 50-52, 55-75
- **Projects**: 1-4, 31-34, 50-75
- **Users**: 13-15, 32, 34, 51-52, 57, 60, 72
- **Comments**: 16-17, 34, 43-44, 51, 57, 59, 63, 67, 69, 71, 73
- **Boards**: 18-20, 40-42, 48, 53-54, 58, 63-64, 68, 72
- **Sprints**: 21-23, 37-39, 50-54, 56, 58-59, 61, 63, 66-68, 71, 75
- **Filters**: 24-26, 48-49, 53-54, 68, 72
- **Fields**: 27-28, 56, 62
- **Transitions**: 29-30, 67
- **Epics**: 45-47, 50-52, 55, 58, 61-62, 65, 71-73
- **Backlogs**: 53, 55, 58, 63-64, 68
- **Links**: 45, 50-52, 61, 69-70, 73
- **Search**: 8-12, 47, 50-75
- **Worklog**: (Can be added to complex workflows)
- **Attachments**: (Can be added to complex workflows)

### By Complexity
- **Level 1 (Simple)**: 30 prompts (1-30)
- **Level 2 (Medium)**: 19 prompts (31-49)
- **Level 3 (Complex)**: 21 prompts (50-70)
- **Level 4 (Expert)**: 5 prompts (71-75)

### Recommended Test Order
1. Start with Level 1 to verify basic tool functionality
2. Progress to Level 2 to test 2-3 tool workflows
3. Use Level 3 for realistic user scenarios
4. Run Level 4 for stress testing and edge cases

---

## Testing Notes

### Setup Requirements
- Test project keys: SRI, PLATFORM, SRE, PROJ
- Test board IDs: 82
- Test sprint IDs: 5829
- Test issue keys: SRE-9945, PROJ-123, SRE-100, SRE-1000
- Test users: john.doe@example.com, sarah@example.com

### Expected Behaviors
- Filters should include `ORDER BY Rank` for board creation
- Sprint URLs should show board URLs, not API URLs
- Project scoping should be automatic when issue keys mentioned
- Date ranges default to 30 days when not specified
- Auto-retry on 0 results with broader criteria
- Automatic filter creation for board setup

### Success Criteria
- ✅ All tools execute without errors
- ✅ Results formatted as markdown tables
- ✅ User-friendly URLs (browse, not API endpoints)
- ✅ Proper JQL queries displayed to user
- ✅ Date context shown in results
- ✅ Pagination handled correctly
- ✅ Read-only mode respected for writes
- ✅ Clear error messages for failures

