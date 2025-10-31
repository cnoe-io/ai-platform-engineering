# AWS ECS MCP Server Integration

## Overview

Added support for the [AWS ECS MCP Server](https://awslabs.github.io/mcp/servers/ecs-mcp-server) to the AWS Agent, enabling comprehensive Amazon Elastic Container Service (ECS) management capabilities. This integration allows AI assistants to help users with the full lifecycle of containerized applications on AWS.

## What Changed

### 1. AWS Agent System Prompt Enhancement

**Files**: 
- `ai_platform_engineering/agents/aws/agent_aws/agent.py`
- `ai_platform_engineering/agents/aws/agent_aws/agent_langgraph.py`

Added ECS capabilities to the system prompt, organized into four main categories:

#### ECS Container Management
- Containerize web applications with best practices guidance
- Deploy containerized applications to Amazon ECS using Fargate
- Configure Application Load Balancers (ALBs) for web traffic
- Generate and apply CloudFormation templates for ECS infrastructure
- Manage VPC endpoints for secure AWS service access
- Implement deployment circuit breakers with automatic rollback
- Enable enhanced Container Insights for monitoring

#### ECS Resource Operations
- List and describe ECS clusters, services, and tasks
- Manage task definitions and capacity providers
- View and manage ECR repositories and container images
- Create, update, and delete ECS resources
- Run tasks, start/stop tasks, and execute commands on containers
- Configure auto-scaling policies and health checks

#### ECS Troubleshooting
- Diagnose ECS deployment issues and task failures
- Fetch CloudFormation stack status and service events
- Retrieve CloudWatch logs for application diagnostics
- Detect and resolve image pull failures
- Analyze network configurations (VPC, subnets, security groups)
- Get deployment status and ALB URLs

#### Security & Best Practices
- Implement AWS security best practices for container deployments
- Manage IAM roles with least-privilege permissions
- Configure network security groups and VPC settings
- Access AWS Knowledge for ECS documentation and new features

### 2. MCP Client Configuration

Added ECS MCP client configuration with security controls:

```python
if enable_ecs_mcp:
    logger.info("Creating ECS MCP client...")
    ecs_env = env_vars.copy()
    
    # Security controls (default to safe values)
    allow_write = os.getenv("ECS_MCP_ALLOW_WRITE", "false").lower() == "true"
    allow_sensitive_data = os.getenv("ECS_MCP_ALLOW_SENSITIVE_DATA", "false").lower() == "true"
    
    ecs_env["ALLOW_WRITE"] = "true" if allow_write else "false"
    ecs_env["ALLOW_SENSITIVE_DATA"] = "true" if allow_sensitive_data else "false"
    
    ecs_client = MCPClient(lambda: stdio_client(
        StdioServerParameters(
            command="uvx",
            args=["awslabs.ecs-mcp-server@latest"],
            env=ecs_env
        )
    ))
    clients.append(("ecs", ecs_client))
```

### 3. Documentation Updates

**File**: `ai_platform_engineering/agents/aws/README.md`

- Updated agent title from "AWS EKS AI Agent" to "AWS AI Agent" to reflect multi-service support
- Added ECS Management feature description
- Added ECS environment variable configuration
- Added security notes for ECS write operations and sensitive data access

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

## Benefits

1. **Comprehensive Container Management**: Full lifecycle management from containerization to deployment
2. **Infrastructure as Code**: Automated CloudFormation template generation
3. **Built-in Troubleshooting**: Diagnostic tools for common ECS issues
4. **Security First**: Default secure configuration with opt-in permissions
5. **ECR Integration**: Direct access to container registries
6. **Load Balancer Support**: Automatic ALB configuration and URL management
7. **Monitoring**: Container Insights and CloudWatch integration
8. **AWS Knowledge Base**: Access to latest ECS documentation and best practices

## Files Modified

- `ai_platform_engineering/agents/aws/agent_aws/agent.py`
- `ai_platform_engineering/agents/aws/agent_aws/agent_langgraph.py`
- `ai_platform_engineering/agents/aws/README.md`

## Files Created

- `docs/docs/changes/2025-10-27-aws-ecs-mcp-integration.md` (this file)

## Migration Notes

No migration needed! This feature is:
- ✅ Backward compatible
- ✅ Opt-in via environment variable (`ENABLE_ECS_MCP=false` by default)
- ✅ Non-breaking change
- ✅ Secure by default (write operations disabled)

Existing AWS agent deployments will continue to work without any changes.

## References

- [AWS ECS MCP Server Documentation](https://awslabs.github.io/mcp/servers/ecs-mcp-server)
- [Amazon ECS Documentation](https://docs.aws.amazon.com/ecs/)
- [AWS ECS Best Practices](https://docs.aws.amazon.com/AmazonECS/latest/bestpracticesguide/intro.html)
- [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)

## Future Enhancements

Potential improvements:
- Blue-green deployment support
- Advanced monitoring and metrics integration
- Multi-region ECS deployments
- Service mesh integration (App Mesh)
- Container security scanning
- Cost optimization recommendations

