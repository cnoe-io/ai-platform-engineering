---
name: review-open-pull-requests
description: List and analyze all open pull requests across GitHub repositories. Shows review status, CI/CD check results, age, and reviewers. Use when triaging PRs, checking team velocity, or identifying stale reviews that need attention.
---

# Review Open Pull Requests

Retrieve all open pull requests across configured repositories and present an organized view of their status, reviewers, CI results, and staleness.

## Instructions

1. **Fetch open PRs** using the GitHub agent. For each PR, collect:
   - PR number, title, and author
   - Repository name
   - Branch name (head -> base)
   - Review status (approved, changes requested, pending review, no reviewers)
   - CI/CD check status (passing, failing, pending)
   - Labels and draft status
   - Age (time since creation) and last activity
2. **Categorize PRs** by urgency:
   - **Needs Immediate Attention**: Failing CI, changes requested, or stale (>5 days)
   - **Ready to Merge**: Approved with passing checks
   - **In Progress**: Draft PRs or pending reviews
   - **Blocked**: Has \`blocked\` or \`do-not-merge\` labels
3. **Provide summary statistics**

## Examples

- "List all open pull requests in our repos"
- "Show me PRs that need review"
- "Which PRs have failing CI checks?"
- "Are there any stale PRs older than a week?"

## Guidelines

- Sort PRs by urgency, then by age (oldest first)
- Flag PRs with no assigned reviewers prominently
- Check for conventional commit compliance in PR titles when possible
- Highlight draft PRs separately so they don't clutter the action-needed list
- Include direct links to PRs where possible