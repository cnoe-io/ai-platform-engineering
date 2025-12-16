"""
Query Analysis Tool for Prompt Chaining.

This tool breaks down complex user queries into structured sub-tasks
for better chain-of-thought TODO list generation. It identifies:
- Key questions the user is asking
- Required data sources/agents
- Dependencies between tasks
- Suggested execution order
"""

from langchain_core.tools import tool
from typing import Dict, List, Any, Optional
import re


# Keywords that suggest specific agent involvement
AGENT_KEYWORDS = {
    "github": ["github", "repository", "repo", "pull request", "pr", "commit", "branch", "issue", "workflow", "action"],
    "jira": ["jira", "ticket", "issue", "sprint", "epic", "story", "bug", "task", "assignee", "backlog"],
    "argocd": ["argocd", "argo", "application", "sync", "deployment", "gitops", "kubernetes", "k8s", "helm"],
    "pagerduty": ["pagerduty", "oncall", "on-call", "incident", "alert", "escalation", "schedule"],
    "aws": ["aws", "amazon", "ec2", "s3", "eks", "lambda", "cloudwatch", "iam", "rds", "cost"],
    "slack": ["slack", "channel", "message", "notification", "workspace"],
    "splunk": ["splunk", "log", "search", "alert", "detector", "metric"],
    "confluence": ["confluence", "wiki", "page", "documentation", "doc"],
    "backstage": ["backstage", "catalog", "service", "component", "system"],
    "rag": ["knowledge", "documentation", "how to", "what is", "explain", "guide", "runbook", "best practice"],
}

# Action keywords that suggest task types
ACTION_KEYWORDS = {
    "search": ["find", "search", "look for", "query", "get", "list", "show", "display"],
    "create": ["create", "make", "add", "new", "generate", "write"],
    "update": ["update", "modify", "change", "edit", "set"],
    "delete": ["delete", "remove", "cancel", "close"],
    "analyze": ["analyze", "investigate", "research", "understand", "compare", "review"],
    "report": ["report", "summarize", "aggregate", "compile", "tabulate"],
}


@tool
def analyze_query(
    user_query: str,
    available_agents: Optional[List[str]] = None
) -> Dict[str, Any]:
    """
    Analyze a user query to break it down into structured sub-tasks for TODO generation.

    Use this tool BEFORE creating your TODO list to ensure comprehensive task planning.
    This helps with prompt chaining by identifying all the discrete questions/tasks
    embedded in a complex user request.

    Args:
        user_query: The original user query/request to analyze
        available_agents: Optional list of available agent names (e.g., ["github", "jira", "argocd"])

    Returns:
        Dict containing:
        - key_questions: List of discrete questions/tasks identified in the query
        - suggested_agents: Dict mapping each question to suggested agents
        - task_dependencies: List of dependency relationships between tasks
        - recommended_order: Suggested execution order for the tasks
        - complexity: "simple" (1-2 tasks), "moderate" (3-4 tasks), or "complex" (5+ tasks)
        - analysis_summary: Human-readable summary of the analysis

    Example usage:
        analyze_query(
            user_query="Research the ai-platform-engineering repo, find recent issues, and create a summary report",
            available_agents=["github", "jira", "rag"]
        )

    After calling this tool, use the 'key_questions' list as input for write_todos
    to create a well-structured execution plan.
    """
    # Identify key questions/tasks
    key_questions = _extract_key_questions(user_query)

    # Identify suggested agents for each question
    suggested_agents = {}
    all_agents_needed = set()

    for question in key_questions:
        agents = _identify_agents_for_question(question, available_agents)
        suggested_agents[question] = agents
        all_agents_needed.update(agents)

    # Identify task dependencies
    task_dependencies = _identify_dependencies(key_questions)

    # Determine recommended execution order
    recommended_order = _determine_execution_order(key_questions, task_dependencies)

    # Calculate complexity
    num_tasks = len(key_questions)
    if num_tasks <= 2:
        complexity = "simple"
    elif num_tasks <= 4:
        complexity = "moderate"
    else:
        complexity = "complex"

    # Generate analysis summary
    analysis_summary = _generate_summary(
        key_questions,
        all_agents_needed,
        complexity,
        task_dependencies
    )

    # Generate TODO suggestions
    todo_suggestions = _generate_todo_suggestions(key_questions, suggested_agents, recommended_order)

    # Generate formatted markdown output
    markdown_output = _generate_markdown_output(
        key_questions=key_questions,
        suggested_agents=suggested_agents,
        all_agents_needed=all_agents_needed,
        task_dependencies=task_dependencies,
        recommended_order=recommended_order,
        complexity=complexity,
        todo_suggestions=todo_suggestions
    )

    return {
        "key_questions": key_questions,
        "suggested_agents": suggested_agents,
        "agents_needed": list(all_agents_needed),
        "task_dependencies": task_dependencies,
        "recommended_order": recommended_order,
        "complexity": complexity,
        "total_tasks": num_tasks,
        "analysis_summary": analysis_summary,
        "todo_suggestions": todo_suggestions,
        "markdown": markdown_output  # Formatted markdown for display
    }


