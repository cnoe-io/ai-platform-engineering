---
name: local-integration-testing
description: Run end-to-end integration tests with all 15 agents and supervisor in local Docker Compose dev environment. Validates agent discovery, multi-agent routing, checkpoint persistence, and cross-agent follow-up conversations.
---

# Local Integration Testing — All Agents

Run end-to-end integration tests against the full CAIPE multi-agent stack in the local Docker Compose dev environment.

## Prerequisites

- Docker Desktop running with sufficient resources (16 GB+ RAM recommended for all 15 agents)
- `docker-compose.dev.yaml` present in the repo root
- `.env` file configured with required API keys and agent enable flags
- MongoDB container (`caipe-mongodb-dev`) running

## Instructions

### Phase 1: Enable All Agents

1. **Edit `.env`** — ensure all agent flags are enabled:
   ```bash
   ENABLE_ARGOCD=true
   ENABLE_AWS=true
   ENABLE_BACKSTAGE=true
   ENABLE_CONFLUENCE=true
   ENABLE_GITHUB=true
   ENABLE_GITLAB=true
   ENABLE_JIRA=true
   ENABLE_KOMODOR=true
   ENABLE_NETUTILS=true
   ENABLE_PAGERDUTY=true
   ENABLE_SLACK=true
   ENABLE_SPLUNK=true
   ENABLE_VICTOROPS=true
   ENABLE_WEATHER=true
   ENABLE_WEBEX=true
   ```

2. **Verify MongoDB checkpoint type**:
   ```bash
   grep "^LANGGRAPH_CHECKPOINT_TYPE=" .env
   # Should output: LANGGRAPH_CHECKPOINT_TYPE=mongodb
   ```

### Phase 2: Start the Stack

1. **Bring up all containers**:
   ```bash
   IMAGE_TAG=latest docker compose -f docker-compose.dev.yaml up -d
   ```

2. **Wait for agents to be healthy** (agents take 15-30 seconds to initialize):
   ```bash
   # Check all agent containers are running
   docker ps --filter "name=agent-" --format "table {{.Names}}\t{{.Status}}" | sort
   ```

3. **Restart supervisor** after agents are warm (avoids race condition where supervisor starts before agents are ready):
   ```bash
   docker restart caipe-supervisor
   ```

4. **Verify supervisor discovered all agents**:
   ```bash
   docker logs caipe-supervisor 2>&1 | grep -E "(ONLINE|subagents|tools)" | tail -5
   ```
   Expected: `Deep agent updated with 15 tools and 15 subagents`

### Phase 3: Validate Per-Agent Checkpoint Isolation

Run the checkpoint validation script:
```bash
./skills/persistence/validate_agent_checkpoints.sh
```

This checks:
- Each agent container is running
- Auto-prefix log present (per-agent MongoDB collection names)
- Collections exist with documents
- No InMemorySaver fallback
- No cross-contamination between agent collections

### Phase 4: Multi-Agent Routing Tests

Open the CAIPE UI at `http://localhost:3000` and test multi-agent routing:

| Test | Query | Expected Agents | Verification |
|------|-------|-----------------|--------------|
| AWS | "list EKS clusters" | supervisor → aws | `aws_checkpoints` has docs |
| ArgoCD | "show argocd version" | supervisor → argocd | `argocd_checkpoints` has docs |
| Jira | "show recent Jira issues" | supervisor → jira | `jira_checkpoints` has docs |
| Splunk | "check latest splunk logs" | supervisor → splunk | `splunk_checkpoints` has docs |
| Weather | "what's the weather in San Jose?" | supervisor → weather | `weather_checkpoints` has docs |
| Multi-agent | "list EKS clusters and show ArgoCD version" | supervisor → aws + argocd | Both checkpoint collections grow |

After each query, verify checkpoint writes:
```bash
docker exec caipe-mongodb-dev mongosh "mongodb://admin:changeme@localhost:27017/caipe?authSource=admin" --quiet --eval '
  db.getCollectionNames().filter(c => c.includes("checkpoint")).sort().forEach(function(c) {
    print(c + ": " + db.getCollection(c).countDocuments() + " docs");
  });
'
```

### Phase 5: Persistence Across Restarts

