from langchain.prompts import PromptTemplate

agent_name = "AI Platform Engineer"

agent_description = (
    "This platform engineering system integrates with multiple tools to manage operations efficiently. "
    "It includes PagerDuty for incident management, GitHub for version control and collaboration, "
    "Jira for project management, Slack for communication, and ArgoCD for continuous deployment. "
    "Each tool is handled by a specialized agent to ensure seamless task execution."
)

tools = {
    "PagerDuty": [
        "Acknowledge the PagerDuty incident with ID 12345.",
        "List all on-call schedules for the DevOps team.",
        "Trigger a PagerDuty alert for the database service.",
        "Resolve the PagerDuty incident with ID 67890.",
        "Get details of the PagerDuty incident with ID 54321."
    ],
    "GitHub": [
        "Create a new GitHub repository named 'my-repo'.",
        "List all open pull requests in the 'frontend' repository.",
        "Merge the pull request #42 in the 'backend' repository.",
        "Close the issue #101 in the 'docs' repository.",
        "Get the latest commit in the 'main' branch of 'my-repo'."
    ],
    "Jira": [
        "Create a new Jira ticket for the 'AI Project'.",
        "List all open tickets in the 'Platform Engineering' project.",
        "Update the status of ticket 'AI-123' to 'In Progress'.",
        "Assign ticket 'PE-456' to user 'john.doe'.",
        "Get details of the Jira ticket 'AI-789'."
    ],
    "Slack": [
        "Send a message to the 'devops' Slack channel.",
        "List all members of the 'engineering' Slack workspace.",
        "Create a new Slack channel named 'project-updates'.",
        "Archive the 'old-project' Slack channel.",
        "Post a notification to the 'alerts' Slack channel."
    ],
    "ArgoCD": [
        "Create a new ArgoCD application named 'my-app'.",
        "Get the status of the 'frontend' ArgoCD application.",
        "Update the image version for 'backend' app.",
        "Delete the 'test-app' from ArgoCD.",
        "Sync the 'production' ArgoCD application to the latest commit."
    ]
}

agent_skill_examples = [example for examples in tools.values() for example in examples]

# Define a skills prompt template
skills_prompt = PromptTemplate(
    input_variables=["user_prompt"],
    template=(
        "User Prompt: {user_prompt}\n"
        "Determine the appropriate agent to handle the request based on the system's capabilities."
    )
)

system_prompt = (
  f"""
You are an AI Platform Engineer, a multi-agent system designed to manage operations across various tools.

For each tool, follow these specific instructions:

- **PagerDuty**:
  If the user's prompt is related to incident management, such as acknowledging, resolving, or retrieving incident details,
  listing and retrieving on-call schedules, determining who is on call, or getting PagerDuty services,
  assign the task to the PagerDuty agent.

- **GitHub**:
  If the user's prompt is related to version control, such as creating repositories, managing pull requests,
  or retrieving commit details, assign the task to the GitHub agent.

- **Jira**:
  If the user's prompt is related to project management, such as creating tickets, updating statuses,
  or assigning tasks, assign the task to the Jira agent.

- **Slack**:
  If the user's prompt is related to communication, such as sending messages, managing channels,
  or listing workspace members, assign the task to the Slack agent.

- **ArgoCD**:
  If the user's prompt is related to continuous deployment, such as managing applications, syncing,
  or updating configurations, assign the task to the ArgoCD agent.

If the request does not match any capabilities, respond with:
"I'm sorry, I cannot assist with that request. Please ask about questions related to Platform Engineering operations."

If the worker agent returns control to you and it is a success and does not contain errors,
do not generate any further messages or responses. End the conversation immediately by returning an empty response.

If the worker agent returns control to you and it is an error, provide the same kind of error message to the user.
"""
)

response_format_instruction : str = (
  'Select status as completed if the request is complete'
  'Select status as input_required if the input is a question to the user'
  'Set response status to error if the input indicates an error'
)