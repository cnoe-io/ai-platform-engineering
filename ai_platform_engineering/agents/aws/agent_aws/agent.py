# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import logging
import os
from typing import Optional, Dict, Any, List, Tuple

from mcp import stdio_client, StdioServerParameters
from strands import Agent
from strands.models import BedrockModel
from strands.tools.mcp import MCPClient
from dotenv import load_dotenv

from .models import AgentConfig, ResponseMetadata
from .state import ConversationState

# Load environment variables
load_dotenv()

# Configure logging
logger = logging.getLogger(__name__)


class AWSAgent:
    """AWS Agent using Strands SDK with multi-MCP server support."""

    def __init__(self, config: Optional[AgentConfig] = None):
        """Initialize the AWS Agent with multi-MCP support.

        Args:
            config: Optional agent configuration. If not provided, uses environment variables.
        """
        self.config = config or AgentConfig.from_env()
        self.state = ConversationState()
        self._agent = None
        # Support multiple MCP servers
        self._mcp_clients = []  # type: List[MCPClient]
        self._mcp_contexts = []  # type: List[Any]
        self._tools = []  # type: List[Any]

        # Set up logging
        log_level = self.config.log_level
        logging.getLogger("strands").setLevel(getattr(logging, log_level, logging.INFO))
        config_str = f"model_provider={self.config.model_provider}, model_name={self.config.model_name}"
        logger.info(f"Initialized AWS Agent with config: {config_str}")

        # Initialize MCP clients and agent on first use
        self._initialize_mcp_and_agent()

    def _create_mcp_clients(self) -> List[Tuple[str, MCPClient]]:
        """Create and configure MCP clients based on enabled features.

        Returns:
            List of tuples containing (name, MCPClient)
        """
        import platform

        enable_eks_mcp = os.getenv("ENABLE_EKS_MCP", "true").lower() == "true"
        enable_cost_explorer_mcp = os.getenv("ENABLE_COST_EXPLORER_MCP", "true").lower() == "true"
        enable_iam_mcp = os.getenv("ENABLE_IAM_MCP", "true").lower() == "true"
        enable_terraform_mcp = os.getenv("ENABLE_TERRAFORM_MCP", "false").lower() == "true"
        enable_aws_documentation_mcp = os.getenv("ENABLE_AWS_DOCUMENTATION_MCP", "false").lower() == "true"
        enable_cloudtrail_mcp = os.getenv("ENABLE_CLOUDTRAIL_MCP", "false").lower() == "true"
        enable_cloudwatch_mcp = os.getenv("ENABLE_CLOUDWATCH_MCP", "false").lower() == "true"
        enable_postgres_mcp = os.getenv("ENABLE_POSTGRES_MCP", "false").lower() == "true"
        enable_aws_support_mcp = os.getenv("ENABLE_AWS_SUPPORT_MCP", "false").lower() == "true"
        enable_cdk_mcp = os.getenv("ENABLE_CDK_MCP", "false").lower() == "true"
        enable_aws_knowledge_mcp = os.getenv("ENABLE_AWS_KNOWLEDGE_MCP", "false").lower() == "true"

        logger.info(f"MCP Configuration - EKS: {enable_eks_mcp}, Cost Explorer: {enable_cost_explorer_mcp}, IAM: {enable_iam_mcp}, Terraform: {enable_terraform_mcp}, AWS Docs: {enable_aws_documentation_mcp}, CloudTrail: {enable_cloudtrail_mcp}, CloudWatch: {enable_cloudwatch_mcp}, Postgres: {enable_postgres_mcp}, AWS Support: {enable_aws_support_mcp}, CDK: {enable_cdk_mcp}, AWS Knowledge: {enable_aws_knowledge_mcp}")
        logger.info(f"Environment Variables - ENABLE_EKS_MCP: {os.getenv('ENABLE_EKS_MCP')}, ENABLE_COST_EXPLORER_MCP: {os.getenv('ENABLE_COST_EXPLORER_MCP')}, ENABLE_IAM_MCP: {os.getenv('ENABLE_IAM_MCP')}")

        env_vars = {
            "AWS_REGION": os.getenv("AWS_REGION", os.getenv("AWS_DEFAULT_REGION", "us-west-2")),
            "FASTMCP_LOG_LEVEL": os.getenv("FASTMCP_LOG_LEVEL", "ERROR"),
        }

        # Pass through relevant AWS auth env vars if set
        for env_var in ["AWS_PROFILE", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"]:
            if os.getenv(env_var):
                env_vars[env_var] = os.getenv(env_var)

        system = platform.system().lower()
        clients: List[Tuple[str, MCPClient]] = []

        if enable_eks_mcp:
            logger.info("Creating EKS MCP client...")
            if system == "windows":
                eks_command_args = [
                    "--from", "awslabs.eks-mcp-server@latest",
                    "awslabs.eks-mcp-server.exe",
                    "--allow-write", "--allow-sensitive-data-access"
                ]
            else:
                eks_command_args = [
                    "awslabs.eks-mcp-server@latest",
                    "--allow-write", "--allow-sensitive-data-access"
                ]
            eks_client = MCPClient(lambda: stdio_client(
                StdioServerParameters(
                    command="uvx",
                    args=eks_command_args,
                    env=env_vars
                )
            ))
            clients.append(("eks", eks_client))

        if enable_cost_explorer_mcp:
            logger.info("Creating Cost Explorer MCP client...")
            # Correct package/command name per official docs
            if system == "windows":
                cost_command_args = [
                    "--from", "awslabs.cost-explorer-mcp-server@latest",
                    "awslabs.cost-explorer-mcp-server.exe"
                ]
            else:
                cost_command_args = [
                    "awslabs.cost-explorer-mcp-server@latest"
                ]
            cost_client = MCPClient(lambda: stdio_client(
                StdioServerParameters(
                    command="uvx",
                    args=cost_command_args,
                    env=env_vars
                )
            ))
            clients.append(("cost-explorer", cost_client))

        if enable_iam_mcp:
            logger.info("Creating IAM MCP client...")
            iam_readonly = os.getenv("IAM_MCP_READONLY", "true").lower() == "true"

            if system == "windows":
                iam_command_args = [
                    "--from", "awslabs.iam-mcp-server@latest",
                    "awslabs.iam-mcp-server.exe"
                ]
                if iam_readonly:
                    iam_command_args.append("--readonly")
            else:
                iam_command_args = [
                    "awslabs.iam-mcp-server@latest"
                ]
                if iam_readonly:
                    iam_command_args.append("--readonly")

            logger.info(f"IAM MCP readonly mode: {iam_readonly}")
            iam_client = MCPClient(lambda: stdio_client(
                StdioServerParameters(
                    command="uvx",
                    args=iam_command_args,
                    env=env_vars
                )
            ))
            clients.append(("iam", iam_client))

        if enable_terraform_mcp:
            logger.info("Creating Terraform MCP client...")
            if system == "windows":
                terraform_command_args = [
                    "--from", "awslabs.terraform-mcp-server@latest",
                    "awslabs.terraform-mcp-server.exe"
                ]
            else:
                terraform_command_args = [
                    "awslabs.terraform-mcp-server@latest"
                ]
            terraform_client = MCPClient(lambda: stdio_client(
                StdioServerParameters(
                    command="uvx",
                    args=terraform_command_args,
                    env=env_vars
                )
            ))
            clients.append(("terraform", terraform_client))

        if enable_aws_documentation_mcp:
            logger.info("Creating AWS Documentation MCP client...")
            # Add AWS_DOCUMENTATION_PARTITION for documentation server
            docs_env = env_vars.copy()
            docs_env["AWS_DOCUMENTATION_PARTITION"] = os.getenv("AWS_DOCUMENTATION_PARTITION", "aws")

            if system == "windows":
                docs_command_args = [
                    "--from", "awslabs.aws-documentation-mcp-server@latest",
                    "awslabs.aws-documentation-mcp-server.exe"
                ]
            else:
                docs_command_args = [
                    "awslabs.aws-documentation-mcp-server@latest"
                ]
            docs_client = MCPClient(lambda: stdio_client(
                StdioServerParameters(
                    command="uvx",
                    args=docs_command_args,
                    env=docs_env
                )
            ))
            clients.append(("aws-documentation", docs_client))

        if enable_cloudtrail_mcp:
            logger.info("Creating CloudTrail MCP client...")
            if system == "windows":
                cloudtrail_command_args = [
                    "--from", "awslabs.cloudtrail-mcp-server@latest",
                    "awslabs.cloudtrail-mcp-server.exe"
                ]
            else:
                cloudtrail_command_args = [
                    "awslabs.cloudtrail-mcp-server@latest"
                ]
            cloudtrail_client = MCPClient(lambda: stdio_client(
                StdioServerParameters(
                    command="uvx",
                    args=cloudtrail_command_args,
                    env=env_vars
                )
            ))
            clients.append(("cloudtrail", cloudtrail_client))

        if enable_cloudwatch_mcp:
            logger.info("Creating CloudWatch MCP client...")
            if system == "windows":
                cloudwatch_command_args = [
                    "--from", "awslabs.cloudwatch-mcp-server@latest",
                    "awslabs.cloudwatch-mcp-server.exe"
                ]
            else:
                cloudwatch_command_args = [
                    "awslabs.cloudwatch-mcp-server@latest"
                ]
            cloudwatch_client = MCPClient(lambda: stdio_client(
                StdioServerParameters(
                    command="uvx",
                    args=cloudwatch_command_args,
                    env=env_vars
                )
            ))
            clients.append(("cloudwatch", cloudwatch_client))

        if enable_postgres_mcp:
            logger.info("Creating Postgres MCP client...")
            # Postgres MCP requires additional configuration for database connection
            postgres_env = env_vars.copy()

            # Add optional Postgres-specific configuration if provided
            if os.getenv("POSTGRES_RESOURCE_ARN"):
                postgres_env["POSTGRES_RESOURCE_ARN"] = os.getenv("POSTGRES_RESOURCE_ARN")
            if os.getenv("POSTGRES_SECRET_ARN"):
                postgres_env["POSTGRES_SECRET_ARN"] = os.getenv("POSTGRES_SECRET_ARN")
            if os.getenv("POSTGRES_DATABASE"):
                postgres_env["POSTGRES_DATABASE"] = os.getenv("POSTGRES_DATABASE")
            if os.getenv("POSTGRES_HOSTNAME"):
                postgres_env["POSTGRES_HOSTNAME"] = os.getenv("POSTGRES_HOSTNAME")

            if system == "windows":
                postgres_command_args = [
                    "--from", "awslabs.postgres-mcp-server@latest",
                    "awslabs.postgres-mcp-server.exe"
                ]
            else:
                postgres_command_args = [
                    "awslabs.postgres-mcp-server@latest"
                ]
            postgres_client = MCPClient(lambda: stdio_client(
                StdioServerParameters(
                    command="uvx",
                    args=postgres_command_args,
                    env=postgres_env
                )
            ))
            clients.append(("postgres", postgres_client))

        if enable_aws_support_mcp:
            logger.info("Creating AWS Support MCP client...")
            if system == "windows":
                support_command_args = [
                    "--from", "awslabs.aws-support-mcp-server@latest",
                    "awslabs.aws-support-mcp-server.exe"
                ]
            else:
                support_command_args = [
                    "awslabs.aws-support-mcp-server@latest"
                ]
            support_client = MCPClient(lambda: stdio_client(
                StdioServerParameters(
                    command="uvx",
                    args=support_command_args,
                    env=env_vars
                )
            ))
            clients.append(("aws-support", support_client))

        if enable_cdk_mcp:
            logger.info("Creating CDK MCP client...")
            if system == "windows":
                cdk_command_args = [
                    "--from", "awslabs.cdk-mcp-server@latest",
                    "awslabs.cdk-mcp-server.exe"
                ]
            else:
                cdk_command_args = [
                    "awslabs.cdk-mcp-server@latest"
                ]
            cdk_client = MCPClient(lambda: stdio_client(
                StdioServerParameters(
                    command="uvx",
                    args=cdk_command_args,
                    env=env_vars
                )
            ))
            clients.append(("cdk", cdk_client))

        if enable_aws_knowledge_mcp:
            logger.info("Creating AWS Knowledge MCP client...")
            if system == "windows":
                knowledge_command_args = [
                    "--from", "awslabs.aws-knowledge-mcp-server@latest",
                    "awslabs.aws-knowledge-mcp-server.exe"
                ]
            else:
                knowledge_command_args = [
                    "awslabs.aws-knowledge-mcp-server@latest"
                ]
            knowledge_client = MCPClient(lambda: stdio_client(
                StdioServerParameters(
                    command="uvx",
                    args=knowledge_command_args,
                    env=env_vars
                )
            ))
            clients.append(("aws-knowledge", knowledge_client))

        if not clients:
            raise ValueError("No MCP servers enabled. Set ENABLE_EKS_MCP, ENABLE_COST_EXPLORER_MCP, and/or ENABLE_IAM_MCP to true.")

        logger.info(f"Prepared {len(clients)} MCP client definitions: {[name for name, _ in clients]}")
        return clients

    def _initialize_mcp_and_agent(self):
        """Initialize MCP client and agent once during startup."""
        try:
            logger.info("Initializing MCP clients and starting AWS MCP servers...")

            # Create MCP clients (possibly multiple)
            mcp_clients_with_names = self._create_mcp_clients()
            self._mcp_clients = [client for _, client in mcp_clients_with_names]

            # Enter each MCP client context and aggregate tools
            aggregated_tools = []
            for name, client in mcp_clients_with_names:
                ctx = client.__enter__()
                self._mcp_contexts.append(ctx)
                tools = client.list_tools_sync()
                logger.info(f"Retrieved {len(tools)} tools from MCP server '{name}'")
                aggregated_tools.extend(tools)

            # Deduplicate tools by name (last wins if duplicate)
            dedup = {}
            for t in aggregated_tools:
                tool_name = getattr(t, 'name', None) or getattr(t, 'tool_name', None)
                if tool_name:
                    dedup[tool_name] = t
                else:
                    # Fallback: append if name not resolvable
                    dedup[id(t)] = t
            self._tools = list(dedup.values())
            logger.info(f"Total aggregated tools: {len(self._tools)} (from {len(self._mcp_clients)} MCP servers)")

            # Create unified agent with all tools
            self._agent = self._create_agent(self._tools)
            logger.info("All MCP servers started and agent initialized successfully")

        except Exception as e:
            logger.error(f"Failed to initialize MCP servers and agent: {e}")
            self._cleanup_mcp()
            raise

    def _cleanup_mcp(self):
        """Clean up MCP client resources."""
        if self._mcp_contexts:
            for idx, client in enumerate(self._mcp_clients):
                try:
                    client.__exit__(None, None, None)
                    logger.info(f"MCP client {idx+1}/{len(self._mcp_clients)} cleaned up")
                except Exception as e:
                    logger.warning(f"Error cleaning up MCP client {idx+1}: {e}")
            self._mcp_contexts.clear()
            self._mcp_clients.clear()
            self._agent = None
            self._tools = []

    def _create_agent(self, tools: list) -> Agent:
        """Create the Strands agent with AWS tools."""
        # Check which capabilities are enabled
        enable_eks_mcp = os.getenv("ENABLE_EKS_MCP", "true").lower() == "true"
        enable_cost_explorer_mcp = os.getenv("ENABLE_COST_EXPLORER_MCP", "false").lower() == "true"
        enable_terraform_mcp = os.getenv("ENABLE_TERRAFORM_MCP", "false").lower() == "true"
        enable_aws_documentation_mcp = os.getenv("ENABLE_AWS_DOCUMENTATION_MCP", "false").lower() == "true"
        enable_cloudtrail_mcp = os.getenv("ENABLE_CLOUDTRAIL_MCP", "false").lower() == "true"
        enable_cloudwatch_mcp = os.getenv("ENABLE_CLOUDWATCH_MCP", "false").lower() == "true"
        enable_postgres_mcp = os.getenv("ENABLE_POSTGRES_MCP", "false").lower() == "true"
        enable_aws_support_mcp = os.getenv("ENABLE_AWS_SUPPORT_MCP", "false").lower() == "true"
        enable_cdk_mcp = os.getenv("ENABLE_CDK_MCP", "false").lower() == "true"
        enable_aws_knowledge_mcp = os.getenv("ENABLE_AWS_KNOWLEDGE_MCP", "false").lower() == "true"

        system_prompt_parts = [
            "You are an AWS AI Assistant specialized in comprehensive AWS management. "
            "You can help users with:"
        ]

        if enable_eks_mcp:
            system_prompt_parts.extend([
                "\n\n**EKS Cluster Management:**\n"
                "- Create, describe, and delete EKS clusters using CloudFormation\n"
                "- Generate CloudFormation templates with best practices\n"
                "- Manage cluster lifecycle and configuration\n"
                "- Handle VPC, networking, and security group setup\n\n"

                "**Kubernetes Resource Operations:**\n"
                "- Create, read, update, and delete Kubernetes resources\n"
                "- Apply YAML manifests to EKS clusters\n"
                "- List and query resources with filtering capabilities\n"
                "- Manage deployments, services, pods, and other workloads\n\n"

                "**Application Deployment:**\n"
                "- Generate Kubernetes deployment and service manifests\n"
                "- Deploy containerized applications with proper configuration\n"
                "- Configure load balancers and ingress controllers\n"
                "- Handle multi-environment deployments\n\n"

                "**Monitoring & Troubleshooting:**\n"
                "- Retrieve pod logs and Kubernetes events\n"
                "- Query CloudWatch logs and metrics\n"
                "- Access EKS troubleshooting guidance\n"
                "- Monitor cluster and application performance\n\n"

                "**Security & IAM:**\n"
                "- Manage IAM roles and policies for EKS\n"
                "- Configure Kubernetes RBAC\n"
                "- Handle service account permissions\n"
                "- Implement security best practices\n\n"
            ])

        if enable_cost_explorer_mcp:
            system_prompt_parts.extend([
                "**AWS Cost Management & FinOps:**\n"
                "- Analyze AWS costs by service, region, and time period\n"
                "- Generate detailed cost reports and breakdowns\n"
                "- Identify cost optimization opportunities\n"
                "- Track cost trends and forecasts\n"
                "- Compare costs across different dimensions\n"
                "- Provide spending recommendations\n"
                "- Analyze Reserved Instance and Savings Plans utilization\n"
                "- Monitor budget alerts and cost anomalies\n\n"
            ])

        if enable_terraform_mcp:
            system_prompt_parts.extend([
                "**Infrastructure as Code with Terraform:**\n"
                "- Provide Terraform best practices for AWS infrastructure\n"
                "- Generate Terraform configurations with AWS Well-Architected guidance\n"
                "- Integrate security scanning with Checkov for compliance\n"
                "- Search AWS and AWSCC provider documentation and examples\n"
                "- Access specialized AI/ML modules (Bedrock, SageMaker, OpenSearch)\n"
                "- Analyze Terraform Registry modules for reusability\n"
                "- Execute Terraform workflows (init, plan, apply, validate)\n"
                "- Provide security-first development workflow guidance\n\n"
            ])

        if enable_aws_documentation_mcp:
            system_prompt_parts.extend([
                "**AWS Documentation Access:**\n"
                "- Search and retrieve AWS documentation in markdown format\n"
                "- Get content recommendations for related documentation\n"
                "- Access official AWS service documentation and guides\n"
                "- Provide accurate, up-to-date AWS information with citations\n"
                "- Help users understand AWS services and best practices\n\n"
            ])

        if enable_cloudtrail_mcp:
            system_prompt_parts.extend([
                "**CloudTrail Security & Auditing:**\n"
                "- Search CloudTrail events for security investigations\n"
                "- Query the last 90 days of AWS account activity\n"
                "- Track user actions and API calls across AWS services\n"
                "- Perform compliance auditing and operational troubleshooting\n"
                "- Execute advanced SQL queries against CloudTrail Lake\n"
                "- Analyze access patterns and identify security anomalies\n\n"
            ])

        if enable_cloudwatch_mcp:
            system_prompt_parts.extend([
                "**CloudWatch Monitoring & Observability:**\n"
                "- Retrieve CloudWatch metrics and analyze performance data\n"
                "- Troubleshoot active alarms with root cause analysis\n"
                "- Analyze CloudWatch log groups for anomalies and patterns\n"
                "- Execute CloudWatch Logs Insights queries\n"
                "- Get metric metadata and recommended alarm configurations\n"
                "- Track alarm history and state changes\n"
                "- Perform AI-powered log analysis and error pattern detection\n\n"
            ])

        if enable_postgres_mcp:
            system_prompt_parts.extend([
                "**Amazon Aurora/RDS PostgreSQL:**\n"
                "- Connect to Aurora PostgreSQL using RDS Data API or direct connection\n"
                "- Convert natural language questions into PostgreSQL SQL queries\n"
                "- Execute queries and retrieve database results\n"
                "- Support both Aurora PostgreSQL and RDS PostgreSQL instances\n"
                "- Provide read-only access by default for safety\n\n"
            ])

        if enable_aws_support_mcp:
            system_prompt_parts.extend([
                "**AWS Support Integration:**\n"
                "- Create and manage AWS Support cases\n"
                "- Query support case status and history\n"
                "- Access AWS Trusted Advisor recommendations\n"
                "- Get proactive guidance on AWS best practices\n"
                "- Track service health and incidents\n\n"
            ])

        if enable_cdk_mcp:
            system_prompt_parts.extend([
                "**AWS CDK Infrastructure:**\n"
                "- Generate AWS CDK code in TypeScript, Python, or Java\n"
                "- Provide CDK best practices and patterns\n"
                "- Create reusable CDK constructs and stacks\n"
                "- Integrate with existing CDK projects\n"
                "- Support CDK v2 features and capabilities\n"
                "- Help with CDK bootstrapping and deployment\n\n"
            ])

        if enable_aws_knowledge_mcp:
            system_prompt_parts.extend([
                "**AWS Knowledge Base:**\n"
                "- Access comprehensive AWS service knowledge\n"
                "- Provide detailed information about AWS services and features\n"
                "- Answer AWS-related questions with authoritative information\n"
                "- Explain AWS concepts, architectures, and best practices\n"
                "- Help with AWS certification and learning paths\n\n"
            ])

        system_prompt_parts.append(
            "Always respect AWS IAM permissions and Kubernetes RBAC. Provide clear, "
            "actionable responses with status indicators and suggest relevant next steps. "
            "Ask clarifying questions when user intent is ambiguous and validate all "
            "operations before execution. Focus on security best practices and cost optimization."
        )

        system_prompt = "".join(system_prompt_parts)

        try:
            # Check if using Bedrock and create BedrockModel directly
            if self.config.model_provider == "bedrock":
                model_name = self.config.model_name or "anthropic.claude-3-5-sonnet-20241022-v2:0"
                region_name = self.config.aws_region or 'us-east-2'

                bedrock_model = BedrockModel(
                    model_id=model_name,
                    region_name=region_name,
                    temperature=0.3,
                )
                agent = Agent(
                    bedrock_model,
                    tools=tools,
                    system_prompt=system_prompt
                )
            else:
                # For other providers, use the original approach
                model_config = self.config.get_model_config()
                agent = Agent(
                    model=model_config,
                    tools=tools,
                    system_prompt=system_prompt
                )

            logger.info(f"Successfully created agent with model provider: {self.config.model_provider}")
            return agent

        except Exception as e:
            logger.warning(f"Failed to create agent with specified config: {e}")
            logger.info("Falling back to default agent configuration")

            return Agent(tools=tools, system_prompt=system_prompt)

    def chat(self, message: str) -> Dict[str, Any]:
        """Chat with the AWS EKS agent.

        Args:
            message: User's input message

        Returns:
            Dictionary containing the agent's response and metadata
        """
        try:
            # Add message to conversation state
            self.state.add_user_message(message)

            # Ensure MCP client and agent are initialized
            if self._agent is None or not self._mcp_clients:
                self._initialize_mcp_and_agent()

            # Get agent response (MCP server is already running)
            logger.info(f"Processing user message: {message[:100]}...")
            response = self._agent(message)

            # Extract response content from AgentResult
            response_text = str(response)

            # Add response to conversation state
            self.state.add_assistant_message(response_text)

            logger.info("Agent response generated successfully")

            return {
                "answer": response_text,
                "metadata": ResponseMetadata(
                    user_input=False,
                    input_fields=[],
                    tools_used=len(self._tools) if self._tools else 0,
                    conversation_length=len(self.state.messages)
                ).model_dump()
            }

        except Exception as e:
            error_message = f"Error processing message: {str(e)}"
            logger.error(error_message)

            return {
                "answer": f"I encountered an error while processing your request: {str(e)}",
                "metadata": ResponseMetadata(
                    user_input=False,
                    input_fields=[],
                    error=True,
                    error_message=error_message
                ).model_dump()
            }

    def run_sync(self, message: str) -> str:
        """Run the agent synchronously and return just the response text.

        Args:
            message: User's input message

        Returns:
            Agent's response as a string
        """
        result = self.chat(message)
        return result.get("answer", "No response generated")

    def stream_chat(self, message: str):
        """Stream chat with the AWS EKS agent.

        Args:
            message: User's input message

        Yields:
            Streaming events from the agent
        """
        try:
            # Add message to conversation state
            self.state.add_user_message(message)

            # Ensure MCP client and agent are initialized
            if self._agent is None or not self._mcp_clients:
                self._initialize_mcp_and_agent()

            # Stream agent response (MCP server is already running)
            logger.info(f"Streaming response for message: {message[:100]}...")

            full_response = ""
            for event in self._agent.stream_async(message):
                if "data" in event:
                    full_response += event["data"]
                yield event

            # Add complete response to conversation state
            if full_response:
                self.state.add_assistant_message(full_response)

        except Exception as e:
            error_message = f"Error streaming message: {str(e)}"
            logger.error(error_message)
            yield {"error": error_message}

    def reset_conversation(self):
        """Reset the conversation state."""
        self.state.reset()
        logger.info("Conversation state reset")

    def get_conversation_history(self) -> list:
        """Get the current conversation history.

        Returns:
            List of conversation messages
        """
        return [msg.model_dump() for msg in self.state.messages]

    def close(self):
        """Close the agent and clean up resources."""
        logger.info("Closing AWS Agent and cleaning up resources...")
        self._cleanup_mcp()

    def __del__(self):
        """Destructor to ensure proper cleanup."""
        try:
            self.close()
        except Exception:
            # Ignore errors during cleanup in destructor
            pass

    def __enter__(self):
        """Context manager entry."""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit."""
        self.close()


# Factory function for easy agent creation
def create_agent(config: Optional[AgentConfig] = None) -> AWSAgent:
    """Create an AWS Agent instance.

    Args:
        config: Optional agent configuration

    Returns:
        AWSAgent instance
    """
    return AWSAgent(config)
