# Ruff Formatting Audit

This document audits the ruff configuration across the codebase to identify inconsistencies in indentation and linting rules.

## Summary

The codebase has inconsistent formatting settings:
- **Most packages**: 2-space indentation (standard)
- **Some packages**: 4-space indentation or no config (defaults to 4-space)

## Indentation Summary

| indent-width | Packages |
|--------------|----------|
| **2 spaces** | Root, multi_agents, utils, RAG packages, most agents |
| **4 spaces** | `dynamic_agents`, `agents/splunk` |
| **Not set (default 4)** | `evals`, MCP subpackages, `integrations/slack_bot` |

## Line Length Summary

| line-length | Packages |
|-------------|----------|
| **300** | Root, multi_agents, RAG packages |
| **320** | agents/backstage |
| **140** | Most agents (github, gitlab, argocd, jira, etc.), utils |
| **120** | dynamic_agents |
| **100** | evals, agents/splunk |

## Detailed Breakdown

| Package | indent-width | line-length | select | Notes |
|---------|--------------|-------------|--------|-------|
| **Root** | 2 | 300 | E, F | Standard |
| **multi_agents** | 2 | 300 | E, F | Matches root |
| **utils** | 2 | 140 | E, F | Matches root indent |
| **RAG packages** | 2 | 300 | E, F | Standardized |
| **Most agents** | 2 | 140 | E, F | Standard for agents |
| **agents/backstage** | 2 | 320 | E, F | Longest line-length |
| **dynamic_agents** | not set (4) | 120 | E, F, I, W | Different style |
| **agents/splunk** | 4 | 100 | Many rules | Most strict linting |
| **evals** | not set (4) | 100 | - | Missing lint config |
| **MCP subpackages** | not set | - | - | No ruff config |
| **integrations/slack_bot** | not set | - | - | No ruff config |

## Packages Needing Standardization

To achieve consistent 2-space indentation across the codebase:

### High Priority (have Python code, will cause reformatting issues)

1. **`dynamic_agents`** (`ai_platform_engineering/dynamic_agents/pyproject.toml`)
   - Has config but missing `indent-width = 2`
   - Currently uses 4-space indentation in source files
   - Action: Add `indent-width = 2` and reformat

2. **`agents/splunk`** (`ai_platform_engineering/agents/splunk/pyproject.toml`)
   - Explicitly set to `indent-width = 4`
   - Has extensive lint rules (different team/style?)
   - Action: Change to `indent-width = 2` and reformat

3. **`evals`** (`evals/pyproject.toml`)
   - Missing indent-width (defaults to 4)
   - Action: Add full ruff lint config with `indent-width = 2`

4. **`integrations/slack_bot`** (`ai_platform_engineering/integrations/slack_bot/pyproject.toml`)
   - No ruff config at all
   - Action: Add ruff config with `indent-width = 2`

### Lower Priority (MCP subpackages - often minimal code)

These MCP subpackages have no ruff config:
- `agents/argocd/mcp/pyproject.toml`
- `agents/backstage/mcp/pyproject.toml`
- `agents/confluence/mcp/pyproject.toml`
- `agents/jira/mcp/pyproject.toml`
- `agents/jira/mcp/mcp_jira/pyproject.toml`
- `agents/komodor/mcp/pyproject.toml`
- `agents/netutils/mcp/pyproject.toml`
- `agents/pagerduty/mcp/pyproject.toml`
- `agents/splunk/mcp/pyproject.toml`
- `agents/template/mcp/pyproject.toml`
- `agents/template/agent_petstore/protocol_bindings/mcp_server/pyproject.toml`
- `agents/template-claude-agent-sdk/agent_petstore/protocol_bindings/mcp_server/pyproject.toml`
- `agents/victorops/mcp/pyproject.toml`
- `agents/webex/mcp/pyproject.toml`

## Recommended Standard Config

For consistency, all packages should use:

```toml
[tool.ruff]
line-length = 140  # or 300 for RAG/root packages
indent-width = 2

[tool.ruff.lint]
select = ["E", "F"]
ignore = ["F403"]
```

## Related

- Commit `4cb98513`: Standardized RAG packages to 2-space indentation
- Root `pyproject.toml`: Defines the canonical style for the project
