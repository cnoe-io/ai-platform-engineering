# Local Development Setup

Guide for running CAIPE locally on a Mac. Two LLM options are supported:

- **Ollama** — fully local, no credentials needed, recommended for basic testing
- **AWS Bedrock** — uses Splunk's `bedrock-inference-role`, requires `dev-login` auth

Both use Ollama for embeddings (running on the Mac host).

---

## Prerequisites

### 1. Install and start Ollama

Ollama runs on your Mac host (not in Docker) so it inherits the system's trusted CA certs,
which avoids TLS issues pulling models through the Splunk corporate proxy.

```bash
brew install ollama
ollama serve &
ollama pull nomic-embed-text        # embeddings model (always required)
ollama pull llama3.2:3b             # chat model (required for Ollama LLM option)
```

Models persist in `~/.ollama` — you only need to pull once.

### 2. (Bedrock only) Authenticate with AWS via dev-login

In your `~/.config/dev-login/config.yaml`, ensure the `bedrock-inference-role` is enabled
under the `ssc-ci-cd` account:

```yaml
accounts:
  - name: ssc-ci-cd
    id: "387769110234"
    roles:
      - name: bedrock-inference-role
        profile: ssc-ci-cd_bedrock-inference-role
        enabled: true
```

Then authenticate:

```bash
dev-login
```

This populates `~/.aws/config` and `~/.aws/credentials`. Sessions last 12 hours — re-run
`dev-login` when they expire.

---

## .env Configuration

Copy `.env.example` to `.env` and set the following. Everything else can stay at its default.

### UI auth (required)

The UI is run locally via `npm run dev` (see below). Auth is disabled — all requests are
treated as anonymous admin.

```bash
NEXTAUTH_SECRET=<generate with: openssl rand -base64 32>
NEXTAUTH_URL=http://localhost:3000
NEXT_PUBLIC_SSO_ENABLED=false
SSO_ENABLED=false
ALLOW_DEV_ADMIN_WHEN_SSO_DISABLED=true
```

### LLM Provider — Option A: Ollama (recommended for local testing)

No credentials required. Uses `llama3.2:3b` via Ollama's OpenAI-compatible API.

```bash
LLM_PROVIDER='openai'
OPENAI_API_KEY=ollama
OPENAI_ENDPOINT=http://host.docker.internal:11434/v1
OPENAI_MODEL_NAME=llama3.2:3b
```

### LLM Provider — Option B: AWS Bedrock (Splunk `bedrock-inference-role`)

Requires `dev-login` auth (see Prerequisites). The `AWS_BEDROCK_BASE_MODEL_ID` setting is
required — it bypasses a `bedrock:GetInferenceProfile` API call that `langchain_aws` makes
on init, which the role does not permit.


```bash
LLM_PROVIDER='aws-bedrock'

AWS_PROFILE='ssc-ci-cd_bedrock-inference-role'
AWS_REGION='us-west-2'
AWS_DEFAULT_REGION='us-west-2'
AWS_BEDROCK_MODEL_ID='arn:aws:bedrock:us-west-2:387769110234:application-inference-profile/bndt94220jde'
AWS_BEDROCK_BASE_MODEL_ID='anthropic.claude-3-7-sonnet-20250219-v1:0'
AWS_BEDROCK_PROVIDER='anthropic'
AWS_BEDROCK_ENABLE_PROMPT_CACHE='false'
AWS_BEDROCK_STREAMING='false'
AWS_BEDROCK_USE_CONVERSE_API='false'
```

> The role grants `bedrock:InvokeModel` on the application inference profile ARN only.
> It does **not** grant `GetInferenceProfile`, `InvokeModelWithResponseStream`, `Converse`,
> or `ConverseStream` — so prompt caching, streaming, and the Converse API must all be disabled.

### Embeddings (Ollama — both options)

```bash
EMBEDDINGS_PROVIDER=ollama
EMBEDDINGS_MODEL=nomic-embed-text
OLLAMA_BASE_URL=http://host.docker.internal:11434
```

---

## Starting the stack

### Docker (supervisor + RAG + MongoDB, no UI)

```bash
# First time or after code changes
COMPOSE_PROFILES="rag,caipe-ui-mongodb" docker compose -f docker-compose.dev.yaml up --build

# Subsequent starts (no rebuild)
COMPOSE_PROFILES="rag,caipe-ui-mongodb" docker compose -f docker-compose.dev.yaml up
```

### UI (separate terminal)

The UI runs locally via npm so auth works without an OIDC provider:

```bash
cd ui
npm install       # first time only
npm run dev
```

Open http://localhost:3000. The `ui/.env.local` file configures it to point at the
supervisor (`localhost:8000`) and RAG server (`localhost:9446`).

### Stop

```bash
COMPOSE_PROFILES="rag,caipe-ui-mongodb" docker compose -f docker-compose.dev.yaml down
```

### Full reset (wipe all data)

```bash
COMPOSE_PROFILES="rag,caipe-ui-mongodb" docker compose -f docker-compose.dev.yaml down -v
rm -rf ./volumes/milvus ./volumes/etcd ./volumes/minio
```

> `-v` removes named Docker volumes but Milvus data lives in `./volumes/` as bind mounts —
> those must be deleted manually.

---

## Switching embeddings models

If you change `EMBEDDINGS_MODEL` (or `EMBEDDINGS_PROVIDER`) after a previous run, Milvus
will error on startup:

```
Exception: Collection rag_default: Dense vector dimension mismatch. Expected: 768, Actual: 3072
```

Wipe the Milvus bind-mount directories and restart:

```bash
COMPOSE_PROFILES="rag,caipe-ui-mongodb" docker compose -f docker-compose.dev.yaml down
rm -rf ./volumes/milvus ./volumes/etcd ./volumes/minio
COMPOSE_PROFILES="rag,caipe-ui-mongodb" docker compose -f docker-compose.dev.yaml up --build
```

---

## Jira ingestor testing

The caipe-supervisor handles Jira ingestion — no separate ingestor profile is needed.
Start the stack as above, then trigger ingestion via the supervisor API or UI.
