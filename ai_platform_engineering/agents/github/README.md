# ArgoCD Agent

This project implements an AI Agent that interacts with ArgoCD using the [langchain-mcp-adapters](https://github.com/langchain-ai/langchain-mcp-adapters) framework and [AGNTCY ACP Protocol](https://github.com/agntcy/acp-sdk), exposing it via an ACP-compatible workflow server.

---

## Architecture

```
+---------------------+     +---------------------+     +------------------------+
|  User Client (ACP)  | --> |     AGNTCY ACP      | --> | LangGraph ReAct Agent  |
+---------------------+     +---------------------+     +------------------------+
                                                                  |
                                                                  v
+---------------+     +-----------------------+     +----------------------------+
|     ArgoCD    | <-- | ArgoCD MCP Server     | <-- |   LangGraph MCP Adapter    |
+---------------+     +-----------------------+     +----------------------------+
```

## 🧠 Features

- Built using **LangGraph + LangChain MCP Adapter**
- Uses **Azure OpenAI GPT-4o** as the LLM backend
- Communicates with ArgoCD through a dedicated [_ArgoCD MCP agent_](https://github.com/severity1/argocd-mcp)
- Deployed with [Workflow Server Manager (WFSM)](https://github.com/agntcy/workflow-srv-mgr)
- Compatible with **ACP protocol** for multi-agent orchestration

---

## 🛠️ Setup

### Start ACP Agent AGNTCY Workflow manager server

#### Step 1. Create/Update `deploy/acp/agent-env.yaml`

```
values:
  AZURE_OPENAI_API_KEY: <COPY YOUR AZURE OPENAI API KEY>
  OPENAI_API_VERSION: <COPY YOUR AZURE OPENAI API VERSION>
  AZURE_OPENAI_API_VERSION: <COPY YOUR AZURE OPENAI API VERSION>
  AZURE_OPENAI_DEPLOYMENT: <COPY YOUR AZURE OPENAI DEPLOYMENT>
  AZURE_OPENAI_ENDPOINT: <COPY YOUR AZURE OPENAI ENDPOINT>
  ARGOCD_TOKEN: <COPY YOUR ARGOCD SERVICE ACCOUNT TOKEN>
  ARGOCD_API_URL: <COPY YOUR ARGOCD API ENDPOINT. Example https://argocd.exmaple.com/api/v1>
  ARGOCD_VERIFY_SSL: <SET ARGOCD SSL VERIFICATION. true | false>
```
#### Step 2. Start ACP Workflow Server Manager

```bash
make run-acp
```

### 🔁 Test with ArgoCD Client

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
> Your Question: how can you help?
Agent: I can assist you with managing applications in ArgoCD, including tasks such as:
```

```
1. **Listing Applications**: Retrieve a list of applications with filtering options like project name, application name, repository URL, and namespace.

2. **Getting Application Details**: Fetch detailed information about a specific application.

3. **Creating Applications**: Create new applications in ArgoCD with specified configurations.

4. **Updating Applications**: Update existing applications with new configurations.

5. **Deleting Applications**: Remove applications from ArgoCD, with options for cascading deletions.

6. **Syncing Applications**: Synchronize applications to a specific Git revision, with options for pruning and dry runs.

7. **Getting User Info**: Retrieve information about the currently logged-in user, including permissions and groups.

8. **Getting ArgoCD Settings**: Access server settings related to OIDC, Dex, UI customization, and plugins.

9. **Getting Plugins**: List available plugins in ArgoCD.

10. **Getting Version Information**: Retrieve version details of the ArgoCD API server.

If you need help with any of these tasks or have specific questions about ArgoCD, feel free to ask!
```

### 🔁 Test with Curl (using Workflow Server)

You can send a test request to the running Workflow Server instance using the agent's dynamic values.

#### Step 1: Get `AGENT_ID`, `API_KEY`, and `PORT`

When you run the server using `wfsm deploy`, it prints out values like:

```
2025-05-01T10:17:45-05:00 INF ACP agent deployment name: org.cnoe.agent_argocd
2025-05-01T10:17:45-05:00 INF ACP agent running in container: org.cnoe.agent_argocd, listening for ACP requests on: http://127.0.0.1:56504
2025-05-01T10:17:45-05:00 INF Agent ID: bc123..
2025-05-01T10:17:45-05:00 INF API Key: xyz456...
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
             "argocd_input": {
               "messages": [
                 {
                   "type": "human",
                   "content": "Get version information of the ARGO CD server"
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

This will trigger the agent via Workflow Server and return the LLM-powered response using tools from the `argocd-mcp` submodule.

---

## 🧬 Agent Internals

- Uses [`create_react_agent`](https://docs.langchain.com/langgraph/agents/react/) for tool-calling
- Tools are dynamically loaded from the **ArgoCD MCP server**
- MCP server launched using `uv run` with `stdio` transport by default
- Graph built using a single-node LangGraph that handles inference and action routing

---

## 📦 Project Structure

```
agent_argocd/
│
├── agent.py              # LLM + MCP client orchestration
├── langgraph.py          # LangGraph graph definition
├── __main__.py           # CLI entrypoint
├── state.py              # Pydantic state models
└── argocd_mcp/           # Git submodule: contains ArgoCD MCP server

client
│
└── client_agent.py       # Agent ACP Client

```
---

## 📚 MCP Submodule (ArgoCD Tools)

This project uses the [ArgoCD MCP Server by `severity1`](https://mcp.so/server/argocd-mcp/severity1) as a **git submodule** in the `argocd_mcp/` directory.

All ArgoCD-related LangChain tools used by this agent are defined by that MCP server implementation. You can see the list of supported tools here:

👉 **[View supported tools](https://mcp.so/server/argocd-mcp/severity1?tab=content)**


---

## 🔌 MCP Integration

The agent uses [`MultiServerMCPClient`](https://github.com/langchain-ai/langchain-mcp-adapters) to communicate with external MCP-compliant services (e.g., ArgoCD). This adapter handles the tool registration and function calling for LangChain tools.

### In this project:

- We use the `stdio` transport to launch the MCP server process via `uv run ...`.
- The `argocd_mcp.server` is discovered dynamically and launched in a subprocess.

Example:

```python
async with MultiServerMCPClient(
    {
        "argocd": {
            "command": "uv",
            "args": ["run", "/abs/path/to/argocd_mcp/server.py"],
            "env": {
                "ARGOCD_TOKEN": argocd_token,
                "ARGOCD_API_URL": argocd_api_url,
                "ARGOCD_VERIFY_SSL": "false"
            },
            "transport": "stdio",
        }
    }
) as client:
    agent = create_react_agent(model, client.get_tools())
```

### SSE Transport (Alternative)

If your MCP server is running as an HTTP server, you can use SSE transport:

```python
async with MultiServerMCPClient(
    {
        "argocd": {
            "transport": "sse",
            "url": "http://localhost:8000"
        }
    }
) as client:
    ...
```
---

## 📜 License

Apache 2.0 (see [LICENSE](./LICENSE))

---

## 👥 Maintainers

[MAINTAINERS.md](MAINTAINERS.md)

- Contributions welcome via PR or issue!

