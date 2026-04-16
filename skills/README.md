# Skills

Reusable tools and utilities organized by category.

## Directory Structure

```
skills/
├── dco-ai-attribution/   # DCO compliance and AI attribution for commits
├── persistence/          # LangGraph persistence testing (Redis, Postgres, MongoDB)
├── integration-testing/  # End-to-end multi-agent integration testing
├── quality-gates/        # Pre-commit validation (lint, test, UI tests)
├── streaming-testing/    # A2A streaming comparison across supervisor versions
├── debugging/            # (future) Debugging and troubleshooting tools
├── monitoring/           # (future) Observability and metrics tools
└── deployment/           # (future) Deployment and infrastructure helpers
```

## Available Skills

### 📋 [dco-ai-attribution](./dco-ai-attribution/)
DCO compliance and AI attribution rules for commits that include AI-assisted code.

**When to apply**: Whenever an AI agent helps write or refactor code that will be committed.

See [dco-ai-attribution/SKILL.md](./dco-ai-attribution/SKILL.md) for the full policy, `Assisted-by` trailer format, and pre-commit checklist.

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

### 📡 [streaming-testing](./streaming-testing/)
Compare A2A streaming behaviour across supervisor versions (e.g. 0.3.0 vs 0.2.41).

**Quick Start:**
```bash
# One-command comparison (captures, analyzes, compares)
./skills/streaming-testing/run_comparison.sh "what can you do?"

# Individual scripts
python3 scripts/analyze_a2a_metadata.py /tmp/capture.json
python3 scripts/compare_a2a_events.py /tmp/cap-030.json /tmp/cap-041.json
```

See [streaming-testing/SKILL.md](./streaming-testing/SKILL.md) for the full workflow and script reference.

### 🚦 [quality-gates](./quality-gates/)
Run all pre-commit quality gates (lint, Python tests, UI tests) in one command.

**Quick Start:**
```bash
# Run all gates
./skills/quality-gates/run_all.sh

# Auto-fix lint issues first, then validate
./skills/quality-gates/run_all.sh --fix
```

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
