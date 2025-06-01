# 🤖 Slack AI Agent

This is a LangGraph-powered Slack Agent that interacts with users via Slack, executing tasks using MCP tools and large language models. Built for **ACP** and **A2A** protocol support.

## 🧰 Quickstart

### Prerequisites

- Docker installed and running
- Git
- Access to required API keys and tokens

### Step 1: Clone and Setup

```bash
git clone <repository-url>
cd agent-slack
```

### Step 2: Create a `.env` File

Create a `.env` file in the root directory with the following structure:

```env
############################
# Slack Agent Environment
############################
AGENT_NAME="slack"
CNOE_AGENT_SLACK_ID="your-agent-id"  # Will be generated automatically
CNOE_AGENT_SLACK_API_KEY="your-api-key"  # Will be generated automatically
CNOE_AGENT_SLACK_PORT=8000

# Slack Configuration
SLACK_BOT_TOKEN="your-slack-bot-token"
SLACK_TOKEN="your-slack-token"
SLACK_APP_TOKEN="your-slack-app-token"
SLACK_SIGNING_SECRET="your-slack-signing-secret"
SLACK_CLIENT_SECRET="your-slack-client-secret"
SLACK_TEAM_ID="your-slack-team-id"

############################
# A2A Agent Configuration
############################
A2A_AGENT_HOST=localhost
A2A_AGENT_PORT=8000

############################
# Azure OpenAI Configuration
############################
LLM_PROVIDER=azure-openai
AZURE_OPENAI_API_KEY="your-azure-openai-key"
AZURE_OPENAI_ENDPOINT="your-azure-openai-endpoint"
AZURE_OPENAI_API_VERSION="2025-04-01-preview"
AZURE_OPENAI_DEPLOYMENT="gpt-4.1"

############################
# Docker Image Configuration
############################
ACP_AGENT_IMAGE=ghcr.io/cnoe-io/agent-slack:acp-latest
A2A_AGENT_IMAGE=ghcr.io/cnoe-io/agent-slack:a2a-latest
```

### Step 3: Configure Your Slack App

To use this agent with Slack, you'll need to create a Slack App and:

* Enable **Socket Mode**
* Add the following **Bot Token Scopes**:
  * `app_mentions:read`
  * `channels:history`
  * `chat:write`
  * `users:read`
  * `groups:history`
  * `im:history`
  * `mpim:history`
* Install the app to your workspace and retrieve the required tokens for the `.env` file above.

## 🚀 Running the Agents

### Option 1: Running ACP Agent

The ACP (Agent Control Protocol) agent can be run in two ways:

#### Using Docker (Recommended)

```bash
make run-docker-acp
```

This will:
1. Build the ACP Docker image if not already built
2. Start the container with all necessary environment variables
3. Expose the agent on port 8000 (or the port specified in your .env file)

#### Using Local Development

```bash
make run-acp         # Starts the ACP server
make run-acp-client  # Launches the ACP client to interact with the agent
```

### Option 2: Running A2A Agent

The A2A (Agent-to-Agent) agent can also be run in two ways:

#### Using Docker

```bash
make run-docker-a2a
```

This will:
1. Build the A2A Docker image if not already built
2. Start the container with all necessary environment variables
3. Expose the agent on port 8000 (or the port specified in your .env file)

#### Using Local Development

```bash
make run-a2a         # Starts the A2A server
make run-a2a-client  # Launches the A2A client to interact with the agent
```

## 🧠 What This Agent Can Do

Once running, you can chat with the agent via Slack, and it will:

* Respond to queries using Azure OpenAI GPT-4
* Use Slack's Web API to send messages and perform actions
* Handle tool-calling via MCP in the background

Under the hood:

* The Slack MCP server is launched using `uv run`
* The agent uses LangGraph's `create_react_agent()` API
* Tool selection and execution is done via the LangChain-MCP adapter

## 📁 Project Structure

```bash
agent-slack/
├── agent_slack/              # Main agent package
│   ├── agent.py             # Core Slack Agent orchestration
│   ├── graph.py             # LangGraph definition
│   ├── state.py             # Pydantic model for AgentState
│   ├── llm_factory.py       # Returns configured LLM based on env vars
│   └── protocol_bindings/   # Contains the Slack MCP server
├── client/                  # Client implementations
│   ├── acp_client.py        # ACP client to test the agent
│   ├── a2a_client.py        # A2A client to test the agent
│   ├── mcp_client.py        # MCP client implementation
│   ├── chat_interface.py    # Chat interface utilities
│   └── acp_client_curl.sh   # Shell-based CURL client
├── build/                   # Docker build files
├── tests/                   # Test suite
├── evals/                   # Evaluation scripts
├── helm/                    # Kubernetes Helm charts
└── Makefile                # Build and run commands
```

## 🧪 Sample Usage

### ACP Mode
```bash
make run-acp
# In another terminal
make run-acp-client
```

You will see:
```
> Your Question: who are you?
Agent: I am a Slack assistant that can send messages and manage your workspace.
```

## 🔧 Troubleshooting

### Common Issues

1. **Port Conflicts**
   - If port 8000 is already in use, modify the `CNOE_AGENT_SLACK_PORT` in your `.env` file
   - Ensure no other services are using the required ports

2. **Docker Issues**
   - Ensure Docker daemon is running
   - Check if you have sufficient permissions to run Docker commands
   - Verify that the required images are available

3. **Environment Variables**
   - Double-check all required environment variables are set in your `.env` file
   - Ensure no trailing spaces in variable values
   - Verify API keys and tokens are valid

### Logs

- For Docker containers, use `docker logs <container-id>` to view logs
- For local development, logs will be displayed in the terminal

## 🛠️ Development

### Building Docker Images

```bash
# Build ACP image
make build-docker-acp

# Build A2A image
make build-docker-a2a
```

### Testing

```bash
make test
```

## 🔐 Security Notes

Make sure you do **not commit your `.env` file** into version control. Use environment variables or secret managers in production.

## 📚 Additional Resources

- [Slack API Documentation](https://api.slack.com/)
- [Azure OpenAI Documentation](https://learn.microsoft.com/en-us/azure/ai-services/openai/)
- [Docker Documentation](https://docs.docker.com/)

## 📜 License

Apache 2.0
