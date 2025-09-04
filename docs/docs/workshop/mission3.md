---
id: mission3
title: "Mission 3: Multi-Agent Weather + Petstore System"
---

# Mission Check 3 — Multi-Agent Weather + Petstore System

## Overview

In this mission, you'll run a **multi-agent system** that coordinates critical Mars colony operations across multiple domains:

- **🐾 Petstore Agent**: Manages colony biological companions from Mission 2 - essential for morale and psychological well-being during long Mars deployments
- **🌤️ Weather Agent**: Monitors weather conditions to optimize interplanetary trade routes and supply deliveries - knowing weather patterns helps predict launch windows and cargo capacity for supply missions
- **🧠 Supervisor Agent**: Acts as the colony's central command coordinator, orchestrating complex operations that require data from multiple specialized systems

### Architecture Overview

![Multi-Agent System Architecture](images/mission3.svg)

This demonstrates **agent-to-agent communication** where the supervisor can intelligently route requests to specialized agents and combine their responses.

## Step 1: Configure Multi-Agent Environment

> **💡 Tip:** You can also click the IDE button on the top right of this page to open the `.env` file in the IDE and edit it that way. Edit lines 1-18 with the following agent configuration:

First, ensure you are in the correct directory:

```bash
cd $HOME/work/ai-platform-engineering
```

Run the below command to update the `.env` file with the following agent configuration:

```bash
sed -i \
  -e 's|^ENABLE_WEATHER_AGENT=.*|ENABLE_WEATHER_AGENT=true|' \
  -e 's|^ENABLE_PETSTORE_AGENT=.*|ENABLE_PETSTORE_AGENT=true|' \
  -e 's|^SKIP_AGENT_CONNECTIVITY_CHECK=.*|SKIP_AGENT_CONNECTIVITY_CHECK=false|' \
  -e 's|^AGENT_CONNECTIVITY_ENABLE_BACKGROUND=.*|AGENT_CONNECTIVITY_ENABLE_BACKGROUND=true|' \
  .env
```

> **💡 Tip:** Check if they are set in your .env

```bash
cat .env | grep -Ei 'weather|petstore|skip_agent|agent_connectivity' | sed -E 's/(=.{5}).+/\1****/'
```

The connectivity check is performed when the supervisor agent starts. It will check if the petstore and weather agents are running and if they are, it will add them to the supervisor agent's memory.

The dynamic monitoring is performed in the background and will check if the petstore and weather agents are running every 5 minutes. If any of the agents is unavailable, the supervisor agent will remove it from available tools until it is back online.

## Step 2: Start Multi-Agent System

---

### 2.1: Launch the multi-agent stack with Docker Compose:

For this mission, we will use the HTTP mode. You can also try out the STDIO mode afterward if you prefer.

**2.1.1: HTTP mode**

HTTP mode will connect petstore and weather agents to connect with their respective remote MCP servers that are hosted by Outshift at:

* `https://petstore.outshift.io/mcp`: mcp server containing data for the available pet companions from Earth

* `https://weather.outshift.io/mcp`: mcp server that can retrieve real weather data for Earth using the Open-Meteo API as well as mock weather data for Mars

```bash
IMAGE_TAG=latest MCP_MODE=http docker compose -f workshop/docker-compose.mission3.yaml --profile=p2p up
```

**2.1.2: What happens (Both modes)**

- ⏬ Downloads the latest supervisor, petstore and weather agent images from the registry
- 🌐 Exposes the supervisor agent on `http://localhost:8000`
- 🌐 Exposes the petstore agent on `http://localhost:8009`
- 🌐 Exposes the weather agent on `http://localhost:8010`
- 🔗 Uses peer-to-peer (p2p) mode to connect the supervisor agent to the petstore and weather agents
- 📋 Shows logs directly in terminal for all three agents

**2.1.4: Expected output:**

Look out for the following logs for each agent in a new terminal:

**Petstore agent logs:**

