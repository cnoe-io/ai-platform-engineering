## Evaluation Date: 2025-05-19 03:59:35

# Evaluation Results

## Accuracy: 100.00%



| Test ID        | Prompt                                                    | Score   | Extracted Trajectory            | Reference Trajectories          | Notes                                                                        |
|----------------|-----------------------------------------------------------|---------|---------------------------------|---------------------------------|------------------------------------------------------------------------------|
| kubernetes_agent_1 | show kubernetes version                                       | True    | [['__start__', 'agent_kubernetes']] | [['__start__', 'agent_kubernetes']] | Shows the version of the Kubernetes Server Version.                              |
| kubernetes_agent_2 | show kubernetes app health status in project jarvis-agent-dev | True    | [['__start__', 'agent_kubernetes']] | [['__start__', 'agent_kubernetes']] | Shows the health status of all applications in the jarvis-agent-dev project. |
| kubernetes_agent_3 | show kubernetes unhealthy apps in project jarvis-agent-dev    | True    | [['__start__', 'agent_kubernetes']] | [['__start__', 'agent_kubernetes']] | Lists all unhealthy applications in the jarvis-agent-dev project.            |