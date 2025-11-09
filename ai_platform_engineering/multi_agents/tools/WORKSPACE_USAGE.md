# Agent Workspace Usage Guide

## Problem Statement

When multiple agents run in parallel, their outputs can become **garbled** or interleaved, making the final response confusing and hard to read. The Agent Workspace solves this by providing a temporary, in-memory filesystem where agents can write results to separate files and combine them cleanly.

## Solution: Agent Workspace

The workspace provides **4 tools** for coordinating parallel agent outputs:
- `write_workspace_file()` - Sub-agents write results
- `read_workspace_file()` - Read results back
- `list_workspace_files()` - See available files
- `clear_workspace()` - Start fresh

## Security Features

✅ **Temporary Storage** - Uses Python's tempfile (tmpfs on Linux, in-memory when available)  
✅ **Complete Isolation** - Restricted to temporary directory, cannot access CAIPE source code  
✅ **Size Limits** - Max 5MB per file, max 100 files total  
✅ **Automatic Cleanup** - Automatically deleted when context ends or task completes  
✅ **Safe** - Path traversal protection and proper filesystem isolation

## Usage Patterns

### Pattern 1: Parallel Agents with Clean Aggregation

**Problem:** Running ArgoCD + Jira agents in parallel produces garbled output.

**Solution:**

```python
# Step 1: Clear workspace at start
clear_workspace()

# Step 2: Spawn parallel agents, each writes to separate file
# ArgoCD agent writes to workspace
argocd_result = task("Get all ArgoCD applications", agent="argocd")
write_workspace_file("argocd_results.md", argocd_result)

# Jira agent writes to workspace (runs in parallel)
jira_result = task("Get all open P1 issues", agent="jira")
write_workspace_file("jira_results.md", jira_result)

# Step 3: Read and combine results cleanly
argocd_data = read_workspace_file("argocd_results.md")
jira_data = read_workspace_file("jira_results.md")

# Step 4: Create clean, organized final response
final_response = f"""
# Platform Status Report

## ArgoCD Applications
{argocd_data['content']}

## Jira Issues (P1)
{jira_data['content']}

_Sources: ArgoCD, Jira_
"""

# Step 5: Format and return
format_markdown(final_response)
```

**Before:** Garbled output with interleaved text  
**After:** Clean, organized sections from each agent

---

### Pattern 2: Progressive Result Building

**Problem:** Complex analysis requires multiple steps, intermediate results get lost.

**Solution:**

```python
# Clear workspace
clear_workspace()

# Step 1: Gather base data
apps = task("List all apps in prod namespace", agent="argocd")
write_workspace_file("apps.txt", apps)

# Step 2: Filter and analyze (using previous results)
apps_list = read_workspace_file("apps.txt")['content']
degraded_apps = task(f"Find degraded apps from: {apps_list}", agent="argocd")
write_workspace_file("degraded.txt", degraded_apps)

# Step 3: Get related issues
degraded_list = read_workspace_file("degraded.txt")['content']
issues = task(f"Find Jira issues for apps: {degraded_list}", agent="jira")
write_workspace_file("related_issues.txt", issues)

# Step 4: Combine all results
final_analysis = f"""
## Total Applications
{read_workspace_file("apps.txt")['content']}

## Degraded Applications
{read_workspace_file("degraded.txt")['content']}

## Related Jira Issues
{read_workspace_file("related_issues.txt")['content']}
"""
```

**Benefit:** Intermediate results preserved, easy to debug, clean flow

---

### Pattern 3: Multiple Data Sources Aggregation

**Problem:** Need to correlate data from 5+ different sources.

**Solution:**

```python
clear_workspace()

# Spawn all agents in parallel, each writes to workspace
task("Get ArgoCD health", agent="argocd") + write_workspace_file("argocd.md", ...)
task("Get AWS resources", agent="aws") + write_workspace_file("aws.md", ...)
task("Get PagerDuty incidents", agent="pagerduty") + write_workspace_file("pagerduty.md", ...)
task("Get Slack alerts", agent="slack") + write_workspace_file("slack.md", ...)
task("Get Splunk logs", agent="splunk") + write_workspace_file("splunk.md", ...)

# Check what we collected
files = list_workspace_files()
print(f"Collected {files['count']} data sources")

# Read and combine
combined = ""
for file in files['files']:
    content = read_workspace_file(file['path'])
    combined += f"\n\n## {file['path']}\n{content['content']}"

# Return organized report
format_markdown(combined)
```

**Benefit:** Easy to see what data was collected, clean aggregation

---

### Pattern 4: Hierarchical Organization

**Problem:** Complex analysis with multiple categories of results.

**Solution:**

```python
clear_workspace()

# Organize by category using directories
write_workspace_file("infrastructure/argocd.md", argocd_results)
write_workspace_file("infrastructure/aws.md", aws_results)
write_workspace_file("alerts/pagerduty.md", pagerduty_results)
write_workspace_file("alerts/slack.md", slack_results)
write_workspace_file("tickets/jira.md", jira_results)
write_workspace_file("tickets/github.md", github_results)

# List files to see structure
all_files = list_workspace_files()

# Read by category
infra_files = [f for f in all_files['files'] if f['path'].startswith('infrastructure/')]
alert_files = [f for f in all_files['files'] if f['path'].startswith('alerts/')]
ticket_files = [f for f in all_files['files'] if f['path'].startswith('tickets/')]

# Combine by category
final_report = create_categorized_report(infra_files, alert_files, ticket_files)
```

