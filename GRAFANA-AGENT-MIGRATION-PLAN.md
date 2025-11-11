# Grafana Agent Migration Plan

## Executive Summary

This document outlines the plan to migrate the `mas-agent-grafana` from its standalone repository back into the upstream `ai-platform-engineering` repository as `ai_platform_engineering/agents/grafana`. The agent was originally forked from the ai-platform-engineering agents pattern and has since evolved with some structural differences. This migration will align it with the established patterns used by other agents in the upstream repository.

### Key Architectural Change: Adopt Upstream MCP Pattern

**Important**: The Grafana agent will be **migrated from sidecar to separate deployment pattern** to align with upstream:
- **Current (mas-agent-grafana)**: Sidecar container pattern (2 containers in 1 pod, localhost communication)
- **Target (ai-platform-engineering)**: Separate deployment pattern (2 separate pods with Kubernetes Service)

**Migration Approach**:
- **Agent Deployment**: Grafana agent pod(s) on port 8000 (A2A server)
- **MCP Deployment**: Separate MCP server pod(s) on port 8000 (HTTP/SSE server)
- **Communication**: Agent connects via `MCP_HOST=mcp-grafana` Kubernetes Service
- **Benefits**:
  - Consistency with all other agents in the repository
  - Independent scaling of agent vs MCP server
  - Easier to use existing Helm charts
  - Follows established upstream patterns

## Current State Analysis

### Repository Locations
- **Source**: `/Users/adickinson/repos/mas-agent-grafana` (standalone repo)
- **Destination**: `/Users/adickinson/repos/ai-platform-engineering/ai_platform_engineering/agents/grafana`

### Key Differences Identified

#### 1. Package Structure
**mas-agent-grafana** (standalone):
```
mas-agent-grafana/
├── agent_grafana/
│   ├── __init__.py
│   ├── __main__.py
│   ├── agent.py              # Uses mas_agent_base.BaseAgent
│   ├── agent_executor.py
│   ├── graph.py
│   ├── state.py
│   ├── mcp_server/           # Contains local MCP server implementation
│   │   └── mcp_grafana/
│   ├── protocol_bindings/
│   │   └── a2a_server/
│   └── utils/
│       └── logging.py
├── pyproject.toml            # Uses mas-agent-base, mas-agent-server
├── Makefile                  # Standalone comprehensive Makefile
├── deployment/kubernetes/    # Standalone deployment configs
└── tests/
```

**ai-platform-engineering/agents/jira** (upstream pattern):
```
agents/jira/
├── agent_jira/
│   ├── __init__.py
│   ├── __main__.py
│   ├── agentcard.py
│   ├── graph.py
│   ├── models.py
│   ├── state.py
│   ├── protocol_bindings/
│   │   └── a2a_server/       # Uses BaseLangGraphAgent
│   │       ├── agent.py
│   │       ├── agent_executor.py
│   │       ├── helpers.py
│   │       └── state.py
├── mcp/                      # MCP server as sibling, not nested
│   └── mcp_jira/
├── clients/
├── evals/
├── tests/
├── pyproject.toml            # Individual agent package
├── Makefile                  # Includes ../common.mk
└── README.md
```

#### 2. Base Class Differences

**mas-agent-grafana** uses:
- `mas_agent_base.BaseAgent` - Custom base class from separate package
- `mas_agent_server` - Separate server package
- Uses `MCPConfig` for MCP server configuration

**ai-platform-engineering** uses:
- `BaseLangGraphAgent` from `ai_platform_engineering.utils.a2a_common`
- Integrated patterns within the monorepo
- Direct MCP integration via langchain-mcp-adapters

#### 3. MCP Server Location

**mas-agent-grafana**:
- Local MCP implementation at `agent_grafana/mcp_server/mcp_grafana/`
- Built with mas-agent-base patterns

**ai-platform-engineering**:
- MCP servers as sibling directories: `agents/{agent}/mcp/mcp_{agent}/`
- Uses external MCP servers (e.g., `mcp-jira` package for Jira agent)

#### 4. Dependencies

**mas-agent-grafana** specific:
```toml
mas-agent-base>=0.2.1
mas-agent-server>=0.1.0
ddtrace==3.15.0
```

