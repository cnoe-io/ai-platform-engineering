"""
Query Analysis Tool for Prompt Chaining.

=============================================================================
PURPOSE:
=============================================================================
This tool is part of the CAIPE supervisor agent's planning workflow. It uses
an LLM to semantically break down complex user queries into structured sub-tasks,
enabling better chain-of-thought TODO list generation.

=============================================================================
WORKFLOW INTEGRATION:
=============================================================================
The supervisor agent (deep_agent) uses a two-phase planning approach:

  Phase 1: PROMPT CHAINING (this tool)
  ------------------------------------
  For complex queries, the supervisor first calls `analyze_query` to:
  - Identify discrete tasks/questions in the user's request
  - Map each task to appropriate specialized agents
  - Determine task dependencies and execution order
  - Generate ready-to-use TODO suggestions

  Phase 2: CHAIN-OF-THOUGHT (write_todos)
  ---------------------------------------
  The supervisor then uses the analysis output to create a structured
  TODO execution plan via `write_todos`, which:
  - Displays a visual checklist to the user
  - Tracks task completion status
  - Enables systematic task execution

=============================================================================
EXAMPLE USAGE:
=============================================================================
User query: "Research the ai-platform-engineering repo, find recent issues,
             and create a summary report"

1. Supervisor calls:
   analyze_query(
       user_query="Research the ai-platform-engineering repo...",
       available_agents=["github", "jira", "rag"]
   )

2. This tool returns markdown analysis with:
   - Key tasks: [get repo info, find issues, create summary]
   - Agent mapping: {repo info: github, issues: github/jira, summary: synthesize}
   - Execution order: [1, 2, 3]
   - Ready-to-use TODO JSON

3. Supervisor copies TODO suggestions to:
   write_todos(merge=False, todos=[
       {"id": "1", "content": "Get repository info (via github)", "status": "pending"},
       {"id": "2", "content": "Find recent issues (via github, jira)", "status": "pending"},
       {"id": "3", "content": "Create summary report", "status": "pending"}
   ])

=============================================================================
ARCHITECTURE:
=============================================================================
                    ┌─────────────────────┐
                    │    User Query       │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   analyze_query()   │ ◄── This tool
                    │   (Prompt Chaining) │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
              ▼                ▼                ▼
        ┌─────────┐      ┌─────────┐      ┌─────────┐
        │   LLM   │  OR  │Fallback │      │ Format  │
        │Analysis │      │Heuristic│      │ Output  │
        └────┬────┘      └────┬────┘      └────┬────┘
              └────────────────┼────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │   Markdown Output   │
                    │   with TODO JSON    │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │    write_todos()    │
                    │  (Chain-of-Thought) │
                    └─────────────────────┘
"""

import json
import logging
from langchain_core.tools import tool
from langchain_core.messages import HumanMessage, SystemMessage
from typing import Dict, List, Any, Optional

logger = logging.getLogger(__name__)


# =============================================================================
# LLM PROMPT TEMPLATES
# =============================================================================
# These prompts guide the LLM to perform structured query analysis.
# The system prompt defines the task and output format.
# The user prompt provides the specific query to analyze.

ANALYSIS_SYSTEM_PROMPT = """You are a query analysis expert. Your job is to break down complex user queries into discrete, actionable tasks.

## Your Task
Analyze the user's query and break it down into specific sub-tasks that can be executed by specialized agents.

## Available Agents
{available_agents}

## Agent Capabilities
- **github**: Repository info, pull requests, issues, commits, workflows, branches
- **jira**: Tickets, sprints, epics, stories, bugs, project management
- **argocd**: Kubernetes deployments, GitOps applications, sync status
- **pagerduty**: Incidents, on-call schedules, alerts, escalation policies
- **aws**: EKS clusters, EC2 instances, S3, costs, CloudWatch
- **splunk**: Log search, metrics, alerts, detectors
- **confluence**: Wiki pages, documentation, spaces
- **backstage**: Service catalog, components, systems
- **rag**: Knowledge base search, documentation lookup, how-to guides

## Output Format
Respond with a JSON object containing:
```json
{{
  "key_questions": ["List of discrete tasks/questions identified"],
  "task_agent_mapping": {{
    "task description": ["agent1", "agent2"]
  }},
  "dependencies": [
    {{"task": "task that depends", "depends_on": "prerequisite task", "reason": "why"}}
  ],
  "execution_order": ["ordered list of tasks"],
  "complexity": "simple|moderate|complex",
  "reasoning": "Brief explanation of your analysis"
}}
```

## Rules
1. Break compound queries into atomic tasks (e.g., "find X and update Y" → 2 tasks)
2. Identify data dependencies (e.g., "search results" needed before "summarize")
3. Map each task to the MOST appropriate agent(s) from the available list
4. Order tasks respecting dependencies
5. Complexity: simple (1-2 tasks), moderate (3-4), complex (5+)

Only output valid JSON, no markdown code blocks or extra text."""

