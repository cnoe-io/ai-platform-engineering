# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""LangGraph-based AWS Agent with MCP support for tool notifications and token streaming."""

import logging
import os
from typing import Dict, Any

from pydantic import BaseModel, Field

from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import BaseLangGraphAgent

logger = logging.getLogger(__name__)


class AWSAgentResponse(BaseModel):
    """Response format for AWS agent."""
    
    answer: str = Field(
        description="The main response to the user's query about AWS resources and operations"
    )
    
    action_taken: str | None = Field(
        default=None,
        description="Description of any actions taken (e.g., 'Listed EKS clusters', 'Analyzed costs')"
    )
    
    resources_accessed: list[str] | None = Field(
        default=None,
        description="List of AWS resources or services accessed during the operation"
    )


class AWSAgentLangGraph(BaseLangGraphAgent):
    """
    LangGraph-based AWS Agent with full MCP support.
    
    Provides comprehensive AWS management across:
    - EKS & Kubernetes
    - Cost Management & FinOps
    - Infrastructure as Code (Terraform, CDK, CloudFormation)
    - Monitoring & Observability (CloudWatch, CloudTrail)
    - IAM & Security
    - Support & Documentation
    """

    def get_agent_name(self) -> str:
        """Return the agent's name."""
        return "aws"

    def get_system_instruction(self) -> str:
        """Return the system prompt for the AWS agent."""
        # Check which capabilities are enabled
        enable_eks_mcp = os.getenv("ENABLE_EKS_MCP", "true").lower() == "true"
        enable_cost_explorer_mcp = os.getenv("ENABLE_COST_EXPLORER_MCP", "false").lower() == "true"
        enable_iam_mcp = os.getenv("ENABLE_IAM_MCP", "false").lower() == "true"
        enable_terraform_mcp = os.getenv("ENABLE_TERRAFORM_MCP", "false").lower() == "true"
        enable_aws_documentation_mcp = os.getenv("ENABLE_AWS_DOCUMENTATION_MCP", "false").lower() == "true"
        enable_cloudtrail_mcp = os.getenv("ENABLE_CLOUDTRAIL_MCP", "false").lower() == "true"
        enable_cloudwatch_mcp = os.getenv("ENABLE_CLOUDWATCH_MCP", "false").lower() == "true"

        system_prompt_parts = [
            "You are an AWS AI Assistant specialized in comprehensive AWS management. "
            "You can help users with:"
        ]

        if enable_eks_mcp:
            system_prompt_parts.append(
                "\n\n**EKS & Kubernetes Management:**\n"
                "- List all EKS clusters in the configured region (use tools without cluster_name parameter)\n"
                "- Create, describe, and delete specific EKS clusters\n"
                "- Manage Kubernetes resources (deployments, services, pods)\n"
                "- Deploy containerized applications\n"
                "- Retrieve logs and monitor cluster health\n"
                "- When listing clusters, DO NOT pass a cluster name parameter - list all clusters first"
            )

        if enable_cost_explorer_mcp:
            from datetime import datetime
            current_month_start = datetime.now().replace(day=1).strftime('%Y-%m-%d')
            current_date = datetime.now().strftime('%Y-%m-%d')
            
            system_prompt_parts.append(
                "\n\n**Cost Management & FinOps:**\n"
                "- Analyze AWS spending and costs\n"
                "- Create cost forecasts and budgets\n"
                "- Identify cost optimization opportunities\n"
                "- Generate cost reports and breakdowns\n\n"
                f"**Default Cost Query Settings:**\n"
                f"- Use date range: Start={current_month_start}, End={current_date} (current month)\n"
                "- AWS Cost Explorer only allows queries within the past 14 months\n"
                "- For dimension queries, end date MUST be the first day of a month if querying beyond 14 months\n"
                "- Always use recent dates (current or previous month) unless user specifies otherwise\n\n"
                "**Cost Query Strategies:**\n"
                "- When user asks for cost of a specific resource name (e.g., 'comn-dev-use2-1', 'my-cluster'):\n"
                "  * First try filtering by Tags (use tag keys like 'Name', 'kubernetes.io/cluster/*', 'aws:eks:cluster-name')\n"
                "  * Or group by SERVICE and filter by resource-specific tags\n"
                "  * Do NOT treat resource names as SERVICE names\n"
                "- Common AWS services: EC2, S3, RDS, EKS, Lambda, VPC, CloudWatch\n"
                "- Resource names are NOT service names - they are tag values or resource identifiers"
            )

        if enable_iam_mcp:
            system_prompt_parts.append(
                "\n\n**IAM & Security:**\n"
                "- Manage IAM users, roles, and policies\n"
                "- Review and audit security configurations\n"
                "- Implement least-privilege access controls"
            )

        if enable_terraform_mcp:
            system_prompt_parts.append(
                "\n\n**Infrastructure as Code (Terraform):**\n"
                "- Generate and manage Terraform configurations\n"
                "- Plan and apply infrastructure changes\n"
                "- Manage state and workspaces"
            )

        if enable_aws_documentation_mcp:
            system_prompt_parts.append(
                "\n\n**AWS Documentation & Knowledge:**\n"
                "- Search AWS documentation\n"
                "- Provide best practices and guidance\n"
                "- Answer AWS service-related questions"
            )

        if enable_cloudtrail_mcp:
            system_prompt_parts.append(
                "\n\n**Audit & Compliance (CloudTrail):**\n"
                "- Query CloudTrail logs for activity history\n"
                "- Track resource changes and access patterns\n"
                "- Generate audit reports"
            )

        if enable_cloudwatch_mcp:
            system_prompt_parts.append(
                "\n\n**Monitoring & Observability (CloudWatch):**\n"
                "- Query logs and metrics\n"
                "- Create and manage alarms\n"
                "- Analyze application and infrastructure performance"
            )

        # Get the configured AWS region
        aws_region = os.getenv("AWS_REGION", os.getenv("AWS_DEFAULT_REGION", "us-west-2"))
        
        system_prompt_parts.append(
            f"\n\n**AWS Configuration:**\n"
            f"- Current AWS Region: {aws_region}\n"
            f"- All AWS operations will be performed in this region unless explicitly specified otherwise\n"
            f"- When users mention a region name (like 'us-east-2', 'us-west-2'), understand it as context about the current region, not as a resource name"
        )
        
        system_prompt_parts.append(
            "\n\n**Important Guidelines:**\n"
            "- Always verify AWS region and account context\n"
            "- Provide clear explanations of actions taken\n"
            "- Warn users about potentially destructive operations\n"
            "- Follow AWS best practices and security principles\n"
            "- Be concise but informative in your responses"
        )

        return "".join(system_prompt_parts)

    def get_response_format_instruction(self) -> str:
        """Return the instruction for response format."""
        return (
            "Provide clear and actionable responses about AWS resources and operations. "
            "Include the main answer, any actions taken, and resources accessed."
        )

    def get_response_format_class(self) -> type[BaseModel]:
        """Return the Pydantic response format model."""
        return AWSAgentResponse

    def get_mcp_config(self, server_path: str) -> Dict[str, Any]:
        """
        Override to provide AWS-specific MCP configuration.
        
        AWS uses multiple published MCP servers via uvx, not local scripts.
        This method builds the configuration for MultiServerMCPClient.
        """
        # Check which AWS MCP servers are enabled
        enable_eks_mcp = os.getenv("ENABLE_EKS_MCP", "true").lower() == "true"
        enable_ecs_mcp = os.getenv("ENABLE_ECS_MCP", "false").lower() == "true"
        enable_cost_explorer_mcp = os.getenv("ENABLE_COST_EXPLORER_MCP", "true").lower() == "true"
        enable_iam_mcp = os.getenv("ENABLE_IAM_MCP", "true").lower() == "true"
        enable_cloudtrail_mcp = os.getenv("ENABLE_CLOUDTRAIL_MCP", "true").lower() == "true"
        enable_cloudwatch_mcp = os.getenv("ENABLE_CLOUDWATCH_MCP", "true").lower() == "true"
        enable_aws_knowledge_mcp = os.getenv("ENABLE_AWS_KNOWLEDGE_MCP", "false").lower() == "true"
        
        import logging
        logger = logging.getLogger(__name__)
        logger.info(f"🔍 MCP Enable Flags: EKS={enable_eks_mcp}, ECS={enable_ecs_mcp}, Cost={enable_cost_explorer_mcp}, IAM={enable_iam_mcp}, CloudTrail={enable_cloudtrail_mcp}, CloudWatch={enable_cloudwatch_mcp}, Knowledge={enable_aws_knowledge_mcp}")
        
        # Build environment variables for AWS
        env_vars = {
            "AWS_REGION": os.getenv("AWS_REGION", os.getenv("AWS_DEFAULT_REGION", "us-west-2")),
            "FASTMCP_LOG_LEVEL": os.getenv("FASTMCP_LOG_LEVEL", "ERROR"),
        }
        
        # Pass through AWS auth env vars if set
        for env_var in ["AWS_PROFILE", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"]:
            if os.getenv(env_var):
                env_vars[env_var] = os.getenv(env_var)
        
        mcp_servers = {}
        
        # Add EKS MCP server
        if enable_eks_mcp:
            mcp_servers["eks"] = {
                "command": "uvx",
                "args": ["awslabs.eks-mcp-server@0.1.15", "--allow-write", "--no-allow-sensitive-data-access"],
                "env": env_vars,
                "transport": "stdio",
            }
        
        # Add ECS MCP server
        if enable_ecs_mcp:
            ecs_env = env_vars.copy()
            
            # Security controls for ECS MCP (default to safe values)
            allow_write = os.getenv("ECS_MCP_ALLOW_WRITE", "false").lower() == "true"
            allow_sensitive_data = os.getenv("ECS_MCP_ALLOW_SENSITIVE_DATA", "false").lower() == "true"
            
            ecs_env["ALLOW_WRITE"] = "true" if allow_write else "false"
            ecs_env["ALLOW_SENSITIVE_DATA"] = "true" if allow_sensitive_data else "false"
            
            mcp_servers["ecs"] = {
                "command": "uvx",
                "args": ["--from", "awslabs.ecs-mcp-server@latest", "ecs-mcp-server"],
                "env": ecs_env,
                "transport": "stdio",
            }
        
        # Add Cost Explorer MCP server
        if enable_cost_explorer_mcp:
            mcp_servers["cost-explorer"] = {
                "command": "uvx",
                "args": ["awslabs.cost-explorer-mcp-server@latest"],
                "env": env_vars,
                "transport": "stdio",
            }
        
        # Add IAM MCP server
        if enable_iam_mcp:
            iam_readonly = os.getenv("IAM_MCP_READONLY", "true").lower() == "true"
            iam_args = ["awslabs.iam-mcp-server@latest"]
            if iam_readonly:
                iam_args.append("--readonly")
            
            mcp_servers["iam"] = {
                "command": "uvx",
                "args": iam_args,
                "env": env_vars,
                "transport": "stdio",
            }
        
        # Add CloudTrail MCP server
        if enable_cloudtrail_mcp:
            mcp_servers["cloudtrail"] = {
                "command": "uvx",
                "args": ["awslabs.cloudtrail-mcp-server@latest"],
                "env": env_vars,
                "transport": "stdio",
            }
        
        # Add CloudWatch MCP server
        if enable_cloudwatch_mcp:
            mcp_servers["cloudwatch"] = {
                "command": "uvx",
                "args": ["awslabs.cloudwatch-mcp-server@latest"],
                "env": env_vars,
                "transport": "stdio",
            }
        
        # Add AWS Knowledge MCP server
        if enable_aws_knowledge_mcp:
            mcp_servers["aws-knowledge"] = {
                "url": "https://knowledge-mcp.global.api.aws",
                "type": "http"
            }
        
        # Return configuration for all enabled servers
        # Note: This returns a dict of server configs, not a single server config
        import logging
        logger = logging.getLogger(__name__)
        logger.info(f"🔍 AWS Agent MCP servers configured: {list(mcp_servers.keys())}")
        return mcp_servers

    def get_tool_working_message(self) -> str:
        """Return message shown when calling AWS tools."""
        return "Looking up AWS Resources..."

    def get_tool_processing_message(self) -> str:
        """Return message shown when processing tool results."""
        return "Processing AWS data..."
    
    async def _ensure_graph_initialized(self, config: Any) -> None:
        """
        Override to skip the complex test query that times out with many AWS tools.
        
        AWS has many MCP servers with dozens of tools, making the default
        "Summarize what you can do?" query too slow (causes LLM to try using tools).
        """
        if self.graph is not None:
            return

        # Just setup MCP and graph without the slow test query
        await self._setup_mcp_without_test(config)
    
    async def _setup_mcp_without_test(self, config: Any) -> None:
        """Setup MCP clients and graph without running a test query."""
        import logging
        from langgraph.prebuilt import create_react_agent
        from langchain_mcp_adapters.client import MultiServerMCPClient
        
        logger = logging.getLogger(__name__)
        
        agent_name = self.get_agent_name()
        
        # Setup MCP client with STDIO transport
        logger.info(f"{agent_name}: Using STDIO transport for MCP client")
        mcp_config = self.get_mcp_config("")
        
        if mcp_config and "command" not in mcp_config:
            logger.info(f"{agent_name}: Multi-server MCP configuration detected with {len(mcp_config)} servers")
            client = MultiServerMCPClient(mcp_config)
        else:
            client = MultiServerMCPClient({agent_name: mcp_config})

        # Get tools from MCP client
        all_tools = await client.get_tools()
        logger.info(f"✅ {agent_name}: Loaded {len(all_tools)} tools from MCP servers")
        
        # Filter out tools with invalid schemas (OpenAI requires 'properties' for object types)
        valid_tools = []
        invalid_tools = []
        for tool in all_tools:
            args_schema = tool.args_schema or {}
            # Check if schema has object type without properties
            if args_schema.get('type') == 'object' and not args_schema.get('properties'):
                logger.warning(f"⚠️  Skipping tool '{tool.name}' - invalid schema: object type without properties")
                invalid_tools.append(tool.name)
                continue
            # Check nested properties for invalid schemas
            properties = args_schema.get('properties', {})
            has_invalid_nested = False
            for prop_name, prop_schema in properties.items():
                if isinstance(prop_schema, dict) and prop_schema.get('type') == 'object' and not prop_schema.get('properties'):
                    logger.warning(f"⚠️  Skipping tool '{tool.name}' - invalid nested schema in property '{prop_name}'")
                    invalid_tools.append(tool.name)
                    has_invalid_nested = True
                    break
            if has_invalid_nested:
                continue
            valid_tools.append(tool)
        
        tools = valid_tools
        if invalid_tools:
            logger.warning(f"🚫 Filtered out {len(invalid_tools)} tools with invalid schemas: {invalid_tools}")
        logger.info(f"✅ {agent_name}: Using {len(tools)} valid tools")

        # Store tool info for later reference
        for tool in tools:
            self.tools_info[tool.name] = {
                'description': tool.description.strip(),
                'parameters': tool.args_schema.get('properties', {}),
                'required': tool.args_schema.get('required', [])
            }

        # Create the agent graph (self.model is already initialized in __init__)
        self.graph = create_react_agent(
            self.model,
            tools=tools,
            prompt=self.get_system_instruction(),
            response_format=(
                self.get_response_format_instruction(),
                self.get_response_format_class()
            ),
        )
        
        logger.info(f"✅ {agent_name}: Graph initialized successfully (skipped slow test query)")

