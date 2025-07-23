# Agent Tracing Implementation Guide

This guide provides step-by-step instructions for implementing distributed tracing in agents using the `cnoe-agent-utils` library.

## Overview

The tracing system uses a hierarchical approach:
- **Supervisor Agents** (Platform Engineer, Incident Engineer): ROOT agents that generate trace_id
- **Sub-Agents** (GitHub, ArgoCD, Slack, etc.): CHILD agents that receive trace_id from supervisors

## Prerequisites

- `cnoe-agent-utils` library installed
- Langfuse configured for observability
- Understanding of A2A (Agent-to-Agent) protocol

## Implementation Steps

### 1. Identify Agent Type

**Supervisor Agent**: Root agent that orchestrates other agents
- Examples: Platform Engineer MAS, Incident Engineer MAS
- **Generates trace_id** when acting as root

**Sub-Agent**: Called by supervisor agents  
- Examples: GitHub, ArgoCD, Slack, Confluence, JIRA
- **Never generates trace_id**, only receives from supervisor

### 2. Modify Main Entry Point

**File**: `protocol_bindings/a2a_server/__main__.py` or `protocol_bindings/a2a/main.py`

Add disable_a2a_tracing() **BEFORE** any a2a imports:

```python
import logging

# =====================================================
# CRITICAL: Disable a2a tracing BEFORE any a2a imports
# =====================================================
from cnoe_agent_utils.tracing import disable_a2a_tracing

# Disable A2A framework tracing to prevent interference with custom tracing
disable_a2a_tracing()
logging.debug("A2A tracing disabled using cnoe-agent-utils")

# =====================================================
# Now safe to import a2a modules
# =====================================================

from a2a.server.apps import A2AStarletteApplication
# ... other a2a imports
```

### 3. Update Agent Class

**File**: `protocol_bindings/a2a_server/agent.py` or `protocol_bindings/a2a/agent.py`

#### 3.1 Add Imports
```python
from cnoe_agent_utils.tracing import TracingManager, trace_agent_stream
```

#### 3.2 Initialize TracingManager
```python
def __init__(self):
    # ... existing initialization
    self.tracing = TracingManager()
```

#### 3.3 Add Tracing Decorator and Update Stream Method
```python
@trace_agent_stream("agent_name")  # Use descriptive agent name
async def stream(self, query: str, context_id: str, trace_id: str = None) -> AsyncIterable[dict[str, Any]]:
    # ... existing stream logic
    
    # Use TracingManager for config
    config: RunnableConfig = self.tracing.create_config(context_id)
    
    # ... rest of method
```

### 4. Update Agent Executor

**File**: `protocol_bindings/a2a_server/agent_executor.py` or `protocol_bindings/a2a/agent_executor.py`

#### 4.1 Add Imports
```python
from cnoe_agent_utils.tracing import extract_trace_id_from_context
import uuid
import logging

logger = logging.getLogger(__name__)
```

#### 4.2 Add Trace ID Handling

**For Supervisor Agents** (ROOT agents):
```python
async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
    # ... existing code ...
    
    # Extract trace_id from A2A context (or generate if root)
    trace_id = extract_trace_id_from_context(context)
    if not trace_id:
        # Supervisor is the ROOT agent - generate trace_id
        # Langfuse requires 32 lowercase hex chars (no dashes)
        trace_id = str(uuid.uuid4()).replace('-', '').lower()
        logger.info(f"🔍 {AGENT_NAME} Executor: Generated ROOT trace_id: {trace_id}")
    else:
        logger.info(f"🔍 {AGENT_NAME} Executor: Using trace_id from context: {trace_id}")
    
    # Pass trace_id to agent stream
    async for event in self.agent.stream(query, context_id, trace_id):
        # ... existing event handling ...
```

**For Sub-Agents** (CHILD agents):
```python
async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
    # ... existing code ...
    
    # Extract trace_id from A2A context - THIS IS A SUB-AGENT, should NEVER generate trace_id
    trace_id = extract_trace_id_from_context(context)
    if not trace_id:
        logger.warning(f"{AGENT_NAME} Agent: No trace_id from supervisor")
        trace_id = None
    else:
        logger.info(f"{AGENT_NAME} Agent: Using trace_id from supervisor: {trace_id}")
    
    # Pass trace_id to agent stream
    async for event in self.agent.stream(query, context_id, trace_id):
        # ... existing event handling ...
```

### 5. Update A2A Remote Agent Connection (Supervisors Only)

**File**: `utils/a2a/a2a_remote_agent_connect.py`

Ensure trace_id is propagated through A2A metadata:

```python
from cnoe_agent_utils.tracing import TracingManager

# Get current trace_id and add to A2A metadata
tracing = TracingManager()
trace_id = tracing.get_trace_id()
if trace_id:
    message_payload['metadata'] = {'trace_id': trace_id}
```

### 6. Update Dockerfile (if agent has separate Dockerfile)

**File**: `build/Dockerfile` or `build/Dockerfile.a2a`

Add git installation and ensure poetry lock is run before install:

