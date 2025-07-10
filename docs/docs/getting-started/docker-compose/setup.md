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
   📚 See the [Setup LLM Providers](configure-llms.md) for more details.

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
3. [Optional] Connect to A2A Agent via backstage agent-forge plug-in

    ```bash
    # Once the container is started, open agent-forge in browser (in test mode)
    https://localhost:3000
    ```

---

> 🛠️ *For local development setup, check out the [Local Development Guide](local-development.md).*
