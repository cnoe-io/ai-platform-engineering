---
sidebar_position: 2
sidebar_label: Specification
title: "2025-12-15: Jira Entity Relationships SOP"
---

# Jira Entity Relationships SOP

**Date**: 2025-12-15
**Status**: 🟢 In-use
**Author**: Sri Aradhyula
**Scope**: Jira Agent MCP Tools

## Overview

This document defines the relationships between Jira Agile entities and the correct order of operations for the Jira Agent to traverse and manage them.


## API Reference Quick Guide

| Entity | Get All | Get One | Create | Update | Delete |
|--------|---------|---------|--------|--------|--------|
| **Project** | `list_projects()` | `get_project(key)` | N/A | N/A | N/A |
| **Board** | `get_all_boards()` | `get_board(id)` | `create_board()` | N/A | `delete_board()` |
| **Sprint** | `get_board_sprints(board_id)` | `get_sprint(id)` | `create_sprint()` | `update_sprint()` | `delete_sprint()` |
| **Issue** | `search_issues(jql)` | `get_issue(key)` | `create_issue()` | `update_issue()` | `delete_issue()` |
| **Backlog** | `get_backlog_issues(board_id)` | N/A | N/A | N/A | N/A |


## Related

- Jira MCP README - See `ai_platform_engineering/agents/jira/mcp/README.md` in repository
- [Jira Agile REST API](https://developer.atlassian.com/cloud/jira/software/rest/intro/)
- [Board API Reference](https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/)
- [Sprint API Reference](https://developer.atlassian.com/cloud/jira/software/rest/api-group-sprint/)



## Related

- Architecture: [architecture.md](./architecture.md)