**ai-platform-engineering** common:
```toml
langgraph==0.5.3
a2a-sdk==0.3.0
cnoe-agent-utils==0.3.2
langchain-mcp-adapters>=0.1.0
```

#### 5. Configuration & Deployment

**mas-agent-grafana**:
- Standalone deployment configs in `deployment/kubernetes/`
- Comprehensive standalone Makefile
- GitLab CI integration with ECR deployment
- Uses uvx for external MCP server (official mcp-grafana)

**ai-platform-engineering**:
- Shared deployment patterns in root-level directories
- Agents use `common.mk` for shared targets
- Workspace-based monorepo structure

## Migration Strategy

### Phase 1: Preparation (Pre-Migration)

#### 1.1 Create Grafana Agent Directory Structure
```bash
mkdir -p ai_platform_engineering/agents/grafana/{agent_grafana,mcp,clients,evals,tests}
```

#### 1.2 Review and Document Dependencies
- Document all mas-agent-base usage patterns
- Identify which features from mas-agent-base need to be replicated or adapted
- Map BaseAgent methods to BaseLangGraphAgent equivalents

#### 1.3 Backup Current Work
```bash
cd /Users/adickinson/repos/mas-agent-grafana
git checkout -b pre-migration-backup
git push origin pre-migration-backup
```

### Phase 2: Code Migration & Adaptation

#### 2.1 Core Agent Files

**agent.py migration**:
- [ ] Copy `agent_grafana/agent.py` to `ai_platform_engineering/agents/grafana/agent_grafana/protocol_bindings/a2a_server/agent.py`
- [ ] Replace `mas_agent_base.BaseAgent` with `BaseLangGraphAgent`
- [ ] Adapt initialization to match upstream pattern
- [ ] Update SYSTEM_INSTRUCTION to use `scope_limited_agent_instruction()` helper
- [ ] Remove mas-agent-base specific imports

**graph.py migration**:
- [ ] Copy `agent_grafana/graph.py` to `ai_platform_engineering/agents/grafana/agent_grafana/graph.py`
- [ ] Ensure compatibility with upstream LangGraph patterns
- [ ] Verify state management aligns with upstream

**state.py migration**:
- [ ] Copy `agent_grafana/state.py` to both:
  - `ai_platform_engineering/agents/grafana/agent_grafana/state.py`
  - `ai_platform_engineering/agents/grafana/agent_grafana/protocol_bindings/a2a_server/state.py`
- [ ] Ensure Pydantic models match upstream conventions

**models.py creation**:
- [ ] Create `agent_grafana/models.py` following upstream pattern
- [ ] Move any model definitions from agent.py or state.py

**agentcard.py creation**:
- [ ] Create `agent_grafana/agentcard.py` following jira agent pattern
- [ ] Define agent metadata, capabilities, and routing information

#### 2.2 Protocol Bindings

**a2a_server module**:
- [ ] Create `agent_grafana/protocol_bindings/a2a_server/` directory
- [ ] Copy and adapt:
  - `__init__.py` - Entry point for A2A server
  - `agent.py` - Main agent class using BaseLangGraphAgent
  - `agent_executor.py` - Execution logic
  - `helpers.py` - Utility functions
  - `state.py` - A2A-specific state management
- [ ] Update imports to use ai_platform_engineering paths
- [ ] Remove mas-agent-server dependencies

#### 2.3 MCP Server Integration

**Current Architecture**: mas-agent-grafana uses a **sidecar container pattern**:
- Main container: Grafana agent (A2A server)
- Sidecar container: `mcp/grafana:latest` MCP server on port 8080
- Agent connects via `http://localhost:8080/mcp` (pod-local)

**Target Architecture**: Adopt **separate deployment pattern** (upstream standard):
- **Agent Deployment**: Separate pod(s) for Grafana agent
- **MCP Deployment**: Separate pod(s) for MCP server
- **Service**: Kubernetes Service `mcp-grafana` for communication
- Agent connects via `MCP_HOST=mcp-grafana` (service-to-service)

**Implementation Tasks**:
- [ ] Move `agent_grafana/mcp_server/mcp_grafana/` to `agents/grafana/mcp/mcp_grafana/`
- [ ] Update agent.py MCP configuration:
  - Remove sidecar-specific code (localhost:8080)
  - Use upstream pattern: `MCP_HOST` and `MCP_PORT` env vars
  - Default to `MCP_HOST=mcp-grafana` and `MCP_PORT=8000`