```bash
docker logs agent-petstore-p2p
```

```
...
agent-petstore-p2p     | ===================================
agent-petstore-p2p     |        PETSTORE AGENT CONFIG
agent-petstore-p2p     | ===================================
agent-petstore-p2p     | AGENT_URL: http://0.0.0.0:8000
agent-petstore-p2p     | ===================================
agent-petstore-p2p     | Running A2A server in p2p mode.
agent-petstore-p2p     | INFO:     Started server process [1]
agent-petstore-p2p     | INFO:     Waiting for application startup.
agent-petstore-p2p     | INFO:     Application startup complete.
agent-petstore-p2p     | INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
```

**Weather agent logs:**

```bash
docker logs agent-weather-p2p
```

```
...
agent-weather-p2p      | ===================================
agent-weather-p2p      |        WEATHER AGENT CONFIG
agent-weather-p2p      | ===================================
agent-weather-p2p      | AGENT_URL: http://0.0.0.0:8000
agent-weather-p2p      | ===================================
agent-weather-p2p      | Running A2A server in p2p mode.
agent-weather-p2p      | INFO:     Started server process [1]
agent-weather-p2p      | INFO:     Waiting for application startup.
agent-weather-p2p      | INFO:     Application startup complete.
agent-weather-p2p      | INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
```

**Supervisor agent logs:**

The supervisor agent logs can be quite verbose as it checks for up to 9 possible agents. Here's how to filter for the key success indicators:

```bash
docker logs platform-engineer-p2p 2>&1 | grep -F -B8 'Uvicorn running on http://0.0.0.0:8000'
```

This will show the logs from the start of the supervisor agent until the Uvicorn server is running like below:

```
...
platform-engineer-p2p  | 2025-08-21 13:36:04,058 - INFO - Dynamic monitoring enabled for 2 agents
platform-engineer-p2p  | 2025-08-21 13:36:04,062 - INFO - [LLM] AzureOpenAI deployment=gpt-4o api_version=2025-03-01-preview
platform-engineer-p2p  | 2025-08-21 13:36:04,809 - INFO - Graph updated with 2 agent tools
platform-engineer-p2p  | 2025-08-21 13:36:04,809 - INFO - AIPlatformEngineerMAS initialized with 2 agents
platform-engineer-p2p  | INFO:     Started server process [1]
platform-engineer-p2p  | INFO:     Waiting for application startup.
platform-engineer-p2p  | INFO:     Application startup complete.
platform-engineer-p2p  | INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
```

**🎯 Success indicator:** Wait until you see all three agents running and the supervisor reports successful connectivity checks as shown in the logs above.

## Step 3: Test the agent health

---

We can now check each agent card to see what capabilities are available. Open a new terminal and run the following command to test the agent health:

### 3.1: Weather agent card

```bash
curl http://localhost:8009/.well-known/agent.json | jq
```

### 3.2: Petstore agent card

```bash
curl http://localhost:8010/.well-known/agent.json | jq
```

### 3.3: Supervisor agent card

This is the supervisor agent card. It will show the combined capabilities of the petstore and weather agents.

```bash
curl http://localhost:8000/.well-known/agent.json | jq
```

## Step 4: Connect Multi-Agent Chat Client

Once all agents are running, start the chat client:


```bash
docker run -it --network=host ghcr.io/cnoe-io/agent-chat-cli:stable
```

**💡 Tip:** When asked to `💬 Enter token (optional): `, just press enter ⏎.

In production, your system will use a JWT or Bearer token for authentication here.

![chatcli token](images/chat-cli-token.svg)

The client will connect to the supervisor agent and show available capabilities from both petstore and weather agents.

## Step 5: Test Multi-Agent Interactions

---

### 5.1: Discovery Commands

Try these to explore the multi-agent capabilities:

```bash
What agents are available?
```

```bash
What can you help me with?
```

### 5.2: Weather-Specific Commands

---

For Earth weather data, you can use the following commands:

