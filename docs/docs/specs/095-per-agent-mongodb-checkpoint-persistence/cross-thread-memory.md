---
sidebar_position: 4
sidebar_label: Cross-Thread Memory
---

# Cross-Thread Memory: How Fact Extraction Benefits Users

## The Problem

Without cross-thread memory, every new chat conversation starts from zero. The supervisor has no idea who you are, what you've been working on, or what your infrastructure looks like. If you spent 30 minutes debugging an OOM issue in the monitoring namespace yesterday, you'd have to re-explain the entire context today.

## How It Works

CAIPE has two persistence layers that work together:

```
┌─────────────────────────────────────────────────────────┐
│                    User Conversation                     │
│                                                          │
│  Thread A: "list EKS clusters"                          │
│  Thread B: "check ArgoCD apps in prod"                  │
│  Thread C: "what was that cluster I was debugging?"     │
│                                                          │
├──────────────┬──────────────────────────────────────────┤
│  Checkpoint  │         Cross-Thread Store               │
│  (MongoDB)   │         (Redis)                          │
│              │                                          │
│  Per-thread  │  Per-user facts that persist             │
│  conversation│  across ALL threads:                     │
│  state       │                                          │
│              │  - "User manages 12 EKS clusters"        │
│  Lost when   │  - "Primary cluster: comn-dev-use2-1"    │
│  thread ends │  - "User's team uses ArgoCD on prod"     │
│              │  - "User prefers tabular output"         │
└──────────────┴──────────────────────────────────────────┘
```

### 1. Fact Extraction (Write Path)

After every supervisor response, a **background task** automatically extracts facts from the conversation:

1. Supervisor finishes streaming a response to the user
2. `asyncio.create_task()` launches fact extraction (non-blocking)
3. LangMem's `MemoryStoreManager` analyzes all messages in the thread
4. It extracts three types of memories:
   - **Semantic**: Facts and relationships ("User's SRE team manages the outshift-common-dev account")
   - **Episodic**: Past events ("User investigated an ArgoCD sync failure last week")
   - **Procedural**: Behavioral patterns ("User prefers detailed cluster metrics with node counts")
5. Memories are stored in Redis under the user's namespace: `("memories", user_id)`
6. Duplicate facts are automatically consolidated (LangMem handles insert/update/delete)

**This happens transparently** — the user doesn't need to do anything.

### 2. Context Recall (Read Path)

When a user starts a **new conversation**, the supervisor automatically retrieves their stored facts:

1. User sends first message in a new thread
2. Supervisor detects it's a new thread (no existing checkpoint)
3. Calls `store_get_cross_thread_context(store, user_id)`
4. Retrieves up to 50 memories + 10 conversation summaries from Redis
5. Injects them as a `SystemMessage` at the beginning of the conversation
6. The LLM now has context about the user before they say anything

The injected context looks like:

```
[Previous Conversation Summaries]
User investigated EKS clusters across 7 AWS accounts. Found 12 clusters
total. Checked ArgoCD v3.3.1 status and cluster utilization metrics.
---
User debugged a Jira workflow issue in the SRE project.

[User Memories]
- User is an SRE engineer managing Kubernetes infrastructure
- Primary AWS accounts: outshift-common-dev, eticloud
- Most used cluster: comn-dev-use2-1 in us-east-2
- User prefers comprehensive tabular output for cluster data
```

### 3. Context Compression (Preserve Path)

When a long conversation approaches the context limit, the supervisor compresses older messages but **preserves cross-thread facts** from the store. This ensures important user context survives even when conversation history is trimmed.

## Practical Examples

### Example 1: Infrastructure Knowledge

**Thread 1** (Monday): "List all my EKS clusters"
→ AWS agent returns 12 clusters across 7 accounts
→ Fact extracted: "User has 12 EKS clusters across eticloud, outshift-common-dev, ..."

**Thread 2** (Tuesday): "Which cluster should I deploy to?"
→ Supervisor already knows the user's cluster inventory
→ Can recommend based on prior context without re-querying AWS

### Example 2: Project Context

**Thread 1**: "Show Jira issues in the SRE project from last month"
→ Jira agent returns issues
→ Fact extracted: "User works on SRE Jira project, interested in recent activity"

**Thread 2**: "Any new blockers?"
→ Supervisor knows to check the SRE Jira project
→ Routes to Jira agent with the right project context

### Example 3: Preferences

**Thread 1**: User asks for data and says "show me a table"
→ Fact extracted: "User prefers tabular output format"

**Thread 2+**: All future responses use tabular format by default

## Configuration

```bash
# Enable fact extraction (default: false — opt-in due to extra LLM cost)
ENABLE_FACT_EXTRACTION=true

# Model for extraction (empty = use same LLM as supervisor)
FACT_EXTRACTION_MODEL=

# Cross-thread store backend (where facts are persisted)
LANGGRAPH_STORE_TYPE=redis
LANGGRAPH_STORE_REDIS_URL=redis://langgraph-redis:6379

# Tuning
LANGGRAPH_STORE_MAX_MEMORIES=50    # Max memories recalled per new thread
LANGGRAPH_STORE_MAX_SUMMARIES=10   # Max conversation summaries recalled
LANGGRAPH_STORE_TTL_MINUTES=10080  # Memory TTL (default: 7 days)
```

## Architecture

```
User sends message
        │
        ▼
┌───────────────────┐
│   Supervisor      │
│                   │──── New thread? ──── YES ──→ Recall facts from Redis
│   (MongoDB        │                              Inject as SystemMessage
│    checkpoint)    │
│                   │
│   Streams         │
│   response        │
│                   │
└───────┬───────────┘
        │
        ▼ (after response completes)
┌───────────────────┐
│  Background Task  │
│                   │
│  LangMem extracts │──→ Redis Store
│  facts from       │    ("memories", user_id)
│  conversation     │
│                   │
│  - Semantic facts │
│  - Episodic events│
│  - Preferences    │
└───────────────────┘
```

## Relationship to Checkpoints

| Feature | Checkpoints (MongoDB) | Cross-Thread Store (Redis) |
|---------|----------------------|---------------------------|
| **Scope** | Single thread | Across all threads |
| **Content** | Full graph state (messages, tool calls, channel versions) | Extracted facts and summaries |
| **Lifetime** | Lives as long as the thread | TTL-based (default 7 days) |
| **Per-agent** | Yes (auto-prefixed collections) | No (supervisor-only) |
| **Purpose** | Resume mid-conversation after restart | Remember user context across conversations |

## Related

- Spec: [073-automatic-fact-extraction](../073-automatic-fact-extraction/spec.md)
- Spec: [074-cross-thread-langgraph-store](../074-cross-thread-langgraph-store/spec.md)
- Spec: [084-cross-thread-store](../084-cross-thread-store/spec.md)
- Spec: [095-per-agent-mongodb-checkpoint-persistence](./spec.md)
