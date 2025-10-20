# Prompt Configuration Feature

## Overview

The AI Platform Engineering Helm chart now supports flexible prompt configuration, allowing users to choose between predefined orchestration behaviors or provide custom configurations.

## Feature Components

### 1. Configuration Files

The chart includes two predefined prompt configurations:

- **`data/prompt_config.yaml`** - Default configuration
  - Standard multi-agent orchestrator
  - Balanced between flexibility and control
  - Maintains strict provenance and source attribution
  - Best for: Development, testing, general platform operations

- **`data/prompt_config.deep_agent.yaml`** - Deep Agent configuration
  - Strict zero-hallucination mode
  - Enhanced provenance tracking
  - Enforces tool-only responses
  - Best for: Production, compliance, mission-critical systems

### 2. Helm Values Configuration

Two new values control prompt behavior:

```yaml
# Select predefined configuration
promptConfigType: "default"  # Options: "default" or "deep_agent"

# Or provide custom configuration (overrides promptConfigType)
promptConfig: ""
```

### 3. Template Logic

The `templates/prompt-config.yaml` template implements a three-tier configuration hierarchy:

1. **Custom override** (`promptConfig`) - Highest priority
2. **Deep Agent** (`promptConfigType: "deep_agent"`) - Second priority
3. **Default** (`promptConfigType: "default"`) - Fallback

## Usage Examples

### Example 1: Deploy with Default Configuration

```bash
helm install ai-platform charts/ai-platform-engineering/ \
  --set promptConfigType=default
```

### Example 2: Deploy with Deep Agent Configuration

```bash
helm install ai-platform charts/ai-platform-engineering/ \
  --set promptConfigType=deep_agent
```

### Example 3: Deploy with Custom Configuration

Create a custom values file:

```yaml
# custom-prompt-values.yaml
promptConfig: |
  agent_name: "Custom Platform Agent"
  agent_description: |
    Specialized agent for custom workflows
  system_prompt_template: |
    Custom system prompt...
  agent_prompts:
    argocd:
      system_prompt: "Custom ArgoCD routing..."
    # ... additional configuration
```

Deploy:

```bash
helm install ai-platform charts/ai-platform-engineering/ \
  --values custom-prompt-values.yaml
```

### Example 4: Switch Configuration on Upgrade

```bash
# Upgrade from default to deep_agent
helm upgrade ai-platform charts/ai-platform-engineering/ \
  --set promptConfigType=deep_agent
```

## Configuration Comparison

| Feature | Default | Deep Agent | Custom |
|---------|---------|------------|--------|
| **Zero-hallucination** | Enforced | Strictly enforced | User-defined |
| **Provenance tracking** | Standard | Enhanced | User-defined |
| **Tool response handling** | Verbatim forwarding | Verbatim + validation | User-defined |
| **Complexity** | Low | Low | High |
| **Customizability** | None | None | Full |
| **Use case** | General | Mission-critical | Specialized |

## Key Differences Between Default and Deep Agent

### Default Configuration
- **Agent Name**: "AI Platform Engineer"
- **Focus**: Balanced orchestration with standard compliance
- **Behavioral Model**: Standards-compliant orchestrator
- **Validation**: ComplianceGuard and Aggregator meta-agents
- **Response Style**: Professional, markdown-formatted with provenance

### Deep Agent Configuration
- **Agent Name**: "AI Platform Engineer — Deep Agent"
- **Focus**: Maximum adherence to zero-hallucination principles
- **Behavioral Model**: Deep Agent Orchestrator with strict tool-only mode
- **Validation**: Enhanced provenance validation and source verification
- **Response Style**: Structured, highly traceable with explicit source attribution
- **Additional Features**:
  - Explicit "Source-of-Truth Policy"
  - Stricter routing logic with RAG-first fallback
  - Enhanced tool-response handling rules
  - Explicit behavior model separation (tool-only vs RAG modes)

## Implementation Details

### Template Hierarchy

```yaml
data:
  prompt_config.yaml: |
{{- if .Values.promptConfig }}
  # Use custom configuration (highest priority)
{{ .Values.promptConfig | nindent 4 }}
{{- else if eq .Values.promptConfigType "deep_agent" }}
  # Use deep agent configuration
{{ .Files.Get "data/prompt_config.deep_agent.yaml" | nindent 4 }}
{{- else }}
  # Use default configuration (fallback)
{{ .Files.Get "data/prompt_config.yaml" | nindent 4 }}
{{- end }}
```

### Configuration Loading

1. Check if `promptConfig` is set → Use custom configuration
2. Check if `promptConfigType` equals "deep_agent" → Load `prompt_config.deep_agent.yaml`
3. Otherwise → Load default `prompt_config.yaml`

## Testing

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

## Backward Compatibility

This feature is fully backward compatible:
- Existing deployments without `promptConfigType` will use "default"
- The original `promptConfig` override mechanism is preserved
- No breaking changes to existing chart functionality

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

## Documentation

- **Chart README**: `/charts/ai-platform-engineering/README.md`
- **Example Values**: `/charts/ai-platform-engineering/values-prompt-examples.yaml`
- **Default Config**: `/charts/ai-platform-engineering/data/prompt_config.yaml`
- **Deep Agent Config**: `/charts/ai-platform-engineering/data/prompt_config.deep_agent.yaml`

## Future Enhancements

Potential future additions:
- Additional predefined configurations for specific use cases
- Configuration validation and schema enforcement
- Dynamic configuration switching without pod restart
- Configuration metrics and observability