```bash
What's the current weather in San Francisco?
```

```bash
Give me a 5-day forecast for London
```

For Mars weather data, you can use the following commands:

```bash
What regoins in Mars can you find the weather for?
```

```bash
What is the weather right now in Arabia Terra?
```

### 5.3: Petstore Commands (from Mission 2)

```bash
Get me all the available pets
```

```bash
Show me pets with 'Hot Climate Lover' tags
```

### 5.4: Cross-Agent Scenarios

Test scenarios that require both agents:

```bash
Is it going to rain in Tokyo tomorrow and also a summary of pets by status.
```

```bash
Considering the weather in Paris right now, what is the best pet available that I can adapt? First, get all the available pets and then based on the weather, provide the best pet recommendation.
```

```bash
What is the weather right now in Arabia Terra? Based on the weather, give me a pet that is suitable for the weather and explain why you chose that pet.
```

## Step 6: [Optional] Bonus 1: STDIO mode

**⚠️ Important:** If you are already running agents in HTTP mode, first stop the docker compose before switching to STDIO mode:

```bash
docker compose -f $HOME/work/ai-platform-engineering/workshop/docker-compose.mission3.yaml --profile=p2p down
```

STDIO mode will connect petstore and weather agents to run the MCP server within the agents themselves.

* `http://localhost:8009/mcp`: mcp server containing data for the available pets retrieved from demo swagger API `https://petstore.swagger.io/v2`

* `http://localhost:8010/mcp`: mcp server that queries real weather data for Earth from the Open-Meteo API on `https://api.open-meteo.com/v1`

```bash
IMAGE_TAG=latest MCP_MODE=stdio docker compose -f workshop/docker-compose.mission3.yaml --profile=p2p up
```

## Step 7: [Optional] Bonus 2: AGNTCY SLIM Gateway

**⚠️ Important:** If you are already running agents in HTTP mode, first stop the docker compose before switching to STDIO mode:

```bash
cd $HOME/work/ai-platform-engineering
```

```bash
docker compose -f $HOME/work/ai-platform-engineering/workshop/docker-compose.mission3.yaml --profile=p2p down
```

**🌟 Bonus Challenge:** Run this with AGNTCY SLIM Gateway in the middle

```bash
cd $HOME/work/ai-platform-engineering
```

```bash
IMAGE_TAG=latest MCP_MODE=http docker compose -f workshop/docker-compose.mission3.yaml --profile=slim up
```

## Step 8: Teardown Multi-Agent System

**🛑 Before You Proceed: Bring Down Your Docker Containers**

- **Important:** Run `docker compose down` in your terminal to stop and remove all running containers for this demo before moving on to the next steps.
- This ensures a clean environment and prevents port conflicts or resource issues.

You can stop all agents by pressing `Ctrl+C` (or `Cmd+C` on Mac) in the terminal. Or if you have already closed the terminal, ensure you run the specific docker compose down command:

For p2p mode:

```bash
docker compose -f $HOME/work/ai-platform-engineering/workshop/docker-compose.mission3.yaml --profile=p2p down
```

For slim mode:

```bash
docker compose -f $HOME/work/ai-platform-engineering/workshop/docker-compose.mission3.yaml --profile=slim down
```

**Note**: Use the same `--profile` flag that you used when starting the agents.

## Mission Checks

---

### 🚀 Mars Colony Multi-Agent Mission Checklist

- [ ] **Multi-Agent Launch: All three agents (supervisor, weather, petstore) start successfully**
- [ ] **Connectivity: Supervisor reports successful connections to both subagents**
- [ ] **Cross-Agent Query: Successfully handle requests requiring both weather and petstore data**
- [ ] **Agent Coordination: Observe supervisor routing requests to appropriate specialized agents**
- [ ] **Combined Responses: Receive unified answers that incorporate data from multiple agents**
- [ ] **Bonus: Run with AGNTCY SLIM Gateway**
- [ ] **Teardown: All agents are stopped**
