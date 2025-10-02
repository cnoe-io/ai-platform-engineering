from langchain.prompts import PromptTemplate
import yaml
import os
from typing import Dict, Any

from ai_platform_engineering.multi_agents.platform_engineer import platform_registry

import logging
logger = logging.getLogger(__name__)

# Load YAML config
def load_prompt_config(path="prompt_config.yaml"):
    if os.path.exists(path):
        with open(path, "r") as f:
            return yaml.safe_load(f)
    return {}

config = load_prompt_config()
print("DEBUG: config keys:", list(config.keys()))
print("DEBUG: system_prompt_template length:", len(config.get('system_prompt_template', '')))
print("DEBUG: system_prompt_template content:")
print(repr(config.get('system_prompt_template', '')))

agent_name = config.get("agent_name", "AI Platform Engineer")
agent_description = config.get("agent_description", (
  "This platform engineering system integrates with multiple tools to manage operations efficiently. "
  "It includes PagerDuty for incident management, GitHub for version control and collaboration, "
  "Jira for project management and ticket tracking, Slack for team communication and notifications, " ) +
  ("Webex for messaging and notifications, " if platform_registry.agent_exists("webex") else "") +
  ("Komodor for Kubernetes cluster and workload management, " if platform_registry.agent_exists("komodor") else "") + (
  "ArgoCD for application deployment and synchronization, and Backstage for catalog and service metadata management. "
  "Each tool is handled by a specialized agent to ensure seamless task execution, "
  "covering tasks such as incident resolution, repository management, ticket updates, "
  "channel creation, application synchronization, and catalog queries."
))

# Load agent prompts from YAML
agent_prompts = config.get("agent_prompts", {})

agents = platform_registry.agents

agent_skill_examples = [skill for agent in agents.values() for skill in agent.get_skill_examples()]

skills_prompt = PromptTemplate(
    input_variables=["user_prompt"],
    template=config.get(
        "skills_prompt_template",
        "User Prompt: {user_prompt}\nDetermine the appropriate agent to handle the request based on the system's capabilities."
    )
)

# Categorize agents by type for better organization
def categorize_agents(agents: Dict[str, Any]) -> Dict[str, list]:
  """Categorize agents into logical groups for better prompt organization."""

  categories = {
    "Application Deployment & Infrastructure": ["argocd", "aws", "komodor"],
    "Communication & Collaboration": ["slack", "webex"],
    "Project Management & Documentation": ["jira", "confluence", "backstage"],
    "Monitoring & Incident Management": ["pagerduty", "splunk"],
    "Version Control & Code Management": ["github"],
    "Knowledge & Information": ["kb-rag"],
    "Testing & Development": ["petstore", "weather"]
  }

  categorized = {cat: [] for cat in categories}
  uncategorized = []

  for agent_key in agents.keys():
    found = False
    for category, agent_list in categories.items():
      if agent_key.lower() in agent_list:
        categorized[category].append(agent_key)
        found = True
        break
    if not found:
      uncategorized.append(agent_key)

  # Add uncategorized agents to a misc category if any exist
  if uncategorized:
    categorized["Other Services"] = uncategorized

  # Remove empty categories
  return {k: v for k, v in categorized.items() if v}

# Generate system prompt dynamically based on tools and their tasks
def generate_system_prompt(agents: Dict[str, Any]):
  tool_instructions = []
  categorized_agents = categorize_agents(agents)

  # Add a helpful header for context
  agent_count = len(agents)
  category_count = len(categorized_agents)

  header = f"""
You manage {agent_count} specialized agents organized into {category_count} categories.
When describing capabilities, cover all agents with concrete examples for each.
"""
  tool_instructions.append(header)

  # Generate categorized agent instructions
  for category, agent_keys in categorized_agents.items():
    category_instructions = [f"\n## {category}\n"]

    for agent_key in agent_keys:
      agent = agents[agent_key]
      logger.info(f"Generating tool instruction for agent_key: {agent_key}")
      description = agent.agent_card().description

      # Check if there is a system_prompt override provided in the prompt config
      system_prompt_override = agent_prompts.get(agent_key, {}).get("system_prompt", None)
      if system_prompt_override:
        agent_system_prompt = system_prompt_override
      else:
        # Use the agent description as the system prompt
        agent_system_prompt = description

      instruction = f"""**{agent_key}**:
  {agent_system_prompt}
"""
      category_instructions.append(instruction.strip())

    tool_instructions.append("\n".join(category_instructions))

  tool_instructions_str = "\n".join(tool_instructions)

  yaml_template = config.get("system_prompt_template")

  logger.info(f"System Prompt Template: {yaml_template}")

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
system_prompt = generate_system_prompt(agents)

logger.info("="*50)
logger.info(f"System Prompt Generated:\n{system_prompt}")
logger.info("="*50)

response_format_instruction: str = config.get(
  "response_format_instruction",
  (
    "Respond in markdown format. Ensure that any URLs provided in the response are updated with clickable links.\n\n"
    "Select status as completed if the request is complete.\n"
    "Select status as input_required if the input is a question to the user.\n"
    "Set response status to error if the input indicates an error."
  )
)
