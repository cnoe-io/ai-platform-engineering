## Evaluation Date: 2025-05-19 03:59:35

# Evaluation Results

## Accuracy: 100.00%



| Test ID        | Prompt                                                    | Score   | Extracted Trajectory            | Reference Trajectories          | Notes                                                                        |
|----------------|-----------------------------------------------------------|---------|---------------------------------|---------------------------------|------------------------------------------------------------------------------|
| atlassian_agent_1 | show atlassian version                                       | True    | [['__start__', 'agent_atlassian']] | [['__start__', 'agent_atlassian']] | Shows the version of the Atlassian Server Version.                              |
| atlassian_agent_2 | show atlassian app health status in project jarvis-agent-dev | True    | [['__start__', 'agent_atlassian']] | [['__start__', 'agent_atlassian']] | Shows the health status of all applications in the jarvis-agent-dev project. |
| atlassian_agent_3 | show atlassian unhealthy apps in project jarvis-agent-dev    | True    | [['__start__', 'agent_atlassian']] | [['__start__', 'agent_atlassian']] | Lists all unhealthy applications in the jarvis-agent-dev project.            |