- [ ] Create `mcp/Dockerfile` for building MCP server image
- [ ] Remove sidecar configuration logic
- [ ] Update agent to use `BaseLangGraphAgent` MCP initialization
- [ ] Configure for HTTP mode: `MCP_MODE=http`

**Why this approach**:
- **Consistency**: Matches all other agents in ai-platform-engineering
- **Maintainability**: Uses existing Helm chart infrastructure
- **Scalability**: Agent and MCP can scale independently
- **Simplicity**: No custom deployment patterns to maintain
- **Community**: Easier for other contributors to understand

#### 2.4 Utility Files

**logging.py**:
- [ ] Review `agent_grafana/utils/logging.py`
- [ ] Check if similar functionality exists in ai_platform_engineering.utils
- [ ] Either integrate or copy to `agent_grafana/utils/`

**__main__.py**:
- [ ] Copy `agent_grafana/__main__.py`
- [ ] Update to match upstream entry point patterns
- [ ] Ensure CLI compatibility with monorepo structure

### Phase 3: Configuration Files

#### 3.1 pyproject.toml
- [ ] Create `agents/grafana/pyproject.toml` based on jira agent template:
  ```toml
  [project]
  name = "agent_grafana"
  version = "0.1.0"
  license = "Apache-2.0"
  description = "Grafana monitoring and observability agent"
  requires-python = ">=3.13, <4.0"
  dependencies = [
      "agentevals>=0.0.7",
      "agntcy-app-sdk==0.4.0",
      "agntcy-acp>=1.3.2",
      "click>=8.2.0",
      "langchain-anthropic>=0.3.13",
      "langchain-core>=0.3.60",
      "langchain-google-genai>=2.1.4",
      "langchain-mcp-adapters>=0.1.0",
      "langchain-openai>=0.3.17",
      "langgraph==0.5.3",
      "a2a-sdk==0.3.0",
      "cnoe-agent-utils==0.3.2",
      # Option A: External MCP server
      # "mcp-grafana",
  ]
  ```
- [ ] Remove mas-agent-base and mas-agent-server dependencies
- [ ] Add to workspace in root pyproject.toml:
  ```toml
  [tool.uv.workspace]
  members = [
      "ai_platform_engineering/agents/argocd",
      "ai_platform_engineering/agents/komodor",
      "ai_platform_engineering/agents/grafana",  # ADD THIS
  ]
  ```

#### 3.2 Makefile
- [ ] Create `agents/grafana/Makefile`:
  ```makefile
  # Grafana Agent Makefile
  AGENT_NAME = grafana

  # Include common functionality
  include ../common.mk

  # Agent-specific targets can be added here if needed
  ```
- [ ] Review standalone Makefile for any grafana-specific targets to preserve
- [ ] Document any custom targets in comments

#### 3.3 Environment Configuration
- [ ] Copy `.env.template` to `agents/grafana/.env.example`
- [ ] Document required environment variables:
  - `GRAFANA_API_KEY`
  - `GRAFANA_URL`
  - `DD_API_KEY` (optional - telemetry)
  - `DD_APP_KEY` (optional - telemetry)
  - LLM provider credentials

### Phase 4: Supporting Files

#### 4.1 Tests
- [ ] Copy `tests/` directory to `agents/grafana/tests/`
- [ ] Update import paths to match new structure
- [ ] Ensure pytest configuration aligns with upstream
- [ ] Verify test execution: `make test`

#### 4.2 Evaluations
- [ ] Create `agents/grafana/evals/strict_match/` directory
- [ ] Port any existing evaluation logic
- [ ] Follow upstream eval patterns from other agents

#### 4.3 Documentation
- [ ] Copy and adapt `README.md` to `agents/grafana/README.md`
- [ ] Update paths, commands, and references for monorepo structure
- [ ] Create or update architecture diagrams
- [ ] Document agent capabilities and MCP tools
- [ ] Add to main repository documentation

#### 4.4 Clients
- [ ] Create `agents/grafana/clients/` directory if needed
- [ ] Port any custom client implementations
- [ ] Update import paths

