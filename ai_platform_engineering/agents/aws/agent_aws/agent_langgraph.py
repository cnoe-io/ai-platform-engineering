# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""LangGraph-based AWS Agent with MCP support for tool notifications and token streaming."""

import logging
import os
import yaml
from typing import Dict, Any

from pydantic import BaseModel, Field

from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import BaseLangGraphAgent

logger = logging.getLogger(__name__)


def _load_aws_prompt_config(path="prompt_config.aws_agent.yaml") -> Dict[str, Any]:
    """Load AWS agent prompt configuration from YAML file."""
    if os.path.exists(path):
        with open(path, "r") as f:
            return yaml.safe_load(f) or {}
    return {}

# Load config at module level
_aws_prompt_config = _load_aws_prompt_config()


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
        """Return the system prompt for the AWS agent, built from YAML config."""
        config = _aws_prompt_config

        # Start with base prompt
        base_prompt = config.get("base_prompt",
            "You are an AWS AI Assistant specialized in comprehensive AWS management. You can help users with:")
        system_prompt_parts = [base_prompt]

        # Get MCP capabilities from config
        mcp_capabilities = config.get("mcp_capabilities", {})

        # Check each MCP capability and append if enabled
        # Env var is automatically constructed as ENABLE_{KEY}_MCP
        for mcp_name, mcp_config in mcp_capabilities.items():
            env_var = f"ENABLE_{mcp_name.upper()}_MCP"
            default = mcp_config.get("default", "false")
            is_enabled = os.getenv(env_var, default).lower() == "true"

            if is_enabled:
                prompt = mcp_config.get("prompt", "")
                if prompt:
                    system_prompt_parts.append("\n\n" + prompt.strip())

                # Special handling for cost_explorer - append dynamic date settings
                if mcp_name == "cost_explorer":
                    from datetime import datetime
                    current_month_start = datetime.now().replace(day=1).strftime('%Y-%m-%d')
                    current_date = datetime.now().strftime('%Y-%m-%d')

                    cost_settings = config.get("cost_query_settings", "")
                    if cost_settings:
                        cost_settings = cost_settings.format(
                            current_month_start=current_month_start,
                            current_date=current_date
                        )
                        system_prompt_parts.append("\n\n" + cost_settings.strip())

        # Add AWS configuration with runtime region
        aws_region = os.getenv("AWS_REGION", os.getenv("AWS_DEFAULT_REGION", "us-west-2"))
        aws_config_template = config.get("aws_config_template",
            "**AWS Configuration:**\n- Current AWS Region: {aws_region}")
        system_prompt_parts.append("\n\n" + aws_config_template.format(aws_region=aws_region).strip())

        # Add important guidelines
        important_guidelines = config.get("important_guidelines",
            "**Important Guidelines:**\n"
            "- Always verify AWS region and account context\n"
            "- Provide clear explanations of actions taken\n"
            "- Warn users about potentially destructive operations\n"
            "- Follow AWS best practices and security principles\n"
            "- Be concise but informative in your responses")
        system_prompt_parts.append("\n\n" + important_guidelines.strip())

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
        return _aws_prompt_config.get("tool_working_message", "Looking up AWS Resources...")

    def get_tool_processing_message(self) -> str:
        """Return message shown when processing tool results."""
        return _aws_prompt_config.get("tool_processing_message", "Processing AWS data...")

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

