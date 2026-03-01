# CAIPE Setup Script

`setup-caipe.sh` automates deploying, configuring, and managing a
[CAIPE](https://github.com/cnoe-io/ai-platform-engineering) (Community AI
Platform Engineering) environment on a local Kind cluster. It handles LLM
provider selection, Kubernetes secrets, Helm chart deployment, optional RAG
and tracing stacks, post-deploy patches, health monitoring, and teardown.

## Quick start

```bash
# Interactive setup (default — prompts for provider, model, features)
./setup-caipe.sh

# Non-interactive with defaults (OpenAI gpt-5.2, base agents only)
./setup-caipe.sh --non-interactive

# Full stack: RAG + Langfuse tracing + auto-heal
./setup-caipe.sh --non-interactive --rag --tracing --auto-heal

# Teardown
./setup-caipe.sh cleanup    # interactive
./setup-caipe.sh nuke       # non-interactive (single 'yes' confirm)
```

## Prerequisites

The script checks for these tools at startup:

- `docker` (Docker Desktop or compatible runtime)
- `kind` (Kubernetes in Docker)
- `kubectl`
- `helm`
- `python3`
- `curl`

## Commands

| Command | Description |
|---------|-------------|
| `setup` | Full interactive setup (default when no command given) |
| `port-forward` | Start port-forwarding, run validation, then monitor |
| `validate` | Run validation and sanity tests only |
| `cleanup` | Interactive teardown of all resources |
| `nuke` | Non-interactive teardown (same as `cleanup --yes`) |
| `status` | Show pod status and Helm releases |

## Options

| Flag | Description |
|------|-------------|
| `--non-interactive` | Skip prompts; use env vars or defaults |
| `--rag` | Deploy the RAG stack (Milvus, Redis, RAG server, web ingestor) |
| `--graph-rag` | Deploy Graph RAG (Neo4j + ontology agent; implies `--rag`) |
| `--corporate-ca` | Inject corporate TLS proxy CA certs into pods |
| `--tracing` | Deploy Langfuse and enable tracing on supervisor |
| `--auto-heal` | Enable auto-heal loop (every 30s) |
| `--yes`, `-y` | Auto-confirm cleanup prompts |
| `-h`, `--help` | Show help |

## LLM providers