ANALYSIS_USER_PROMPT = """Analyze this user query and break it down into actionable tasks:

**User Query:** {query}

**Available Agents:** {agents}

Provide your analysis as a JSON object."""


# =============================================================================
# LLM FACTORY HELPER
# =============================================================================

def _get_llm():
    """
    Get an LLM instance for query analysis.

    Uses cnoe_agent_utils.LLMFactory to create the LLM, which respects
    environment configuration (MODEL_NAME, OPENAI_API_KEY, etc.).

    Returns:
        LLM instance or None if creation fails.

    Note:
        Temperature is set to 0.0 for deterministic, structured output.
        This ensures consistent task breakdown across similar queries.
    """
    try:
        from cnoe_agent_utils import LLMFactory

        # Use temperature=0 for consistent, structured analysis
        llm = LLMFactory.create(
            temperature=0.0,  # Deterministic for structured output
        )
        return llm
    except Exception as e:
        logger.warning(f"Could not create LLM via LLMFactory: {e}")
        return None


# =============================================================================
# RESPONSE PARSING
# =============================================================================

def _parse_llm_response(response_text: str) -> Dict[str, Any]:
    """
    Parse LLM response text into a structured dictionary.

    Handles common LLM output quirks:
    - Markdown code blocks (```json ... ```)
    - Extra whitespace
    - Invalid JSON (returns None for fallback)

    Args:
        response_text: Raw text response from the LLM.

    Returns:
        Parsed dictionary or None if parsing fails.
    """
    text = response_text.strip()

    # Remove markdown code blocks if present
    # LLMs sometimes wrap JSON in ```json ... ``` despite instructions
    if text.startswith("```"):
        lines = text.split("\n")
        # Remove first line (```json or ```)
        lines = lines[1:]
        # Remove last line if it's ```
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines)

    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        logger.warning(f"Failed to parse LLM response as JSON: {e}")
        return None


# =============================================================================
# FALLBACK HEURISTIC ANALYSIS
# =============================================================================

def _fallback_analysis(query: str, available_agents: List[str]) -> Dict[str, Any]:
    """
    Fallback to basic keyword-based analysis when LLM is unavailable.

    This is a degraded mode that uses simple string matching to identify
    relevant agents. It's less accurate than LLM analysis but ensures
    the tool always returns something useful.

    Args:
        query: The user's query string.
        available_agents: List of agent names currently available.

    Returns:
        Analysis dictionary with is_fallback=True flag.

    Note:
        This fallback is triggered when:
        - LLMFactory fails to create an LLM
        - LLM invocation throws an exception
        - LLM response cannot be parsed as JSON
    """
    query_lower = query.lower()

    # Keyword-to-agent mapping for basic detection
    # These keywords suggest which agent might be relevant
    agent_keywords = {
        "github": ["github", "repo", "pull request", "pr", "commit", "branch"],
        "jira": ["jira", "ticket", "sprint", "epic", "story", "bug"],
        "argocd": ["argocd", "argo", "deployment", "sync", "kubernetes", "k8s"],
        "pagerduty": ["pagerduty", "oncall", "on-call", "incident", "alert"],
        "aws": ["aws", "ec2", "s3", "eks", "lambda", "cost"],
        "splunk": ["splunk", "log", "search", "metric"],
        "confluence": ["confluence", "wiki", "documentation", "doc"],
        "backstage": ["backstage", "catalog", "service"],
        "rag": ["knowledge", "how to", "what is", "explain", "guide"],
    }

    # Detect agents based on keyword presence
    detected_agents = []
    for agent, keywords in agent_keywords.items():
        if agent in [a.lower() for a in available_agents]:
            if any(kw in query_lower for kw in keywords):
                detected_agents.append(agent)

    # Return simple structure - treats entire query as single task
    return {
        "key_questions": [query],
        "task_agent_mapping": {query: detected_agents or ["rag"]},
        "dependencies": [],
        "execution_order": [query],
        "complexity": "simple",
        "reasoning": "Fallback analysis (LLM unavailable) - basic keyword matching used",
        "is_fallback": True  # Flag to indicate degraded mode
    }