def _extract_key_questions(query: str) -> List[str]:
    """Extract discrete questions/tasks from the query."""
    questions = []

    # Split on common conjunctions and punctuation
    # Handle "and", "then", "also", semicolons, numbered lists
    split_patterns = [
        r'\band\s+(?:also\s+)?',  # "and", "and also"
        r'\bthen\s+',              # "then"
        r'\balso\s+',              # "also"
        r';\s*',                   # semicolons
        r'\.\s+(?=[A-Z])',         # periods followed by capital letter
        r',\s*(?=(?:and\s+)?(?:create|get|find|show|list|search|update|delete|analyze))',  # comma before action verb
    ]

    # First try to split on explicit task separators
    segments = [query]
    for pattern in split_patterns:
        new_segments = []
        for segment in segments:
            parts = re.split(pattern, segment, flags=re.IGNORECASE)
            new_segments.extend([p.strip() for p in parts if p.strip()])
        segments = new_segments

    # Process each segment to identify distinct tasks
    for segment in segments:
        # Skip very short segments
        if len(segment) < 10:
            continue

        # Check for multiple action verbs in one segment
        action_verbs = []
        segment_lower = segment.lower()

        for action_type, keywords in ACTION_KEYWORDS.items():
            for keyword in keywords:
                if keyword in segment_lower:
                    action_verbs.append((segment_lower.find(keyword), keyword, action_type))

        # If multiple distinct actions, try to split further
        if len(action_verbs) > 1:
            action_verbs.sort(key=lambda x: x[0])

            # Check if actions are at different positions (not just synonyms together)
            positions = [av[0] for av in action_verbs]
            if max(positions) - min(positions) > 20:  # Actions are spread apart
                # Keep as potentially multiple tasks, but don't over-split
                questions.append(segment)
            else:
                questions.append(segment)
        else:
            questions.append(segment)

    # If no split happened, analyze the single query for implicit tasks
    if len(questions) == 1 and len(query) > 50:
        questions = _identify_implicit_tasks(query)

    # Clean up and deduplicate
    cleaned_questions = []
    for q in questions:
        q = q.strip()
        # Remove leading conjunctions
        q = re.sub(r'^(and|then|also|but|or)\s+', '', q, flags=re.IGNORECASE)
        q = q.strip()
        if q and q not in cleaned_questions and len(q) > 5:
            cleaned_questions.append(q)

    return cleaned_questions if cleaned_questions else [query]


