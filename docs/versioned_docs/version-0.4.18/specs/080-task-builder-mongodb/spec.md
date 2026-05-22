---
sidebar_position: 2
sidebar_label: Specification
---

# Task Builder — Visual Workflow Editor with MongoDB Persistence

**Status**: 🟡 In-development
**Category**: Architecture & Design
**Date**: March 3, 2026

## Overview

Introduced a visual Task Builder UI for creating and managing self-service workflows, backed by a new `task_configs` MongoDB collection. The supervisor agent now reads task configs from MongoDB (with YAML fallback), closing the gap between the UI and the backend.

## Motivation

The supervisor agent reads workflows exclusively from `task_config.yaml` on disk. The UI has no way to create or edit these workflows — any change requires modifying YAML, rebuilding the Helm chart, and redeploying. Non-developer users cannot create custom self-service workflows, and workflows created in the existing Agent Builder are not consumed by the supervisor.

## Related

- Spec: [task-builder](../091-task-builder/spec.md)
- Task Config YAML: `charts/ai-platform-engineering/data/task_config.yaml`
- Existing Agent Builder: `ui/src/components/agent-builder/`

- Architecture: [architecture.md](./architecture.md)
