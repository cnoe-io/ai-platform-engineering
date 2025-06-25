from langchain.prompts import PromptTemplate
import yaml
import os

from ai_platform_engineering.agents.argocd.a2a_agentcards import (
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
  "and ArgoCD for application deployment and synchronization. "
  "Each tool is handled by a specialized agent to ensure seamless task execution, "
  "covering tasks such as incident resolution, repository management, ticket updates, "
  "channel creation, and application synchronization."
))

# Load agent prompts from YAML
agent_prompts = config.get("agent_prompts", {})

def get_agent_system_prompt(agent_key: str) -> str:
    """Get the system prompt for a given agent (e.g., 'argocd', 'jira', etc.)"""
    return agent_prompts.get(agent_key, {}).get("system_prompt", f"No system prompt configured for {agent_key} agent.")

def get_agent_skills_prompt(agent_key: str) -> str:
    """Get the skills prompt for a given agent (e.g., 'argocd', 'jira', etc.)"""
    return agent_prompts.get(agent_key, {}).get("skills_prompt", f"No skills prompt configured for {agent_key} agent.")


argocd_system_prompt = get_agent_system_prompt("argocd")
jira_system_prompt = get_agent_system_prompt("jira")
github_system_prompt = get_agent_system_prompt("github")
pagerduty_system_prompt = get_agent_system_prompt("pagerduty")
slack_system_prompt = get_agent_system_prompt("slack")

argocd_skills_prompt = get_agent_skills_prompt("argocd")
jira_skills_prompt = get_agent_skills_prompt("jira")
github_skills_prompt = get_agent_skills_prompt("github")
pagerduty_skills_prompt = get_agent_skills_prompt("pagerduty")
slack_skills_prompt = get_agent_skills_prompt("slack")

tools = {
  argocd_agent_card.name: argocd_agent_skill.examples,
  atlassian_agent_card.name: atlassian_agent_skill.examples,
  pagerduty_agent_card.name: pagerduty_agent_skill.examples,
  github_agent_card.name: github_agent_skill.examples,
  slack_agent_card.name: slack_agent_skill.examples
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
  for agent_key in tools.keys():
    agent_system_prompt = get_agent_system_prompt(agent_key.lower())
    instruction = f"""
{agent_key}:
  {agent_system_prompt}
"""
    tool_instructions.append(instruction.strip())

  tool_instructions_str = "\n\n".join(tool_instructions)

  yaml_template = config.get("system_prompt_template")
  
  if yaml_template:
      return yaml_template.replace("{{tool_instructions}}", tool_instructions_str)
  else:
      return f"""
You are an AI Platform Engineer, a multi-agent system designed to manage operations across various tools.

DO NOT hallucinate or generate responses that are not related to the tools you are integrated with. Always call the appropriate agent or tool to handle the request.

For each tool, follow these specific instructions:

{tool_instructions_str}


If the request does not match any capabilities, respond with:
\"I'm sorry, I cannot assist with that request. Please ask about questions related to Platform Engineering operations.\"

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