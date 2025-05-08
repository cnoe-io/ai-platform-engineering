# PagerDuty Agent

This project implements an AI Agent that interacts with PagerDuty using the [langchain-mcp-adapters](https://github.com/langchain-ai/langchain-mcp-adapters) framework and [AGNTCY ACP Protocol](https://github.com/agntcy/acp-sdk), exposing it via an ACP-compatible workflow server.

---

## Architecture

```
+---------------------+     +---------------------+     +------------------------+
|  User Client (ACP)  | --> |     AGNTCY ACP      | --> | LangGraph ReAct Agent  |
+---------------------+     +---------------------+     +------------------------+
                                                                  |
                                                                  v
+---------------+     +-----------------------+     +----------------------------+
|   PagerDuty   | <-- | PagerDuty MCP Server  | <-- |   LangGraph MCP Adapter    |
+---------------+     +-----------------------+     +----------------------------+
```

## 🧠 Features

- Built using **LangGraph + LangChain MCP Adapter**
- Uses **Azure OpenAI GPT-4o** as the LLM backend
- Communicates with PagerDuty through a dedicated PagerDuty MCP agent
- Deployed with [Workflow Server Manager (WFSM)](https://github.com/agntcy/workflow-srv-mgr)
- Compatible with **ACP protocol** for multi-agent orchestration

---

## 🛠️ Setup

### Start ACP Agent AGNTCY Workflow manager server

#### Step 1. Create/Update `deploy/acp/agent-env.yaml`

```yaml
values:
  AZURE_OPENAI_API_KEY: <COPY YOUR AZURE OPENAI API KEY>
  OPENAI_API_VERSION: <COPY YOUR AZURE OPENAI API VERSION>
  AZURE_OPENAI_API_VERSION: <COPY YOUR AZURE OPENAI API VERSION>
  AZURE_OPENAI_DEPLOYMENT: <COPY YOUR AZURE OPENAI DEPLOYMENT>
  AZURE_OPENAI_ENDPOINT: <COPY YOUR AZURE OPENAI ENDPOINT>
  PAGERDUTY_TOKEN: <COPY YOUR PAGERDUTY API TOKEN>
  PAGERDUTY_API_TOKEN: <COPY YOUR PAGERDUTY API TOKEN>
  PAGERDUTY_API_URL: <COPY YOUR PAGERDUTY API URL>
  PAGERDUTY_API_KEY:<COPY YOUR PAGERDUTY API TOKEN>

```

#### Step 2. Start ACP Workflow Server Manager

```bash
make run-acp
```

### 🔁 Test with PagerDuty Client

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
Agent: I can assist you with managing your PagerDuty operations, including:

1. **Incident Management**: Create, update, resolve, and acknowledge incidents.

2. **Service Management**: Create and update services, manage service configurations.

3. **User Management**: View user information, contact methods, and notification rules.

4. **Schedule Management**: View and manage on-call schedules and rotations.

What would you like to do?
```

---

## 📚 Documentation

For more detailed information about the project, please refer to the following resources:

- [API Documentation](docs/api.md)
- [Architecture Overview](docs/architecture.md)
- [Development Guide](docs/development.md)
- [Deployment Guide](docs/deployment.md)

---

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for more details.

---

## 📄 License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

---

## 👥 Maintainers

See [MAINTAINERS.md](MAINTAINERS.md) for the list of maintainers. 