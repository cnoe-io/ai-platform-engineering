# 🤖 Slack AI Agent

This is a LangGraph-powered Slack Agent that interacts with users via Slack, executing tasks using MCP tools and large language models. Built for **ACP** and **A2A** protocol support.

---

## 🧰 Quickstart

### Step 1: Create a `.env` File

Before using the agent, create a `.env` file in the root of the project with the following variables:

```env
# === Agent Config ===
WFSM_PORT=49499
AGENT_ID=5b2491e7-fc58-4869-bdfd-313dca48de86
API_KEY=e9273827-0b9f-4391-8cb4-615ec6c135ec
AGENT_NAME=slack
AGENT_HOST=localhost
AGENT_PORT=49499

# === LLM Config ===
LLM_PROVIDER=azure-openai
OPENAI_API_VERSION=2025-03-01-preview
AZURE_OPENAI_API_VERSION=2025-03-01-preview
AZURE_OPENAI_DEPLOYMENT=gpt-4.1
AZURE_OPENAI_ENDPOINT=https://platform-interns-eus2.openai.azure.com/
AZURE_OPENAI_API_KEY=YOUR_AZURE_OPENAI_API_KEY

# === Slack Config ===
SLACK_BOT_TOKEN=your-bot-token
SLACK_TOKEN=your-token
SLACK_APP_TOKEN=your-app-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_CLIENT_SECRET=your-client-secret
SLACK_TEAM_ID=your-team-id

# === Other ===
GOOGLE_API_KEY=your-google-api-key
```

### Step 2: Configure Your Slack App

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

---

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

---

## 🧠 What This Agent Can Do

Once running, you can chat with the agent via Slack, and it will:

* Respond to queries using Azure OpenAI GPT-4
* Use Slack's Web API to send messages and perform actions
* Handle tool-calling via MCP in the background

Under the hood:

* The Slack MCP server is launched using `uv run`
* The agent uses LangGraph's `create_react_agent()` API
* Tool selection and execution is done via the LangChain-MCP adapter

---

## 📁 Project Structure

```bash
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

---

## 🧪 Sample Usage (ACP)

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

---

## 🔐 Security Notes

Make sure you do **not commit your `.env` file** into version control. Use environment variables or secret managers in production.

---

## 📜 License

Apache 2.0
