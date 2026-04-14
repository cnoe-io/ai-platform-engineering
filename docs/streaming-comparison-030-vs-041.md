# A2A Response Comparison: 0.3.0 vs 0.2.41

**Query**: `show caipe setup options`
**Date**: 2026-04-13

| Setting | 0.3.0 | 0.2.41 |
|---------|-------|--------|
| ENABLE_MIDDLEWARE | false | false |
| USE_STRUCTURED_RESPONSE | false | false |
| ENABLE_RAG | true | false |

---

## 0.3.0 — 18 artifacts

### Artifact 0: `tool_notification_start`
- **Description**: Tool call started: [RAG] Search knowledge base for CAIPE setup options
- **Metadata**: `{"sourceAgent": "[RAG] Search knowledge base for CAIPE setup options", "agentType": "notification"}`
- **Parts count**: 1
- **Text**: 🔧 Workflow: Calling [RAG] Search knowledge base for CAIPE setup options...

### Artifact 1: `execution_plan_status_update`
- **Description**: Execution plan progress update
- **Metadata**: `{}`
- **Parts count**: 1
- **Data**: `{"steps": [{"step_id": "step-e6ae51949661", "title": "Search knowledge base for CAIPE setup options", "agent": "RAG", "status": "in_progress", "order": 0}]}`

### Artifact 2: `tool_notification_start`
- **Description**: Tool call started: search
- **Metadata**: `{"sourceAgent": "search", "agentType": "notification", "plan_step_id": "step-e6ae51949661"}`
- **Parts count**: 1
- **Text**: 🔧 Supervisor: Calling Agent Search...

### Artifact 3: `tool_notification_start`
- **Description**: Tool call started: list_datasources_and_entity_types
- **Metadata**: `{"sourceAgent": "list_datasources_and_entity_types", "agentType": "notification", "plan_step_id": "step-e6ae51949661"}`
- **Parts count**: 1
- **Text**: 🔧 Supervisor: Calling Agent List_Datasources_And_Entity_Types...

### Artifact 4: `tool_notification_end`
- **Description**: Tool call completed: list_datasources_and_entity_types
- **Metadata**: `{"sourceAgent": "list_datasources_and_entity_types", "agentType": "notification", "plan_step_id": "step-e6ae51949661"}`
- **Parts count**: 1
- **Text**: ✅ Supervisor: Agent task List_Datasources_And_Entity_Types completed

### Artifact 5: `tool_notification_end`
- **Description**: Tool call completed: search
- **Metadata**: `{"sourceAgent": "search", "agentType": "notification", "plan_step_id": "step-e6ae51949661"}`
- **Parts count**: 1
- **Text**: ✅ Supervisor: Agent task Search completed

### Artifact 6: `tool_notification_start`
- **Description**: Tool call started: fetch_document
- **Metadata**: `{"sourceAgent": "fetch_document", "agentType": "notification", "plan_step_id": "step-e6ae51949661"}`
- **Parts count**: 1
- **Text**: 🔧 Supervisor: Calling Agent Fetch_Document...

### Artifact 7: `tool_notification_start`
- **Description**: Tool call started: fetch_document
- **Metadata**: `{"sourceAgent": "fetch_document", "agentType": "notification", "plan_step_id": "step-e6ae51949661"}`
- **Parts count**: 1
- **Text**: 🔧 Supervisor: Calling Agent Fetch_Document...

### Artifact 8: `tool_notification_start`
- **Description**: Tool call started: search
- **Metadata**: `{"sourceAgent": "search", "agentType": "notification", "plan_step_id": "step-e6ae51949661"}`
- **Parts count**: 1
- **Text**: 🔧 Supervisor: Calling Agent Search...

### Artifact 9: `tool_notification_end`
- **Description**: Tool call completed: fetch_document
- **Metadata**: `{"sourceAgent": "fetch_document", "agentType": "notification", "plan_step_id": "step-e6ae51949661"}`
- **Parts count**: 1
- **Text**: ✅ Supervisor: Agent task Fetch_Document completed

