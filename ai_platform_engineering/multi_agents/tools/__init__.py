"""
Multi-agent tools package.

Contains shared tools used across multiple agents.

Command-line tools are in utils/agent_tools/ for use by all agents:
- git: Run any git command with auto auth
- curl: Run any curl command
- wget: Run any wget command
- grep: Run any grep command
- glob_find: Find files with glob patterns
- fetch_url: Fetch content from public URLs
- jq: Process JSON data
- yq: Process YAML data
- read_file, write_file, append_file, list_files: File I/O
"""

from ai_platform_engineering.multi_agents.tools.get_current_date import get_current_date
from ai_platform_engineering.multi_agents.tools.request_user_input import request_user_input
from ai_platform_engineering.multi_agents.tools.workspace_ops import (
    write_workspace_file,
    read_workspace_file,
    list_workspace_files,
    clear_workspace
)
# Spec #099 Phase 3 — autonomous-task management tools so the supervisor's
# main agent can chat-create / update / delete / trigger autonomous tasks
# without forcing the operator into the form dialog.
from ai_platform_engineering.multi_agents.tools.autonomous_tasks import (
    list_autonomous_tasks,
    create_autonomous_task,
    update_autonomous_task,
    delete_autonomous_task,
    trigger_autonomous_task_now,
    validate_cron_expression,
)
# Spec #099 webhook follow-up — GitHub-side webhook registration so the
# supervisor can wire a repo to an autonomous-agents webhook task in a
# single conversational turn (no visiting github.com to click through
# Settings → Webhooks).
from ai_platform_engineering.multi_agents.tools.github_webhooks import (
    register_github_webhook,
    list_github_webhooks,
    delete_github_webhook,
    test_github_webhook,
)
# Spec #099 webhook follow-up Phase 4 — canonical prompt templates so
# the supervisor LLM hands create_autonomous_task a well-structured
# prompt for common scenarios (issue triage, PR review, push notify)
# instead of improvising from scratch every time.
from ai_platform_engineering.multi_agents.tools.webhook_task_templates import (
    get_webhook_task_template,
)

# Command-line tools from utils/agent_tools/ (available to all agents)
from ai_platform_engineering.utils.agent_tools import (
    git,
    curl,
    wget,
    grep,
    glob_find,
    fetch_url,
    jq,
    yq,
    read_file,
    write_file,
    append_file,
    list_files,
)

__all__ = [
    # Core utilities
    'fetch_url',
    'get_current_date',
    'request_user_input',  # Structured user input tool
    'write_workspace_file',
    'read_workspace_file',
    'list_workspace_files',
    'clear_workspace',

    # Autonomous-task management (spec #099 Phase 3)
    'list_autonomous_tasks',
    'create_autonomous_task',
    'update_autonomous_task',
    'delete_autonomous_task',
    'trigger_autonomous_task_now',
    'validate_cron_expression',

    # GitHub webhook management (spec #099 webhook follow-up)
    'register_github_webhook',
    'list_github_webhooks',
    'delete_github_webhook',
    'test_github_webhook',

    # Canonical webhook-task prompt templates (spec #099 Phase 4)
    'get_webhook_task_template',

    # Command-line tools (pass full shell command)
    'git',          # git("git clone https://github.com/org/repo")
    'curl',         # curl("curl -sL https://example.com/api")
    'wget',         # wget("wget -O out.txt https://example.com")
    'grep',         # grep("grep -rn pattern /path")
    'glob_find',    # glob_find("**/*.py")

    # Data processing tools
    'jq',           # jq("jq '.items[].name' data.json")
    'yq',           # yq("yq '.spec.replicas' deployment.yaml")

    # File I/O tools
    'read_file',    # read_file("/tmp/data.json")
    'write_file',   # write_file("/tmp/out.json", content)
    'append_file',  # append_file("/tmp/log.txt", "entry\n")
    'list_files',   # list_files("/tmp/repo", pattern="*.yaml")
]