# =============================================================================
# MAIN TOOL FUNCTION
# =============================================================================

@tool
def analyze_query(
    user_query: str,
    available_agents: Optional[List[str]] = None
) -> str:
    """
    Analyze a complex user query using an LLM to break it down into structured sub-tasks.

    This tool is designed for PROMPT CHAINING - use it BEFORE creating your TODO list
    to ensure comprehensive task planning. The LLM semantically understands the query
    and identifies embedded tasks, appropriate agents, and execution order.

    Args:
        user_query: The original user query/request to analyze.
        available_agents: Optional list of available agent names (e.g., ["github", "jira"]).
                         If not provided, all standard agents are assumed available.

    Returns:
        Markdown formatted analysis containing:
        - Summary with complexity rating and agents needed
        - Table of key tasks with suggested agents
        - Task dependencies (if any)
        - Ready-to-use TODO suggestions for write_todos

    Example:
        analyze_query(
            user_query="Research the ai-platform-engineering repo, find recent issues, and create a summary",
            available_agents=["github", "jira", "rag"]
        )

    When to use:
        ✅ Complex queries with multiple parts ("do X and Y and Z")
        ✅ Research/investigation requests
        ✅ Queries involving multiple systems
        ✅ Report generation requests

    When to skip:
        ❌ Simple single-action queries ("list PRs")
        ❌ Greetings ("hello", "how can you help?")
        ❌ Direct questions ("what is X?")
    """
    # Set default available agents if not specified
    # These represent the standard CAIPE agent ecosystem
    if not available_agents:
        available_agents = [
            "github", "jira", "argocd", "pagerduty", "aws",
            "splunk", "confluence", "backstage", "rag"
        ]

    agents_str = ", ".join(available_agents)

    # =======================================================================
    # STEP 1: Attempt LLM-based analysis (preferred)
    # =======================================================================
    llm = _get_llm()
    analysis = None

    if llm:
        try:
            # Construct the prompt messages
            messages = [
                SystemMessage(content=ANALYSIS_SYSTEM_PROMPT.format(available_agents=agents_str)),
                HumanMessage(content=ANALYSIS_USER_PROMPT.format(query=user_query, agents=agents_str))
            ]

            # Invoke the LLM
            response = llm.invoke(messages)
            response_text = response.content if hasattr(response, 'content') else str(response)

            # Parse the structured response
            analysis = _parse_llm_response(response_text)

            if analysis:
                logger.info(f"LLM analysis completed: {len(analysis.get('key_questions', []))} tasks identified")
        except Exception as e:
            logger.warning(f"LLM analysis failed: {e}, falling back to heuristics")

    # =======================================================================
    # STEP 2: Fallback to heuristic analysis if LLM failed
    # =======================================================================
    if not analysis:
        analysis = _fallback_analysis(user_query, available_agents)

    # =======================================================================
    # STEP 3: Format the analysis as markdown for the supervisor
    # =======================================================================
    return _format_analysis_output(user_query, analysis)


# =============================================================================
# OUTPUT FORMATTING
# =============================================================================

