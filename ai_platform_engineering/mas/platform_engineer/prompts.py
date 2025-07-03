from langchain.prompts import PromptTemplate
import yaml
import os

from ai_platform_engineering.agents.argocd.a2a_agent_client.agentcard import (
  argocd_agent_card,
  argocd_agent_skill
)
from ai_platform_engineering.agents.atlassian.a2a_agentcards import  (
  atlassian_agent_card,
  atlassian_agent_skill
)
from ai_platform_engineering.agents.github.a2a_agentcards import (
  github_agent_card,
  github_agent_skill
)
from ai_platform_engineering.agents.pagerduty.a2a_agentcards import (
  pagerduty_agent_card,
  pagerduty_agent_skill
)
from ai_platform_engineering.agents.slack.a2a_agentcards import (
  slack_agent_card,
  slack_agent_skill
)
from ai_platform_engineering.agents.backstage.a2a_agentcards import (
  backstage_agent_card,
  backstage_agent_skill
)

# Load YAML config
def load_prompt_config(path="prompt_config.yaml"):
    if os.path.exists(path):
        with open(path, "r") as f:
            return yaml.safe_load(f)
    return {}

config = load_prompt_config()
print("DEBUG: config keys:", list(config.keys()))

agent_name = config.get("agent_name", "AI Platform Engineer")

agent_description = config.get("agent_description", (
  "This platform engineering system integrates with multiple tools to manage operations efficiently. "
  "It includes PagerDuty for incident management, GitHub for version control and collaboration, "
  "Jira for project management and ticket tracking, Slack for team communication and notifications, "
  "ArgoCD for application deployment and synchronization, and Backstage for catalog and service metadata management. "
  "Each tool is handled by a specialized agent to ensure seamless task execution, "
  "covering tasks such as incident resolution, repository management, ticket updates, "
  "channel creation, application synchronization, and catalog queries."
))

# Load agent prompts from YAML
agent_prompts = config.get("agent_prompts", {})

def get_agent_system_prompt(agent_key: str) -> str:
    """Get the system prompt for a given agent (e.g., 'argocd', 'jira', etc.)"""
    return agent_prompts.get(agent_key, {}).get("system_prompt", None)

tools = {
  argocd_agent_card.name: argocd_agent_skill.examples,
  atlassian_agent_card.name: atlassian_agent_skill.examples,
  pagerduty_agent_card.name: pagerduty_agent_skill.examples,
  github_agent_card.name: github_agent_skill.examples,
  slack_agent_card.name: slack_agent_skill.examples,
  backstage_agent_card.name: backstage_agent_skill.examples
}

agent_skill_examples = [example for examples in tools.values() for example in examples]

skills_prompt = PromptTemplate(
    input_variables=["user_prompt"],
    template=config.get(
        "skills_prompt_template",
        "User Prompt: {user_prompt}\nDetermine the appropriate agent to handle the request based on the system's capabilities."
    )
)


# Generate system prompt dynamically based on tools and their tasks
def generate_system_prompt(tools):
  tool_instructions = []
  for tool_name, tasks in tools.items():
    tasks_str = ", ".join(tasks)
    instruction = f"""
{tool_name}:
  If the user's prompt is related to {tool_name.lower()} operations, such as {tasks_str},
  assign the task to the {tool_name} agent.
"""
    tool_instructions.append(instruction.strip())

  tool_instructions_str = "\n\n".join(tool_instructions)

# Generate system prompt dynamically based on tools and their tasks
def generate_system_prompt(tools):
  tool_instructions = []
  for agent_key, tasks in tools.items():
    agent_system_prompt = get_agent_system_prompt(agent_key.lower()) if get_agent_system_prompt(agent_key.lower()) else ", ".join(tasks)
    instruction = f"""
{agent_key}:
  {agent_system_prompt}
"""
    tool_instructions.append(instruction.strip())

  tool_instructions_str = "\n\n".join(tool_instructions)

  yaml_template = config.get("system_prompt_template")

  if yaml_template:
      return yaml_template.format(
        tool_instructions=tool_instructions_str
      )
  else:
      return f"""
You are an AI Platform Engineer, a multi-agent system designed to manage operations across various tools.

DO NOT hallucinate or generate responses that are not related to the tools you are integrated with. Always call the appropriate agent or tool to handle the request.

For each tool, follow these specific instructions:

{tool_instructions_str}


If the request does not match any capabilities, respond with: I'm sorry, I cannot assist with that request. Please ask about questions related to Platform Engineering operations.

Reflection Instructions:
- If the user asks a question that requires input, set the response status to 'input_required'.
- If the user asks a question that can be answered, set the response status to 'completed'.
- If the user asks a question that indicates an error, set the response status to 'error'.

When asked about your capabilities, respond with:
{tool_instructions_str}

DO NOT respond without calling the appropriate agent or tool.
"""

# Generate the system prompt
system_prompt = generate_system_prompt(tools)

print("System Prompt Generated:\n", system_prompt)

response_format_instruction : str = config.get(
  "response_format_instruction",
  'Select status as completed if the request is complete'
  'Select status as input_required if the input is a question to the user'
  'Set response status to error if the input indicates an error'
)