### Artifact 10: `tool_notification_end`
- **Description**: Tool call completed: search
- **Metadata**: `{"sourceAgent": "search", "agentType": "notification", "plan_step_id": "step-e6ae51949661"}`
- **Parts count**: 1
- **Text**: ✅ Supervisor: Agent task Search completed

### Artifact 11: `tool_notification_end`
- **Description**: Tool call completed: fetch_document
- **Metadata**: `{"sourceAgent": "fetch_document", "agentType": "notification", "plan_step_id": "step-e6ae51949661"}`
- **Parts count**: 1
- **Text**: ✅ Supervisor: Agent task Fetch_Document completed

### Artifact 12: `tool_notification_start`
- **Description**: Tool call started: fetch_document
- **Metadata**: `{"sourceAgent": "fetch_document", "agentType": "notification", "plan_step_id": "step-e6ae51949661"}`
- **Parts count**: 1
- **Text**: 🔧 Supervisor: Calling Agent Fetch_Document...

### Artifact 13: `tool_notification_end`
- **Description**: Tool call completed: fetch_document
- **Metadata**: `{"sourceAgent": "fetch_document", "agentType": "notification", "plan_step_id": "step-e6ae51949661"}`
- **Parts count**: 1
- **Text**: ✅ Supervisor: Agent task Fetch_Document completed

### Artifact 14: `tool_notification_end`
- **Description**: Tool call completed: [RAG] Search knowledge base for CAIPE setup options
- **Metadata**: `{"sourceAgent": "[RAG] Search knowledge base for CAIPE setup options", "agentType": "notification", "plan_step_id": "step-e6ae51949661"}`
- **Parts count**: 1
- **Text**: ✅ Workflow: [RAG] Search knowledge base for CAIPE setup options completed

### Artifact 15: `execution_plan_status_update`
- **Description**: Execution plan progress update
- **Metadata**: `{}`
- **Parts count**: 1
- **Data**: `{"steps": [{"step_id": "step-e6ae51949661", "title": "Search knowledge base for CAIPE setup options", "agent": "RAG", "status": "completed", "order": 1}]}`

### Artifact 16: `streaming_result`
- **Description**: Streaming result
- **Metadata**: `{"plan_step_id": "step-e6ae51949661", "is_final_answer": true}`
- **Parts count**: 288
- **Token chunks (first 30 of 288):**
```
  [  0] "\n\n##"
  [  1] " "
  [  2] "🚀 CA"
  [  3] "IPE Setup"
  [  4] " Options"
  [  5] "\n\nCAIPE offers"
  [  6] " **"
  [  7] "5"
  [  8] " deployment paths"
  [  9] "** depending"
  [ 10] " on your environment and needs"
  [ 11] ":\n\n|"
  [ 12] " #"
  [ 13] " | Path"
  [ 14] " | Best"
  [ 15] " For |"
  [ 16] " Link"
  [ 17] " |\n|---|------|----------|"
  [ 18] "------|\n| 1 |"
  [ 19] " **"
  [ 20] "Docker Compose** | Local development,"
  [ 21] " VM"
  [ 22] " ("
  [ 23] "EC"
  [ 24] "2),"
  [ 25] " agent"
  [ 26] " profiles"
  [ 27] " | [Setup"
  [ 28] " Guide](https://cnoe-io"
  [ 29] ".github.io/ai-platform"
  ... (258 more chunks)
```
- **Full text length**: 3225 chars

### Artifact 17: `final_result`
- **Description**: Final result
- **Metadata**: `{"trace_id": "5453e4923f4d4519b155adbec8648cb0"}`
- **Parts count**: 1
- **Full text length**: 3223 chars
- **Text preview**: ## 🚀 CAIPE Setup Options  CAIPE offers **5 deployment paths** depending on your environment and needs:  | # | Path | Best For | Link | |---|------|----------|------| | 1 | **Docker Compose** | Local d...

---

## 0.2.41 — 4 artifacts

