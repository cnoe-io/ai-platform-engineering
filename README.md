# 🤖 CAIPE: Community AI Platform Engineering Multi-Agent System

[![Python](https://img.shields.io/badge/python-3.13%2B-blue?logo=python)](https://www.python.org/)
[![Publish Docs](https://github.com/cnoe-io/ai-platform-engineering/actions/workflows/publish-gh-pages.yml/badge.svg)](https://github.com/cnoe-io/ai-platform-engineering/actions/workflows/publish-gh-pages.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-green)](LICENSE)

## Agentic AI SIG Community

🚀 [Getting Started](https://cnoe-io.github.io/ai-platform-engineering/getting-started/quick-start) | 🎥 [Meeting Recordings](https://github.com/cnoe-io/agentic-ai/wiki/Meeting-Recordings) | 🏛️ [Governance](https://github.com/cnoe-io/governance/tree/main/sigs/agentic-ai) | 🗺️ [Roadmap](https://github.com/orgs/cnoe-io/projects/9)

### 🗓️ Weekly Meetings

* **Every Monday**
  * 🕕 19:00–20:00 CET | 🕔 18:00–19:00 GMT (London) | 🕘 10:00–11:00 PST
* 🔗 [Webex Meeting](https://go.webex.com/meet/cnoe) | 📅 [Google Calendar](https://calendar.google.com/calendar/u/0/embed?src=064a2adfce866ccb02e61663a09f99147f22f06374e7a8994066bdc81e066986@group.calendar.google.com&ctz=America/Los_Angeles) | 📥 [.ics Download](https://github.com/cnoe-io/ai-platform-engineering/raw/main/docs/docs/community/cnoe-sig-agentic-ai-community-meeting.ics)

### 💬 Slack

* Not in CNCF Slack? [Join here first](https://communityinviter.com/apps/cloud-native/cncf)
* [Join #cnoe-sig-agentic-ai channel](https://cloud-native.slack.com/archives/C08N0AKR52S)

## [Note: Use latest docs to get started](https://cnoe-io.github.io/ai-platform-engineering)

## What is AI Platform Engineering?

As Platform Engineering, SRE, and DevOps environments grow in complexity, traditional approaches often lead to delays, increased operational overhead, and developer frustration. By adopting Multi-Agentic Systems and Agentic AI, Platform Engineering teams can move from manual, task-driven processes to more adaptive and automated operations, better supporting development and business goals.

![](docs/docs/ui/images/ui-usecases.svg)

**Community AI Platform Engineering (CAIPE)** (pronounced as `cape`) is an open-source, Multi-Agentic AI System (MAS) championed by the [CNOE (Cloud Native Operational Excellence)](http://cnoe.io/) forum. CAIPE provides a secure, scalable, persona-driven reference implementation with built-in knowledge base retrieval that streamlines platform operations, accelerates workflows, and fosters innovation for modern engineering teams. It integrates seamlessly with Internal Developer Portals like Backstage and developer environments such as VS Code, enabling frictionless adoption and extensibility.

CAIPE is empowered by a set of specialized sub-agents that integrate seamlessly with essential engineering tools. Below are some common platform agents leveraged by the MAS agent:

* 🚀 ArgoCD Agent for continuous deployment
* 🚨 PagerDuty Agent for incident management
* 🐙 GitHub Agent for version control
* 🗂️ Jira/Confluence Agent for project management
* 💬 Slack/Webex Agents for team communication

*...and many more platform agents are available for additional tools and use cases.*

Together, these sub-agents enable users to perform complex operations using agentic workflows by invoking relavant APIs using MCP tools. The system also includes:

* **A curated prompt library**: A carefully evaluated collection of prompts designed for high accuracy and optimal workflow performance in multi-agent systems. These prompts guide persona agents (such as "Platform Engineer" or "Incident Engineer") using standardized instructions and questions, ensuring effective collaboration, incident response, platform operations, and knowledge sharing.
* **Multiple End-user interfaces**: Easily invoke agentic workflows programmatically using standard A2A protocol or through intuitive UIs, enabling seamless integration with existing systems like Backstage (Internal Developer Portals).
* **End-to-end security**: Secure agentic communication and task execution across all agents, ensuring API RBACs to meet enterprise requirements.
* **Enterprise-ready cloud deployment architecture**: Reference deployment patterns for scalable, secure, and resilient multi-agent systems in cloud and hybrid environments

*For detailed information on project goals and our community, head to our [documentation site](https://cnoe-io.github.io/ai-platform-engineering/).*

![](docs/docs/architecture/images/5_caipe-architecture-a2a-over-gateway.svg)


![](docs/docs/architecture/images/6_solution_architecture.svg)

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

## 🚀 Quick Start with Docker Compose

Run CAIPE locally with the OSS Docker Compose stack:

```bash
# Clone the repository
git clone https://github.com/cnoe-io/ai-platform-engineering.git
cd ai-platform-engineering

# Copy and configure environment variables
cp .env.example .env
# Edit .env with your LLM API key or local OpenAI-compatible endpoint.

# Run the stack described by .env.example
docker compose up
```

Access the UI at **http://localhost:3000** and the dynamic-agents API at **http://localhost:8100**.

The default `.env.example` uses image tag `0.5.16` and enables this profile set:

```bash
COMPOSE_PROFILES=mcp-servers,caipe-ui-prod,rbac,dynamic-agents,rag,caipe-mongodb
```

That starts the dynamic-agents runtime, the MCP server containers, production UI, local Keycloak/OpenFGA/AgentGateway RBAC, MongoDB, and RAG.

Add `web_ingestor` when you want the web ingestion worker. Add `slack-bot` or `webex-bot` only when you want those bot integrations.

### Optional Profiles

Enable additional features with profiles:

```bash
# With tracing (Langfuse)
docker compose --profile tracing up

# With Graph RAG (adds Neo4j and ontology services)
docker compose --profile graph_rag up

# With web ingestion worker
docker compose --profile web_ingestor up

# Development mode (build from source)
docker compose -f docker-compose.dev.yaml up --build
```

### Architecture

CAIPE runs a **dynamic-agents** runtime that drives user-defined agents, each
backed by tools served from **per-tool MCP server** containers. The UI reaches
the runtime server-side; chat streams (AG-UI/SSE) are proxied through the
Next.js BFF. Enable the integrations you need via Docker Compose profiles (or
the matching Helm `tags.agent-*`); each enabled integration starts its own MCP
server.

```bash
# Image-based stack (dynamic-agents + MCP servers + UI + RBAC + RAG + Mongo)
docker compose up

# Build from source
docker compose -f docker-compose.dev.yaml up --build

# Start every MCP integration
docker compose --profile all-agents up
```

#### RAG (Knowledge Base)

RAG is included in the default profile set. Use `graph_rag` only when you also want Neo4j-backed graph relationships:

```bash
# Vector RAG, included by default
docker compose up

# Full Graph RAG (includes Neo4j)
docker compose --profile graph_rag up
```

**RAG Profiles:**

| Profile | Services Included | Use Case |
|---------|-------------------|----------|
| `rag` | rag-server, milvus, redis | Vector search without graph relationships |
| `web_ingestor` / `web-ingestor` | web-ingestor | Web datasource ingestion worker |
| `graph_rag` | All `rag` services + Neo4j, agent_ontology | Full knowledge graph with entity relationships |

**Ingesting Content:**

Once RAG services are running, you can ingest web content via the RAG server API:

```bash
# Ingest a website (uses sitemap if available)
curl -X POST http://localhost:9446/v1/datasources \
  -H "Content-Type: application/json" \
  -d '{"url": "https://cnoe-io.github.io/ai-platform-engineering/"}'
```

Agents automatically use the knowledge base when answering questions about ingested content.

### Kubernetes Deployment

For Kubernetes, use the Helm chart. Enable the UI, the dynamic-agents runtime,
and one `tags.agent-*` flag per integration you want (each deploys its own MCP
server):

```bash
helm install caipe charts/ai-platform-engineering \
  --set tags.caipe-ui=true \
  --set tags.dynamic-agents=true \
  --set tags.agent-netutils=true
```

#### Pod Security Standards

All Helm charts ship with security contexts configured to satisfy the Kubernetes [Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/) **Baseline** profile and meet all **Restricted** profile requirements, except `readOnlyRootFilesystem` (left `false` because some agent workloads write to the filesystem at runtime). All app containers set a user ID in `runAsUser` so Kubernetes can enforce `runAsNonRoot` when the image USER directive is a name rather than a numeric UID.

To enforce Baseline and warn on Restricted at the namespace level:

```bash
kubectl label namespace <your-namespace> \
  pod-security.kubernetes.io/enforce=baseline \
  pod-security.kubernetes.io/warn=restricted \
  pod-security.kubernetes.io/audit=restricted
```

To reach full Restricted compliance, set `readOnlyRootFilesystem: true` in each chart's values and add `emptyDir` volume mounts for the write paths.

## 📦 Documentation

- [Quick Start Guide](https://cnoe-io.github.io/ai-platform-engineering/getting-started/quick-start)
- Setup
    - [Docker Compose](https://cnoe-io.github.io/ai-platform-engineering/getting-started/docker-compose/setup)
- [Local Development setup](https://cnoe-io.github.io/ai-platform-engineering/getting-started/local-development)
- [Run Agents for Tracing & Evaluation](https://cnoe-io.github.io/ai-platform-engineering/getting-started/local-development#-run-agents-for-tracing--evaluation)
- [Adding new agents](https://cnoe-io.github.io/ai-platform-engineering/getting-started/local-development#%EF%B8%8F-adding-new-agents)

## 🤝 Contributing

We’d love your contributions! To get started:

1. **Fork** this repo
2. **Create a branch** for your changes
3. **Open a Pull Request**—just add a clear description so we know what you’re working on

Thinking about a big change? Feel free to [start a discussion](https://github.com/cnoe-io/ai-platform-engineering/discussions) first so we can chat about it together.

* Browse our [open issues](https://github.com/cnoe-io/ai-platform-engineering/issues) to see what needs doing
* New here? Check out the [good first issues](https://github.com/cnoe-io/ai-platform-engineering/issues?q=is%3Aissue%20state%3Aopen%20label%3A%22good%20first%20issue%22) for some beginner-friendly tasks

We’re excited to collaborate with you!

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=cnoe-io/ai-platform-engineering&type=Date)](https://www.star-history.com/#cnoe-io/ai-platform-engineering&Date)

## Contributors

<a href="https://github.com/cnoe-io/ai-platform-engineering/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=cnoe-io/ai-platform-engineering" />
</a>

## 📄 License

Licensed under the [Apache-2.0 License](LICENSE).

---

*Made with ❤️ by the [CNOE Contributors](https://cnoe.io/)*