**Benefit:** Clear organization, easy to process by category

---

## API Reference

### `write_workspace_file(file_path: str, content: str)`

Write content to a temporary file in the workspace.

**Parameters:**
- `file_path`: Path to file (e.g., `"argocd_results.md"`, `"analysis/jira.txt"`)
- `content`: Content to write (string)

**Returns:**
```python
{
    'success': True,
    'path': 'argocd_results.md',
    'size': 1234,
    'message': 'Successfully wrote 1234 characters to argocd_results.md'
}
```

**Limits:**
- Max file size: 5 MB
- Max files: 100
- Max path length: 256 characters

---

### `read_workspace_file(file_path: str)`

Read content from a workspace file.

**Parameters:**
- `file_path`: Path to file

**Returns:**
```python
{
    'success': True,
    'content': '# ArgoCD Results\n\n...',
    'path': 'argocd_results.md',
    'size': 1234,
    'message': 'Successfully read 1234 characters from argocd_results.md'
}
```

---

### `list_workspace_files(directory: str = "/")`

List all files in workspace.

**Parameters:**
- `directory`: Directory to list (default: `"/"` for all files)

**Returns:**
```python
{
    'success': True,
    'files': [
        {'path': 'argocd_results.md', 'size': 1234},
        {'path': 'jira_results.md', 'size': 567},
        {'path': 'analysis/summary.txt', 'size': 890}
    ],
    'count': 3,
    'message': 'Found 3 files in workspace'
}
```

---

### `clear_workspace()`

Clear all files from workspace.

**Returns:**
```python
{
    'success': True,
    'files_removed': 5,
    'message': 'Cleared workspace (5 files removed)'
}
```

**Use Cases:**
- At start of new task (ensure clean slate)
- After completing task (cleanup)
- When switching contexts

---

## Best Practices

### ✅ DO

1. **Clear at start**: `clear_workspace()` at beginning of each new task
2. **Descriptive names**: Use clear file names like `"argocd_health.md"` not `"data.txt"`
3. **Use directories**: Organize with paths like `"reports/argocd.md"`, `"analysis/summary.txt"`
4. **Check success**: Always check `result['success']` before using content
5. **List files**: Use `list_workspace_files()` to see what's available
6. **Combine cleanly**: Read all files and create organized final response

### ❌ DON'T

1. **Don't assume files exist**: Always check `result['success']` 
2. **Don't write huge files**: Max 5 MB per file
3. **Don't create too many files**: Max 100 files
4. **Don't use as permanent storage**: Workspace is temporary
5. **Don't skip clear_workspace()**: Start each task with clean slate

---

## Troubleshooting

### Problem: File not found

```python
result = read_workspace_file("results.md")
if not result['success']:
    # File doesn't exist, check what files are available
    available = list_workspace_files()
    print(f"Available files: {available['files']}")
```

### Problem: Workspace full

```python
result = write_workspace_file("data.md", content)
if not result['success'] and 'full' in result['message']:
    # Clear old files
    clear_workspace()
    # Try again
    write_workspace_file("data.md", content)
```

### Problem: File too large

```python
# Solution: Break into smaller chunks
chunks = split_content(large_content, chunk_size=4_000_000)  # 4MB chunks
for i, chunk in enumerate(chunks):
    write_workspace_file(f"data_part_{i}.md", chunk)
```

---

## Implementation Details

- **Technology**: Python's `tempfile.TemporaryDirectory`
- **Storage**: tmpfs on Linux (in-memory), OS temp directory otherwise
- **Persistence**: Per-context only (automatically cleaned up when context ends)
- **Isolation**: Restricted to temporary directory with path traversal protection
- **Security**: Standard Python library with proper filesystem isolation

---

## Example Workflow

```python
# 1. Start fresh
clear_workspace()

# 2. Spawn parallel agents
argocd_task = task("Get all apps", agent="argocd")
jira_task = task("Get P1 issues", agent="jira")
aws_task = task("Get EC2 instances", agent="aws")

# 3. Each agent writes to workspace (you may need to instruct sub-agents)
# (Agents write their results to workspace during execution)
write_workspace_file("argocd.md", argocd_task)
write_workspace_file("jira.md", jira_task)
write_workspace_file("aws.md", aws_task)

# 4. Check what we have
files = list_workspace_files()
print(f"Collected {files['count']} results")

# 5. Read and combine
final_response = "# Platform Status\n\n"
for file in files['files']:
    content = read_workspace_file(file['path'])
    if content['success']:
        final_response += f"## {file['path']}\n{content['content']}\n\n"

# 6. Format and return
formatted = format_markdown(final_response)
return formatted['formatted_text']
```

---

## Contact & Support

For questions or issues:
- Check `workspace_ops.py` for implementation details
- Review this guide for usage patterns
- Contact: Sri Aradhyula <sraradhy@cisco.com>

**Last Updated:** November 8, 2025  
**License:** Apache-2.0