### Artifact 0: `tool_notification_start`
- **Description**: Tool call started: task
- **Metadata**: `{"sourceAgent": "task", "agentType": "notification"}`
- **Parts count**: 1
- **Text**: 🔧 Supervisor: Calling Agent Task...

### Artifact 1: `streaming_result`
- **Description**: Streaming result
- **Metadata**: `{"sourceAgent": "task", "agentType": "streaming"}`
- **Parts count**: 268
- **Token chunks (first 30 of 268):**
```
  [  0] "Excellent! I now have comprehensive information about CAIPE setup options. Here's a complete summary:\n\n---\n\n# 🤖 CAIPE Setup Options — Complete Guide\n\n**CAIPE** (Community AI Platform Engineering, pronounced "cape") is an open-source Multi-Agentic AI System by [CNOE](https://cnoe.io/). Here's everything you need to know about its setup options.\n\n📦 **Repository:** [cnoe-io/ai-platform-engineering](https://github.com/cnoe-io/ai-platform-engineering)\n📚 **Official Docs:** [cnoe-io.github.io/ai-platform-engineering](https://cnoe-io.github.io/ai-platform-engineering)\n\n---\n\n## 🚀 Quick Start (One-Command)\n\n```bash\ncurl -fsSL https://raw.githubusercontent.com/cnoe-io/ai-platform-engineering/main/setup-caipe.sh | bash\n```\nThe interactive script prompts for your LLM provider, API key, and optional components (RAG, tracing, persistence).\n\n---\n\n## 🛠️ Setup Paths\n\n| Path | Best For |\n|------|----------|\n| **Docker Compose** | Local development, VM (EC2), agent profiles |\n| **KinD** | Local Kubernetes, mirroring a production cluster |\n| **Helm** | Any Kubernetes cluster (EKS, GKE, AKS, …) |\n| **IDP Builder** | Full platform stack with Backstage, ArgoCD, Gitea |\n| **EKS** | AWS production deployment |\n\n---\n\n## 🐳 Docker Compose Setup\n\n### Step 1: Clone & Configure\n\n```bash\ngit clone https://github.com/cnoe-io/ai-platform-engineering.git\ncd ai-platform-engineering\ncp .env.example .env\n# Edit .env with your settings\n```\n\n### Step 2: Minimal `.env` Configuration\n\n```env\nENABLE_GITHUB=true\nA2A_TRANSPORT=p2p\nMCP_MODE=http\nLLM_PROVIDER=openai\nOPENAI_API_KEY=sk-...\nGITHUB_PERSONAL_ACCESS_TOKEN=<token>\n```\n\n### Step 3: Start with Profiles\n\n```bash\n# Supervisor only\ndocker compose up\n\n# Single agent\nCOMPOSE_PROFILES="github" docker compose up\n\n# Multiple agents\nCOMPOSE_PROFILES="argocd,aws,backstage" docker compose up\n\n# With RAG knowledge base\nCOMPOSE_PROFILES="github,rag" docker compose up\n\n# With tracing\nCOMPOSE_PROFILES="github,tracing" docker compose up\n\n# Full stack\nCOMPOSE_PROFILES="github,rag,tracing" docker compose up\n```\n\n---\n\n## ⚙️ Key Configuration Options (`.env.example`)\n\n### Agent Enable/Disable Flags\n\n| Variable | Default | Description |\n|----------|---------|-------------|\n| `ENABLE_GITHUB` | `false` | GitHub agent |\n| `ENABLE_ARGOCD` | `false` | ArgoCD agent |\n| `ENABLE_JIRA` | `false` | Jira agent |\n| `ENABLE_CONFLUENCE` | `false` | Confluence agent |\n| `ENABLE_PAGERDUTY` | `false` | PagerDuty agent |\n| `ENABLE_SLACK` | `false` | Slack agent |\n| `ENABLE_WEBEX` | `false` | Webex agent |\n| `ENABLE_BACKSTAGE` | `false` | Backstage agent |\n| `ENABLE_AWS` | `false` | AWS agent |\n| `ENABLE_SPLUNK` | `false` | Splunk agent |\n| `ENABLE_RAG` | `false` | RAG knowledge base |\n| `ENABLE_CAIPE_UI` | `true` | Web UI |\n| `ENABLE_TRACING` | `false` | Langfuse tracing |\n\n### LLM Provider Options\n\n| Provider | Variable | Notes |\n|----------|----------|-------|\n| **OpenAI** | `LLM_PROVIDER=openai` | Requires `OPENAI_API_KEY`, `OPENAI_MODEL_NAME` |\n| **Azure OpenAI** | `LLM_PROVIDER=azure-openai` | Requires `AZURE_OPENAI_API_KEY`, endpoint, deployment |\n| **AWS Bedrock** | `LLM_PROVIDER=aws-bedrock` | Requires `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` |\n| **Anthropic Claude** | `LLM_PROVIDER=anthropic-claude` | Requires `ANTHROPIC_API_KEY` |\n\n### A2A Transport Options\n\n```env\nA2A_TRANSPORT=p2p    # Peer-to-peer (default)\nA2A_TRANSPORT=slim   # AGNTCY Slim dataplane\n```\n\n### A2A Authentication Options\n\n```env\n# Option A: OAuth2 (recommended for production)\nA2A_AUTH_OAUTH2=true\nJWKS_URI=https://your-idp.com/.well-known/jwks.json\nAUDIENCE=your-audience\nISSUER=https://your-idp.com\n\n# Option B: Shared key (dev/testing)\nA2A_AUTH_SHARED_KEY=your-secret-key\n```\n\n---\n\n## 🏗️ Deployment Modes\n\n### Multi-Node (Default — Production)\nSupervisor orchestrates multiple remote sub-agents via A2A protocol:\n```bash\ndocker compose --profile caipe-ui up\n```\n\n### Single-Node (Development)\nAll agents run in-process in a single container:\n```bash\ndocker compose -f docker-compose.single-node.yaml --profile caipe-ui up\n```\n\n### Hybrid Mode (via `DISTRIBUTED_AGENTS`)\n```bash\n# All agents distributed\nDISTRIBUTED_AGENTS=all docker compose -f docker-compose.dev.yaml ...\n\n# Only specific agents distributed\nDISTRIBUTED_AGENTS=argocd,github docker compose -f docker-compose.dev.yaml ...\n```\n\n---\n\n## 📚 RAG (Knowledge Base) Profiles\n\n| Profile | Services | Use Case |\n|---------|----------|----------|\n| `rag` | rag_server, web_ingestor, milvus, redis | Vector search |\n| `graph_rag` | All `rag` + Neo4j, agent_ontology | Full knowledge graph |\n\n---\n\n## ☸️ Kubernetes (Helm) Setup\n\n```bash\n# Multi-node (default)\nhelm install caipe charts/ai-platform-engineering \\n  --set tags.caipe-ui=true \\n  --set caipe-ui.env.NEXT_PUBLIC_A2A_BASE_URL="https://your-caipe-api.example.com"\n\n# Single-node\nhelm install caipe charts/ai-platform-engineering \\n  --set global.deploymentMode=single-node \\n  --set tags.caipe-ui=true\n```\n\n---\n\n## 🔗 Available Docker Compose Agent Profiles\n\n| Profile | Description |\n|---------|-------------|\n| `argocd` | ArgoCD GitOps for Kubernetes |\n| `aws` | AWS cloud operations |\n| `backstage` | Backstage developer portal |\n| `confluence` | Confluence documentation |\n| `github` | GitHub repos and PRs |\n| `jira` | Jira issue tracking |\n| `komodor` | Kubernetes troubleshooting |\n| `pagerduty` | Incident management |\n| `rag` | RAG knowledge base |\n| `slack` | Slack messaging |\n| `splunk` | Splunk observability |\n| `webex` | Webex collaboration |\n| `slim` | AGNTCY Slim dataplane |\n| `tracing` | Langfuse distributed tracing |\n\n---\n\n## 💾 LangGraph Persistence Options\n\n```env\n# In-thread checkpoint persistence\nLANGGRAPH_CHECKPOINT_TYPE=memory   # memory | redis | postgres | mongodb\n\n# Cross-thread store persistence\nLANGGRAPH_STORE_TYPE=memory        # memory | redis | postgres | mongodb\n```\n\n---\n\nFor the most up-to-date setup documentation, visit the **[official CAIPE docs](https://cnoe-io.github.io/ai-platform-engineering/getting-started/quick-start)**.\n"
  [  1] "#"
  [  2] " 🤖 CAIPE"
  [  3] " Setup Options"
  [  4] "\n\n**CAIPE** (Community AI"
  [  5] " Platform Engineering)"
  [  6] " is an open-source Multi-"
  [  7] "Agentic AI System by ["
  [  8] "CNOE](https://cnoe."
  [  9] "io/)."
  [ 10] "\n\n-"
  [ 11] " "
  [ 12] "📦 **"
  [ 13] "Repo:** [cnoe-io/"
  [ 14] "ai-platform-engineering](https://"
  [ 15] "github.com/cnoe-io"
  [ 16] "/ai-platform-engineering)"
  [ 17] "\n- 📚 **"
  [ 18] "Docs:** [cnoe-io."
  [ 19] "github.io/ai-platform-"
  [ 20] "engineering](https://cnoe-io"
  [ 21] ".github.io/ai-platform"
  [ 22] "-engineering)\n\n---\n\n## "
  [ 23] "🚀 Quick Start (One"
  [ 24] "-Command)\n\n```bash\ncurl"
  [ 25] " -fsSL https://raw."
  [ 26] "githubusercontent.com/cnoe-io"
  [ 27] "/ai-platform-engineering/main"
  [ 28] "/setup-caipe.sh |"
  [ 29] " bash\n```\n\nThe interactive script prom"
  ... (238 more chunks)
