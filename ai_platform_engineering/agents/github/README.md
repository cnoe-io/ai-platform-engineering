# Slack Agent

This project implements an AI Agent that interacts with Slack using the [langchain-mcp-adapters](https://github.com/langchain-ai/langchain-mcp-adapters) framework and [AGNTCY ACP Protocol](https://github.com/agntcy/acp-sdk), exposing it via an ACP-compatible workflow server.

---

## Architecture

```
+---------------------+     +---------------------+     +------------------------+
|  User Client (ACP)  | --> |     AGNTCY ACP      | --> | LangGraph ReAct Agent  |
+---------------------+     +---------------------+     +------------------------+
                                                                  |
                                                                  v
+---------------+     +-----------------------+     +----------------------------+
|     Slack     | <-- |   Slack MCP Tools     | <-- |   LangGraph MCP Adapter    |
+---------------+     +-----------------------+     +----------------------------+
```

## 🧠 Features

- Built using **LangGraph + LangChain MCP Adapter**
- Uses **Azure OpenAI GPT-4o** as the LLM backend
- Communicates with Slack through a dedicated Slack SDK integration
- Deployed with [Workflow Server Manager (WFSM)](https://github.com/agntcy/workflow-srv-mgr)
- Compatible with **ACP protocol** for multi-agent orchestration

---

## 🛠️ Setup

### Start ACP Agent AGNTCY Workflow manager server

#### Step 1. Create/Update `deploy/acp/agent-env.yaml`

```
values:
  AZURE_OPENAI_API_KEY: <COPY YOUR AZURE OPENAI API KEY>
  AZURE_OPENAI_API_VERSION: <COPY YOUR AZURE OPENAI API VERSION>
  AZURE_OPENAI_DEPLOYMENT: <COPY YOUR AZURE OPENAI DEPLOYMENT>
  AZURE_OPENAI_ENDPOINT: <COPY YOUR AZURE OPENAI ENDPOINT>
  SLACK_BOT_TOKEN: <COPY YOUR SLACK BOT TOKEN>
  SLACK_APP_TOKEN: <COPY YOUR SLACK APP TOKEN>
  SLACK_SIGNING_SECRET: <COPY YOUR SLACK SIGNING SECRET>
  SLACK_CLIENT_SECRET: <COPY YOUR SLACK CLIENT SECRET>
  SLACK_TEAM_ID: <COPY YOUR SLACK TEAM ID>
```

#### Step 2. Start ACP Workflow Server Manager

```bash
make run-acp
```

### 🔁 Test with Slack Client

#### Step 1: Add Environment Variables to `.env`

Create or update a `.env` file in the project root with the following content:

```bash
AGENT_ID="<COPY AGENT_ID>"
API_KEY="<COPY API_KEY from the above step xyz456...>"
WFSM_PORT="<COPY ACP SERVER PORT>"
```

#### Step 2: Run the Client

Start the client using the following command:

```bash
make run-client
```

**Sample Output:**

```
> Your Question: how can you help
Using Slack token starting with: xoxb-*****...
Sending request to ACP client...

Agent: I can assist you with a variety of tasks related to managing and interacting with a Slack workspace. Here are some of the things I can do:

1. **Channel Management**: 
   - List, join, leave, and get detailed information about channels.
   
2. **Messaging**:
   - Post, update, delete, and list messages in channels.
   - Reply to threads and add or remove reactions to messages.

3. **File Management**:
   - List, upload, get information about, and delete files.

4. **User Management**:
   - List users and get detailed information about specific users.
   - Set the status for the authenticated user.

If you have a specific task in mind, feel free to ask, and I'll do my best to assist you!

> Your Question: 
```

### 🔁 Test with Curl (using Workflow Server)

You can send a test request to the running Workflow Server instance using the agent's dynamic values.

#### Step 1: Get `AGENT_ID`, `API_KEY`, and `PORT`

When you run the server using `wfsm deploy`, it prints out values like:

```
2025-05-01T10:17:45-05:00 INF ACP agent deployment name: org.cnoe.agent_slack
2025-05-01T10:17:45-05:00 INF ACP agent running in container: org.cnoe.agent_slack, listening for ACP requests on: http://127.0.0.1:56504
2025-05-01T10:17:45-05:00 INF Agent ID: ***********
2025-05-01T10:17:45-05:00 INF API Key: ***********
...
```
Set them as environment variables:

```bash
export AGENT_ID="<COPY AGENT_ID>"
export API_KEY="<COPY API_KEY from the above step xyz456...>"
export WFSM_PORT="<COPY ACP SERVER PORT>"
```

#### Step 2: Run the curl command

```bash
curl -s -H "Content-Type: application/json" \
     -H "x-api-key: $API_KEY" \
     -d '{
           "agent_id": "'"$AGENT_ID"'",
           "input": {
             "slack_input": {
               "messages": [
                 {
                   "type": "human",
                   "content": "Send a message to the general channel saying hello"
                 }
               ]
             }
           },
           "config": {
             "configurable": {}
           }
         }' \
     http://127.0.0.1:$WFSM_PORT/runs/wait
```

This will trigger the agent via Workflow Server and return the LLM-powered response using tools from the Slack MCP integration.

---

## 🧬 Agent Internals

- Uses [`create_react_agent`](https://docs.langchain.com/langgraph/agents/react/) for tool-calling
- Tools are integrated directly within the `agent_slack/slack_mcp/tools` directory
- Graph built using a single-node LangGraph that handles inference and action routing

---

## 📦 Project Structure

```
agent_slack/
│
├── agent.py              # LLM + MCP client orchestration
├── langgraph.py          # LangGraph graph definition
├── __main__.py           # CLI entrypoint
├── state.py              # Pydantic state models
└── slack_mcp/            # Slack tools implementation
    ├── __init__.py
    ├── server.py         # MCP server implementation
    ├── tool_registry.py  # Tool registration
    ├── api/              # API client implementation
    ├── models/           # Data models
    └── tools/            # Slack tools
        ├── channels.py   # Channel management tools
        ├── files.py      # File management tools
        ├── messages.py   # Message sending/reading tools
        └── users.py      # User management tools

client/
│
├── client_agent.py       # Agent ACP Client
└── client_curl.sh        # Curl-based client example

deploy/
│
└── acp/                  # ACP deployment configuration
    └── agent.json        # Agent configuration
```
---

## 📚 Slack Tools

This project includes a set of Slack tools implemented directly in the codebase. These tools use the official Slack SDK to communicate with the Slack API.

Key features include:
- **Channel management**: Create, archive, list channels
- **Message actions**: Send, read, update, delete messages
- **User operations**: Lookup profiles, check presence
- **File handling**: Upload and share files

---

## 🔌 MCP Integration

The agent uses LangChain tools integrated directly in the codebase, exposed through the Model Context Protocol (MCP) adapters framework.

Example of using the Slack tools:

```python
# Send a message to a Slack channel
response = messages.send_message(
    channel_id="C08RQPSH4KD",
    text="Hello from the Slack agent!",
    env={
        "SLACK_BOT_TOKEN": os.getenv("SLACK_BOT_TOKEN")
    }
)

# Get channel information
channel_info = channels.get_channel_info(
    channel_id="C08RQPSH4KD",
    env={
        "SLACK_BOT_TOKEN": os.getenv("SLACK_BOT_TOKEN")
    }
)
```

---

## 📜 License

Apache 2.0 (see [LICENSE](./LICENSE))

---

## 👥 Maintainers

See [MAINTAINERS.md](MAINTAINERS.md)

- Contributions welcome via PR or issue!