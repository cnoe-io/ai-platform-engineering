## Evaluation Date: 2025-05-19 03:59:35

# Evaluation Results

## Accuracy: 100.00%



| Test ID        | Prompt                                                    | Score   | Extracted Trajectory            | Reference Trajectories          | Notes                                                                        |
|----------------|-----------------------------------------------------------|---------|---------------------------------|---------------------------------|------------------------------------------------------------------------------|
| jira_agent_1 | show jira version                                       | True    | [['__start__', 'agent_jira']] | [['__start__', 'agent_jira']] | Shows the version of the Jira Server Version.                              |
| jira_agent_2 | show jira app health status in project jarvis-agent-dev | True    | [['__start__', 'agent_jira']] | [['__start__', 'agent_jira']] | Shows the health status of all applications in the jarvis-agent-dev project. |
| jira_agent_3 | show jira unhealthy apps in project jarvis-agent-dev    | True    | [['__start__', 'agent_jira']] | [['__start__', 'agent_jira']] | Lists all unhealthy applications in the jarvis-agent-dev project.            |