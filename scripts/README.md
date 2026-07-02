# Scripts Directory

This directory contains utility scripts for the AI Platform Engineering project.

## Current Helpers

- `add-new-agent-helm-chart.py`: scaffolds parent chart entries for new `ai_platform_engineering/mcp/*` MCP servers.
- `validate-helm-image-channel.py`: verifies chart image repositories use the expected release/pre-release channel.
- `validate-realm-config.py`, `validate-rbac-matrix.py`, `validate_rbac_docs.py`: validate RBAC fixture and documentation consistency.

Use the maintained root `docker-compose.yaml` and `docker-compose.dev.yaml`
files directly for local stack composition.
