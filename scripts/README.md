# Scripts Directory

This directory contains utility scripts for the AI Platform Engineering project.

## generate-docker-compose.py

Dynamic Docker Compose generator that creates docker-compose.yaml files based on persona definitions.

### Overview

The `generate-docker-compose.py` script generates docker-compose configurations dynamically from persona definitions. It uses the existing agent structure and generates services based on current docker-compose patterns.

**Configuration file:** `persona.yaml` - Defines user personas (roles) and their required agents

### Usage

```bash
# Generate compose for specific persona(s)
./scripts/generate-docker-compose.py --persona devops-engineer

# Generate for multiple personas
./scripts/generate-docker-compose.py --persona devops-engineer full-platform

# Generate for all personas
./scripts/generate-docker-compose.py

# Specify custom output file
./scripts/generate-docker-compose.py --persona argocd --output docker-compose.argocd.yaml

# Generate dev mode with local code mounts (like docker-compose.dev.yaml)
./scripts/generate-docker-compose.py --persona p2p-basic --dev

# Use custom config file
./scripts/generate-docker-compose.py --config my-persona.yaml
```

### Dev Mode

The `--dev` flag generates a docker-compose file similar to `docker-compose.dev.yaml` with:
- Local code volume mounts for live development
- Build contexts pointing to Dockerfiles instead of using images
- Enables rapid iteration without rebuilding images

```bash
# Generate dev compose
./scripts/generate-docker-compose.py --persona p2p-basic --dev --output docker-compose/docker-compose.p2p-basic.dev.yaml
```

### Environment Variables

- `A2A_TRANSPORT`: Set transport mode (default: `p2p`)
  - `p2p`: Peer-to-peer transport
  - `slim`: SLIM dataplane transport

```bash
A2A_TRANSPORT=slim ./scripts/generate-docker-compose.py --persona devops-engineer
```

### Supported Agents

The script includes built-in configuration for existing agents:
- `argocd` - ArgoCD integration
- `github` - GitHub operations (includes Docker socket mount)
- `jira` - Jira issue tracking
- `slack` - Slack messaging
- `pagerduty` - PagerDuty incident management
- `backstage` - Backstage developer portal
- `confluence` - Confluence documentation
- `komodor` - Komodor Kubernetes management
- `splunk` - Splunk observability
- `weather` - Weather API (remote MCP)
- `petstore` - Pet store template (remote MCP)

### Author

Original implementation by: Satish Patil <satishpatil@hotmail.com>
Adapted for existing agent structure by: Sri Aradhyula <sraradhy@cisco.com>

### Related Files

- `persona.yaml`: Persona definitions (project root)
- `slim-config.yaml`: SLIM transport configuration
- `profiles/`: Directory for generated profiles and documentation

