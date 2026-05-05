# skill-scanner

Standalone deployment of [cisco-ai-defense/skill-scanner](https://github.com/cisco-ai-defense/skill-scanner)
running its built-in REST API server (`skill-scanner-api`). The CAIPE UI
posts zipped SKILL packages to `/scan-upload` for safety analysis.

> **Security**: the upstream API is unauthenticated by design ("Development
> Use Only"). This chart ships a `ClusterIP` Service and no Ingress —
> **never** expose it externally.

## Enabling

In the parent `ai-platform-engineering` chart values:

```yaml
global:
  skillScanner:
    enabled: true

caipe-ui:
  config:
    SKILL_SCANNER_URL: "http://{{ .Release.Name }}-skill-scanner:8000"
```

## Optional LLM analyzer

```yaml
skill-scanner:
  llm:
    enabled: true
    model: "anthropic/claude-sonnet-4-20250514"
    apiKey:
      secretName: skill-scanner-llm
      secretKey: SKILL_SCANNER_LLM_API_KEY
```

## Image

Built from `build/Dockerfile.skill-scanner` in this repo. Pin
`SKILL_SCANNER_VERSION` (the upstream pip package) at build time and the
chart `image.tag` at deploy time.
