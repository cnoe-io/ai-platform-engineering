from langchain.prompts import PromptTemplate
import yaml
import os


from ai_platform_engineering.agents.backstage.a2a_agent_client.agentcard import (
  backstage_agent_card,
  backstage_agent_skill
)
from ai_platform_engineering.agents.confluence.a2a_agent_client.agentcard import (
  confluence_agent_card,
  confluence_agent_skill
)
from ai_platform_engineering.agents.jira.a2a_agent_client.agentcard import  (
  jira_agent_card,
  jira_agent_skill
)
from ai_platform_engineering.agents.github.agentcard import (
  github_agent_card,
  github_agent_skill
)
from ai_platform_engineering.agents.pagerduty.agentcard import (
  pagerduty_agent_card,
  pagerduty_agent_skill
)

from ai_platform_engineering.agents.komodor.a2a_agent_client.agentcard import (
  komodor_agent_card,
  komodor_agent_skill
)

# Load YAML config
def load_prompt_config(path="prompt_library/incident_engineer.yaml"):
    current_dir = os.path.dirname(os.path.abspath(__file__))
    full_path = os.path.join(current_dir, path)
    if os.path.exists(full_path):
        with open(full_path, "r") as f:
            return yaml.safe_load(f)
    return {}

config = load_prompt_config()
print("DEBUG: config loaded:", type(config))

# Extract workflows and agent prompts from config
workflows = {}
agent_prompts = {}

if isinstance(config, dict):
    # New format: dict with workflows and agent_prompts keys
    workflows_list = config.get('workflows', [])
    agent_prompts = config.get('agent_prompts', {})
    workflows = {item['id']: item for item in workflows_list} if workflows_list else {}

    # Get agent info
    agent_name = config.get('agent_name', 'AI Incident Engineer')
    agent_description = config.get('agent_description', 'AI Incident Engineer system for detailed incident operations')
else:
    # Fallback for old format
    workflows = {}
    agent_prompts = {}
    agent_name = "AI Incident Engineer"
    agent_description = "AI Incident Engineer system for detailed incident operations"

print("DEBUG: workflows loaded:", list(workflows.keys()))
print("DEBUG: agent_prompts loaded:", list(agent_prompts.keys()))

# Default to the first workflow or create a default one
default_workflow = workflows.get('deep_incident_research', {
    'name': agent_name,
    'description': agent_description
})

# Use the loaded values or fallback to defaults
final_agent_name = agent_name
final_agent_description = agent_description

# Load agent prompts from YAML
def get_workflow_by_id(workflow_id: str) -> dict:
    """Get a specific workflow by ID"""
    return workflows.get(workflow_id, {})

def get_agent_system_prompt(agent_key: str) -> str:
    """Get the system prompt for a given agent (e.g., 'pagerduty', 'jira', etc.)"""
    if agent_key in agent_prompts:
        return agent_prompts[agent_key].get('system_prompt', f"Handle {agent_key} operations according to incident engineering protocols.")
    return f"Handle {agent_key} operations according to incident engineering protocols."

def get_workflow_content(workflow_id: str) -> str:
    """Get the content for a specific workflow"""
    workflow = get_workflow_by_id(workflow_id)
    return workflow.get('content', '')

def list_available_workflows() -> list:
    """List all available workflows"""
    return [{'id': k, 'name': v.get('name', ''), 'description': v.get('description', '')}
            for k, v in workflows.items()]

tools = {
  jira_agent_card.name: jira_agent_skill.examples,
  confluence_agent_card.name: confluence_agent_skill.examples,
  pagerduty_agent_card.name: pagerduty_agent_skill.examples,
  github_agent_card.name: github_agent_skill.examples,
  komodor_agent_card.name: komodor_agent_skill.examples,  # Always include Komodor as primary K8s agent
}

# Backstage is optional
if os.getenv("ENABLE_BACKSTAGE", "false").lower() == "true":
    tools[backstage_agent_card.name] = backstage_agent_skill.examples

agent_skill_examples = [example for examples in tools.values() for example in examples]

skills_prompt = PromptTemplate(
    input_variables=["user_prompt"],
    template="""User Prompt: {user_prompt}

ORCHESTRATED WORKFLOW EXECUTION:
For incident-related requests, the system will automatically execute workflows in sequence:

Available Incident Engineering Workflows:
""" + "\n".join([f"- {w['name']}: {w['description']}" for w in list_available_workflows()]) + """

EXECUTION LOGIC:
- Keywords like 'incident', 'alert', 'outage', 'error' trigger the full workflow sequence
- The system will automatically determine which workflows to execute based on the request
- Workflows are executed in dependency order with context passing between them

Determine the appropriate workflow orchestration for this request."""
)

