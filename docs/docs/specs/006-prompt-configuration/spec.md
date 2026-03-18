---
sidebar_position: 2
sidebar_label: Specification
title: "2024-10-22: Prompt Configuration Feature"
---

# Prompt Configuration Feature

**Status**: 🟢 In-use
**Category**: Configuration & Prompts
**Date**: October 22, 2024

## Overview

The AI Platform Engineering Helm chart now supports flexible prompt configuration, allowing users to choose between predefined orchestration behaviors or provide custom configurations.


## Testing Strategy

All three configuration modes have been tested:

```bash
# Test default
helm template test charts/ai-platform-engineering/ \
  --set promptConfigType=default | grep agent_name

# Test deep_agent
helm template test charts/ai-platform-engineering/ \
  --set promptConfigType=deep_agent | grep agent_name

# Test custom
helm template test charts/ai-platform-engineering/ \
  --set-string 'promptConfig=agent_name: "Custom"' | grep agent_name
```


## Best Practices

### Development and Testing
```yaml
promptConfigType: "default"
```

### Production Deployments
```yaml
promptConfigType: "deep_agent"
```

### Specialized Workflows
```yaml
promptConfig: |
  # Custom configuration
  ...
```


## Related

- Architecture: [architecture.md](./architecture.md)
