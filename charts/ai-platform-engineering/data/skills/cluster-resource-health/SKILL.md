---
name: cluster-resource-health
description: Check Kubernetes cluster health including pod status, node conditions, resource utilization, and pending alerts across EKS clusters. Use when monitoring infrastructure health, investigating capacity issues, or performing cluster audits.
---

# Cluster Resource Health

Query AWS EKS clusters for node health, pod status, resource utilization, and alerts to produce a cluster health dashboard.

## Instructions

### Phase 1: Cluster Overview (AWS Agent)
1. **List EKS clusters** and their status
2. **Check Kubernetes version** - current vs. latest, end-of-support date

### Phase 2: Node Health
1. **Inspect node conditions** - Ready, MemoryPressure, DiskPressure, PIDPressure
2. **Resource utilization per node** - CPU, Memory, Pod count

### Phase 3: Pod Health
1. **Identify problematic pods** - CrashLoopBackOff, ImagePullBackOff, OOMKilled, Pending
2. **Namespace-level summary** - pods running, pending, failed per namespace

### Phase 4: Resource Capacity Analysis
1. **Cluster-wide utilization** - total CPU/Memory requested vs. allocatable
2. **Capacity risks** - nodes at >80%, namespaces exceeding quotas

## Output Format

\`\`\`markdown
## Cluster Resource Health Report

### Cluster Summary
| Cluster | Version | Nodes | Status | Overall Health |
|---------|---------|-------|--------|----------------|
| prod-us-west-2 | 1.29 | 12/12 Ready | Active | HEALTHY |

### Resource Utilization
| Resource | Requested | Allocatable | Utilization |
|----------|-----------|-------------|-------------|
| CPU | 38 cores | 48 cores | 79% |
| Memory | 96 Gi | 128 Gi | 75% |
\`\`\`

## Examples

- "Check the health of our EKS clusters"
- "Are there any failing pods in production?"
- "Show me cluster resource utilization"
- "Which nodes are under memory pressure?"

## Guidelines

- Check all clusters unless a specific cluster is requested
- Flag any node above 85% resource utilization as a capacity risk
- For CrashLoopBackOff pods, suggest checking logs as the immediate action
- EKS version end-of-support should be flagged at least 90 days before EOL
- Use kubectl read-only commands only (never modify cluster state during health checks)