def _identify_implicit_tasks(query: str) -> List[str]:
    """Identify implicit tasks in a complex query."""
    tasks = []
    query_lower = query.lower()

    # Check for research/investigation patterns
    if any(word in query_lower for word in ["research", "investigate", "analyze", "understand"]):
        # Research queries often have implicit sub-tasks
        if "repo" in query_lower or "repository" in query_lower:
            tasks.append("Get repository overview and metadata")
            tasks.append("Fetch README and documentation")
            if "issue" in query_lower or "recent" in query_lower:
                tasks.append("Get recent issues and pull requests")
            if "contributor" in query_lower or "activity" in query_lower:
                tasks.append("Analyze contributors and activity")

    # Check for report generation patterns
    if any(word in query_lower for word in ["report", "summary", "compile", "aggregate"]):
        tasks.append("Gather data from relevant sources")
        tasks.append("Synthesize and format results")

    # Check for multi-system queries
    agents_mentioned = []
    for agent, keywords in AGENT_KEYWORDS.items():
        if any(kw in query_lower for kw in keywords):
            agents_mentioned.append(agent)

    if len(agents_mentioned) > 1:
        for agent in agents_mentioned:
            tasks.append(f"Query {agent} for relevant information")
        tasks.append("Correlate and synthesize results from all sources")

    return tasks if tasks else [query]


def _identify_agents_for_question(question: str, available_agents: Optional[List[str]]) -> List[str]:
    """Identify which agents are relevant for a question."""
    question_lower = question.lower()
    agents = []

    for agent, keywords in AGENT_KEYWORDS.items():
        # Check if agent is available (if list provided)
        if available_agents and agent not in [a.lower() for a in available_agents]:
            continue

        if any(keyword in question_lower for keyword in keywords):
            agents.append(agent)

    # If no specific agent identified, suggest RAG for knowledge queries
    if not agents:
        if any(word in question_lower for word in ["what", "how", "why", "explain", "documentation"]):
            agents.append("rag")

    return agents


def _identify_dependencies(questions: List[str]) -> List[Dict[str, str]]:
    """Identify dependencies between tasks."""
    dependencies = []

    for i, q1 in enumerate(questions):
        q1_lower = q1.lower()
        for j, q2 in enumerate(questions):
            if i >= j:
                continue
            q2_lower = q2.lower()

            # Check for explicit dependency patterns
            # "using X" or "with X" suggests dependency on previous data
            if any(pattern in q2_lower for pattern in ["using the", "with the", "based on", "from the"]):
                dependencies.append({
                    "task": q2,
                    "depends_on": q1,
                    "reason": "Task references data from previous task"
                })

            # Synthesis/report tasks depend on data gathering
            if any(word in q2_lower for word in ["synthesize", "summarize", "report", "compile", "correlate"]):
                if any(word in q1_lower for word in ["get", "fetch", "find", "search", "query"]):
                    dependencies.append({
                        "task": q2,
                        "depends_on": q1,
                        "reason": "Synthesis depends on data gathering"
                    })

    return dependencies


def _determine_execution_order(questions: List[str], dependencies: List[Dict[str, str]]) -> List[str]:
    """Determine optimal execution order based on dependencies."""
    # Start with original order
    ordered = []
    remaining = questions.copy()

    # Build dependency map
    dep_map = {}
    for dep in dependencies:
        task = dep["task"]
        if task not in dep_map:
            dep_map[task] = []
        dep_map[task].append(dep["depends_on"])

    # Topological sort
    while remaining:
        # Find tasks with no unresolved dependencies
        available = []
        for task in remaining:
            deps = dep_map.get(task, [])
            if all(d in ordered for d in deps):
                available.append(task)

        if not available:
            # No tasks available (cycle or all remaining have deps)
            # Just add remaining in original order
            ordered.extend(remaining)
            break

        # Add first available task
        task = available[0]
        ordered.append(task)
        remaining.remove(task)

    return ordered


def _generate_summary(
    questions: List[str],
    agents: set,
    complexity: str,
    dependencies: List[Dict[str, str]]
) -> str:
    """Generate a human-readable analysis summary."""
    summary_parts = []

    summary_parts.append(f"📊 **Query Analysis**: {complexity.upper()} ({len(questions)} tasks)")

    if agents:
        summary_parts.append(f"🤖 **Agents needed**: {', '.join(sorted(agents))}")

    summary_parts.append("📋 **Key tasks identified**:")
    for i, q in enumerate(questions, 1):
        summary_parts.append(f"   {i}. {q}")

    if dependencies:
        summary_parts.append(f"🔗 **Dependencies**: {len(dependencies)} task dependencies found")

    return "\n".join(summary_parts)


