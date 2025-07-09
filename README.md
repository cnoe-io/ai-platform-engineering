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

## What is AI Platform Engineering?

As Platform Engineering, SRE, and DevOps environments grow in complexity, traditional approaches often lead to delays, increased operational overhead, and developer frustration. By adopting Multi-Agentic Systems and Agentic AI, Platform Engineering teams can move from manual, task-driven processes to more adaptive and automated operations, better supporting development and business goals.

**AI Platform Engineering** provides a multi-agent system that streamlines platform operations through persona-driven “usecase agents” such as _Platform Engineer_, _Incident Engineer_, and _Product Owner_ etc. Each usecase agent is empowered by a set of specialized sub-agents that integrate seamlessly with essential engineering tools. Below are some common platform agents leveraged by the persona agents:

* 🚀 **ArgoCD Agent** for continuous deployment
* 🚨 **PagerDuty Agent** for incident management
* 🐙 **GitHub Agent** for version control
* 🗂️ **Jira Agent** for project management
* 💬 **Slack Agent** for team communication

Together, these sub-agents enable automated, high-fidelity operations across your platform by executing tasks, invoking APIs, and interacting with tools on behalf of the user. The system also includes:

* **A curated prompt library**: This is a carefully evaluated collection of prompts designed for high accuracy and optimal workflow performance in multi-agent systems. These prompts guide persona agents (such as "Platform Engineer" or "Incident Engineer") using standardized instructions and questions, ensuring effective collaboration, incident response, platform operations, and knowledge sharing.
* **Developer APIs and end-user interfaces**: Easily invoke agentic workflows programmatically or through intuitive UIs, enabling seamless integration with existing engineering processes.
* **End-to-end security**: Secure agentic communication and task execution across all agents, ensuring data privacy and compliance for enterprise environments.

Simply describe your task—**the platform intelligently routes your request to the appropriate persona agent, which coordinates with the relevant platform agents to interact with the right tools**, ensuring efficient and reliable execution across all your engineering workflows.

*...and many more platform agents are available for additional tools and use cases. For detailed information on project goals and our community, head to our [documentation site](https://cnoe-io.github.io/ai-platform-engineering/).*

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

## 📦 Quick Doc Links

- [Quick Start Guide](https://cnoe-io.github.io/ai-platform-engineering/getting-started/quick-start)
- Setup
    - [Docker Compose](https://cnoe-io.github.io/ai-platform-engineering/getting-started/docker-compose/setup)
- [Local Development setup](https://cnoe-io.github.io/ai-platform-engineering/getting-started/local-development)
- [Run Agents for Tracing & Evaluation](https://cnoe-io.github.io/ai-platform-engineering/getting-started/local-development#-run-agents-for-tracing--evaluation)
- [Adding new agents](https://cnoe-io.github.io/ai-platform-engineering/getting-started/local-development#%EF%B8%8F-adding-new-agents)

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

> *Made with ❤️ by the [CNOE Contributors](https://cnoe.io/)