```dockerfile
# Install git and poetry dependencies (required for cnoe-agent-utils)
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Install uv and use it to install the package
RUN pip install uv poetry

RUN poetry config virtualenvs.create false
RUN poetry config virtualenvs.in-project false
RUN poetry config cache-dir /app/.cache

RUN poetry lock
RUN poetry install --no-interaction --no-root
```

## Key Requirements

### Trace ID Format
- **Langfuse Compatible**: 32 lowercase hexadecimal characters (no dashes)
- **Generation**: `str(uuid.uuid4()).replace('-', '').lower()`
- **Invalid**: `b7bdf137-8cf7-4ec5-bfa6-3ea75c1687a4` (has dashes)
- **Valid**: `b7bdf1378cf74ec5bfa63ea75c1687a4`

### Agent Hierarchy Rules
- **ROOT Agents**: Generate trace_id when none exists
- **CHILD Agents**: NEVER generate trace_id, only receive from parent
- **Trace Propagation**: ROOT → A2A metadata → CHILD agents

### Import Order
```python
# 1. Standard imports
import os, logging, etc.

# 2. CRITICAL: Disable A2A tracing FIRST
from cnoe_agent_utils.tracing import disable_a2a_tracing
disable_a2a_tracing()

# 3. Now safe to import a2a modules
from a2a.server.apps import A2AStarletteApplication
```

## Testing & Verification

### 1. Check Logs
Look for trace_id propagation logs:
```
🔍 Platform Engineer Executor: Generated ROOT trace_id: abc123...
🔍 GitHub Agent Executor: Using trace_id from supervisor: abc123...
```

### 2. Verify Langfuse
- Traces should appear with consistent trace_id across agents
- Parent-child relationship should be visible
- No format errors in logs

### 3. Common Issues
- **Missing disable_a2a_tracing()**: A2A framework interferes with tracing
- **Wrong trace_id format**: Langfuse rejects UUIDs with dashes
- **Sub-agent generating trace_id**: Breaks hierarchical tracing
- **Missing poetry lock**: Docker build failures

## Example Implementation

See the following reference implementations:
- **Supervisor**: `multi_agents/platform_engineer/protocol_bindings/a2a/`
- **Sub-Agent**: `agents/github/agent_github/protocol_bindings/a2a_server/`

## File Checklist

For each agent, verify these files are updated:

- [ ] `__main__.py` or `main.py`: disable_a2a_tracing() added
- [ ] `agent.py`: @trace_agent_stream decorator, TracingManager, trace_id parameter
- [ ] `agent_executor.py`: extract_trace_id_from_context, appropriate trace_id handling
- [ ] `Dockerfile`: poetry lock added (if separate Docker build)
- [ ] `a2a_remote_agent_connect.py`: trace_id propagation (supervisors only)

## Post-Implementation: Build and Test

After completing all tracing implementation steps above, build and test the agent:

### 1. Build the Agent
```bash
# Build the specific agent you just updated
docker compose -f docker-compose.dev.yaml --profile build-tracing build agent-[AGENT_NAME]-build

# Example for ArgoCD:
docker compose -f docker-compose.dev.yaml --profile build-tracing build agent-argocd-build
```

### 2. Test the Build
```bash
# Run the agent to verify it starts correctly
docker compose -f docker-compose.dev.yaml --profile build-tracing up agent-[AGENT_NAME]-build

# Check logs for tracing initialization
docker logs [container_name] | grep -i trace
```

### 3. Verify Implementation
- [ ] Agent starts without errors
- [ ] No import errors related to cnoe-agent-utils
- [ ] TracingManager initializes properly
- [ ] A2A tracing is disabled successfully

## Building and Testing

### Build Individual Agent
```bash
# Build specific agent using docker compose with tracing profile
docker compose -f docker-compose.dev.yaml --profile build-tracing build agent-github-build
```

### Build All Agents with Tracing
```bash
# Build all agents that support tracing
docker compose -f docker-compose.dev.yaml --profile build-tracing build
```

### Run Agent for Testing
```bash
# Run the built agent container
docker compose -f docker-compose.dev.yaml --profile build-tracing up agent-github-build
```

### Verify Tracing Setup
1. Check container logs for tracing initialization messages
2. Look for trace_id propagation logs:
   ```
   Platform Engineer Agent: Generated ROOT trace_id: abc123...
   GitHub Agent: Using trace_id from supervisor: abc123...
   ```
3. Verify Langfuse dashboard shows traces with correct hierarchy

## Troubleshooting

### No Traces Appearing
1. Check disable_a2a_tracing() is called before a2a imports
2. Verify Langfuse configuration
3. Check trace_id format (no dashes)

### Broken Trace Hierarchy  
1. Ensure supervisors generate trace_id when root
2. Ensure sub-agents never generate trace_id
3. Verify A2A metadata propagation

### Docker Build Failures
1. Add `RUN poetry lock` before `poetry install`
2. Check cnoe-agent-utils is in dependencies
3. Verify imports are correct
4. **Git executable not found**: Add git installation to Dockerfile:
   ```dockerfile
   RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
   ```

### Build Profile Issues
- Use `--profile build-tracing` flag with docker compose
- Ensure docker-compose.dev.yaml exists in project root
- Check that agent service is defined in the compose file