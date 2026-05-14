---
sidebar_position: 1
id: 027-aws-integration-architecture
sidebar_label: Architecture
---

# Architecture: AWS Agent Backend Implementations

**Date**: 2025-11-05

## 1. LangGraph Backend (Default) ✨

**File:** `agent_aws/agent_langgraph.py`

### Features:
- ✅ **Tool Call Notifications**: Shows `🔧 Calling tool: {ToolName}` and `✅ Tool {ToolName} completed`
- ✅ **Token-by-Token Streaming**: Fine-grained streaming when `ENABLE_STREAMING=true`
- ✅ **Consistent with Other Agents**: Same behavior as ArgoCD, GitHub, Jira agents
- ✅ **LangGraph Ecosystem**: Full access to LangGraph features

### Usage:
```bash
# Default - no configuration needed
docker-compose -f docker-compose.dev.yaml up agent-aws-p2p

# Or explicitly set
export AWS_AGENT_BACKEND=langgraph
export ENABLE_STREAMING=true
```

### Example Output:
```
🔧 Aws: Calling tool: List_Clusters
✅ Aws: Tool List_Clusters completed

Found 3 EKS clusters in us-west-2:
- prod-cluster
- staging-cluster
- dev-cluster
```

---

## 2. Strands Backend (Alternative)

**File:** `agent_aws/agent.py`

### Features:
- ✅ **Chunk-Level Streaming**: Built-in streaming (always on)
- ✅ **Mature**: Original implementation, well-tested
- ✅ **Simple**: Fewer dependencies
- ❌ **No Tool Notifications**: Tools are called internally (not visible)
- ❌ **No Token-Level Streaming**: Streams in larger chunks

### Usage:
```bash
export AWS_AGENT_BACKEND=strands
docker-compose -f docker-compose.dev.yaml up agent-aws-p2p
```

### Example Output:
```
Found 3 EKS clusters in us-west-2:
- prod-cluster
- staging-cluster
- dev-cluster
```

---

## Comparison Table

| Feature | LangGraph (Default) | Strands |
|---------|---------------------|---------|
| **Tool Notifications** | ✅ Yes (`🔧`, `✅`) | ❌ No (internal) |
| **Token Streaming** | ✅ Yes (with `ENABLE_STREAMING=true`) | ⚠️  Chunk-level only |
| **Streaming Control** | ✅ Via `ENABLE_STREAMING` | ❌ Always on (chunks) |
| **Agent Name in Messages** | ✅ Yes | ❌ No |
| **Consistency** | ✅ Matches other agents | ⚠️  Different format |
| **Maturity** | ✨ New | ✅ Well-tested |
| **Dependencies** | LangGraph, LangChain | Strands SDK |

---

## Environment Variables

### AWS Agent Backend Selection
```bash
# Choose the backend implementation
AWS_AGENT_BACKEND=langgraph  # default
# or
AWS_AGENT_BACKEND=strands
```

### Streaming Configuration (LangGraph only)
```bash
# Enable token-by-token streaming
ENABLE_STREAMING=true  # default for AWS agent
```

### MCP Configuration (Both backends)
```bash
# Enable/disable AWS MCP servers
ENABLE_EKS_MCP=true
ENABLE_COST_EXPLORER_MCP=true
ENABLE_IAM_MCP=true
ENABLE_TERRAFORM_MCP=false
ENABLE_AWS_DOCUMENTATION_MCP=false
ENABLE_CLOUDTRAIL_MCP=true
ENABLE_CLOUDWATCH_MCP=true
```

---

## Recommendation

**Use LangGraph backend (default)** for:
- ✅ Consistent user experience across all agents
- ✅ Better visibility into tool execution
- ✅ Finer-grained streaming control
- ✅ Better integration with Backstage plugin

**Use Strands backend** only if:
- You need the original implementation for compatibility
- You're debugging issues with the LangGraph implementation
- You prefer a simpler dependency tree

---

## Implementation Details

The executor automatically selects the backend in `agent_executor.py`:

```python
backend = os.getenv("AWS_AGENT_BACKEND", "langgraph").lower()

if backend == "strands":
    # Use Strands SDK implementation
    from ai_platform_engineering.utils.a2a_common.base_strands_agent_executor import BaseStrandsAgentExecutor
    from agent_aws.agent import AWSAgent
    return BaseStrandsAgentExecutor(AWSAgent())
else:
    # Use LangGraph implementation (default)
    from ai_platform_engineering.utils.a2a_common.base_langgraph_agent_executor import BaseLangGraphAgentExecutor
    from agent_aws.agent_langgraph import AWSAgentLangGraph
    return BaseLangGraphAgentExecutor(AWSAgentLangGraph())
```

---

## Environment Variables

### Core ECS Configuration

```env
# Enable ECS MCP Server (default: false)
ENABLE_ECS_MCP=true

# Security Controls (default: false for both)
ECS_MCP_ALLOW_WRITE=false
ECS_MCP_ALLOW_SENSITIVE_DATA=false
```

