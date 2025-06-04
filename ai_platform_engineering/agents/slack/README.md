# 🤖 Slack AI Agent

This is a LangGraph-powered Slack Agent that interacts with users via Slack, executing tasks using MCP tools and large language models. Built for **ACP** and **A2A** protocol support.

## 🚀 Quick Start Guide

### Prerequisites
- Docker installed on your system
- A Slack App configured with necessary permissions
- Azure OpenAI API access (or other supported LLM provider)

### Step 1: Clone the Repository
```bash
git clone https://github.com/cnoe-io/agent-slack.git
cd agent-slack
```

### Step 2: Create Environment File
Create a `.env` file in the root directory with the following variables (do not use quotes around values):

```env
############################
# Slack Agent Environment
############################

# Required for ACP Docker
AGENT_NAME=slack
CNOE_AGENT_SLACK_ID=your-agent-id
CNOE_AGENT_SLACK_API_KEY=your-api-key
CNOE_AGENT_SLACK_PORT=8000
AGENT_ID=your-agent-id
AGENTS_REF={"your-agent-id": "agent_slack.graph:AGENT_GRAPH"}

SLACK_BOT_TOKEN=your-bot-token
SLACK_TOKEN=your-bot-token
SLACK_APP_TOKEN=your-app-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_CLIENT_SECRET=your-client-secret
SLACK_TEAM_ID=your-team-id

############################
# Azure OpenAI Configuration
############################

LLM_PROVIDER=azure-openai
AZURE_OPENAI_API_KEY=your-azure-key
AZURE_OPENAI_ENDPOINT=your-azure-endpoint
AZURE_OPENAI_API_VERSION=2025-04-01-preview
AZURE_OPENAI_DEPLOYMENT=gpt-4.1

############################
# A2A and MCP Configurations
############################

A2A_AGENT_HOST=localhost
A2A_AGENT_PORT=8000
MCP_HOST=localhost
MCP_PORT=9000

############################
# Docker Image (Optional)
############################

ACP_AGENT_IMAGE=ghcr.io/cnoe-io/agent-slack:acp-latest
A2A_AGENT_IMAGE=ghcr.io/cnoe-io/agent-slack:a2a-latest
```

### Step 3: Running the Agent

#### ACP Mode
1. Pull the ACP image:
```bash
docker pull ghcr.io/cnoe-io/agent-slack:acp-v0.1.1
```

2. Run the ACP container:
```bash
docker run -it --rm \
  --env-file .env \
  -v $(pwd)/.env:/opt/agent_src/.env \
  -p 8000:8000 \
  -e AGENT_MANIFEST_PATH=manifest.json \
  -e API_HOST=0.0.0.0 \
  ghcr.io/cnoe-io/agent-slack:acp-v0.1.1
```

3. In a new terminal, start the ACP client:
```bash
make run-acp-client
```

#### A2A Mode
1. Pull the A2A image:
```bash
docker pull ghcr.io/cnoe-io/agent-slack:a2a-v0.1.1
```

2. Run the A2A container:
```bash
docker run -it --rm \
  --env-file .env \
  -p 8000:8000 \
  ghcr.io/cnoe-io/agent-slack:a2a-v0.1.1
```

3. In a new terminal, start the A2A client:
```bash
uvx https://github.com/cnoe-io/agent-chat-cli.git a2a
```

### Step 4: Configure Your Slack App

To use this agent with Slack, you'll need to create a Slack App and:

1. Enable **Socket Mode**
2. Add the following **Bot Token Scopes**:  
   * `app_mentions:read`  
   * `channels:history`  
   * `chat:write`  
   * `users:read`  
   * `groups:history`  
   * `im:history`  
   * `mpim:history`
3. Install the app to your workspace
4. Copy the required tokens to your `.env` file

## 🛠️ Core Commands

### ACP Mode
```bash
make run-acp         # Starts the ACP server
make run-acp-client  # Launches the ACP client to interact with the agent
```

### A2A Mode
```bash
make run-a2a         # Starts the A2A server
make run-a2a-client  # Launches the A2A client to interact with the agent
```

## 🧠 What This Agent Can Do

This agent is powered by a custom MCP (Multi-Protocol Control) server specifically built for Slack integration. Once running, you can chat with the agent via Slack, and it will:

* Respond to queries using Azure OpenAI GPT-4
* Use Slack's Web API to send messages and perform actions
* Handle tool-calling via our custom Slack MCP server

### Example Interactions

1. **Channel Management**
```
User: list all channels
Agent: Here are all the public, active channels in your Slack workspace:

1. all-slack-bot-test – For announcements and company updates.
2. social – A fun channel to get to know your teammates.
3. new-channel – For everything related to #new-channel, including meetings and docs.
4. test-channel – (No description provided).

Let me know if you want more details about any channel or need to take action!
```

2. **Capabilities Overview**
```
User: what can you do for me
Agent: I can help you with a wide range of tasks related to Slack and general productivity! Here are some things I can do for you:

1. Slack Channel Management:
   • List, join, or leave channels
   • Get information about channels (members, purpose, etc.)
   • Post messages or announcements to channels
   • Reply to threads or update/delete messages

2. User & Team Support:
   • List users in your workspace
   • Get detailed info about specific users
   • Set your Slack status

3. File Management:
   • List, upload, or delete files in Slack
   • Get information about specific files

4. Message Reactions:
   • Add or remove emoji reactions to messages

5. General Productivity:
   • Summarize conversations or threads
   • Help draft or format messages
   • Remind you of tasks or follow-ups

6. Custom Requests:
   • Answer questions about Slack features
   • Provide tips for better collaboration
   • Automate repetitive Slack tasks

If you have a specific task in mind, just let me know what you'd like to do!
```

## 📁 Project Structure

```
agent_slack/
├── agent.py               # Core Slack Agent orchestration
├── graph.py               # LangGraph definition
├── state.py               # Pydantic model for AgentState
├── llm_factory.py         # Returns configured LLM based on env vars
├── protocol_bindings/    # Contains the Slack MCP server
client/
├── acp_client.py          # ACP client to test the agent
├── a2a_client.py          # A2A client to test the agent
```

## 🔍 Troubleshooting

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

4. **Client Connection Issues**
   - Make sure the server is running before starting the client
   - Verify the port numbers match between server and client
   - Check that the API key in your `.env` file matches the one used by the server

### Logs

- For Docker containers, use `docker logs <container-id>` to view logs
- For local development, logs will be displayed in the terminal

## 📚 Additional Resources

- [Slack API Documentation](https://api.slack.com/)
- [Azure OpenAI Documentation](https://learn.microsoft.com/en-us/azure/ai-services/openai/)
- [Docker Documentation](https://docs.docker.com/)
- [LangGraph Documentation](https://python.langchain.com/docs/langgraph)

## 🔐 Security Notes

* Never commit your `.env` file to version control
* Keep your API keys and tokens secure
* Use environment variables or secret managers in production
* Regularly rotate your API keys and tokens

## 📜 License

Apache 2.0

## 🤝 Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## 📞 Support

For support, please open an issue in the GitHub repository. 