def _generate_todo_suggestions(
    questions: List[str],
    suggested_agents: Dict[str, List[str]],
    execution_order: List[str]
) -> List[Dict[str, str]]:
    """Generate TODO item suggestions based on analysis."""
    todos = []

    for i, question in enumerate(execution_order, 1):
        agents = suggested_agents.get(question, [])
        agent_hint = f" (via {', '.join(agents)})" if agents else ""

        todos.append({
            "id": str(i),
            "content": f"{question}{agent_hint}",
            "status": "pending",
            "suggested_agents": agents
        })

    # Add synthesis task if multiple tasks
    if len(todos) > 1:
        todos.append({
            "id": str(len(todos) + 1),
            "content": "Synthesize results and present findings",
            "status": "pending",
            "suggested_agents": []
        })

    return todos


def _generate_markdown_output(
    key_questions: List[str],
    suggested_agents: Dict[str, List[str]],
    all_agents_needed: set,
    task_dependencies: List[Dict[str, str]],
    recommended_order: List[str],
    complexity: str,
    todo_suggestions: List[Dict[str, str]]
) -> str:
    """Generate a well-formatted markdown output for the analysis."""

    # Complexity emoji
    complexity_emoji = {
        "simple": "🟢",
        "moderate": "🟡",
        "complex": "🔴"
    }.get(complexity, "⚪")

    md = []

    # Header
    md.append("## 📊 Query Analysis Results\n")

    # Summary box
    md.append(f"**Complexity:** {complexity_emoji} {complexity.upper()} ({len(key_questions)} tasks)\n")

    # Agents needed
    if all_agents_needed:
        agent_badges = " ".join([f"`{agent}`" for agent in sorted(all_agents_needed)])
        md.append(f"**Agents Needed:** {agent_badges}\n")

    md.append("---\n")

    # Key Questions / Tasks
    md.append("### 🎯 Key Tasks Identified\n")
    md.append("| # | Task | Suggested Agent(s) |")
    md.append("|---|------|-------------------|")

    for i, question in enumerate(recommended_order, 1):
        agents = suggested_agents.get(question, [])
        agents_str = ", ".join([f"`{a}`" for a in agents]) if agents else "_none_"
        # Truncate long questions for table display
        task_display = question[:80] + "..." if len(question) > 80 else question
        md.append(f"| {i} | {task_display} | {agents_str} |")

    md.append("")

    # Dependencies (if any)
    if task_dependencies:
        md.append("### 🔗 Task Dependencies\n")
        for dep in task_dependencies:
            task_short = dep['task'][:50] + "..." if len(dep['task']) > 50 else dep['task']
            depends_short = dep['depends_on'][:50] + "..." if len(dep['depends_on']) > 50 else dep['depends_on']
            md.append(f"- **{task_short}** → depends on → _{depends_short}_")
            md.append(f"  - Reason: {dep['reason']}")
        md.append("")

    md.append("---\n")

    # TODO Suggestions (ready to use)
    md.append("### 📋 Suggested Execution Plan\n")
    md.append("Copy this to your TODO list:\n")
    md.append("```")
    md.append("📋 Execution Plan")

    for todo in todo_suggestions:
        status_emoji = "⏳"
        md.append(f"- {status_emoji} {todo['content']}")

    md.append("```\n")

    # JSON for write_todos (collapsible)
    md.append("<details>")
    md.append("<summary>📦 JSON for <code>write_todos</code> (click to expand)</summary>\n")
    md.append("```python")
    md.append("write_todos(merge=False, todos=[")
    for todo in todo_suggestions:
        md.append(f'    {{"id": "{todo["id"]}", "content": "{todo["content"]}", "status": "pending"}},')
    md.append("])")
    md.append("```")
    md.append("</details>\n")

    return "\n".join(md)

