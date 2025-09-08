# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import logging
import os
from typing import Optional, Dict, Any

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
        self._mcp_client = None
        self._mcp_context = None
        self._tools = None
        
        # Set up logging
        log_level = self.config.log_level
        logging.getLogger("strands").setLevel(getattr(logging, log_level, logging.INFO))
        config_str = f"model_provider={self.config.model_provider}, model_name={self.config.model_name}"
        logger.info(f"Initialized AWS Agent with config: {config_str}")
        
        # Initialize MCP client and agent on first use
        self._initialize_mcp_and_agent()
        
    def _create_mcp_client(self) -> MCPClient:
        """Create and configure MCP clients based on enabled features."""
        import platform
        
        # Check which MCP servers are enabled
        enable_eks_mcp = os.getenv("ENABLE_EKS_MCP", "true").lower() == "true"
        enable_cost_explorer_mcp = os.getenv("ENABLE_COST_EXPLORER_MCP", "false").lower() == "true"
        
        # Common environment variables for all platforms
        env_vars = {
            "AWS_REGION": os.getenv("AWS_REGION", "us-west-2"),
            "FASTMCP_LOG_LEVEL": os.getenv("FASTMCP_LOG_LEVEL", "ERROR"),
        }
        
        # Add AWS credentials if they exist
        for env_var in ["AWS_PROFILE", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]:
            if os.getenv(env_var):
                env_vars[env_var] = os.getenv(env_var)
        
        # Platform-specific command configuration
        system = platform.system().lower()
        
        # Create MCP clients based on enabled features
        mcp_clients = []
        
        if enable_eks_mcp:
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
            mcp_clients.append(("eks", eks_client))
        
        if enable_cost_explorer_mcp:
            if system == "windows":
                cost_command_args = [
                    "--from", "mcp-cost-analyzer@latest",
                    "mcp-cost-analyzer.exe"
                ]
            else:
                cost_command_args = [
                    "mcp-cost-analyzer@latest"
                ]
            
            cost_client = MCPClient(lambda: stdio_client(
                StdioServerParameters(
                    command="uvx", 
                    args=cost_command_args,
                    env=env_vars
                )
            ))
            mcp_clients.append(("cost-explorer", cost_client))
        
        # For now, return the first client (primary MCP)
        # TODO: Implement proper multi-MCP support in future versions
        if mcp_clients:
            logger.info(f"Initialized {len(mcp_clients)} MCP clients: {[name for name, _ in mcp_clients]}")
            return mcp_clients[0][1]  # Return first client for now
        else:
            raise ValueError("No MCP servers enabled. Please enable at least one MCP server.")
    
    def _initialize_mcp_and_agent(self):
        """Initialize MCP client and agent once during startup."""
        try:
            logger.info("Initializing MCP clients and starting AWS MCP servers...")
            
            # Create MCP client
            self._mcp_client = self._create_mcp_client()
            
            # Start the MCP client context and keep it running
            self._mcp_context = self._mcp_client.__enter__()
            
            # Get tools from AWS MCP servers
            self._tools = self._mcp_client.list_tools_sync()
            logger.info(f"Retrieved {len(self._tools)} tools from AWS MCP servers")
            
            # Create agent with tools
            self._agent = self._create_agent(self._tools)
            
            logger.info("MCP servers started and agent initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize MCP servers and agent: {e}")
            self._cleanup_mcp()
            raise
    
    def _cleanup_mcp(self):
        """Clean up MCP client resources."""
        if self._mcp_context is not None:
            try:
                self._mcp_client.__exit__(None, None, None)
                logger.info("MCP client context cleaned up")
            except Exception as e:
                logger.warning(f"Error cleaning up MCP context: {e}")
            finally:
                self._mcp_context = None
                self._mcp_client = None
                self._agent = None
                self._tools = None
    
    def _create_agent(self, tools: list) -> Agent:
        """Create the Strands agent with AWS tools."""
        # Check which capabilities are enabled
        enable_eks_mcp = os.getenv("ENABLE_EKS_MCP", "true").lower() == "true"
        enable_cost_explorer_mcp = os.getenv("ENABLE_COST_EXPLORER_MCP", "false").lower() == "true"
        
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
            if self._agent is None or self._mcp_client is None:
                self._initialize_mcp_and_agent()
            
            # Get agent response (MCP server is already running)
            logger.info(f"Processing user message: {message[:100]}...")
            response = self._agent(message)
            
            # Extract response content from AgentResult
            # The Strands agent returns an AgentResult object that can be directly converted to string
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
            if self._agent is None or self._mcp_client is None:
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