```
- **Full text length**: 11583 chars

### Artifact 2: `tool_notification_end`
- **Description**: Tool call completed: task
- **Metadata**: `{"sourceAgent": "task", "agentType": "notification"}`
- **Parts count**: 1
- **Text**: ✅ Supervisor: Agent task Task completed

### Artifact 3: `partial_result`
- **Description**: Complete result from Platform Engineer
- **Metadata**: `{"trace_id": "84ab081730bc476ab56cf31499a737bb"}`
- **Parts count**: 1
- **Full text length**: 11583 chars
- **Text preview**: Excellent! I now have comprehensive information about CAIPE setup options. Here's a complete summary:  ---  # 🤖 CAIPE Setup Options — Complete Guide  **CAIPE** (Community AI Platform Engineering, pron...

---

## Summary Comparison

| Metric | 0.3.0 | 0.2.41 |
|--------|-------|--------|
| Total artifacts | 18 | 4 |
| Unique artifact types | 5 | 4 |
| Tool notifications (start/end) | 7/7 | 1/1 |
| streaming_result count | 1 | 1 |
| Total streaming parts | 288 | 268 |
| Total streaming text | 3225 chars | 11583 chars |
| has is_final_answer | True | False |
| has is_narration | False | False |
| has execution_plan | True | False |
| Final artifact name | final_result | partial_result |

### Key Deltas

1. **0.3.0 has `is_final_answer: true`** on streaming_result — enables Slack bot to know when to open the stream
2. **0.3.0 breaks down RAG tools** — search, list_datasources, fetch_document as separate notifications vs 0.2.41's single `task`
3. **0.3.0 has `execution_plan_status_update`** — UI can show step progress
4. **0.2.41 leaks LLM narration** — 'Excellent! I now have comprehensive information...' in streaming_result
5. **0.2.41 uses `partial_result`** — 0.3.0 uses `final_result` as completion artifact
6. **0.3.0 answer is more concise** — 3225 chars vs 11583 chars (RAG grounding)