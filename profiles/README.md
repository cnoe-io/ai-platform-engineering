# Profiles Directory

This directory is used for profile-related documentation and future extensions.

## Persona Configuration

The main persona configuration file is located at the project root: `persona.yaml`

This file defines user personas (roles) and their associated agent configurations. Each persona represents a specific use case or job role with a curated set of AI agents.

### Structure

```yaml
persona:
  <persona-name>:
    description: "Description of the persona"
    agents:
      - agent1
      - agent2
```

### Available Personas

- **argocd**: Minimal ArgoCD-only setup for GitOps operations
- **full-platform**: Complete Platform Engineer with all agents
- **devops-engineer**: DevOps Engineer focused on CI/CD and monitoring

### Adding a New Persona

1. Open `persona.yaml` in the project root
2. Add a new persona entry under `persona:`
3. Specify the agents needed for that persona
4. Add a descriptive `description` field

Example:
```yaml
persona:
  my-custom-role:
    description: "Custom role for specific needs"
    agents:
      - argocd
      - github
      - slack
```

### Using Personas

Personas can be used with the `generate-compose.py` script to generate tailored docker-compose configurations:

```bash
# Generate compose for a specific persona
./scripts/generate-compose.py --persona devops-engineer

# Generate for multiple personas
./scripts/generate-compose.py --persona argocd full-platform
```

### Available Agents

Agents that can be included in personas:
- `argocd` - GitOps with ArgoCD
- `aws` - AWS cloud operations
- `backstage` - Developer portal
- `confluence` - Documentation
- `github` - Source code management
- `jira` - Issue tracking
- `komodor` - Kubernetes management
- `pagerduty` - Incident management
- `petstore` - API template example
- `slack` - Team communication
- `splunk` - Observability
- `weather` - Weather API example
- `webex` - Video communication

## Default Profile

The default profile is specified in `persona.yaml` under `default_profile` and will be used if no specific persona is specified.

