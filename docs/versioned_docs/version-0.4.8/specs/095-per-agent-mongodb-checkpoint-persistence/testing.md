---
sidebar_position: 3
sidebar_label: Testing
---

# Per-Agent Checkpoint Persistence — Testing Report

**Date**: March 19, 2026
**Environment**: Docker Compose dev (docker-compose.dev.yaml)
**MongoDB**: caipe-mongodb-dev (MongoDB 8.0)

## Test 1: All 15 Agents Initialize with Per-Agent Collections

**Method**: Started all 15 agent containers and checked logs for auto-prefix detection.

**Result**: 15/15 agents confirmed with per-agent MongoDB collections.

| Agent | Prefix | Collections | Status |
|-------|--------|-------------|--------|
| argocd | `argocd` | `checkpoints_argocd`, `checkpoint_writes_argocd` | ✅ |
| aws | `aws` | `checkpoints_aws`, `checkpoint_writes_aws` | ✅ |
| backstage | `backstage` | `checkpoints_backstage`, `checkpoint_writes_backstage` | ✅ |
| confluence | `confluence` | `checkpoints_confluence`, `checkpoint_writes_confluence` | ✅ |
| github | `github` | `checkpoints_github`, `checkpoint_writes_github` | ✅ |
| gitlab | `gitlab` | `checkpoints_gitlab`, `checkpoint_writes_gitlab` | ✅ |
| jira | `jira` | `checkpoints_jira`, `checkpoint_writes_jira` | ✅ |
| komodor | `komodor` | `checkpoints_komodor`, `checkpoint_writes_komodor` | ✅ |
| netutils | `netutils` | `checkpoints_netutils`, `checkpoint_writes_netutils` | ✅ |
| pagerduty | `pagerduty` | `checkpoints_pagerduty`, `checkpoint_writes_pagerduty` | ✅ |
| slack | `slack` | `checkpoints_slack`, `checkpoint_writes_slack` | ✅ |
| splunk | `splunk` | `checkpoints_splunk`, `checkpoint_writes_splunk` | ✅ |
| victorops | `victorops` | `checkpoints_victorops`, `checkpoint_writes_victorops` | ✅ |
| weather | `weather` | `checkpoints_weather`, `checkpoint_writes_weather` | ✅ |
| webex | `webex` | `checkpoints_webex`, `checkpoint_writes_webex` | ✅ |

**Supervisor**: `checkpoints_caipe_supervisor`, `checkpoint_writes_caipe_supervisor` ✅

Log pattern observed for each agent:
```
LangGraph Checkpointer: auto-prefixed collections with '{agent}' → checkpoints_{agent}, checkpoint_writes_{agent}
LangGraph Checkpointer: MongoDBSaver configured (uri=mongodb://admin:chan..., db=caipe, ...)
```

## Test 2: Supervisor Discovery — All 15 Agents Online

**Method**: Enabled all agents in `.env`, restarted supervisor, verified connectivity.

**Result**: 15/15 agents discovered, 15 subagents registered, 15 tools available.

```
✅ Deep agent updated with 15 tools and 15 subagents
```

All agents show `✅ ONLINE` in the supervisor registry table.

## Test 3: Multi-Agent Checkpoint Writes (Thread f8221179)

**Method**: Sent "find list of eks clusters" through the UI. Supervisor routed to AWS agent (EKS CLI queries) and ArgoCD agent (cluster listing). Verified checkpoint documents in MongoDB.

**Result**: All three agents wrote checkpoints to their own collections for the same `thread_id`.

| Collection | Checkpoints | Writes |
|-----------|-------------|--------|
| `caipe_supervisor_checkpoints` | 28 | 56 |
| `aws_checkpoints` | 38 | 318 |
| `argocd_checkpoints` | 8 | 11 |

AWS agent executed `aws eks list-clusters` across 7 accounts (eticloud, outshift-common-dev, outshift-common-staging, outshift-common-prod, eti-ci, cisco-research, eticloud-demo) and multiple regions.

## Test 4: Checkpoint Persistence Survives Container Restart

**Method**: Restarted `caipe-supervisor`, `agent-aws`, `agent-argocd`, and `agent-jira`. Then sent "where were you working on?" on the same thread (f8221179).

**Result**: Supervisor loaded prior conversation state from MongoDB checkpoint and responded with a "Session Work Summary" recalling the EKS cluster listing and ArgoCD version query — without re-calling any subagents.

```
final_result: is_datapart=False, content_len=2762, preview=## 📋 Session Work Summary
```

## Test 5: Cross-Agent Follow-Up After Restart (Same Thread)

**Method**: On the same thread (f8221179), after restart, sent "show argocd version". Then sent "in that cluster list which one is the most used".

**Result**:
- "show argocd version" → routed to ArgoCD agent → returned **ArgoCD v3.3.1** (build 2026-02-18)
- "which cluster most used" → supervisor recalled the EKS list from checkpoint, routed to AWS agent asking about top 3 clusters (`in-cluster`, `comn-dev-use2-1`, `comn-staging-use2-1`), which ran kubectl commands against them

Final checkpoint counts for thread f8221179:

| Collection | Checkpoints | Writes |
|-----------|-------------|--------|
| `caipe_supervisor_checkpoints` | 53 | 106 |
| `aws_checkpoints` | 67 | 409 |
| `argocd_checkpoints` | 19 | 33 |

## Test 6: Checkpoint Content Verification

**Method**: Read checkpoint documents directly from MongoDB to verify content integrity.

**Result**: ArgoCD checkpoint writes contain the full structured response:

```
channel: messages
content: ## ArgoCD Version Information
- ArgoCD Version: v3.3.1
- Build Date: 2026-02-18T11:44:48Z
- Git Commit: 326a1dbd6b9f061207f814049f88e73fd8880c55
- Helm Version: v3.19.4
- Kubectl Version: v0.34.0
model_name: us.anthropic.claude-haiku-4-5-20251001-v1:0

channel: structured_response
status: completed
message: ArgoCD version information successfully retrieved.
```

## Test 7: No Cross-Contamination

**Method**: Verified that each agent's checkpoints only appear in their own collection.

**Result**: `aws_checkpoints` contains only AWS agent graph state. `argocd_checkpoints` contains only ArgoCD agent graph state. `caipe_supervisor_checkpoints` contains only supervisor graph state. No mixing despite sharing the same `thread_id` (`f8221179-f14a-4f5e-b02a-2d00d09fc486`).

## Summary

All tests pass. Per-agent MongoDB checkpoint persistence is working correctly:
- Auto-prefix detection creates isolated collection pairs per agent
- Checkpoints survive container restarts
- Multi-turn conversations maintain context across agent boundaries
- No cross-contamination between agents sharing the same thread ID
