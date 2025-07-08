---
sidebar_position: 1
---

# Run with Docker Compose 🚀🧑‍💻

Setup AI Platform Engineering to run in a docker environment on a latop or a virtual machine like EC2 instance.

1. **Clone the repository**

   ```bash
   git clone https://github.com/cnoe-io/ai-platform-engineering.git
   cd ai-platform-engineering
   ```

2. **Configure environment variables**

   ```bash
   cp .env.example .env
   ```

   Update `.env` with your configuration.
   📚 See the [Setup LLM Providers](../configure/configure-llms-in-docker.md) for more details.

---

## 🏁 Getting Started

1. **Launch with Docker Compose**

   ```bash
   docker-compose up
   ```

2. **Connect to the A2A agent (host network)**

   ```bash
   docker run -it --network=host ghcr.io/cnoe-io/agent-chat-cli:stable
   ```

   *Or, clone and run the chat client:*

   ```bash
   uvx https://github.com/cnoe-io/agent-chat-cli.git <a2a|mcp>
   ```

---

## 💡 Local Development

1. **Start the application**

   ```bash
   make run-ai-platform-engineer
   ```

2. **Run the client**
   ```bash
   docker run -it --network=host ghcr.io/cnoe-io/agent-chat-cli:stable
   ```

   *Or, clone and run the chat client:*

   ```bash
   uvx https://github.com/cnoe-io/agent-chat-cli.git <a2a|mcp>
   ```