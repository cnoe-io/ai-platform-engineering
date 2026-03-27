# Implementation Plan: Single-Node Persistent Memory Store

**Branch**: `098-single-node-memstore` | **Date**: 2026-03-25 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/098-single-node-memstore/spec.md`

## Summary

Combine `deep_agent.py` and `deep_agent_single.py` into a single canonical implementation that supports configurable persistent checkpointing (MongoDB/Redis/Postgres) and cross-thread store with fact extraction.

## Technical Context

**Language/Version**: Python 3.11+
**Primary Dependencies**: LangGraph, LangChain, deepagents
**Storage**: MongoDB, Redis, Postgres — configurable via env vars, default InMemory
**Testing**: pytest with `make test`, `make lint`

## Files Modified

- `ai_platform_engineering/multi_agents/platform_engineer/deep_agent_single.py` — add persistence wiring
- `ai_platform_engineering/multi_agents/platform_engineer/deep_agent.py` — thin re-export shim
- `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent_single.py` — add memory + fact extraction
- `tests/test_persistence_unit.py` — update module paths
