---
name: cluster-resource-health
description: Check Kubernetes cluster health including pod status, node conditions, resource utilization, and pending alerts across EKS clusters. Use when monitoring infrastructure health, investigating capacity issues, or performing cluster audits.
---

# Cluster Resource Health

Query AWS EKS clusters for node health, pod status, resource utilization, and alerts to produce a cluster health dashboard.

## Instructions

### Phase 1: Cluster Overview (AWS Agent)
1. **List EKS clusters** and their status:
   - Cluster name, version, and status
   - Node group configurations (instance types, desired/min/max counts)
   - Current node count and readiness
2. **Check Kubernetes version**:
   - Current version vs. latest available
   - End-of-support date for current version

### Phase 2: Node Health
1. **Inspect node conditions** using kubectl via the AWS agent:
   - Ready, MemoryPressure, DiskPressure, PIDPressure, NetworkUnavailable
   - Node allocatable vs. requested resources
   - Unschedulable nodes (cordoned/drained)
2. **Resource utilization per node**:
   - CPU requested vs. allocatable (%)
   - Memory requested vs. allocatable (%)
   - Pod count vs. pod limit

### Phase 3: Pod Health
1. **Identify problematic pods**:
   - CrashLoopBackOff, ImagePullBackOff, OOMKilled
   - Pending pods (unable to schedule)
   - Pods with high restart counts (>5)
   - Evicted pods
2. **Namespace-level summary**:
   - Pods running, pending, failed per namespace
   - Resource quotas and limit ranges

### Phase 4: Resource Capacity Analysis
1. **Cluster-wide utilization**:
   - Total CPU requested vs. total allocatable
   - Total memory requested vs. total allocatable
   - Headroom for new workloads
2. **Capacity risks**:
   - Nodes at >80% resource utilization
   - Namespaces exceeding resource quotas
   - PersistentVolume claims pending or near capacity

## Output Format

```markdown
## Cluster Resource Health Report
**Generated**: February 9, 2026

### Cluster Summary
| Cluster | Version | Nodes | Status | Overall Health |
|---------|---------|-------|--------|----------------|
| prod-us-west-2 | 1.29 | 12/12 Ready | Active | HEALTHY |
| staging-us-west-2 | 1.28 | 4/4 Ready | Active | WARNING |

### Resource Utilization (prod-us-west-2)
| Resource | Requested | Allocatable | Utilization |
|----------|-----------|-------------|-------------|
| CPU | 38 cores | 48 cores | 79% |
| Memory | 96 Gi | 128 Gi | 75% |
| Pods | 187 | 440 | 43% |

**Headroom**: Can schedule ~10 more standard pods (1 CPU, 2Gi each)

### Problematic Pods
| Pod | Namespace | Status | Restarts | Node |
|-----|-----------|--------|----------|------|
| payment-api-7d4b8c | production | CrashLoopBackOff | 23 | node-3 |
| data-pipeline-abc | batch | OOMKilled | 5 | node-7 |
| image-proc-xyz | processing | ImagePullBackOff | 0 | node-2 |

### Node Health
| Node | Status | CPU Req% | Mem Req% | Pods | Conditions |
|------|--------|----------|----------|------|------------|
| node-1 | Ready | 82% | 71% | 18 | OK |
| node-7 | Ready | 91% | 88% | 22 | MemoryPressure |

### Capacity Risks
1. **HIGH**: node-7 at 91% CPU / 88% memory - consider scaling node group
2. **MEDIUM**: staging cluster on EKS 1.28 - EOL in 60 days, plan upgrade
3. **LOW**: 3 PVCs at >80% capacity in `data` namespace

### Recommendations
1. **Immediate**: Investigate payment-api CrashLoopBackOff (23 restarts)
2. **Short-term**: Scale prod node group from 12 to 14 nodes (headroom at 79%)
3. **Planned**: Upgrade staging cluster from EKS 1.28 to 1.29
4. **Optimization**: Right-size data-pipeline pods (OOMKilled - increase memory limit)
```

## Examples

- "Check the health of our EKS clusters"
- "Are there any failing pods in production?"
- "Show me cluster resource utilization"
- "Which nodes are under memory pressure?"
- "Do we have enough capacity for a new deployment?"

## Guidelines

- Check all clusters unless a specific cluster is requested
- Flag any node above 85% resource utilization as a capacity risk
- For CrashLoopBackOff pods, suggest checking logs as the immediate action
- EKS version end-of-support should be flagged at least 90 days before EOL
- Group pods by issue type (crash, OOM, image pull) for easier triage
- Include pod restart counts - high restarts indicate chronic issues even if currently running
- When capacity is tight, recommend specific scaling actions (node count, instance type)
- Use kubectl read-only commands only (never modify cluster state during health checks)
