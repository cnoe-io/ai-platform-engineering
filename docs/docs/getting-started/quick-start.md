---
sidebar_position: 2
---

# 🚀 Quick Start

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
   📚 See the [Getting Started Guide](https://github.com/cnoe-io/agentic-ai/wiki/Getting%E2%80%90Started) for more details.

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