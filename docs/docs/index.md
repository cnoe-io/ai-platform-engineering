---
sidebar_position: 1
---

# Introduction

## What is AI Platform Engineering

As [Platform Engineering](https://platformengineering.org/blog/what-is-platform-engineering), [SRE](https://en.wikipedia.org/wiki/Site_reliability_engineering) and [DevOps](https://en.wikipedia.org/wiki/DevOps) environments grow in complexity, traditional approaches to problem solving can introduce delays and increase operational overhead for teams. Developers may experience frustration when workflows become inefficient or manual processes accumulate.

![Intro](images/intro.svg)

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


## Goals of the project

- Enable Platform Engineering teams with a curated, validated set of persona-specific multi-agent systems (MAS) tailored to their unique enterprise requirements.

- Foster an ecosystem of AI Platform Engineering practitioners to collaboratively develop high-quality, reusable prompt engineering libraries and commonly used platform tools.
- A carefully curated library of meta-prompts, continuously evaluated for effectiveness with both our agents and the MCP server to drive optimal performance in agentic workflows.


## Who we are

We are Platform Engineers, SREs, and Developers from a variety of companies in the [CNCF](https://www.cncf.io/) and [CNOE.io](https://cnoe.io/) ecosystems, passionate about open source and advancing the use of agentic AI in Platform Engineering.