Three providers are supported via
[cnoe-agent-utils](https://github.com/cnoe-io/agent-utils) `LLMFactory`:

### OpenAI (default)

```bash
# Interactive — prompted for API key and model
./setup-caipe.sh

# Non-interactive
OPENAI_API_KEY=sk-xxx ./setup-caipe.sh --non-interactive

# Custom model
OPENAI_API_KEY=sk-xxx OPENAI_MODEL_NAME=gpt-4o ./setup-caipe.sh --non-interactive
```

Credential lookup order:
1. `OPENAI_API_KEY` environment variable
2. `~/.config/openai.txt` (single line containing the key)
3. Interactive prompt

### Anthropic Claude

```bash
# Interactive
LLM_PROVIDER=anthropic-claude ./setup-caipe.sh

# Non-interactive (default model: claude-haiku-4-5)
LLM_PROVIDER=anthropic-claude ANTHROPIC_API_KEY=sk-ant-xxx ./setup-caipe.sh --non-interactive

# Custom model
LLM_PROVIDER=anthropic-claude ANTHROPIC_MODEL_NAME=claude-sonnet-4-20250514 \
  ./setup-caipe.sh --non-interactive
```

Credential lookup order:
1. `ANTHROPIC_API_KEY` environment variable
2. `~/.config/claude.txt` (single line containing the key)
3. Interactive prompt

### AWS Bedrock

```bash
# Interactive
LLM_PROVIDER=aws-bedrock ./setup-caipe.sh

# Non-interactive with explicit keys
LLM_PROVIDER=aws-bedrock \
  AWS_ACCESS_KEY_ID=AKIA... \
  AWS_SECRET_ACCESS_KEY=... \
  ./setup-caipe.sh --non-interactive

# Non-interactive with AWS profile
LLM_PROVIDER=aws-bedrock AWS_PROFILE=my-profile ./setup-caipe.sh --non-interactive
```

Credential lookup order:
1. `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` environment variables
2. `~/.config/bedrock.txt` (see formats below)
3. `AWS_PROFILE` environment variable
4. `~/.aws/credentials` `[default]` profile
5. Interactive prompt

`~/.config/bedrock.txt` supports three formats:

```
# .env style (recommended)
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-2
AWS_BEDROCK_MODEL_ID=us.anthropic.claude-haiku-4-5-20251001-v1:0

# Key pair (single line)
AKIAXXXXXXXX:SecretKeyHere

# Profile name (single line)
my-profile-name
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_PROVIDER` | `openai` | `openai`, `anthropic-claude`, or `aws-bedrock` |
| `OPENAI_API_KEY` | — | OpenAI API key |
| `OPENAI_MODEL_NAME` | `gpt-5.2` | OpenAI model name (used by LLMFactory) |
| `ANTHROPIC_API_KEY` | — | Anthropic API key |
| `ANTHROPIC_MODEL_NAME` | `claude-haiku-4-5` | Anthropic model alias |
| `AWS_ACCESS_KEY_ID` | — | AWS access key for Bedrock |
| `AWS_SECRET_ACCESS_KEY` | — | AWS secret key for Bedrock |
| `AWS_PROFILE` | — | AWS profile (keys resolved from `~/.aws/credentials`) |
| `AWS_REGION` | `us-east-2` | AWS region |
| `AWS_BEDROCK_MODEL_ID` | `us.anthropic.claude-3-7-sonnet-20250219-v1:0` | Bedrock model ID |
| `AWS_BEDROCK_ENABLE_PROMPT_CACHE` | — | Enable Bedrock prompt caching |
| `CAIPE_CHART_VERSION` | latest | Pin Helm chart version |
| `EMBEDDINGS_MODEL` | `text-embedding-3-large` | Embeddings model for RAG |
| `EMBEDDINGS_PROVIDER` | `openai` | Embeddings provider for RAG |

## Post-deploy patches

The script applies several patches after Helm install to work around upstream
chart issues (v0.2.x). These are idempotent and re-applied by auto-heal.

| Patch | Scope | Description |
|-------|-------|-------------|
| Schema fix | All agents | `sitecustomize.py` adds `additionalProperties: false` and `required` to `PlatformEngineerResponse` for OpenAI strict mode |
| httpx redirect | All agents | `sitecustomize.py` enables `follow_redirects=True` for MCP trailing-slash 307s |
| OpenAI response dedup | Supervisor only | Mounts a patched `agent.py` via ConfigMap that sets `from_response_format_tool=True` when structured responses are parsed from OpenAI plain-text output |
| Corporate CA | All agents | Mounts corporate CA bundle (when `--corporate-ca` is set) |
| Langfuse secret | Supervisor only | Injects `langfuse-secret` into `envFrom` (when `--tracing` is set) |

### OpenAI response deduplication fix

OpenAI models (`gpt-4o`, `gpt-5-mini`, `gpt-5.2`) stream
`PlatformEngineerResponse` structured output as plain `message.content` text,
unlike Bedrock/Claude which send it as tool calls. The upstream `agent.py`
fails to set `from_response_format_tool=True` after successfully parsing
this response in its PRIORITY 2/3 post-stream paths, causing `agent_executor.py`
to take the wrong code path and produce duplicated output with raw JSON blobs.

The fix (`scripts/agent_fix.py`) adds two lines to set
`from_response_format_tool=True` when `handle_structured_response` returns a
valid `PlatformEngineerResponse`. This is mounted via ConfigMap at:

```
/app/ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/agent.py
```

Tested and verified with `gpt-4o`, `gpt-5-mini`, and `gpt-5.2`. Backward
compatible with Bedrock and Anthropic Claude (those providers already set
`from_response_format_tool=True` via the PRIORITY 1 tool-call path).

## Ports

| Service | Local port |
|---------|-----------|
| Supervisor (A2A API) | 8000 |
| CAIPE UI | 3000 |
| Langfuse | 3100 |
| RAG Server | 9446 |

## Auto-heal

When `--auto-heal` is enabled, the script runs a heal loop every 30 seconds
that:

- Restarts crash-looping or errored pods
- Fixes PVCs with wrong storage class
- Re-applies post-deploy patches (schema, httpx, agent fix, CA, Langfuse)
- Fixes RAG server configuration issues
- Heals services with no endpoints

## File structure

```
scripts/
  setup-caipe.sh          # Main setup/management script
  agent_fix.py            # Patched agent.py for OpenAI response dedup fix
  agent_executor_fix.py   # Original (unmodified) agent_executor.py
  README.md               # This file
```
