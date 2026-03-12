# Skills

Reusable tools and utilities organized by category.

## Directory Structure

```
skills/
├── persistence/    # LangGraph persistence testing (Redis, Postgres, MongoDB)
├── debugging/      # (future) Debugging and troubleshooting tools
├── monitoring/     # (future) Observability and metrics tools
└── deployment/     # (future) Deployment and infrastructure helpers
```

## Available Skills

### 📊 [persistence](./persistence/)
Test and manage LangGraph persistence backends and fact extraction.

**Quick Start:**
```bash
./skills/persistence/test_persistence_all_backends.sh redis
./skills/persistence/switch_backend.sh postgres
python skills/persistence/test_langgraph_persistence.py mongodb
```

See [persistence/README.md](./persistence/README.md) for full documentation.

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