### Environment Variable Details

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_ECS_MCP` | `false` | Enable/disable the ECS MCP server |
| `ECS_MCP_ALLOW_WRITE` | `false` | Allow write operations (create/delete infrastructure) |
| `ECS_MCP_ALLOW_SENSITIVE_DATA` | `false` | Allow access to logs and detailed resource information |

## Available Tools

The ECS MCP Server provides the following tool categories:

### Deployment Tools
- **containerize_app**: Generate Dockerfile and container configurations
- **create_ecs_infrastructure**: Create AWS infrastructure for ECS deployments
- **get_deployment_status**: Get deployment status and ALB URLs
- **delete_ecs_infrastructure**: Delete ECS infrastructure

### Troubleshooting Tool
- **ecs_troubleshooting_tool**: Comprehensive troubleshooting with multiple actions:
  - `get_ecs_troubleshooting_guidance`
  - `fetch_cloudformation_status`
  - `fetch_service_events`
  - `fetch_task_failures`
  - `fetch_task_logs`
  - `detect_image_pull_failures`
  - `fetch_network_configuration`

### Resource Management
- **ecs_resource_management**: Execute operations on ECS resources:
  - Read operations (always available): list/describe clusters, services, tasks, task definitions
  - Write operations (requires `ALLOW_WRITE=true`): create, update, delete resources

### AWS Documentation Tools
- **aws_knowledge_aws___search_documentation**: Search AWS documentation
- **aws_knowledge_aws___read_documentation**: Fetch AWS documentation
- **aws_knowledge_aws___recommend**: Get documentation recommendations

## Example Prompts

### Containerization and Deployment
- "Containerize this Node.js app and deploy it to AWS"
- "Deploy this Flask application to Amazon ECS"
- "Create an ECS deployment for this web application with auto-scaling"
- "List all my ECS clusters"

### Troubleshooting
- "Help me troubleshoot my ECS deployment"
- "My ECS tasks keep failing, can you diagnose the issue?"
- "The ALB health check is failing for my ECS service"
- "Why can't I access my deployed application?"

### Resource Management
- "Show me my ECS clusters"
- "List all running tasks in my ECS cluster"
- "Describe my ECS service configuration"
- "Create a new ECS cluster"
- "Update my service configuration"

## Security Considerations

### Default Security Posture

The ECS MCP Server is configured with **secure defaults**:

- ✅ **Write operations disabled** by default (`ALLOW_WRITE=false`)
- ✅ **Sensitive data access disabled** by default (`ALLOW_SENSITIVE_DATA=false`)
- ✅ **Read-only monitoring** safe for production environments
- ⚠️ **Infrastructure changes** require explicit opt-in

### Production Use

#### Read-Only Operations (Safe for Production)
- List operations (clusters, services, tasks) ✅
- Describe operations ✅
- Fetch service events ✅
- Get troubleshooting guidance ✅
- Status checking ✅

#### Write Operations (Use with Caution)
- Creating ECS infrastructure ⚠️
- Deleting ECS infrastructure 🛑
- Updating services/tasks ⚠️
- Running/stopping tasks ⚠️

### Recommended Configuration by Environment

#### Development Environment
```env
ENABLE_ECS_MCP=true
ECS_MCP_ALLOW_WRITE=true
ECS_MCP_ALLOW_SENSITIVE_DATA=true
```

#### Staging Environment
```env
ENABLE_ECS_MCP=true
ECS_MCP_ALLOW_WRITE=true
ECS_MCP_ALLOW_SENSITIVE_DATA=true
```

#### Production Environment (Read-Only Monitoring)
```env
ENABLE_ECS_MCP=true
ECS_MCP_ALLOW_WRITE=false
ECS_MCP_ALLOW_SENSITIVE_DATA=false
```

#### Production Environment (Troubleshooting)
```env
ENABLE_ECS_MCP=true
ECS_MCP_ALLOW_WRITE=false
ECS_MCP_ALLOW_SENSITIVE_DATA=true  # For log access
```

## Files Modified

- `ai_platform_engineering/agents/aws/agent_aws/agent.py`
- `ai_platform_engineering/agents/aws/agent_aws/agent_langgraph.py`
- `ai_platform_engineering/agents/aws/README.md`

## Files Created

- [2025-10-27-aws-ecs-mcp-integration](../016-aws-ecs-mcp-integration/architecture.md) (this file)

## Migration Notes

No migration needed! This feature is:
- ✅ Backward compatible
- ✅ Opt-in via environment variable (`ENABLE_ECS_MCP=false` by default)
- ✅ Non-breaking change
- ✅ Secure by default (write operations disabled)

Existing AWS agent deployments will continue to work without any changes.

## Future Enhancements

Potential improvements:
- Blue-green deployment support
- Advanced monitoring and metrics integration
- Multi-region ECS deployments
- Service mesh integration (App Mesh)
- Container security scanning
- Cost optimization recommendations

## Related

- Spec: [spec.md](./spec.md)
