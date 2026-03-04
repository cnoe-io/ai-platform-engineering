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

CAIPE is an open-source, multi-agent AI system for Platform Engineering that orchestrates specialized agents across DevOps tools via the A2A and MCP protocols.

### Project description

Community AI Platform Engineering (CAIPE, pronounced "cape") is an open-source Multi-Agent System (MAS) championed by the CNOE (Cloud Native Operational Excellence) forum. As platform engineering, SRE, and DevOps environments grow in complexity, traditional approaches lead to delays, increased operational overhead, and developer frustration. CAIPE addresses this by providing a secure, scalable, persona-driven reference implementation that orchestrates specialized AI agents—each integrating with a specific tool (ArgoCD, GitHub, PagerDuty, Jira, Slack, Kubernetes, and more)—through standardized protocols.

Built on LangGraph and LangChain, CAIPE uses the Agent-to-Agent (A2A) protocol for inter-agent communication and the Model Context Protocol (MCP) for tool integration, enabling a loosely coupled architecture where agents can be developed, deployed, and scaled independently. The system includes a curated prompt library evaluated for accuracy in agentic workflows, a Next.js web UI, enterprise-grade security with OAuth2/JWT-based agent authentication, and production-ready deployment patterns via Docker Compose and Helm charts.

CAIPE fills a gap in the cloud native ecosystem by providing a vendor-neutral, community-driven reference architecture for applying agentic AI to platform operations—enabling teams to automate complex multi-tool workflows, reduce mean time to resolution, and accelerate developer self-service, all within a cloud native stack.

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

### Website URL

https://cnoe-io.github.io/ai-platform-engineering/

### Roadmap

https://github.com/orgs/cnoe-io/projects/9

### Roadmap context

CAIPE's roadmap is organized around several key themes:

1. **Agent ecosystem expansion**: Adding new sub-agents for additional cloud native tools (Crossplane, Backstage catalog, Prometheus/Grafana, cloud provider services) and supporting community-contributed agents via a plugin registry.
2. **Enterprise hardening**: Strengthening multi-tenancy, RBAC at the agent level, audit logging, policy-based guardrails (OPA/Rego), and SOC 2-aligned operational controls.
3. **Evaluation & observability**: Building out automated evaluation pipelines (LLM-as-judge, human-in-the-loop scoring) and deep integration with tracing systems (Langfuse, OpenTelemetry) to measure agent accuracy and reliability.
4. **Knowledge base & RAG**: Expanding the retrieval-augmented generation capabilities with GraphRAG, ontology-driven entity extraction, and multi-source ingestion for organizational knowledge.
5. **Standards alignment**: Continued alignment with emerging standards—A2A protocol evolution, MCP specification updates, and CNCF ecosystem interoperability patterns.
6. **Community growth**: Expanding the contributor base through workshops (CAIPE Labs), improved onboarding docs, and cross-project collaboration within CNCF.

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
| **Backstage** | Embeddable as a plugin in Backstage for Internal Developer Portal integration |
| **Helm** | Helm charts for Kubernetes deployment; Helm-based release lifecycle |
| **OpenTelemetry** | Tracing integration via Langfuse (OTel-compatible); structured telemetry |
| **Prometheus/Grafana** | Planned integration for metrics-driven agent workflows |
| **Crossplane** | Planned agent for infrastructure-as-code operations |
| **Envoy/Gateway API** | API gateway pattern for A2A agent routing and OAuth token validation |

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
- Adopters include Outshift by Cisco, Splunk, and Demandbase
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