1. **Note the current checkpoint counts** from Phase 4
2. **Restart agent containers**:
   ```bash
   docker restart caipe-supervisor agent-aws agent-argocd agent-jira
   ```
3. **On the same thread**, ask a follow-up question:
   - "Where were you working on?" or "What did we discuss?"
4. **Verify** the supervisor recalls prior context from MongoDB checkpoints without re-calling subagents

### Phase 6: Cross-Contamination Verification

```bash
docker exec caipe-mongodb-dev mongosh "mongodb://admin:changeme@localhost:27017/caipe?authSource=admin" --quiet --eval '
  var colls = db.getCollectionNames().filter(c => c.endsWith("_checkpoints"));
  var threadMap = {};
  colls.forEach(function(coll) {
    db.getCollection(coll).distinct("thread_id").forEach(function(tid) {
      if (!threadMap[tid]) threadMap[tid] = [];
      threadMap[tid].push(coll);
    });
  });
  var shared = 0;
  Object.keys(threadMap).forEach(function(tid) {
    if (threadMap[tid].length > 1) {
      shared++;
      print("thread " + tid.substring(0,8) + "... → " + threadMap[tid].join(", "));
    }
  });
  if (shared > 0) {
    print(shared + " threads shared across collections (expected — supervisor forwards context_id)");
  } else {
    print("No shared threads — each agent is fully isolated");
  }
'
```

Shared thread IDs between supervisor and subagent collections are **expected** — the supervisor forwards its `context_id` as the subagent's `thread_id`. What matters is that each agent's graph state is only in **its own** collection.

## Troubleshooting

### Agent not discovered by supervisor
```bash
# Check agent logs for startup errors
docker logs agent-<name> 2>&1 | tail -20

# Verify the ENABLE flag in .env
grep "ENABLE_<NAME>" .env

# Restart supervisor after agent is running
docker restart caipe-supervisor
```

### Agent using InMemorySaver instead of MongoDB
```bash
# Check for InMemorySaver fallback in logs
docker logs agent-<name> 2>&1 | grep -i "InMemorySaver\|checkpointer"

# Verify the agent imports get_checkpointer()
grep -r "get_checkpointer\|MemorySaver\|InMemorySaver" ai_platform_engineering/agents/<name>/
```

### Container name conflict on startup
```bash
# Remove stale containers
docker rm -f agent-<name>
docker compose -f docker-compose.dev.yaml up -d agent-<name>
```

### Supervisor race condition (agents show OFFLINE)
Agents take 15-30 seconds to initialize. If supervisor starts first, it marks agents as offline.
```bash
# Wait for all agents, then restart supervisor
sleep 30
docker restart caipe-supervisor
```

## Quick Reference

```bash
# Full validation (run after stack is up)
./skills/persistence/validate_agent_checkpoints.sh

# Validate specific agents
./skills/persistence/validate_agent_checkpoints.sh aws jira argocd

# Check supervisor agent discovery
docker logs caipe-supervisor 2>&1 | grep -E "subagents|ONLINE|OFFLINE" | tail -20

# MongoDB checkpoint overview
docker exec caipe-mongodb-dev mongosh "mongodb://admin:changeme@localhost:27017/caipe?authSource=admin" --quiet --eval 'db.getCollectionNames().filter(c => c.includes("checkpoint")).sort().forEach(c => print(c + ": " + db.getCollection(c).countDocuments() + " docs"))'

# Watch agent logs in real-time
docker logs -f agent-aws 2>&1 | grep -i "checkpoint\|error"
```

## Examples

- "Test that all agents write checkpoints to isolated MongoDB collections"
- "Verify checkpoint persistence survives container restarts"
- "Run the full integration test suite locally"
- "Check if any agent fell back to InMemorySaver"

## Guidelines

- Always restart the supervisor **after** agents are warm — race condition is a known issue
- Agent source code is cross-mounted via Docker volumes — code changes only require `docker restart`, not rebuild
- The `validate_agent_checkpoints.sh` script is the single source of truth for checkpoint health
- Shared `thread_id` values across supervisor and subagent collections are expected behavior
- For agents that require API keys (AWS, Jira, Splunk, etc.), ensure credentials are set in `.env`