# Generate system prompt dynamically based on tools and workflows
def generate_system_prompt(tools):
    tool_instructions = []
    for agent_key, tasks in tools.items():
        agent_system_prompt = get_agent_system_prompt(agent_key.lower())
        instruction = f"""
{agent_key}:
  {agent_system_prompt}
"""
        tool_instructions.append(instruction.strip())

    tool_instructions_str = "\n\n".join(tool_instructions)

    # Add workflow information
    workflow_info = "\n\nAvailable Incident Engineering Workflows:\n"
    for workflow in list_available_workflows():
        workflow_info += f"- {workflow['name']}: {workflow['description']}\n"

    return f"""
You are an AI Incident Engineer, a multi-agent system designed to perform deep research and generate reports on incidents.

CRITICAL: YOU MUST FOLLOW THE EXACT WORKFLOW INSTRUCTIONS FROM THE YAML CONFIGURATION.

ORCHESTRATED WORKFLOW EXECUTION:
When a user submits an incident-related request, you MUST execute workflows in sequence based on the detailed instructions in the YAML configuration. Each workflow specifies EXACTLY which agents to call and in what order.

MANDATORY WORKFLOW EXECUTION RULES:
1. ALWAYS follow the step-by-step instructions provided in each workflow's content
2. CALL ALL AGENTS specified in the workflow instructions - do not move on to the next agent until the current one has been called
3. Execute agents in the exact order specified in the workflow
4. Pass context and results between agent calls as specified

WORKFLOW EXECUTION ORDER:
1. Deep Incident Research - MUST use PagerDuty, Jira, GitHub, Confluence, and Komodor agents
2. Automate Post-Incident Documentation - MUST use Confluence and Jira agents to CREATE actual pages and tickets
3. MTTR Report Generation - MUST use Jira, PagerDuty, Komodor, and Confluence agents to CREATE reports and epics
4. Uptime Report Generation - MUST use Komodor, PagerDuty, Jira, and Confluence agents for comprehensive analysis

CRITICAL: Each workflow contains [ACTIONS_REQUIRED] sections that specify EXACT API calls that MUST be executed.

DO NOT hallucinate or generate responses that are not related to the tools you are integrated with. Always call the appropriate agent or tool to handle the request.

AGENT CALLING INSTRUCTIONS:
You have access to these agents and MUST use them according to workflow instructions:

{tool_instructions_str}

{workflow_info}

EXECUTION GUIDELINES:
- READ and FOLLOW the detailed workflow instructions from the YAML configuration
- Each workflow contains specific steps that tell you WHICH agents to call
- Each workflow contains [ACTIONS_REQUIRED] sections with MANDATORY API calls that MUST be executed
- Call ALL agents mentioned in the workflow instructions
- Execute ALL actions specified in [ACTIONS_REQUIRED] sections (e.g., confluence.create_page, jira.create_ticket)
- Pass context and artifacts between workflows as specified
- Provide comprehensive final reports aggregating all workflow results
- Document any failures and continue with remaining workflows where possible

IMPORTANT: The workflow instructions in the YAML file are MANDATORY. You must execute each step exactly as specified, calling all the agents mentioned in the correct order and executing all required actions.

If the request does not match any capabilities, respond with: I'm sorry, I cannot assist with that request. Please ask about questions related to Incident Engineering operations.

For incident requests, automatically execute the orchestrated workflow sequence following the YAML instructions exactly.
"""

# Generate the system prompt
system_prompt = generate_system_prompt(tools)

print("System Prompt Generated:\n", system_prompt)