### Phase 5: Deployment & Infrastructure

#### 5.1 Kubernetes Deployment with Separate MCP Pattern

**Target Deployment Architecture** (Aligned with Upstream):

```
┌─────────────────────────────┐         ┌──────────────────────────┐
│ Pod: agent-grafana          │         │ Pod: mcp-grafana         │
│                             │         │                          │
│ ┌─────────────────────────┐ │         │ ┌──────────────────────┐ │
│ │ Container: agent        │ │         │ │ Container: mcp-server│ │
│ │                         │ │         │ │                      │ │
│ │ - Port: 8000 (A2A)      │ │    ┌────┼─► Port: 8000 (HTTP)   │ │
│ │ - LangGraph Agent       │ │    │    │ │ - Grafana MCP Server │ │
│ │ - BaseLangGraphAgent    │ ├────┘    │ │ - HTTP/SSE transport │ │
│ │                         │ │         │ │                      │ │
│ │ Env:                    │ │         │ │ Env:                 │ │
│ │ - MCP_MODE=http         │ │         │ │ - GRAFANA_API_KEY    │ │
│ │ - MCP_HOST=mcp-grafana  │ │         │ │ - GRAFANA_URL        │ │
│ │ - MCP_PORT=8000         │ │         │ │ - MCP_MODE=http      │ │
│ │                         │ │         │ │ - MCP_PORT=8000      │ │
│ │ Resources:              │ │         │ │                      │ │
│ │ - CPU: 500m             │ │         │ │ Resources:           │ │
│ │ - Memory: 2Gi           │ │         │ │ - CPU: 100m          │ │
│ └─────────────────────────┘ │         │ │ - Memory: 128Mi      │ │
│                             │         │ └──────────────────────┘ │
└─────────────────────────────┘         └──────────────────────────┘
         │                                         ▲
         │ Connects via Service                    │
         └────────► Service: mcp-grafana ──────────┘
                    ClusterIP: 8000

         │
         │ A2A Protocol
         ▼
   External Clients
```

**Deployment Structure**:
```yaml
# Agent Deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: agent-grafana
spec:
  template:
    spec:
      containers:
      - name: agent
        image: ghcr.io/cnoe-io/agent-grafana:TAG
        ports:
        - containerPort: 8000
        env:
        - name: MCP_MODE
          value: "http"
        - name: MCP_HOST
          value: "mcp-grafana"
        - name: MCP_PORT
          value: "8000"

---
# MCP Deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mcp-grafana
spec:
  template:
    spec:
      containers:
      - name: mcp
        image: ghcr.io/cnoe-io/mcp-grafana:TAG
        ports:
        - containerPort: 8000
        env:
        - name: GRAFANA_API_KEY
          valueFrom:
            secretKeyRef: ...
        - name: GRAFANA_URL
          value: "https://grafana.demandbase.com"

---
# MCP Service
apiVersion: v1
kind: Service
metadata:
  name: mcp-grafana
spec:
  selector:
    app: mcp-grafana
  ports:
  - port: 8000
    targetPort: 8000
```

**Migration Tasks**:
- [ ] Review standalone `deployment/kubernetes/mas-agent-grafana/` configs
- [ ] **Use upstream Helm chart pattern** (agents/grafana will be added to main chart)
- [ ] Update `charts/ai-platform-engineering/values.yaml`:
  ```yaml
  agent-grafana:
    enabled: true
    nameOverride: "agent-grafana"
    image:
      repository: "ghcr.io/cnoe-io/agent-grafana"
      tag: "stable"
    mcp:
      image:
        repository: "ghcr.io/cnoe-io/mcp-grafana"
        tag: "stable"
      mode: "http"
      port: 8000
  ```
- [ ] Convert sidecar architecture to separate deployments:
  - Split into agent-grafana and mcp-grafana deployments
  - Remove sidecar container configuration
  - Create Service for mcp-grafana
- [ ] Update image references to use ghcr.io/cnoe-io paths
- [ ] Configure environment variables:
  - Agent: `MCP_HOST=mcp-grafana`, `MCP_PORT=8000`, `MCP_MODE=http`
  - MCP: `GRAFANA_API_KEY`, `GRAFANA_URL`, `MCP_MODE=http`
