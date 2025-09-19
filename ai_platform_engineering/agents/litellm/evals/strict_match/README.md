## Evaluation Date: 2025-05-19 03:59:35

# Evaluation Results

## Accuracy: 100.00%



| Test ID        | Prompt                                                    | Score   | Extracted Trajectory            | Reference Trajectories          | Notes                                                                        |
|----------------|-----------------------------------------------------------|---------|---------------------------------|---------------------------------|------------------------------------------------------------------------------|
| argocd_agent_1 | show argocd version                                       | True    | [['__start__', 'agent_argocd']] | [['__start__', 'agent_argocd']] | Shows the version of the ArgoCD Server Version.                              |
| argocd_agent_2 | show argocd app health status in project jarvis-agent-dev | True    | [['__start__', 'agent_argocd']] | [['__start__', 'agent_argocd']] | Shows the health status of all applications in the jarvis-agent-dev project. |
| argocd_agent_3 | show argocd unhealthy apps in project jarvis-agent-dev    | True    | [['__start__', 'agent_argocd']] | [['__start__', 'agent_argocd']] | Lists all unhealthy applications in the jarvis-agent-dev project.            |