response_format_instruction: str = """
ORCHESTRATED WORKFLOW RESPONSE FORMAT:

For incident engineering requests, execute workflows automatically in sequence:

1. WORKFLOW EXECUTION STATUS:
   - Status: 'executing' | 'completed' | 'error' | 'input_required'
   - Current workflow: [workflow_name]
   - Progress: [step_number]/[total_steps]
   - Actions executed: [list of completed actions]
   - Actions pending: [list of remaining required actions]

2. REQUIRED ACTIONS TRACKING:
   Each workflow MUST execute specific actions from [ACTIONS_REQUIRED] sections:

   Post-Incident Documentation:
   ☐ confluence.create_page() - Create postmortem page
   ☐ jira.create_ticket() - Create follow-up tickets for action items
   ☐ jira.add_comment() - Add postmortem link to incident ticket
   ☐ jira.transition_ticket() - Update incident status to "Documented"

   MTTR Report:
   ☐ confluence.create_page() - Create MTTR report page
   ☐ jira.create_epic() - Create MTTR improvement epic
   ☐ jira.create_ticket() - Create improvement tickets
   ☐ jira.create_dashboard_filter() - Create MTTR tracking dashboard

   Uptime Report:
   ☐ confluence.create_page() - Create uptime report page
   ☐ jira.create_epic() - Create service reliability epic
   ☐ jira.create_ticket() - Create SLO violation tickets
   ☐ jira.update_epic() - Update existing reliability epic
   ☐ confluence.add_comment() - Schedule review meeting

3. WORKFLOW RESULTS STRUCTURE:
   - Deep Incident Research Results:
     * Root cause analysis
     * PagerDuty alert details
     * Jira ticket information
     * Komodor/Kubernetes status and logs
     * RAG/Confluence findings
     * Recommended remediation steps

   - Post-Incident Documentation:
     * ✅ Generated postmortem document (Confluence page link)
     * ✅ Created follow-up tickets (Jira ticket links)
     * ✅ Updated incident ticket (Jira link)
     * ✅ Stakeholder notifications sent

   - MTTR Report:
     * ✅ MTTR report published (Confluence page link)
     * ✅ Improvement epic created (Jira epic link)
     * ✅ Action tickets created (Jira ticket links)
     * ✅ MTTR dashboard created (Jira dashboard link)

   - Uptime Report:
     * ✅ Uptime report published (Confluence page link)
     * ✅ Reliability epic created/updated (Jira epic link)
     * ✅ SLO violation tickets created (Jira ticket links)
     * ✅ Review meeting scheduled (Calendar link)

4. FINAL RESPONSE FORMAT:
   - Executive Summary
   - Critical Findings
   - Actionable Recommendations
   - All Source Links and Artifacts
   - DELIVERABLES CREATED:
     * Confluence Pages: [list with links]
     * Jira Tickets: [list with links]
     * Jira Epics: [list with links]
     * Dashboards: [list with links]
     * Notifications: [list of recipients]
   - Response Status: 'completed' (only when ALL required actions executed)

5. ERROR HANDLING:
   - Document any workflow failures
   - Continue with remaining workflows where possible
   - Provide partial results if full execution fails
   - Mark specific actions as 'failed' with reasons
   - Set status to 'error' only if no workflows can execute

CRITICAL: Response status should only be 'completed' when ALL required actions from [ACTIONS_REQUIRED] sections have been successfully executed and actual deliverables have been created.
"""

def get_workflow_execution_order() -> list:
    """Define the default execution order for incident workflows"""
    return [
        'deep_incident_research',
        'automate_post_incident_doc',
        'mttr_report',
        'uptime_report'
    ]

def get_workflow_dependencies() -> dict:
    """Define workflow dependencies and execution logic"""
    return {
        'deep_incident_research': {
            'depends_on': [],
            'triggers': ['automate_post_incident_doc'],
            'required_for': ['automate_post_incident_doc', 'mttr_report', 'uptime_report']
        },
        'automate_post_incident_doc': {
            'depends_on': ['deep_incident_research'],
            'triggers': ['mttr_report', 'uptime_report'],
            'required_for': []
        },
        'mttr_report': {
            'depends_on': ['deep_incident_research'],
            'triggers': [],
            'required_for': []
        },
        'uptime_report': {
            'depends_on': ['deep_incident_research'],
            'triggers': [],
            'required_for': []
        }
    }

def should_execute_workflow(workflow_id: str, user_prompt: str) -> bool:
    """Determine if a workflow should be executed based on user prompt"""
    workflow = get_workflow_by_id(workflow_id)
    if not workflow:
        return False

    # Keywords that trigger specific workflows
    workflow_triggers = {
        'deep_incident_research': ['incident', 'alert', 'outage', 'error', 'failure', 'issue', 'problem'],
        'automate_post_incident_doc': ['incident', 'postmortem', 'documentation', 'report'],
        'mttr_report': ['incident', 'mttr', 'recovery', 'report', 'metrics'],
        'uptime_report': ['incident', 'uptime', 'availability', 'report', 'metrics']
    }

    triggers = workflow_triggers.get(workflow_id, [])
    user_prompt_lower = user_prompt.lower()

    # Check if any trigger keywords are present
    return any(trigger in user_prompt_lower for trigger in triggers)

