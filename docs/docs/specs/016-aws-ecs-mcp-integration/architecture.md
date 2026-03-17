---
sidebar_position: 1
id: 016-aws-ecs-mcp-integration-architecture
sidebar_label: Architecture
---

# Architecture: AWS ECS MCP Server Integration

**Date**: 2025-10-27

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
