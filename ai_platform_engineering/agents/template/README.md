# Agent Template

[![Build and Push Python Image](https://github.com/cnoe-io/agent-template/actions/workflows/docker-build-push.yaml/badge.svg)](https://github.com/cnoe-io/agent-template/actions/workflows/docker-build-push.yaml)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

## Overview

You are a weekend activity planner agent. This agent helps users plan their weekend activities by leveraging specialized sub-agents.

### Sub-Agents

- **Hiking Agent**: For hiking-related queries, use `hiking_agent`.
- **Weather Agent**: For weather-related queries, use `weather_agent`.

## Usage

This project uses a `Makefile` to manage common tasks. Below are the available `make` targets:

### Makefile Targets

- `make setup-env`: Setup Virtual Env
- `make run-acp`: Start the weekend activity planner agent.
- `make run-client`: Run tests for the agent and its sub-agents.

## Getting Started

- Clone the repository:
```bash
git clone <repository-url>
cd agent-template
```

- Create `deploy/acp/agent-env.yaml` with the following content:

```yaml
values:
  AZURE_OPENAI_API_KEY: <Refer to 1Password>
  OPENAI_API_VERSION: 2025-03-01-preview
  AZURE_OPENAI_API_VERSION: 2025-03-01-preview
  AZURE_OPENAI_DEPLOYMENT: gpt-4o
  AZURE_OPENAI_ENDPOINT: https://platform-interns-eus2.openai.azure.com/
```

- Run the agent server:
```bash
make run-acp
```

- Create a `.env` file with the following content:

```bash
API_PORT=57226
API_KEY=<COPY from make run-acp console output>
AGENT_ID=0f9d6e73-b027-4ea8-a3d2-4180a9b634db
OPENAI_API_VERSION=gpt-4o
AZURE_OPENAI_DEPLOYMENT=gpt-4o
AZURE_OPENAI_ENDPOINT=https://platform-interns-eus2.openai.azure.com/
AZURE_OPENAI_API_KEY=<CHECK 1Password>
AZURE_OPENAI_API_VERSION=2025-03-01-preview
```

- Run the agent client:
```bash
source .env
make run-acp
source venv/bin/activate
make run-client
```

- Sample Output:

```
Chat ID: 12345, Event: data, Data: {"answer": "where can I hike in Califronia?", "metadata": {}}
Chat ID: 12345, Event: data, Data: {"answer": "", "metadata": {}}
Chat ID: 12345, Event: data, Data: {"answer": "Successfully transferred to hiking_agent", "metadata": {}}
Chat ID: 12345, Event: data, Data: {"answer": "California offers ...", "metadata": {}}
Chat ID: 12345, Event: data, Data: {"answer": "Transferring back to supervisor", "metadata": {}}
Chat ID: 12345, Event: data, Data: {"answer": "Successfully transferred back to supervisor", "metadata": {}}
Chat ID: 12345, Event: data, Data: {"answer": "I hope you found the information on hiking destinations in California helpful! If you have any more questions or need further assistance, feel free to ask.", "metadata": {}}
```

## Run LangGraph Studio

```
make langgraph-dev
```
