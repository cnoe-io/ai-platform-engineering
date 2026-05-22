---
sidebar_position: 2
sidebar_label: Specification
---

# LangGraph Persistence — Checkpointer & Cross-Thread Store

**Status**: 🟢 In-use
**Category**: Architecture & Design
**Date**: February 26, 2026

## Overview

Implemented full LangGraph persistence with two complementary layers: (1) per-thread **Checkpointer** for conversation state within a thread, including auto-trimming and orphan repair; and (2) cross-thread **Store** for long-term user-scoped memory that persists across threads.

## Motivation

Without persistence, the agent loses all state on restart, threads are isolated with no carryover, and users must re-explain context in every conversation.

## Related

- Spec: [cross-thread-store](../084-cross-thread-store/spec.md)
- ADR: `2026-02-26-automatic-fact-extraction.md` (Fact extraction decision)
- ADR: [2025-12-13-context-management-and-resilience](../039-context-management-and-resilience/architecture.md) (LangMem context management)

- Architecture: [architecture.md](./architecture.md)
