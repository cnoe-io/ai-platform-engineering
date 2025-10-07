# Docker Compose Files

This directory contains auto-generated Docker Compose files for various AI Platform Engineering personas. Each file includes both `a2a-p2p` and `a2a-over-slim` transport profiles.

## 🚀 Quick Start

### Run a Persona with P2P Transport
```bash
cd docker-compose
docker compose -f docker-compose.argocd.yaml --profile a2a-p2p up
```

### Run a Persona with SLIM Transport
```bash
cd docker-compose
docker compose -f docker-compose.argocd.yaml --profile a2a-over-slim up
```

## 📋 Available Personas

### Core Personas

#### `argocd`
**Purpose**: Minimal GitOps-focused platform engineer
**Agents**: ArgoCD only
**Use Case**: Managing Kubernetes applications through ArgoCD - create, sync, update, and monitor application deployments using GitOps principles
**Best For**: Teams focused solely on GitOps workflows

#### `platform-engineer`
**Purpose**: Complete platform engineering solution with all available agents
**Agents**: All 13 agents (ArgoCD, AWS, Backstage, Confluence, GitHub, Jira, Komodor, PagerDuty, Slack, Splunk, Weather, Webex, Petstore)
**Use Case**: Comprehensive platform management covering infrastructure, CI/CD, monitoring, incident response, documentation, and collaboration
**Best For**: Full-stack platform teams needing access to all capabilities

#### `devops-engineer`
**Purpose**: CI/CD and automation focused engineer
**Agents**: ArgoCD, GitHub
**Use Case**: Source code management, pull requests, repository operations, and GitOps deployments
**Best For**: DevOps teams focused on continuous integration and deployment pipelines

#### `incident-engineer`
**Purpose**: Incident response and troubleshooting specialist
**Agents**: PagerDuty, GitHub, Backstage, Jira, Confluence, Komodor
**Use Case**: Responding to incidents, managing on-call schedules, tracking issues, documenting postmortems, and investigating Kubernetes cluster problems
**Best For**: SRE teams handling production incidents and postmortem documentation

#### `product-owner`
**Purpose**: Product management and backlog maintenance
**Agents**: Jira, Confluence
**Use Case**: Creating and managing user stories, epics, and tasks; drafting Product Requirement Documents (PRDs); maintaining product documentation and roadmaps
**Best For**: Product Owners and Product Managers focused on backlog management and requirement documentation

### Individual Agent Personas

#### `aws`
**Purpose**: AWS cloud operations specialist
**Agents**: AWS only
**Use Case**: EKS cluster management, Kubernetes operations, CloudWatch monitoring, cost analysis, IAM management, and AWS resource provisioning
**Best For**: Teams managing AWS infrastructure and EKS clusters

#### `backstage`
**Purpose**: Developer portal and service catalog manager
**Agents**: Backstage only
**Use Case**: Managing service catalogs, looking up entity metadata, exploring software components, and maintaining developer portal information
**Best For**: Platform teams maintaining service catalogs and developer documentation

#### `confluence`
**Purpose**: Documentation and knowledge management
**Agents**: Confluence only
**Use Case**: Creating, updating, and searching documentation pages, managing spaces, and organizing team knowledge
**Best For**: Teams focused on documentation and knowledge sharing

#### `github`
**Purpose**: Source code and repository management
**Agents**: GitHub only
**Use Case**: Managing repositories, pull requests, issues, workflows, and GitHub Actions
**Best For**: Development teams focused on code review and repository management

#### `jira`
**Purpose**: Project and issue tracking
**Agents**: Jira only
**Use Case**: Creating tickets, tracking sprints, managing backlogs, updating issue statuses, and project planning
**Best For**: Agile teams managing work items and project tracking

#### `komodor`
**Purpose**: Kubernetes cluster management and troubleshooting
**Agents**: Komodor only
**Use Case**: Monitoring cluster health, investigating service issues, triggering root cause analysis, and managing Kubernetes workloads
**Best For**: Platform teams troubleshooting Kubernetes deployments