def _format_analysis_output(query: str, analysis: Dict[str, Any]) -> str:
    """
    Format the analysis result as markdown for the supervisor agent.

    The output is designed to be:
    1. Human-readable (for debugging/transparency)
    2. LLM-parseable (supervisor can extract TODO suggestions)
    3. Actionable (includes ready-to-use write_todos JSON)

    Output Structure:
    -----------------
    ## 📊 Query Analysis Results

    **Complexity:** 🟡 MODERATE (3 tasks)
    **Agents Needed:** `github` `jira`

    ---

    ### 🎯 Key Tasks Identified
    | # | Task | Agent(s) |
    |---|------|----------|
    | 1 | Get repo info | `github` |
    ...

    ### 🔗 Task Dependencies
    (if any)

    ---

    ### 📋 Suggested TODO Items
    ```
    - ⏳ Task 1 (via agent)
    - ⏳ Task 2 (via agent)
    ```

    <details>
    <summary>📦 JSON for write_todos</summary>
    ```python
    write_todos(merge=False, todos=[...])
    ```
    </details>

    Args:
        query: Original user query (for context).
        analysis: Parsed analysis dictionary from LLM or fallback.

    Returns:
        Formatted markdown string.
    """
    # Extract analysis components with defaults
    key_questions = analysis.get("key_questions", [query])
    task_mapping = analysis.get("task_agent_mapping", {})
    dependencies = analysis.get("dependencies", [])
    execution_order = analysis.get("execution_order", key_questions)
    complexity = analysis.get("complexity", "moderate")
    reasoning = analysis.get("reasoning", "")
    is_fallback = analysis.get("is_fallback", False)

    # Visual complexity indicator
    complexity_emoji = {
        "simple": "🟢",    # 1-2 tasks
        "moderate": "🟡",  # 3-4 tasks
        "complex": "🔴"    # 5+ tasks
    }.get(complexity, "⚪")

    # Collect all unique agents mentioned
    all_agents = set()
    for agents in task_mapping.values():
        all_agents.update(agents)

    # Build markdown output
    md = []

    # ---------------------------------------------------------------------
    # HEADER & SUMMARY
    # ---------------------------------------------------------------------
    md.append("## 📊 Query Analysis Results\n")

    # Warning if using fallback mode
    if is_fallback:
        md.append("⚠️ *Using fallback analysis (LLM unavailable)*\n")

    # Complexity and agents summary
    md.append(f"**Complexity:** {complexity_emoji} {complexity.upper()} ({len(key_questions)} tasks)")

    if all_agents:
        agent_badges = " ".join([f"`{agent}`" for agent in sorted(all_agents)])
        md.append(f"**Agents Needed:** {agent_badges}")

    # LLM's reasoning (helps with debugging/transparency)
    if reasoning:
        md.append(f"\n**Analysis:** {reasoning}")

    md.append("\n---\n")

    # ---------------------------------------------------------------------
    # KEY TASKS TABLE
    # ---------------------------------------------------------------------
    md.append("### 🎯 Key Tasks Identified\n")
    md.append("| # | Task | Agent(s) |")
    md.append("|---|------|----------|")

    for i, task in enumerate(execution_order, 1):
        agents = task_mapping.get(task, [])
        agents_str = ", ".join([f"`{a}`" for a in agents]) if agents else "_auto_"
        # Truncate long task descriptions for table readability
        task_display = task[:80] + "..." if len(task) > 80 else task
        md.append(f"| {i} | {task_display} | {agents_str} |")

    md.append("")

    # ---------------------------------------------------------------------
    # TASK DEPENDENCIES (if any exist)
    # ---------------------------------------------------------------------
    if dependencies:
        md.append("### 🔗 Task Dependencies\n")
        for dep in dependencies:
            md.append(f"- **{dep.get('task', '')}** depends on **{dep.get('depends_on', '')}**")
            if dep.get('reason'):
                md.append(f"  - _{dep['reason']}_")
        md.append("")

    md.append("---\n")

    # ---------------------------------------------------------------------
    # SUGGESTED TODO ITEMS (Human-readable list)
    # ---------------------------------------------------------------------
    md.append("### 📋 Suggested TODO Items\n")
    md.append("Use these to create your execution plan:\n")
    md.append("```")

    for i, task in enumerate(execution_order, 1):
        agents = task_mapping.get(task, [])
        agent_hint = f" (via {', '.join(agents)})" if agents else ""
        md.append(f"- ⏳ {task}{agent_hint}")

    # Add synthesis step for multi-task queries
    # (Supervisor needs to combine results at the end)
    if len(execution_order) > 1:
        md.append("- ⏳ Synthesize results and present findings")

    md.append("```\n")

    # ---------------------------------------------------------------------
    # JSON FOR write_todos (Collapsible, copy-paste ready)
    # ---------------------------------------------------------------------
    # This section provides the exact JSON format the supervisor can use
    # with the write_todos tool. It's in a collapsible <details> block
    # to keep the output clean.
    md.append("<details>")
    md.append("<summary>📦 JSON for <code>write_todos</code></summary>\n")
    md.append("```python")
    md.append("write_todos(merge=False, todos=[")

    for i, task in enumerate(execution_order, 1):
        agents = task_mapping.get(task, [])
        agent_hint = f" (via {', '.join(agents)})" if agents else ""
        content = f"{task}{agent_hint}"
        # Escape quotes to ensure valid JSON
        content = content.replace('"', '\\"')
        md.append(f'    {{"id": "{i}", "content": "{content}", "status": "pending"}},')

    # Add synthesis task for multi-step queries
    if len(execution_order) > 1:
        md.append(f'    {{"id": "{len(execution_order) + 1}", "content": "Synthesize results and present findings", "status": "pending"}},')

    md.append("])")
    md.append("```")
    md.append("</details>")

    return "\n".join(md)