- [ ] Update ConfigMap and Secret definitions for both deployments
- [ ] Configure separate resource limits for agent and MCP pods
- [ ] Add health checks for both deployments
- [ ] Verify IAM role for AWS Bedrock access (agent pod)
- [ ] Test service-to-service communication (mcp-grafana:8000)

#### 5.2 MCP Server Image Build
- [ ] Create `agents/grafana/mcp/Dockerfile` for MCP server:
  ```dockerfile
  FROM python:3.13-slim
  WORKDIR /app
  COPY mcp_grafana/ /app/mcp_grafana/
  COPY pyproject.toml /app/
  RUN pip install -e .
  EXPOSE 8000
  ENV MCP_MODE=http
  ENV MCP_PORT=8000
  ENV MCP_HOST=0.0.0.0
  ENTRYPOINT ["python", "-m", "mcp_grafana.server"]
  ```
- [ ] Add build target for MCP server in CI/CD (separate from agent)
- [ ] Push MCP server image to ghcr.io/cnoe-io/mcp-grafana
- [ ] Document MCP server image versioning strategy
- [ ] Ensure MCP server supports HTTP/SSE mode on port 8000

#### 5.3 CI/CD Integration
- [ ] Review standalone `.gitlab-ci.yml`
- [ ] Integrate grafana agent into root `.gitlab-ci.yml`
- [ ] Ensure Docker build stages exist for both:
  - Main grafana agent container
  - MCP server sidecar container (if custom build needed)
- [ ] Update ECR push configurations for both images
- [ ] Test CI/CD pipeline end-to-end

#### 5.4 Backstage Catalog
- [ ] Copy `catalog-info.yaml` to `agents/grafana/`
- [ ] Update component metadata:
  - Update lifecycle, owner, system
  - Update repository URLs
  - Update links and documentation references
- [ ] Register in Backstage

### Phase 6: Testing & Validation

#### 6.1 Unit Tests
- [ ] Run unit tests: `cd agents/grafana && make test`
- [ ] Fix any import errors
- [ ] Verify all tests pass
- [ ] Check code coverage

#### 6.2 Integration Tests
- [ ] Start agent locally: `make run-a2a`
- [ ] Test with A2A client: `make run-a2a-client`
- [ ] Verify MCP server connection
- [ ] Test key operations:
  - Dashboard search
  - Alert queries
  - Prometheus metrics queries
  - Incident management

#### 6.3 End-to-End Testing
- [ ] Deploy to dev/test environment
- [ ] Test agent registration with platform-engineering-mas
- [ ] Verify multi-agent routing works
- [ ] Test with real Grafana instance
- [ ] Monitor for errors in logs

### Phase 7: Documentation & Handoff

#### 7.1 Update Documentation
- [ ] Update main README.md to include Grafana agent
- [ ] Document Grafana agent in agents/README.md
- [ ] Create migration notes document
- [ ] Update architecture diagrams

#### 7.2 Team Communication
- [ ] Announce migration completion
- [ ] Share documentation updates
- [ ] Conduct knowledge transfer session if needed
- [ ] Update team runbooks

#### 7.3 Deprecate Old Repository
- [ ] Archive mas-agent-grafana repository
- [ ] Update README with deprecation notice and pointer to new location
- [ ] Update any external references or links
- [ ] Preserve git history with notes about migration

## Key Decisions & Considerations

### 1. Base Class Migration Strategy

**Decision**: Replace `mas_agent_base.BaseAgent` with `BaseLangGraphAgent`

**Rationale**:
- Aligns with upstream patterns
- Reduces external dependencies
- Integrates better with monorepo structure
- Provides better control and maintainability

**Implementation**:
```python
# OLD (mas-agent-grafana)
from mas_agent_base import BaseAgent

class GrafanaAgent(BaseAgent):
    SYSTEM_INSTRUCTION = "..."

# NEW (upstream)
from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import BaseLangGraphAgent
from ai_platform_engineering.utils.prompt_templates import scope_limited_agent_instruction

class GrafanaAgent(BaseLangGraphAgent):
    SYSTEM_INSTRUCTION = scope_limited_agent_instruction(
        service_name="Grafana",
        service_operations="monitor dashboards, query metrics, manage alerts and incidents",
        additional_guidelines=[
            "Search and list dashboards",
            "Query datasources (Prometheus, Loki, etc.)",
            # ... more guidelines
        ]
    )
```