#### `pagerduty`
**Purpose**: Incident and on-call management
**Agents**: PagerDuty only
**Use Case**: Managing on-call schedules, acknowledging/resolving incidents, triggering alerts, and incident escalation
**Best For**: SRE teams managing incident response and on-call rotations

#### `slack`
**Purpose**: Team communication and notifications
**Agents**: Slack only
**Use Case**: Sending messages, managing channels, posting notifications, and workspace collaboration
**Best For**: Teams using Slack for automated notifications and communication

#### `splunk`
**Purpose**: Log analysis and monitoring
**Agents**: Splunk only
**Use Case**: Searching logs, creating alerts, managing detectors, analyzing system health, and investigating incidents through log data
**Best For**: Operations teams focused on observability and log analysis

#### `weather`
**Purpose**: Weather API integration example
**Agents**: Weather only
**Use Case**: Demonstrating external API integration - getting weather forecasts, current conditions, alerts, and location-based queries
**Best For**: Testing and demonstrating agent capabilities with public APIs

#### `webex`
**Purpose**: Video communication and collaboration
**Agents**: Webex only
**Use Case**: Managing Webex meetings, sending notifications, and video collaboration workflows
**Best For**: Teams using Webex for communication automation

#### `petstore`
**Purpose**: REST API template and testing example
**Agents**: Petstore only
**Use Case**: Demonstrating CRUD operations, API interactions, and serving as a template for building new agents
**Best For**: Developers learning to build new agents or testing agent infrastructure

### Special Profiles

#### `caipe-basic`
**Purpose**: Minimal demonstration setup
**Agents**: Weather, Petstore
**Use Case**: Quick testing and demonstration of agent-to-agent communication with public APIs
**Best For**: Demos, testing, and learning the CAIPE platform basics

#### `caipe-complete-with-tracing`
**Purpose**: Full platform with observability
**Agents**: All 13 agents + distributed tracing
**Use Case**: Complete platform engineering with Langfuse tracing for debugging, monitoring agent interactions, and analyzing LLM calls
**Best For**: Production deployments requiring full observability and debugging capabilities

#### `slim-tracing`
**Purpose**: SLIM transport with observability
**Agents**: All agents via SLIM dataplane + distributed tracing
**Use Case**: Testing advanced routing capabilities of SLIM transport while maintaining full observability
**Best For**: Teams evaluating SLIM transport or requiring advanced message routing

#### `rag-only`
**Purpose**: Retrieval-Augmented Generation specialist
**Agents**: None (RAG system only)
**Use Case**: Document retrieval, semantic search, and knowledge base queries without specific tool agents
**Best For**: Knowledge management and document search use cases

## 🛠️ Generating Compose Files

### Prerequisites
- Python 3.x
- PyYAML library

### Using Make (Recommended)

```bash
# Generate a single persona
make generate-docker-compose PERSONAS="argocd"

# Generate multiple personas
make generate-docker-compose PERSONAS="argocd github aws"

# Generate with dev mode (local code mounts)
make generate-docker-compose-dev PERSONAS="argocd"

# Generate all personas
make generate-docker-compose-all
```

### Using the Script Directly

```bash
# Generate a single persona
./scripts/generate-docker-compose.py --persona argocd \
  --output docker-compose/docker-compose.argocd.yaml

# Generate multiple personas in one file
./scripts/generate-docker-compose.py --persona argocd github \
  --output docker-compose/docker-compose.multi.yaml

# Generate with dev mode (local code mounts)
./scripts/generate-docker-compose.py --persona argocd \
  --output docker-compose/docker-compose.argocd.yaml \
  --dev

# Use custom persona config
./scripts/generate-docker-compose.py --persona argocd \
  --config my-custom-persona.yaml \
  --output docker-compose/docker-compose.custom.yaml
```

### Regenerate All Files

```bash
cd /path/to/ai-platform-engineering
for persona in argocd aws backstage confluence github jira komodor \
               pagerduty slack splunk weather webex petstore \
               platform-engineer devops-engineer incident-engineer \
               caipe-basic caipe-complete-with-tracing slim-tracing rag-only; do
  ./scripts/generate-docker-compose.py \
    --persona $persona \
    --output docker-compose/docker-compose.$persona.yaml
done
```

