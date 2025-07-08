---
sidebar_position: 1
---

# Overview

**AI Platform Engineer** is a multi-agent system that streamlines platform operations by integrating with essential engineering tools:

- 🚀 **ArgoCD** for continuous deployment for Kubernetes applications
- 🚨 **PagerDuty** for incident management
- 🐙 **GitHub** for github repos, issues, PRs
- 🗂️ **Jira** for project/task management
- 💬 **Slack** for communication channels

Each tool is managed by a specialized agent that automatically handles user requests—such as acknowledging incidents, merging pull requests, creating Jira tickets, sending Slack messages, and syncing ArgoCD applications.

Just describe your task — **the platform intelligently routes your request to the right agent and tool**, ensuring efficient, reliable execution across your engineering workflows.


> In this guide, you’ll be running the **Platform Engineer** multi-agent system as the baseline example. This setup is designed to showcase core features and integrations for platform operations.
> For additional persona-based use cases (such as SRE, Developer, or custom workflows), please refer to the [usecases](../usecases) section of the documentation.

---

## 💡 Example Prompts

Here are some sample requests you can try with **Platform Engineer**:

- 🚨 *Acknowledge the PagerDuty incident with ID 12345*
- 🚨 *List all on-call schedules for the DevOps team*
- 🐙 *Create a new GitHub repository named 'my-repo'*
- 🐙 *Merge the pull request #42 in the ‘backend’ repository*
- 🗂️ *Create a new Jira ticket for the ‘AI Project’*
- 🗂️ *Assign ticket 'PE-456' to user 'john.doe'*
- 💬 *Send a message to the ‘devops’ Slack channel*
- 💬 *Create a new Slack channel named ‘project-updates’*
- 🚀 *Sync the ‘production’ ArgoCD application to the latest commit*
- 🚀 *Get the status of the 'frontend' ArgoCD application*