### 2. MCP Server Strategy

**Decision**: Adopt separate deployment pattern with Kubernetes Service (Align with upstream!)

**Migration Approach**: Convert from sidecar to separate deployment pattern:
- **Current (mas-agent-grafana)**: Sidecar container within same pod, localhost communication
- **Target (ai-platform-engineering)**: Separate deployments, service-to-service communication

**Rationale for Adopting Upstream Pattern**:
- **Consistency**: All agents use the same architecture pattern
- **Maintainability**: Leverage existing Helm chart infrastructure
- **Scalability**: Agent and MCP can scale independently based on load
- **Community**: Easier for contributors to understand and maintain
- **Future-proof**: Benefits from upstream improvements automatically
- **Simplicity**: No custom deployment patterns to document/maintain

**Implementation**:
- **Agent Deployment**: Separate pod(s) for Grafana agent
- **MCP Deployment**: Separate pod(s) for MCP server
- **Service**: Kubernetes Service `mcp-grafana` on port 8000
- Agent connects via `MCP_HOST=mcp-grafana`, `MCP_PORT=8000`
- Configure via `MCP_MODE=http` (standard upstream pattern)

**Upstream Pattern Verification**:
- `charts/ai-platform-engineering/charts/agent/templates/mcp-deployment.yaml` - Separate MCP deployment template
- `charts/ai-platform-engineering/charts/agent/templates/mcp-service.yaml` - Service for MCP
- `docker-compose.yaml` - All agents use `MCP_HOST=mcp-<agent>` pattern
- `base_langgraph_agent.py` - Uses `MCP_HOST` and `MCP_PORT` env vars

**Architecture Comparison**:

| Aspect | Current (Sidecar) | Target (Separate) | Benefit |
|--------|-------------------|-------------------|---------|
| Deployment | 1 pod, 2 containers | 2 pods | Independent scaling |
| Communication | localhost:8080 | mcp-grafana:8000 | Standard pattern |
| Scaling | Together | Independent | Better resource usage |
| Helm Support | Custom | Native | Less maintenance |
| Pattern | Unique | Standard | Easier onboarding |

### 3. Directory Structure

**Decision**: Follow upstream agents/{agent}/ pattern

**Rationale**:
- Consistency with other agents in monorepo
- Easier for developers to navigate
- Shared tooling and infrastructure
- Better workspace integration

### 4. Dependency Management

**Decision**: Remove mas-agent-base/server, use monorepo dependencies

**Rationale**:
- Reduces external package dependencies
- Leverages shared utilities in ai_platform_engineering
- Simplifies version management
- Better integration with uv workspace

## Risk Assessment

### High Risk Items
1. **Base class compatibility**: Ensure BaseAgent → BaseLangGraphAgent migration doesn't break functionality
2. **MCP integration**: Verify external MCP server works correctly
3. **State management**: Ensure state handling matches upstream patterns

### Medium Risk Items
1. **Import path updates**: Many files need path changes
2. **Testing coverage**: Need comprehensive testing after migration
3. **Deployment configs**: K8s configs need validation

### Low Risk Items
1. **Documentation updates**: Time-consuming but low technical risk
2. **Makefile changes**: Well-defined patterns to follow
3. **Utility function moves**: Mostly straightforward copies

## Success Criteria

- [ ] All tests pass (unit, integration, e2e)
- [ ] Agent successfully registers with platform-engineering-mas
- [ ] Multi-agent routing works correctly
- [ ] No regression in functionality
- [ ] Documentation is complete and accurate
- [ ] CI/CD pipeline builds and deploys successfully
- [ ] Team can develop and maintain agent using standard patterns

## Timeline Estimate

- **Phase 1 (Preparation)**: 2-4 hours
- **Phase 2 (Code Migration)**: 1-2 days
- **Phase 3 (Configuration)**: 4-6 hours
- **Phase 4 (Supporting Files)**: 4-6 hours
- **Phase 5 (Deployment)**: 1 day
- **Phase 6 (Testing)**: 1-2 days
- **Phase 7 (Documentation)**: 4-6 hours

