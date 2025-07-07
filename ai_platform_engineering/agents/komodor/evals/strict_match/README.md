## Evaluation Date: 2025-05-19 03:59:35

# Evaluation Results

## Accuracy: 100.00%



| Test ID        | Prompt                                                    | Score   | Extracted Trajectory            | Reference Trajectories          | Notes                                                                        |
|----------------|-----------------------------------------------------------|---------|---------------------------------|---------------------------------|------------------------------------------------------------------------------|
| komodor_agent_1 | show komodor version                                       | True    | [['__start__', 'agent_komodor']] | [['__start__', 'agent_komodor']] | Shows the version of the Komodor Server Version.                              |
| komodor_agent_2 | show komodor app health status in project jarvis-agent-dev | True    | [['__start__', 'agent_komodor']] | [['__start__', 'agent_komodor']] | Shows the health status of all applications in the jarvis-agent-dev project. |
| komodor_agent_3 | show komodor unhealthy apps in project jarvis-agent-dev    | True    | [['__start__', 'agent_komodor']] | [['__start__', 'agent_komodor']] | Lists all unhealthy applications in the jarvis-agent-dev project.            |