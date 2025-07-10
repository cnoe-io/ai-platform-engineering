---
sidebar_position: 7
---

# 💡 Local Development

1. **Clone the repository**

   ```bash
   git clone https://github.com/cnoe-io/ai-platform-engineering.git
   cd ai-platform-engineering
   ```

2. **Start the application**

   ```bash
   make run-ai-platform-engineer
   ```

3. **Run the client**
   ```bash
   docker run -it --network=host ghcr.io/cnoe-io/agent-chat-cli:stable
   ```

   *Or, clone and run the chat client:*

   ```bash
   uvx https://github.com/cnoe-io/agent-chat-cli.git <a2a|mcp>
   ```

## 📊 Run Agents for Tracing & Evaluation

Enable observability and evaluation with Langfuse v3:

1. **In .env file**
   ```bash
   ENABLE_TRACING=true
   ```

2. **Start with tracing enabled**
   ```bash
   docker-compose down
   docker-compose --profile tracing up
   ```

3. **Access Langfuse dashboard** at `http://localhost:3000` and create an account and apply for API key

4. **Configure Langfuse keys in `.env` and rebuild the platform-engineer**
   ```bash
   LANGFUSE_PUBLIC_KEY=your-public-key
   LANGFUSE_SECRET_KEY=your-secret-key
   ```

   ```bash
   docker-compose --profile tracing build ai-platform-engineer-tracing
   ```

5. **Add LLM keys for evaluator in Langfuse settings** for automated trace analysis

## 🛠️ Adding New Agents

When adding a new agent to the system:

1. **Create the agent code** in `ai_platform_engineering/agents/your-agent-name/`

2. **Auto-generate Helm configuration** by running:
   ```bash
   python scripts/add-new-agent-helm-chart.py
   ```

   This script will automatically:
   - Add new dependency in `helm/Chart.yaml`
   - Bump the chart version
   - Add agent sections to all values files
   - Generate ingress and secrets configurations

3. **Review and customize** the generated configuration files as needed

4. **Test the configuration**:
   ```bash
   helm template ./helm
   helm dependency update ./helm
   ```