def get_orchestrated_workflow_prompt(user_prompt: str) -> str:
    """Generate an orchestrated workflow execution prompt"""
    execution_order = get_workflow_execution_order()
    dependencies = get_workflow_dependencies()

    # Determine which workflows should be executed
    workflows_to_execute = []
    for workflow_id in execution_order:
        if should_execute_workflow(workflow_id, user_prompt):
            workflows_to_execute.append(workflow_id)

    # If no specific workflows detected, default to full incident response
    if not workflows_to_execute:
        workflows_to_execute = execution_order

    workflow_steps = []
    for i, workflow_id in enumerate(workflows_to_execute, 1):
        workflow = get_workflow_by_id(workflow_id)
        step = f"""
STEP {i}: {workflow.get('name', workflow_id)}
Description: {workflow.get('description', '')}
Instructions: {workflow.get('content', '')}
Dependencies: {', '.join(dependencies.get(workflow_id, {}).get('depends_on', ['None']))}
"""
        workflow_steps.append(step)

    return f"""
ORCHESTRATED INCIDENT ENGINEERING WORKFLOW EXECUTION

User Request: {user_prompt}

MANDATORY: Execute the following workflows in sequence, following the DETAILED INSTRUCTIONS in each workflow:
{''.join(workflow_steps)}

CRITICAL EXECUTION GUIDELINES:
1. READ each workflow's detailed instructions carefully - they specify WHICH agents to call
2. CALL ALL agents mentioned in the workflow instructions - do not skip any
3. Execute agents in the EXACT order specified in the workflow content
4. Pass relevant context and artifacts between workflows as specified
5. Ensure dependencies are satisfied before proceeding
6. If any workflow fails, document the failure and continue with remaining workflows where possible

WORKFLOW INSTRUCTION COMPLIANCE:
- Each workflow above contains specific instructions about which agents to use
- These instructions are MANDATORY and must be followed exactly
- Do NOT improvise or skip agents mentioned in the workflow instructions
- The workflow content tells you step-by-step what to do and which agents to call

CONTEXT FLOW:
- Deep Incident Research → Provides context for all subsequent workflows
- Post-Incident Documentation → Uses research findings to create comprehensive documentation
- MTTR Report → Uses incident data and research findings for metrics analysis
- Uptime Report → Uses incident data and research findings for availability analysis

Expected Output: A comprehensive incident engineering response that includes all executed workflow results with proper context flow and artifact sharing, following the YAML workflow instructions exactly.
"""

def create_orchestrated_incident_prompt(user_prompt: str) -> str:
    """Create a comprehensive orchestrated incident response prompt"""
    orchestrated_prompt = get_orchestrated_workflow_prompt(user_prompt)

    return f"""
{orchestrated_prompt}

CRITICAL EXECUTION INSTRUCTIONS:
YOU MUST FOLLOW THE EXACT WORKFLOW INSTRUCTIONS ABOVE. Each workflow contains detailed step-by-step instructions that specify:
- WHICH agents to call (PagerDuty, Jira, GitHub, Confluence, Komodor)
- WHEN to call them (the exact order)
- WHAT to ask each agent for
- WHICH actions to execute from [ACTIONS_REQUIRED] sections
- HOW to use the results

MANDATORY ACTION EXECUTION:
Each workflow contains [ACTIONS_REQUIRED] sections with specific API calls that MUST be executed:
- confluence.create_page() - CREATE actual Confluence pages
- jira.create_ticket() - CREATE actual Jira tickets
- jira.create_epic() - CREATE actual Jira epics
- jira.add_comment() - ADD comments to existing tickets
- jira.transition_ticket() - UPDATE ticket status
- jira.update_epic() - UPDATE existing epics
These are NOT suggestions - they are MANDATORY actions that must be performed.

AGENT EXECUTION CONTEXT:
Use the following agents according to the workflow instructions:

{generate_system_prompt(tools)}

MANDATORY EXECUTION REQUIREMENTS:
1. READ each workflow's detailed instructions carefully
2. CALL ALL agents mentioned in the workflow steps
3. EXECUTE ALL actions specified in [ACTIONS_REQUIRED] sections
4. Execute agents in the EXACT order specified
5. Do NOT skip any agents or actions marked as "MANDATORY"
6. Pass results between agents as specified in the workflow
7. Provide comprehensive reports with all agent findings and created artifacts

FINAL OUTPUT REQUIREMENTS:
1. Provide a comprehensive incident response report
2. Include findings from ALL executed workflows and agents
3. Show clear context flow between workflows
4. Highlight critical findings and recommendations
5. Include all relevant artifacts and source links from each agent
6. List ALL created artifacts (Confluence pages, Jira tickets, epics) with links
7. Set response status to 'completed' when all workflows finish successfully

Execute the orchestrated workflow sequence now, following the YAML instructions exactly and executing all required actions.
"""

