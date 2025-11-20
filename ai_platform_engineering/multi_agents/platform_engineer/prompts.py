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
logger.debug("config keys: %s", list(config.keys()))
logger.debug("system_prompt_template length: %d", len(config.get('system_prompt_template', '')))
logger.debug("system_prompt_template content: %r", config.get('system_prompt_template', ''))

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
agent_examples_from_config = config.get("agent_skill_examples", {})

agents = platform_registry.agents

agent_skill_examples = []

# Always include general examples
if agent_examples_from_config.get("general"):
    agent_skill_examples.extend(agent_examples_from_config.get("general"))

# Include sub-agent examples from config ONLY IF the sub-agent is enabled
for sub_agent_name, agent_card in agents.items():
    if agent_card is not None:
        try:
            agent_eg = agent_examples_from_config.get(sub_agent_name.lower())
            if agent_eg:
                logger.info("Agent examples config found for agent: %s", sub_agent_name)
                agent_skill_examples.extend(agent_eg)
            else: # If no examples are provided in the config, use the agent's own examples
                logger.info("Agent examples config not found for agent: %s", sub_agent_name)
                agent_skill_examples.extend(platform_registry.get_agent_examples(sub_agent_name))
        except Exception as e:
            logger.warning(f"Error getting skill examples from agent: {e}")
            continue

skills_prompt = PromptTemplate(
    input_variables=["user_prompt"],
    template=config.get(
        "skills_prompt_template",
        "User Prompt: {user_prompt}\nDetermine the appropriate agent to handle the request based on the system's capabilities."
    )
)

# Note: Subagents are now generated dynamically in deep_agent.py with the model
# This allows CustomSubAgents to be created with proper react agent graphs

# Generate system prompt dynamically based on tools and their tasks
def generate_system_prompt(agents: Dict[str, Any]):
  tool_instructions = []
  for agent_key, agent_card in agents.items():

    logger.debug(f"Generating tool instruction for agent_key: {agent_key}")

    # Check if agent and agent_card are available
    if agent_card is None:
      logger.warning(f"Agent {agent_key} is None, skipping...")
      continue

    try:
      if agent_card is None:
        logger.warning(f"Agent {agent_key} has no agent card, skipping...")
        continue
      logger.debug(f"agent_card 1: {agent_card}")
      description = agent_card['description']
    except AttributeError as e:
      logger.warning(f"Agent {agent_key} does not have agent_card method or description: {e}, skipping...")
      continue
    except Exception as e:
      logger.error(f"Error getting agent card for {agent_key}: {e}, skipping...")
      continue

    # Check if there is a system_prompt override provided in the prompt config
    system_prompt_override = agent_prompts.get(agent_key, {}).get("system_prompt", None)
    if system_prompt_override:
      agent_system_prompt = system_prompt_override
    else:
      # Use the agent description as the system prompt
      agent_system_prompt = description

    instruction = f"""
{agent_key}:
  {agent_system_prompt}
"""
    tool_instructions.append(instruction.strip())

  tool_instructions_str = "\n\n".join(tool_instructions)

  yaml_template = config.get("system_prompt_template")

  logger.debug(f"System Prompt Template: {yaml_template}")

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


{tool_instructions_str}
"""

# Generate the system prompt
system_prompt = generate_system_prompt(agents)

logger.debug("="*50)
logger.debug(f"System Prompt Generated:\n{system_prompt}")
logger.debug("="*50)

# 📊 Print connectivity table after system prompt
platform_registry.print_connectivity_table()

response_format_instruction: str = config.get(
  "response_format_instruction",
  (
    "Respond in markdown format. Ensure that any URLs provided in the response are updated with clickable links.\n\n"
  )
)
