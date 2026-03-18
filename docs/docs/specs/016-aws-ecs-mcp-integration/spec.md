---
sidebar_position: 2
sidebar_label: Specification
title: "2025-10-27: AWS ECS MCP Server Integration"
---

# AWS ECS MCP Server Integration

**Status**: 🟢 In-use (Part of consolidated AWS integration)
**Category**: Integrations
**Date**: October 27, 2025 (Consolidated into 2025-11-05-aws-integration.md)

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


## Benefits

1. **Comprehensive Container Management**: Full lifecycle management from containerization to deployment
2. **Infrastructure as Code**: Automated CloudFormation template generation
3. **Built-in Troubleshooting**: Diagnostic tools for common ECS issues
4. **Security First**: Default secure configuration with opt-in permissions
5. **ECR Integration**: Direct access to container registries
6. **Load Balancer Support**: Automatic ALB configuration and URL management
7. **Monitoring**: Container Insights and CloudWatch integration
8. **AWS Knowledge Base**: Access to latest ECS documentation and best practices


## Related

- [AWS ECS MCP Server Documentation](https://awslabs.github.io/mcp/servers/ecs-mcp-server)
- [Amazon ECS Documentation](https://docs.aws.amazon.com/ecs/)
- [AWS ECS Best Practices](https://docs.aws.amazon.com/AmazonECS/latest/bestpracticesguide/intro.html)
- [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)


- Architecture: [architecture.md](./architecture.md)