# Create the orchestrated execution function
def get_incident_response_prompt(user_prompt: str) -> str:
    """Get the complete incident response prompt with orchestrated workflow execution"""
    return create_orchestrated_incident_prompt(user_prompt)

def get_workflow_required_actions(workflow_id: str) -> list:
    """Extract required actions from a workflow's content"""
    workflow = get_workflow_by_id(workflow_id)
    content = workflow.get('content', '')

    # Extract actions from [ACTIONS_REQUIRED] section
    import re
    actions_match = re.search(r'\[ACTIONS_REQUIRED\](.*?)(?:\[|$)', content, re.DOTALL)
    if actions_match:
        actions_text = actions_match.group(1)
        # Extract individual action calls
        action_lines = [line.strip() for line in actions_text.split('\n') if line.strip().startswith('- ')]
        return [line.strip('- ') for line in action_lines]
    return []

def validate_workflow_actions_completion(workflow_id: str, executed_actions: list) -> dict:
    """Validate that all required actions for a workflow have been executed"""
    required_actions = get_workflow_required_actions(workflow_id)

    validation_result = {
        'workflow_id': workflow_id,
        'required_actions': required_actions,
        'executed_actions': executed_actions,
        'missing_actions': [],
        'is_complete': True
    }

    for required_action in required_actions:
        # Simple check if the action type was executed
        action_type = required_action.split('(')[0] if '(' in required_action else required_action
        if not any(action_type in executed for executed in executed_actions):
            validation_result['missing_actions'].append(required_action)
            validation_result['is_complete'] = False

    return validation_result

def get_comprehensive_action_checklist() -> dict:
    """Get a comprehensive checklist of all actions across all workflows"""
    action_checklist = {}

    for workflow_id in ['deep_incident_research', 'automate_post_incident_doc', 'mttr_report', 'uptime_report']:
        workflow = get_workflow_by_id(workflow_id)
        if workflow:
            required_actions = get_workflow_required_actions(workflow_id)
            action_checklist[workflow_id] = {
                'name': workflow.get('name', workflow_id),
                'required_actions': required_actions,
                'agents_to_call': extract_agents_from_workflow(workflow_id),
                'deliverables': extract_deliverables_from_workflow(workflow_id)
            }

    return action_checklist

def extract_agents_from_workflow(workflow_id: str) -> list:
    """Extract which agents should be called based on workflow content"""
    workflow = get_workflow_by_id(workflow_id)
    content = workflow.get('content', '').lower()

    agents = []
    if 'pagerduty' in content or 'pd' in content:
        agents.append('PagerDuty')
    if 'jira' in content:
        agents.append('Jira')
    if 'confluence' in content:
        agents.append('Confluence')
    if 'github' in content:
        agents.append('GitHub')
    if 'komodor' in content or 'kubernetes' in content or 'k8s' in content:
        agents.append('Komodor')
    if 'backstage' in content:
        agents.append('Backstage')

    return agents

def extract_deliverables_from_workflow(workflow_id: str) -> list:
    """Extract expected deliverables from workflow content"""
    workflow = get_workflow_by_id(workflow_id)
    content = workflow.get('content', '')

    deliverables = []
    if 'create a new confluence page' in content.lower():
        deliverables.append('Confluence Page')
    if 'create a follow-up jira ticket' in content.lower() or 'create jira ticket' in content.lower():
        deliverables.append('Jira Tickets')
    if 'create jira epic' in content.lower():
        deliverables.append('Jira Epic')
    if 'update' in content.lower() and 'jira' in content.lower():
        deliverables.append('Jira Updates')
    if 'notification' in content.lower():
        deliverables.append('Notifications')

    return deliverables
