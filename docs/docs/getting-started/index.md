---
sidebar_position: 1
---

# Overview

CAIPE is an open-source AI platform for building, deploying, governing, and
operating AI agents and agentic workflows for platform engineering.

CAIPE provides a complete cloud-native AI platform combining agent creation,
runtime execution, workflow automation, skills and MCP integrations, enterprise
knowledge, persistent memory, identity and authorization, observability, and
multi-channel user experiences.

The included Platform Engineer experience demonstrates these capabilities by
integrating with engineering tools such as:

- 🚀 **ArgoCD** for continuous deployment for Kubernetes applications
- 🚨 **PagerDuty** for incident management
- 🐙 **GitHub** for github repos, issues, PRs
- 🗂️ **Jira** for project/task management
- 💬 **Slack** for communication channels

Each integration exposes tools that an authorized agent can use for requests
such as acknowledging incidents, creating pull requests, working with tickets,
and synchronizing Argo CD applications.

Users can also create Dynamic Agents, attach approved MCP tools and skills,
connect knowledge, build workflows, schedule work, and deliver agent experiences
through Web, CLI, Slack, and Webex.


> In this guide, you’ll be running the **Platform Engineer** multi-agent system as the baseline example. This setup is designed to showcase core features and integrations for platform operations.
> For additional persona-based use cases (such as SRE, Developer, or custom workflows), please refer to the [usecases](../usecases/platform-engineer.md) section of the documentation.

See the [Platform Capabilities](../features/platform-capabilities.md),
[User Guide](../user-guide/index.md), and
[Administrator Guide](../admin-guide/index.md) for the complete released
feature set.

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
