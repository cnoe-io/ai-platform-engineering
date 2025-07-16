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


---
## Run Individual Agent

### 🤖 ⚙️ LLM Provider Configuration

Each agent supports one of the following LLM providers. Choose one and uncomment it in your `.env` file:

```env
########### LLM PROVIDER CONFIGURATION ###########

# --- AWS Bedrock ---
# LLM_PROVIDER=aws-bedrock
# AWS_ACCESS_KEY_ID=
# AWS_SECRET_ACCESS_KEY=
# AWS_REGION=
# AWS_BEDROCK_MODEL_ID=
# AWS_BEDROCK_PROVIDER="amazon"

# --- Azure OpenAI ---
# LLM_PROVIDER=azure-openai
# AZURE_OPENAI_API_KEY=
# AZURE_OPENAI_ENDPOINT=
# AZURE_OPENAI_DEPLOYMENT=
# AZURE_OPENAI_API_VERSION=

# --- OpenAI ---
# LLM_PROVIDER=openai
# OPENAI_API_KEY=
# OPENAI_ENDPOINT=
# OPENAI_MODEL_NAME=
```

> 💡 For the latest supported providers and `.env` examples, see:
> [https://github.com/cnoe-io/cnoe-agent-utils](https://github.com/cnoe-io/cnoe-agent-utils)


### 🔁 ArgoCD Agent

#### ⚙️ `.env` Configuration

```env
# === ArgoCD Agent Configuration ===
ARGOCD_TOKEN=
ARGOCD_API_URL=
ARGOCD_VERIFY_SSL=true
```

Combine this with the **LLM Provider Configuration** above in a single `.env` file.

#### ▶️ Run the ArgoCD Agent

```bash
docker pull ghcr.io/cnoe-io/agent-argocd:a2a-stable
docker run -p 8000:8000 -it \
  -v $(pwd)/.env:/app/.env \
  ghcr.io/cnoe-io/agent-argocd:a2a-stable
```

---

### 🧾 Jira Agent

#### ⚙️ `.env` Configuration

```env
# === Atlassian Agent Configuration ===
ATLASSIAN_TOKEN=
ATLASSIAN_EMAIL=
ATLASSIAN_API_URL=
```

Include the **LLM Provider Configuration** as well.

#### ▶️ Run the Atlassian Agent

```bash
docker pull ghcr.io/cnoe-io/agent-jira:a2a-stable
docker run -p 8000:8000 -it \
  -v $(pwd)/.env:/app/.env \
  ghcr.io/cnoe-io/agent-jira:a2a-stable
```

---

### 🧑‍💻 GitHub Agent

#### ⚙️ `.env` Configuration

```env
# === GitHub Agent Configuration ===
GITHUB_PERSONAL_ACCESS_TOKEN=
```

Include the **LLM Provider Configuration** in the same `.env`.

#### ▶️ Run the GitHub Agent

```bash
docker pull ghcr.io/cnoe-io/agent-github:a2a-stable
docker run -p 8000:8000 -it \
  -v $(pwd)/.env:/app/.env \
  -v /var/run/docker.sock:/var/run/docker.sock \
  ghcr.io/cnoe-io/agent-github:a2a-stable
```

---

### 🚨 PagerDuty Agent

#### ⚙️ `.env` Configuration

```env
# === PagerDuty Agent Configuration ===
PAGERDUTY_API_KEY=
PAGERDUTY_API_URL=https://api.pagerduty.com
```

Add the LLM block to the same `.env` file.

### ▶️ Run the PagerDuty Agent

```bash
docker pull ghcr.io/cnoe-io/agent-pagerduty:a2a-stable
docker run -p 8000:8000 -it \
  -v $(pwd)/.env:/app/.env \
  ghcr.io/cnoe-io/agent-pagerduty:a2a-stable
```

---

## 💬 Slack Agent

### ⚙️ `.env` Configuration

```env
# === Slack Agent Configuration ===
SLACK_BOT_TOKEN=
SLACK_APP_TOKEN=
SLACK_SIGNING_SECRET=
SLACK_CLIENT_SECRET=
SLACK_TEAM_ID=
```

Don’t forget to include the LLM provider block in your `.env`.

### ▶️ Run the Slack Agent

```bash
docker pull ghcr.io/cnoe-io/agent-slack:a2a-stable
docker run -p 8000:8000 -it \
  -v $(pwd)/.env:/app/.env \
  ghcr.io/cnoe-io/agent-slack:a2a-stable
```