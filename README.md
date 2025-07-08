# 🤖 AI Platform Engineering Multi-Agent System

[![Python](https://img.shields.io/badge/python-3.13%2B-blue?logo=python)](https://www.python.org/)
[![Docker](https://img.shields.io/badge/docker-%231572B6.svg?logo=docker\&logoColor=white)](https://www.docker.com/)
[![Publish Docs](https://github.com/cnoe-io/ai-platform-engineering/actions/workflows/publish-gh-pages.yml/badge.svg)](https://github.com/cnoe-io/ai-platform-engineering/actions/workflows/publish-gh-pages.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-green)](LICENSE)

---

## Agentic AI SIG Community

🚀 [Getting Started](https://github.com/cnoe-io/agentic-ai/wiki/Getting%E2%80%90Started) | 🎥 [Meeting Recordings](https://github.com/cnoe-io/agentic-ai/wiki/Meeting-Recordings) | 🏛️ [Governance](https://github.com/cnoe-io/governance/tree/main/sigs/agentic-ai) | 🗺️ [Roadmap](https://github.com/orgs/cnoe-io/projects/9)

### 🗓️ Weekly Meetings

* **Every Thursday**
  * 🕕 18:00–19:00 CET | 🕔 17:00–18:00 London | 🕘 09:00–10:00 PST
* 🔗 [Webex Meeting](https://go.webex.com/meet/cnoe) | 📅 [Google Calendar](https://calendar.google.com/calendar/u/0/embed?src=064a2adfce866ccb02e61663a09f99147f22f06374e7a8994066bdc81e066986@group.calendar.google.com&ctz=America/Los_Angeles) | 📥 [.ics Download](cnoe-agentic-ai-meeting-invite.ics)

### 💬 Slack

* Not in CNCF Slack? [Join here first](https://communityinviter.com/apps/cloud-native/cncf)
* [Join #cnoe-sig-agentic-ai channel](https://cloud-native.slack.com/archives/C08N0AKR52S)

## Overview

**AI Platform Engineer** is a multi-agent system that streamlines platform operations by integrating with essential engineering tools:

* 🚨 **PagerDuty** for incident management
* 🐙 **GitHub** for version control
* 🗂️ **Jira** for project management
* 💬 **Slack** for communication
* 🚀 **ArgoCD** for continuous deployment

Each tool is managed by a specialized agent that automatically handles user requests such as acknowledging incidents, merging pull requests, creating Jira tickets, sending Slack messages, and syncing ArgoCD applications.

Just describe your task—**the platform intelligently routes your request to the right agent and tool**, ensuring efficient, reliable execution across your engineering workflows.

> *If your request isn’t supported, you’ll get a friendly message letting you know!*

---

## 💡 Examples

**AI Platform Engineer** can handle a wide range of operational requests. Here are some sample prompts you can try:

* 🚨 *Acknowledge the PagerDuty incident with ID 12345*
* 🚨 *List all on-call schedules for the DevOps team*
* 🐙 *Create a new GitHub repository named 'my-repo'*
* 🐙 *Merge the pull request #42 in the ‘backend’ repository*
* 🗂️ *Create a new Jira ticket for the ‘AI Project’*
* 🗂️ *Assign ticket 'PE-456' to user 'john.doe'*
* 💬 *Send a message to the ‘devops’ Slack channel*
* 💬 *Create a new Slack channel named ‘project-updates’*
* 🚀 *Sync the ‘production’ ArgoCD application to the latest commit*
* 🚀 *Get the status of the 'frontend' ArgoCD application*

---

## 📦 Installation

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
   docker compose up
   ```

2. **Launching with Komodor Agent**

   To include the Komodor agent in your deployment, run Docker Compose with the override file:

   ```bash
   docker compose -f docker-compose.yaml -f docker-compose.komodor.yaml up
   ```

3. **Connect to the A2A agent (host network)**

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
---

## 📊 Tracing & Evaluation

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

---

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

## 🤝 Contributing

Contributions welcome!
To get started:

1. **Fork** this repository
2. **Create a branch** for your feature or fix
3. **Open a Pull Request** with a clear description

For larger changes, open an [discussion](https://github.com/cnoe-io/ai-platform-engineering/discussions) first to discuss.

---

## 📄 License

Licensed under the [Apache-2.0 License](LICENSE).

---

> *Made with ❤️ by the CNOE Contributors
