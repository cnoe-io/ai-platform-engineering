---
title: "CNCF Sandbox Application Draft"
description: Draft application for CAIPE to join the CNCF Sandbox
authors: [sriaradhyula]
tags: [articles]
draft: true
---

# [Sandbox] CAIPE (Community AI Platform Engineering)

> Draft application for [CNCF Sandbox](https://github.com/cncf/sandbox/issues/new?assignees=&labels=New&projects=&template=application.yml&title=%5BSandbox%5D+CAIPE).
> Copy each section into the corresponding field of the GitHub issue form.

<!-- truncate -->

---

## Basic project information

### Project summary

Community AI Platform Engineering (CAIPE, pronounced “cape”) is an open-source distributed Multi-Agent System (MAS) for platform engineering and cloud-native operations. CAIPE orchestrates specialized AI agents across Kubernetes platforms, cloud-native infrastructure, DevOps tooling, and project management systems using standardized interoperability protocols such as Agent-to-Agent (A2A) and the Model Context Protocol (MCP).

CAIPE integrates extensible knowledge bases that support retrieval-augmented generation (RAG), GraphRAG, and persistent agent memory. These capabilities allow agents to extract, store, and recall operational facts from documentation, system state, and previous workflows, enabling more reliable reasoning across complex Kubernetes and cloud-native environments.

By combining agent orchestration, curated platform engineering skills, persistent memory, and structured workflows, CAIPE enables teams to build predictable, auditable automation across modern platform engineering stacks.

### Project description

Community AI Platform Engineering (CAIPE, pronounced “cape”) is an open source Multi-Agent System (MAS) championed by the CNOE (Cloud Native Operational Excellence) forum. As platform engineering, SRE, and DevOps environments grow in complexity, traditional approaches often lead to operational delays, fragmented tooling, and developer friction. CAIPE addresses this by providing a secure and scalable persona-driven reference implementation that orchestrates specialized AI agents. Each agent integrates securely with platform tools such as ArgoCD, Backstage, GitHub, PagerDuty, Jira, Slack, and Kubernetes using standardized interoperability protocols.

Built on LangGraph and LangChain, CAIPE uses the Agent-to-Agent (A2A) protocol for inter-agent communication and the Model Context Protocol (MCP) for tool integration. This architecture enables agents to be developed, deployed, and scaled independently while securely interacting with Kubernetes platforms, cloud native infrastructure, and operational tooling.

The platform includes a curated prompt and skills library evaluated for reliability in agentic workflows, a modern AI-native user interface for interacting with agents, extensible integration plugins for developer platforms such as Backstage, and a command line interface for automation and developer workflows. The system also includes enterprise-grade security with OAuth2 and JWT-based agent authentication and production-ready deployment patterns using Docker Compose and Helm charts.

CAIPE also provides extensible knowledge bases that support retrieval-augmented generation (RAG) and GraphRAG. These knowledge systems enable agents to reason over both unstructured documentation and structured relationships between systems, services, and operational data. In addition, CAIPE supports persistent agent memory, fact extraction, and recall. Agents can extract operational knowledge from workflows, incident investigations, and platform telemetry, store these facts in shared knowledge systems, and reuse them in future tasks.

This capability allows agents to maintain contextual awareness across workflows in Kubernetes and cloud native environments. For example, agents can recall prior incidents, service dependencies, deployment history, and troubleshooting outcomes when assisting with new operational tasks. This reduces repeated investigation and improves operational efficiency.

The platform also includes built-in tracing, evaluation, and workflow observability to ensure predictable and auditable automation. Curated platform engineering skills encode operational best practices for common tasks such as incident investigation, GitOps deployment workflows, and platform diagnostics.

CAIPE fills a gap in the cloud native ecosystem by providing a vendor-neutral and community-driven reference architecture for applying agentic AI to platform engineering and operations. It enables teams to automate complex workflows across multiple tools, reduce mean time to resolution (MTTR), and accelerate developer self-service while maintaining transparency, governance, and operational reliability within modern Kubernetes and cloud native platforms.

---

## Project details

### Org repo URL

https://github.com/cnoe-io

### Project repo URL in scope of application

https://github.com/cnoe-io/ai-platform-engineering

### Additional repos in scope of the application

- https://github.com/cnoe-io/agent-chat-cli — CLI client for A2A agent interaction
- https://github.com/cnoe-io/openapi-mcp-codegen — OpenAPI-to-MCP server code generator
- https://github.com/cnoe-io/cnoe-agent-utils — Shared Python utilities for CAIPE agents
- https://github.com/cnoe-io/community-plugins/tree/agent-forge-upstream-docker/workspaces/agent-forge — Agent Forge Backstage plugin (upstream contribution to [backstage/community-plugins](https://github.com/backstage/community-plugins/blob/main/workspaces/agent-forge/plugins/agent-forge/README.md), published as [@caipe/plugin-agent-forge](https://www.npmjs.com/package/@caipe/plugin-agent-forge) on npm)

### Website URL

https://cnoe-io.github.io/ai-platform-engineering/

### Roadmap

Here is a **more concise CNCF-appropriate version** while keeping the important signals (open roadmap, ecosystem alignment, knowledge systems, and community growth):

---

### Roadmap context

CAIPE’s roadmap is developed openly through GitHub issues and community working groups and is tracked in the project roadmap board.

Project roadmap:
[https://github.com/orgs/cnoe-io/projects/9](https://github.com/orgs/cnoe-io/projects/9)

Issues and feature discussions:
[https://github.com/cnoe-io/ai-platform-engineering/issues](https://github.com/cnoe-io/ai-platform-engineering/issues)

Key roadmap themes include:

1. **Agent ecosystem expansion**
   Adding new agents for cloud native and platform engineering tools such as Crossplane, Backstage catalog, Prometheus/Grafana, and cloud provider services, along with a plugin registry for community-contributed agents.

2. **Enterprise hardening**
   Improving multi-tenancy, agent-level RBAC, audit logging, and policy-based guardrails using technologies such as OPA/Rego.

3. **Evaluation and observability**
   Expanding automated evaluation pipelines and integrating with observability platforms such as Langfuse and OpenTelemetry to measure agent reliability and workflow execution.

4. **Knowledge systems**
   Enhancing RAG capabilities with GraphRAG, ontology-driven entity extraction, persistent memory, and multi-source ingestion of organizational knowledge.

5. **Standards alignment**
   Continued alignment with emerging agent interoperability standards such as A2A and MCP, and integration patterns across the cloud native ecosystem.

6. **Community growth**
   Expanding contributors through working groups, improved onboarding, and community workshops such as CAIPE Labs.

Project documentation:
[https://cnoe-io.github.io/ai-platform-engineering/](https://cnoe-io.github.io/ai-platform-engineering/)

### Contributing guide

https://github.com/cnoe-io/ai-platform-engineering/blob/main/CONTRIBUTING.md

### Code of Conduct (CoC)

https://github.com/cnoe-io/governance/blob/main/CODE-OF-CONDUCT.md

### Adopters

https://github.com/cnoe-io/ai-platform-engineering/blob/main/ADOPTERS.md

### Maintainers file

https://github.com/cnoe-io/ai-platform-engineering/blob/main/MAINTAINERS.md

### Security policy file

https://github.com/cnoe-io/ai-platform-engineering/blob/main/SECURITY.md

### Standard or specification?

N/A. CAIPE is not a standard or specification. It is a reference implementation that builds on existing open protocols—specifically Google's Agent-to-Agent (A2A) protocol and Anthropic's Model Context Protocol (MCP)—to provide a practical, deployable multi-agent system for platform engineering.

### Business product or service to project separation

CAIPE originated as an open-source initiative within the CNOE (Cloud Native Operational Excellence) community, a CNCF-affiliated forum. While contributors from Cisco (Outshift), Splunk, and other organizations participate, CAIPE is not the upstream version of any commercial product. It operates under its own open governance within the CNOE Agentic AI SIG, with community-elected maintainers from multiple organizations. All development happens in the open on GitHub, and the project's roadmap is driven by community consensus. Contributing organizations may use CAIPE internally or build internal tooling on top of it, but the project itself is community-owned and vendor-neutral.

---

## Cloud native context

### Why CNCF?

CAIPE is built for and by the cloud native community. Joining the CNCF would:

1. **Accelerate adoption**: CNCF's neutral governance and brand recognition would attract a broader contributor and adopter base across the platform engineering ecosystem.
2. **Strengthen interoperability**: Being part of the CNCF landscape alongside projects like Argo, Backstage, Kubernetes, and Prometheus would formalize integration patterns and encourage co-development with these projects' communities.
3. **Ensure long-term sustainability**: CNCF governance provides a stable, vendor-neutral home that ensures the project's continuity beyond any single organization's involvement.
4. **Advance the ecosystem**: Agentic AI applied to platform operations is an emerging area. CNCF hosting would signal to the industry that this is a serious, production-quality approach, and provide a focal point for best practices around AI-assisted cloud native operations.

The CNOE forum, which champions CAIPE, already operates within the CNCF ecosystem and many CAIPE contributors are active participants in other CNCF projects and TAGs.

### Benefit to the landscape

CAIPE benefits the Cloud Native Landscape by:

1. **Bridging AI and cloud native operations**: There is currently no CNCF project that provides a reference architecture for applying multi-agent AI systems to platform engineering workflows. CAIPE fills this gap.
2. **Unifying tool interaction**: Platform teams use many CNCF and adjacent tools (Argo, Kubernetes, Prometheus, Backstage). CAIPE provides a unified conversational and agentic interface across all of them, reducing context-switching and operational friction.
3. **Pioneering protocol-based agent interoperability**: By building on A2A and MCP protocols, CAIPE demonstrates how AI agents can be composed in a loosely coupled, cloud native manner—similar to how microservices communicate via gRPC/REST.
4. **Lowering the barrier for AI adoption**: CAIPE gives platform teams a production-ready starting point for incorporating AI into their workflows, with enterprise security, observability, and deployment patterns built in.

### Cloud native 'fit'

CAIPE is cloud native by design:

- **Containerized**: Every component (supervisor, sub-agents, UI, RAG services) runs as an independent container, deployable via Docker Compose or Kubernetes.
- **Orchestrated**: Helm charts provide production-grade Kubernetes deployment with configurable resource limits, HPA, health checks, and rolling updates.
- **Microservices architecture**: Sub-agents communicate via the A2A protocol over HTTP, enabling independent scaling, deployment, and lifecycle management.
- **Stateless compute with external state**: Agent state is managed via Redis (persistence) and Milvus (vector store), following cloud native patterns for state externalization.
- **Observable**: Integrated with OpenTelemetry-compatible tracing (Langfuse), structured logging, and health endpoints.
- **Declarative configuration**: Agent behavior, personas, prompts, and tool configurations are defined declaratively in YAML files.
- **Infrastructure-agnostic**: Runs on any Kubernetes cluster (EKS, GKE, AKS, on-prem) or locally via Docker Compose.

### Cloud native 'integration'

CAIPE complements and integrates with the following CNCF projects:

| CNCF Project | Integration |
|---|---|
| **Kubernetes** | Primary deployment target; dedicated Kubernetes agent for cluster operations |
| **Argo** (ArgoCD) | Dedicated ArgoCD agent for GitOps deployment management |
| **Backstage** | [Agent Forge plugin](https://github.com/backstage/community-plugins/blob/main/workspaces/agent-forge/plugins/agent-forge/README.md) contributed upstream to backstage/community-plugins for Internal Developer Portal integration |
| **Helm** | Helm charts for Kubernetes deployment; Helm-based release lifecycle |
| **OpenTelemetry** | Tracing integration via Langfuse (OTel-compatible); structured telemetry |
| **Prometheus/Grafana** | Planned integration for metrics-driven agent workflows |

### Cloud native overlap

There is no direct overlap with existing CNCF projects. While projects like **Backstage** provide a developer portal UI and **Argo** provides GitOps capabilities, CAIPE operates at a different layer—it is an AI orchestration system that *uses* these tools through agents rather than replacing them. CAIPE is complementary: it provides an intelligent, conversational interface on top of existing CNCF tools.

The closest conceptual overlap is with **Backstage** in terms of being a "unified interface for platform operations," but the approaches are fundamentally different—Backstage is a plugin-based UI framework while CAIPE is an AI agent orchestration system. In practice, CAIPE can be embedded as a Backstage plugin.

### Similar projects

- **LangGraph** (LangChain ecosystem): A framework for building agent workflows. CAIPE *uses* LangGraph as its agent runtime but provides the full platform engineering application layer (agents, tools, deployment, UI) on top of it.
- **CrewAI / AutoGen**: Multi-agent frameworks. These are general-purpose agent orchestration libraries; CAIPE is a purpose-built platform engineering solution with production deployment patterns, security, and cloud native tool integrations.
- **Kubiya**: A commercial AI platform for DevOps automation. CAIPE is open source, community-driven, and vendor-neutral.
- **Cline / Aider**: AI coding assistants. These focus on code generation; CAIPE focuses on platform operations.

No existing CNCF project directly addresses multi-agent AI orchestration for platform engineering.

### Landscape

CAIPE is not yet listed on the [Cloud Native Landscape](https://landscape.cncf.io/). We would anticipate placement in a new or emerging category related to **AI/ML for Platform Operations** or under **Automation & Configuration** within the landscape.

---

## CNCF policies

### Trademark and accounts

- [x] If the project is accepted, I agree to donate all project trademarks and accounts to the CNCF

### IP policy

- [x] If the project is accepted, I agree the project will follow the CNCF IP Policy

### Will the project require a license exception?

N/A. CAIPE is licensed under Apache 2.0, which is the standard CNCF license. All dependencies are compatible with the CNCF Allowlist License Policy.

### Project "Domain Technical Review"

*[To be completed — the project has not yet engaged with a TAG for a formal presentation. We plan to engage with TAG App Delivery and/or TAG Runtime for a Domain Technical Review prior to the sandbox application review.]*

---

## Contact information

### Application contact email(s)

cnoe-steering@googlegroups.com

### Contributing or sponsoring entity signatory information

If an individual or individual(s):

| Name | Country | Email address |
|---|---|---|
| *[To be filled by maintainers]* | | |
| | | |

---

## Additional information

### CNCF contacts

- The CAIPE project is championed by the CNOE (Cloud Native Operational Excellence) community, which has established relationships within the CNCF ecosystem.
- Several CAIPE contributors are active in CNCF TAGs and working groups.
- *[List specific TOC/TAG members familiar with the project if applicable]*

### Additional information

**Community engagement and traction:**
- 316+ GitHub stars, 46+ forks, 3,055+ commits as of March 2026
- 32 releases with active development cadence (multiple releases per week)
- 77+ Architecture Decision Records documenting project evolution
- Weekly community meetings (CNOE Agentic AI SIG) with participants from multiple organizations
- Active Slack channel (#cnoe-sig-agentic-ai) on CNCF Slack
- [Adopters include Outshift by Cisco, Splunk, and Demandbase](https://github.com/cnoe-io/ai-platform-engineering/blob/main/ADOPTERS.md)
- Comprehensive documentation site with getting-started guides, architecture docs, and workshops (CAIPE Labs)

**Technical maturity indicators:**
- Extensive CI/CD pipeline with 30+ GitHub Actions workflows covering build, test, lint, security scanning, and release automation
- Conventional commits enforcement, automated dependency updates (Dependabot), and code ownership (CODEOWNERS)
- Helm chart with production-ready configuration for multi-node and single-node deployment modes
- Integration test suites for supervisor, multi-agent, and individual agent components
- Security policy with responsible disclosure process and GitHub Security Advisories

**Governance:**
- Governed by the CNOE Agentic AI SIG: https://github.com/cnoe-io/governance/tree/main/sigs/agentic-ai
- Open governance with community-driven roadmap and decision-making
- DCO (Developer Certificate of Origin) required for all contributions
