---
sidebar_position: 1
---

# Run with KinD

`setup-caipe.sh` (at the [repository root](https://github.com/cnoe-io/ai-platform-engineering)) automates deploying, configuring, and managing a [CAIPE](https://github.com/cnoe-io/ai-platform-engineering) (Community AI Platform Engineering) environment on a local Kind cluster. It handles LLM provider selection, Kubernetes secrets, Helm chart deployment, optional RAG and tracing stacks, health monitoring, and teardown.

## Quick start

From the repo root, run the script with no arguments for a fully guided, interactive setup:

```bash
./setup-caipe.sh
```

The script will walk you through:

1. Selecting a Kubernetes cluster (or creating one with Kind)
2. Choosing an LLM provider (Anthropic Claude is the recommended default; AWS Bedrock and OpenAI are also supported)
3. Entering your API key or credentials
4. Optionally enabling RAG, tracing, and other features

To tear down the environment:

```bash
./setup-caipe.sh cleanup
```

### Non-interactive mode

For CI or scripted use, pass `--non-interactive` with environment variables:

```bash
# Create cluster + deploy Claude (default) from scratch
./setup-caipe.sh --non-interactive --create-cluster

# Full stack with Claude: RAG + Langfuse tracing + auto-heal
./setup-caipe.sh --non-interactive --create-cluster --rag --tracing --auto-heal

# Non-interactive teardown
./setup-caipe.sh nuke
```

Credentials are read from `~/.config/claude.txt` and `~/.config/openai.txt` automatically. Set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` environment variables to override.

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
| `--create-cluster` | Create a Kind cluster if no kubectl context exists (name: `caipe`) |
| `--rag` | Deploy the RAG stack (Milvus, Redis, RAG server, web ingestor) |
| `--graph-rag` | Deploy Graph RAG (Neo4j + ontology agent; implies `--rag`) |
| `--corporate-ca` | Inject corporate TLS proxy CA certs into pods |
| `--tracing` | Deploy Langfuse and enable tracing on supervisor |
| `--ingest-url=URL` | Ingest a URL into the RAG knowledge base (implies `--rag`; repeatable) |
| `--auto-heal` | Enable auto-heal loop (every 30s) |
| `--yes`, `-y` | Auto-confirm cleanup prompts |
| `-h`, `--help` | Show help |

## LLM providers

Three providers are supported via [cnoe-agent-utils](https://github.com/cnoe-io/agent-utils) `LLMFactory`:

### Anthropic Claude (default, recommended)

Just run the script — Claude is the default provider. It prompts you for your API key and model:

```bash
./setup-caipe.sh
```

Store your key in `~/.config/claude.txt` (single line) to skip the prompt. Credential lookup order:

1. `ANTHROPIC_API_KEY` environment variable
2. `~/.config/claude.txt`
3. Interactive prompt

**Non-interactive:**

```bash
ANTHROPIC_API_KEY=sk-ant-xxx ./setup-caipe.sh --non-interactive
```

### OpenAI

Run the script and select **OpenAI** when prompted for a provider, or set the provider via environment variable:

```bash
LLM_PROVIDER=openai ./setup-caipe.sh
```

Store your key in `~/.config/openai.txt` (single line) to skip the prompt.

**Non-interactive:**

```bash
LLM_PROVIDER=openai OPENAI_API_KEY=sk-xxx ./setup-caipe.sh --non-interactive
```

### AWS Bedrock

Run the script and select **AWS Bedrock** when prompted, or:

```bash
LLM_PROVIDER=aws-bedrock ./setup-caipe.sh
```

The script resolves AWS credentials in this order:

1. `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` environment variables
2. `~/.config/bedrock.txt`
3. `AWS_PROFILE` environment variable
4. `~/.aws/credentials` `[default]` profile
5. Interactive prompt

**Non-interactive:**

```bash
LLM_PROVIDER=aws-bedrock AWS_PROFILE=my-profile ./setup-caipe.sh --non-interactive
```

## Enabling RAG

When you run the script interactively, it will ask whether to enable RAG. You can also pass the `--rag` flag:

```bash
./setup-caipe.sh --rag
```

RAG uses **OpenAI embeddings** (`text-embedding-3-large`) by default. When the default LLM is Claude, the script will prompt for both your Anthropic key (LLM) and an OpenAI key (embeddings). The script reads the OpenAI key from `~/.config/openai.txt` or `OPENAI_API_KEY`.

## Ingesting knowledge base URLs

After RAG is deployed, you can ingest documentation sites using `--ingest-url=URL` (repeatable, implies `--rag`):

```bash
./setup-caipe.sh --non-interactive --rag --ingest-url=https://cnoe-io.github.io/ai-platform-engineering/
```

Progress can be monitored in the CAIPE UI Knowledge Base tab.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_PROVIDER` | `anthropic-claude` | `anthropic-claude`, `aws-bedrock`, or `openai` |
| `OPENAI_API_KEY` | — | OpenAI API key (also used for embeddings when RAG is enabled) |
| `ANTHROPIC_API_KEY` | — | Anthropic API key |
| `KIND_CLUSTER_NAME` | `caipe` | Kind cluster name (used with `--create-cluster`) |
| `CAIPE_CHART_VERSION` | latest | Pin Helm chart version |

## Ports

| Service | Local port |
|---------|-----------|
| Supervisor (A2A API) | 8000 |
| CAIPE UI | 3000 |
| Langfuse | 3100 |
| RAG Server | 9446 |

## Next steps

- [Configure LLM providers for KinD](./configure-llms)
- [Configure agent secrets for KinD](./configure-agent-secrets)
