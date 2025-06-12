# 🤖 AI Platform Engineering Multi-Agent System

[![Python](https://img.shields.io/badge/python-3.13%2B-blue?logo=python)](https://www.python.org/)
[![Docker](https://img.shields.io/badge/docker-%231572B6.svg?logo=docker\&logoColor=white)](https://www.docker.com/)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-green)](LICENSE)

---

## 🚀 Overview

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
   git clone https://github.com/your-org/ai-platform-engineering.git
   cd ai-platform-engineering
   ```

3. **Configure environment variables**

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

## 💡 Usage

1. **Start the application**

   ```bash
   python main.py
   ```

2. **Open the web interface:**
   [http://localhost:8000](http://localhost:8000)

3. **Test the FastAPI endpoint**

   ```bash
   curl --location 'http://localhost:5001/agent/prompt' \
     --header 'Content-Type: application/json' \
     --data '{
         "prompt": "show all who is oncall on SRE and also show my repos in sriaradhyula org that are agent in name and send this info to slack channel test-channel"
     }'
   ```

---

## 🗂️ Project Structure

```
ai-platform-engineering/
├── src/                # Source code for the platform
├── tests/              # Unit and integration tests
├── docs/               # Documentation and resources
├── scripts/            # Utility scripts
├── .env.example        # Example environment variables
├── requirements.txt    # Python dependencies
└── README.md           # Project documentation
```

---

## 🤝 Contributing

Contributions welcome!
To get started:

1. **Fork** this repository
2. **Create a branch** for your feature or fix
3. **Open a Pull Request** with a clear description

For larger changes, open an [issue](https://github.com/your-org/ai-platform-engineering/issues) first to discuss.

---

## 📄 License

Licensed under the [Apache-2.0 License](LICENSE).

---

> *Inspired by [agent-argocd](https://github.com/cnoe-io/agent-argocd)*
> *Made with ❤️ by the CNOE Contributors
