# Skills

Reusable tools and utilities organized by category.

## Directory Structure

```
skills/
├── persistence/          # LangGraph persistence testing (Redis, Postgres, MongoDB)
├── integration-testing/  # End-to-end multi-agent integration testing
├── debugging/            # (future) Debugging and troubleshooting tools
├── monitoring/           # (future) Observability and metrics tools
└── deployment/           # (future) Deployment and infrastructure helpers
```

## Available Skills

### 📊 [persistence](./persistence/)
Test and manage LangGraph persistence backends and fact extraction.

**Quick Start:**
```bash
# Validate per-agent checkpoint isolation (all 15 agents)
./skills/persistence/validate_agent_checkpoints.sh

# Test persistence backends
./skills/persistence/test_persistence_all_backends.sh redis
./skills/persistence/switch_backend.sh postgres
python skills/persistence/test_langgraph_persistence.py mongodb
```

See [persistence/README.md](./persistence/README.md) for full documentation.

### 🧪 [integration-testing](./integration-testing/)
End-to-end integration tests with all 15 agents and supervisor in Docker Compose dev.

**Quick Start:**
```bash
# Start full stack
IMAGE_TAG=latest docker compose -f docker-compose.dev.yaml up -d
docker restart caipe-supervisor  # after agents are warm

# Validate all agents
./skills/persistence/validate_agent_checkpoints.sh
```

See [integration-testing/SKILL.md](./integration-testing/SKILL.md) for full testing procedure.

## Adding New Skills

1. Create directory: `skills/<category>/`
2. Add tools/scripts
3. Include README.md with:
   - Purpose and usage
   - Requirements
   - Examples
4. Make scripts executable
5. Update this README

## Integration

Skills can be:
- Called from CI/CD pipelines
- Used in development workflows
- Referenced from documentation
- Invoked by automation

## Conventions

- Lowercase with hyphens: `debugging`, `persistence`, `backup-restore`
- Executable scripts: `chmod +x skills/<category>/*.sh`
- Always include README.md
- Add QUICKSTART.md for common commands
