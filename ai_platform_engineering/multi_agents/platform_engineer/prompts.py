from langchain.prompts import PromptTemplate
import yaml
import os

from ai_platform_engineering.agents.argocd.a2a_agent_client.agentcard import (
  argocd_agent_card,
  argocd_agent_skill
)
from ai_platform_engineering.agents.backstage.a2a_agent_client.agentcard import (
  backstage_agent_card,
  backstage_agent_skill
)
from ai_platform_engineering.agents.confluence.a2a_agent_client.agentcard import (
  confluence_agent_card,
  confluence_agent_skill
)
from ai_platform_engineering.agents.github.a2a_agent_client.agentcard import (
  github_agent_card,
  github_agent_skill
)
from ai_platform_engineering.agents.jira.a2a_agent_client.agentcard import (
  jira_agent_card,
  jira_agent_skill
)
from ai_platform_engineering.agents.pagerduty.a2a_agent_client.agentcard import (
  pagerduty_agent_card,
  pagerduty_agent_skill
)
from ai_platform_engineering.agents.slack.a2a_agent_client.agentcard import (
  slack_agent_card,
  slack_agent_skill
)
from ai_platform_engineering.agents.komodor.a2a_agent_client.agentcard import (
  komodor_agent_card,
  komodor_agent_skill
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
  "Jira for project management and ticket tracking, Slack for team communication and notifications, " ) +
  ("Komodor for Kubernetes cluster and workload management, " if os.getenv("ENABLE_KOMODOR", "false").lower() == "true" else "") + (
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
  backstage_agent_card.name: backstage_agent_skill.examples,
  confluence_agent_card.name: confluence_agent_skill.examples,
  github_agent_card.name: github_agent_skill.examples,
  jira_agent_card.name: jira_agent_skill.examples,
  pagerduty_agent_card.name: pagerduty_agent_skill.examples,
  slack_agent_card.name: slack_agent_skill.examples,
}

if os.getenv("ENABLE_KOMODOR", "false").lower() == "true":
    tools[komodor_agent_card.name] = komodor_agent_skill.examples

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

LLM Instructions:
- Only respond to requests related to the integrated tools. Always call the appropriate agent or tool.
- When responding, use markdown format. Make sure all URLs are presented as clickable links.
- Set status to completed if the request is fulfilled.
- Set status to input_required if you need more information from the user.
- Set status to error if there is a problem with the input or processing.


{tool_instructions_str}
"""

# Generate the system prompt
system_prompt = generate_system_prompt(tools)

print("="*50)
print("System Prompt Generated:\n", system_prompt)
print("="*50)

response_format_instruction: str = config.get(
  "response_format_instruction",
  (
    "Respond in markdown format. Ensure that any URLs provided in the response are updated with clickable links.\n\n"
    "Select status as completed if the request is complete.\n"
    "Select status as input_required if the input is a question to the user.\n"
    "Set response status to error if the input indicates an error."
  )
)
