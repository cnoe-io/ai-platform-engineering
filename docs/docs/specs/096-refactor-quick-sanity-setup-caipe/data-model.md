# Data Model: 096 - Refactor Quick Sanity Integration Workflows

**Date**: 2026-03-20

## Overview

This feature involves CI/CD workflow configuration changes only. There are no persistent data entities, database schemas, or state transitions to model.

## Key Configuration Entities

### Workflow Configuration

- **Release-tag workflow**: Triggers on semver tag push or manual dispatch. Accepts optional `chart_version` input.
- **Dev workflow**: Triggers on push to `main` or manual dispatch. No configurable inputs.

### Environment Variables (injected via `.env`)

Both workflows inject LLM provider credentials from GitHub Secrets. The dev workflow additionally sets:
- `ENABLE_RAG=true`
- `ENABLE_TRACING=false`

### Docker Compose Profile Set (dev workflow)

The dev workflow requires this specific profile combination:
`caipe-supervisor`, `caipe-mongodb`, `deps`, `caipe-ui`, `all-agents`, `netutils-agent`, `rag`

### Concurrency Groups

- `caipe-integration-release`: Serial execution, no cancellation
- `caipe-integration-dev`: Cancel older in-progress runs on new push