## 📝 Customizing Personas

Edit `persona.yaml` in the project root to add or modify personas:

```yaml
persona:
  my-custom-persona:
    description: "My custom platform engineer"
    agents:
      - argocd
      - github
      - slack
```

Then generate:
```bash
./scripts/generate-docker-compose.py --persona my-custom-persona \
  --output docker-compose/docker-compose.my-custom-persona.yaml
```

## 🔧 Configuration

### Transport Modes

Each compose file supports two transport profiles:

- **`a2a-p2p`** - Direct peer-to-peer communication between agents
- **`a2a-over-slim`** - Communication via SLIM dataplane for advanced routing

### Environment Variables

Set these in your `.env` file (in the project root, not this directory):

```bash
# Image tag
IMAGE_TAG=stable

# SLIM configuration
SLIM_GATEWAY_PASSWORD=dummy_password

# Agent-specific credentials
GITHUB_TOKEN=your_token
JIRA_API_TOKEN=your_token
SLACK_BOT_TOKEN=your_token
# ... etc
```

### Agent Control

Each persona automatically sets `ENABLE_*` environment variables:

- **`ENABLE_ARGOCD=true/false`**
- **`ENABLE_AWS=true/false`**
- **`ENABLE_GITHUB=true/false`**
- ... and so on

This ensures only the agents specified in the persona are loaded.

## 🏗️ Architecture

Each generated compose file contains:

1. **Platform Engineer Service** - Orchestrates agent communication
   - Service name: `platform-engineer-{persona}-{p2p|slim}`
   - Exposes port 8000
   - Manages agent routing and LLM interactions

2. **Agent Services** - Individual capability agents
   - Service name: `agent-{agent-name}-{persona}-{p2p|slim}`
   - Exposes ports starting from 8001

3. **MCP Services** - Model Context Protocol servers (if needed)
   - Service name: `mcp-{agent-name}`
   - Shared across both transport profiles
   - Exposes ports starting from 18000

4. **SLIM Infrastructure** (for `a2a-over-slim` profile only)
   - `slim-dataplane` - Handles message routing (port 46357)
   - `slim-control-plane` - Manages control plane (ports 50051, 50052)

## 🐛 Troubleshooting

### Service fails to start
- Check `.env` file exists in project root (not in docker-compose/)
- Verify all required environment variables are set
- Check logs: `docker compose logs platform-engineer-{persona}-{p2p|slim}`

### Cannot connect to agents
- Ensure the profile is specified: `--profile a2a-p2p` or `--profile a2a-over-slim`
- Check agent service is running: `docker compose ps`
- Verify network connectivity: `docker compose exec platform-engineer-{persona}-{p2p|slim} ping agent-{agent-name}-{persona}-{p2p|slim}`

### SLIM transport not working
- Verify `slim-config.yaml` exists in project root
- Check SLIM services are running: `docker compose ps slim-dataplane slim-control-plane`
- Review SLIM logs: `docker compose logs slim-dataplane`

## 📚 Additional Resources

- **Main README**: `../README.md`
- **Script Documentation**: `../scripts/README.md`
- **Persona Configuration**: `../persona.yaml`
- **SLIM Configuration**: `../slim-config.yaml`

## ⚠️ Important Notes

- **Do NOT edit these files directly** - They are auto-generated and will be overwritten
- Always run compose commands from within this `docker-compose/` directory
- Paths in compose files use `../.env` to reference the root `.env` file
- All personas include both p2p and slim profiles - choose one with `--profile`

## 🤝 Contributing

To add a new persona:
1. Edit `../persona.yaml` to define your persona
2. Run the generation script
3. Test with: `docker compose -f docker-compose.{your-persona}.yaml --profile a2a-p2p up`
4. Commit both the `persona.yaml` changes and generated compose file

---

**Generated by**: `scripts/generate-docker-compose.py`
**Last Updated**: Auto-generated - see git history