**Total Estimate**: 4-6 days

## Rollback Plan

If critical issues are discovered:

1. **Immediate**: Keep mas-agent-grafana repository active
2. **Short-term**: Maintain parallel deployment of both versions
3. **Long-term**: Document blockers and create remediation plan
4. **Recovery**: Original repository has full git history for restoration

## Next Steps

1. Review and approve this migration plan
2. Create tracking ticket/epic for migration work
3. Schedule migration execution window
4. Begin Phase 1 (Preparation)
5. Execute phases sequentially with validation at each step

## Notes

- This migration converts Grafana agent from sidecar to separate deployment pattern
- Aligns with all upstream patterns for consistency and maintainability
- Git history from mas-agent-grafana should be preserved via repository notes
- Consider pair programming for complex migration steps
- Schedule team review at Phase 3 completion (50% checkpoint)

### Architectural Migration: Sidecar → Separate Deployment

This migration includes an **architectural change** from sidecar to separate deployment pattern:

**Before (mas-agent-grafana)**:
- Single Kubernetes pod with 2 containers
- Agent container + MCP sidecar container
- Communication: `localhost:8080` (pod-local)
- No separate Kubernetes Service for MCP

**After (ai-platform-engineering)**:
- Two separate Kubernetes deployments
- Agent deployment + MCP deployment
- Communication: `http://mcp-grafana:8000` (via Service)
- Kubernetes Service resource for MCP server

**Benefits of the Change**:
1. **Consistency**: Matches all other agents (ArgoCD, Backstage, Jira, etc.)
2. **Helm Integration**: Uses existing upstream Helm chart infrastructure
3. **Independent Scaling**: Agent and MCP can scale based on different load patterns
4. **Maintainability**: No custom deployment patterns to maintain
5. **Community**: Standard pattern is easier for contributors

**Migration Impact**:
- Agent code needs update: Remove localhost:8080, use MCP_HOST/MCP_PORT
- Deployment configs: Split sidecar into separate deployment + service
- Testing: Verify service-to-service communication works correctly
- Minimal functional impact: Same MCP tools, just different transport

## Quick Reference: Configuration

### Environment Variables (Upstream Pattern)

**Agent Container**:
```bash
# MCP Configuration
MCP_MODE=http
MCP_HOST=mcp-grafana
MCP_PORT=8000

# LLM Provider (choose one)
LLM_PROVIDER=aws-bedrock  # or azure-openai, openai, anthropic
AWS_BEDROCK_MODEL_ID=anthropic.claude-3-5-sonnet-20241022-v2:0

# Observability (optional)
DD_API_KEY=<datadog_api_key>
DD_APP_KEY=<datadog_app_key>
DD_ENV=production
```

**MCP Server Container**:
```bash
# MCP Server Configuration
MCP_MODE=http
MCP_PORT=8000
MCP_HOST=0.0.0.0

# Grafana API Configuration
GRAFANA_API_KEY=<grafana_api_key>
GRAFANA_URL=https://grafana.demandbase.com
```

### Testing Service Communication

```bash
# Test MCP service accessibility
kubectl run -it --rm debug --image=curlimages/curl --restart=Never -- \
  curl http://mcp-grafana:8000/health

# Check MCP server logs
kubectl logs -f deployment/mcp-grafana

# Check agent logs
kubectl logs -f deployment/agent-grafana

# Verify service exists
kubectl get svc mcp-grafana

# Check service endpoints
kubectl get endpoints mcp-grafana
```

## References

- [ai-platform-engineering repository](https://github.com/cnoe-io/ai-platform-engineering)
- [mas-agent-grafana repository](https://gitlab.com/demandbase/devx/mas-agent-grafana)
- [Grafana MCP Server](https://github.com/grafana/mcp-grafana)
- [A2A SDK Documentation](https://github.com/google/A2A)
- [LangGraph Documentation](https://langchain-ai.github.io/langgraph/)
- [Kubernetes Sidecar Pattern](https://kubernetes.io/docs/concepts/workloads/pods/#workload-resources-for-managing-pods)
- [MCP SSE Transport](https://modelcontextprotocol.io/docs/concepts/transports#server-sent-events-sse)
