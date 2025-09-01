from langchain.prompts import PromptTemplate
import yaml
import os

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

def get_agent_system_prompt(agent_key: str) -> str:
    """Get the system prompt for a given agent (e.g., 'argocd', 'jira', etc.)"""
    return agent_prompts.get(agent_key, {}).get("system_prompt", None)

tools = platform_registry.get_tools()

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
system_prompt = generate_system_prompt(tools)

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
