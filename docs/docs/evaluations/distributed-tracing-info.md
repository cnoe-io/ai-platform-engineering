# Multi-Agent Distributed Tracing Architecture

The architecture diagram illustrates a multi-agent distributed tracing system designed to provide end-to-end observability across various agents in a supervisor multi-agent architecture. Here's a breakdown of the components:

1. **User Request**: The process begins with a user request, which is handled by the **Supervisor Agent**. This agent acts as the central orchestrator for all subsequent operations.

2. **Sub-Agents**: The supervisor interacts with multiple sub-agents

3. **A2A Communication Layer**:
   - This layer provides communication between agents using the **Agent-to-Agent Protocol (A2A)**.
   - **Metadata Propagation** ensures that critical information, such as trace IDs, is passed along with each request.
   - **Trace Context** maintains the continuity of tracing information across agent boundaries.

4. **Tracing Flow**:
   - The end user generates a unique trace ID for request.
   - This trace ID is propagated through the A2A communication layer to all sub-agents, ensuring that all operations are linked to the same trace context.

```mermaid
graph TB
    USER[User Request] --> PE[Platform Engineer Agent<br/>Supervisor]

    PE --> GH[GitHub Agent<br/>Repository Operations]
    PE --> JIRA[Jira Agent<br/>Issue Management]
    PE --> SLACK[Slack Agent<br/>Communication]
    PE --> CONF[Confluence Agent<br/>Documentation]

    subgraph "A2A Communication Layer"
        A2A[Agent-to-Agent Protocol]
        META[Metadata Propagation]
        TRACE[Trace Context]
    end

    PE --> A2A
    A2A --> GH
    A2A --> JIRA
    A2A --> SLACK
    A2A --> CONF

    META --> TRACE

    style PE fill:#e1f5fe
    style A2A fill:#fff3e0
    style TRACE fill:#f3e5f5
```
**Styling notes**:
  - The supervisor agent is highlighted in blue (`#e1f5fe`) to indicate its central role.
  - The A2A communication layer is styled in orange (`#fff3e0`) to emphasize its role in connecting agents.
  - The trace context is styled in purple (`#f3e5f5`) to signify its importance in maintaining observability.
### Why Distributed Tracing is Critical

In a multi-agent environment, understanding the flow of operations across agent boundaries becomes essential for:

```mermaid
graph LR
    subgraph "Challenges Without Tracing"
        C1[Black Box Operations]
        C2[Lost Context Between Agents]
        C3[Need Agent Evaluation]
    end

    subgraph "Solutions With Tracing"
        S1[End-to-End Visibility]
        S2[Context Preservation]
        S3[AI Agent Evaluation Framework]
    end

    C1 --> S1
    C2 --> S2
    C3 --> S3

    style C1 fill:#ffebee
    style C2 fill:#ffebee
    style C3 fill:#ffebee
    style S1 fill:#e8f5e8
    style S2 fill:#e8f5e8
    style S3 fill:#e8f5e8
```

### Tracing Implementation Goals

Our distributed tracing implementation addresses these specific requirements:

```mermaid
graph TD
    subgraph "Core Requirements"
        R1[Unified Trace Context<br/>Single trace_id across agents]
        R2[Zero Framework Interference<br/>Clean Langfuse traces only]

        R4[Automatic Propagation<br/>Seamless A2A trace flow]
        R5[AI Agent Evaluation<br/>Performance & quality metrics]
    end

    subgraph "Technical Challenges"

        T2[Context Variable Management]
        T3[Framework Noise Elimination]
        T4[Metadata Propagation]
        T5[Evaluation Data Collection]
    end

    R1 --> T2
    R2 --> T3

    R4 --> T4
    R5 --> T5

    style R1 fill:#e8f5e8
    style R2 fill:#e8f5e8

    style R4 fill:#e8f5e8
    style R5 fill:#fff8e1

    style T2 fill:#fff3e0
    style T3 fill:#fff3e0
    style T4 fill:#fff3e0
    style T5 fill:#fff8e1
```

## Overview

The CAIPE (Community AI Platform Engineering) system implements distributed tracing using **Langfuse** to provide end-to-end observability across multi-agent workflows. This enables debugging, performance analysis, and understanding of complex agent-to-agent interactions.

## Architecture Diagram

```mermaid
graph TB
    subgraph "Supervisor Agent (Platform Engineer)"
        PE[Platform Engineer Agent]
        TID[Trace ID Generator]
        A2A_TOOLS[A2A Communication Tools]
    end

    subgraph "A2A Framework"
        A2A_MSG[A2A Message Payload]
        META[Metadata with trace_id]
    end

    subgraph "Sub-Agents"
        GH[GitHub Agent]
        JIRA[Jira Agent]
        SLACK[Slack Agent]
        CONF[Confluence Agent]
    end

    subgraph "Langfuse Infrastructure"
        LF_WEB[Langfuse Web UI:3000]
        LF_WORKER[Langfuse Worker:3030]
        PG[PostgreSQL:5432]
        CH[ClickHouse:8123]
        REDIS[Redis:6379]
        MINIO[MinIO:9090]
    end

    PE --> TID
    TID --> A2A_TOOLS
    A2A_TOOLS --> A2A_MSG
    A2A_MSG --> META
    META --> GH
    META --> JIRA
    META --> SLACK
    META --> CONF

    PE --> LF_WEB
    GH --> LF_WEB
    JIRA --> LF_WEB
    SLACK --> LF_WEB
    CONF --> LF_WEB

    LF_WEB --> LF_WORKER
    LF_WORKER --> PG
    LF_WORKER --> CH
    LF_WEB --> REDIS
    LF_WEB --> MINIO

    style PE fill:#e1f5fe
    style TID fill:#f3e5f5
    style LF_WEB fill:#e8f5e8
    style META fill:#fff3e0
```

## Trace Flow

```mermaid
sequenceDiagram
    participant User
    participant Supervisor as Platform Engineer Agent
    participant A2A as A2A Framework
    participant GitHub as GitHub Agent
    participant Langfuse

    User->>Supervisor: Request (e.g., "Create PR")
    Supervisor->>Supervisor: Generate UUID trace_id
    Note over Supervisor: 🔍 Supervisor initialized trace_id: abc123

    Supervisor->>Langfuse: Create parent span
    Supervisor->>A2A: Call GitHub agent with trace_id in metadata
    Note over A2A: Message payload includes trace_id

    A2A->>GitHub: Forward request with trace_id
    GitHub->>GitHub: Extract trace_id from metadata
    Note over GitHub: 🔍 GitHub Agent using SUPERVISOR trace_id: abc123

    GitHub->>Langfuse: Create child span with same trace_id
    GitHub->>GitHub: Execute GitHub operations
    GitHub->>Langfuse: Log span completion

    GitHub->>A2A: Return response
    A2A->>Supervisor: Forward response
    Supervisor->>Langfuse: Complete parent span
    Supervisor->>User: Final response
```

## Key Components

### 1. Trace ID Management

**Location**: `ai_platform_engineering/utils/a2a/a2a_remote_agent_connect.py`

```python
# Thread-safe trace ID storage
current_trace_id: ContextVar[Optional[str]] = ContextVar('current_trace_id', default=None)

# Langfuse v3 compliant trace ID generation
def generate_trace_id() -> str:
    return uuid4().hex.lower()  # 32-char lowercase hex
```

### 2. A2A Communication with Tracing

**Location**: `ai_platform_engineering/utils/a2a/a2a_remote_agent_connect.py:176-188`

#### Message Payload Structure with Trace ID

```mermaid
graph TB
    subgraph "A2A Message Structure"
        MSG[Message Payload]
        ROLE[role: 'user']
        PARTS[parts: text content]
        MID[messageId: UUID]
        META[metadata: object]
        TID[trace_id: inherited UUID]
    end

    MSG --> ROLE
    MSG --> PARTS
    MSG --> MID
    MSG --> META
    META --> TID

    style MSG fill:#e1f5fe
    style META fill:#fff3e0
    style TID fill:#f3e5f5
```



**Most common flow:** The supervisor agent sets trace_id in context variable, and A2A tools inherit it automatically without needing explicit input.


#### Context Variable Isolation

```mermaid
graph LR
    subgraph "Supervisor Container"
        CTX1[ContextVar trace_id]
        SUPER[Platform Engineer Agent]
    end

    subgraph "GitHub Container"
        CTX2[ContextVar trace_id]
        GITHUB[GitHub Agent]
    end

    subgraph "A2A Message"
        META[metadata.trace_id]
    end

    CTX1 --> META
    META --> CTX2

    style CTX1 fill:#f3e5f5
    style CTX2 fill:#f3e5f5
    style META fill:#fff3e0
```

**Context Variable Mechanism:**

Each agent container runs in isolation with its own Python `contextvars.ContextVar` for trace ID storage. This provides:

- **Thread Safety**: Each async task maintains its own trace context
- **Container Isolation**: No shared memory between supervisor and sub-agents
- **Automatic Inheritance**: Child tasks inherit parent context within the same container
- **Cross-Container Bridge**: A2A metadata serves as the bridge between isolated contexts

```mermaid
graph TD
    subgraph "How Context Variables Work"
        INIT[Agent Container Starts]
        RECV[Receive A2A Message]
        EXTRACT[Extract trace_id from metadata]
        SET[Set trace_id in ContextVar]
        INHERIT[All async tasks inherit context]
        LANGFUSE[LangChain callbacks access context]
    end

    INIT --> RECV
    RECV --> EXTRACT
    EXTRACT --> SET
    SET --> INHERIT
    INHERIT --> LANGFUSE

    style SET fill:#f3e5f5
    style INHERIT fill:#e8f5e8
    style LANGFUSE fill:#fff3e0
```

### 4. A2A Noise Reduction

#### Problem and Solution Flow

```mermaid
graph TD
    PROBLEM[A2A Framework Built-in Tracing] --> NOISE[Creates Noise in Langfuse]
    NOISE --> SOLUTION[Monkey Patch A2A Telemetry]
    SOLUTION --> NOOP[Replace trace_function with no-op]
    NOOP --> CLEAN[Clean Langfuse Traces Only]

    subgraph "Before Fix"
        A2A_TRACE[A2A Traces]
        LF_TRACE[Langfuse Traces]
        MIXED[Mixed/Duplicated Spans]
    end

    subgraph "After Fix"
        PURE_LF[Pure Langfuse Traces]
        NO_A2A[No A2A Interference]
    end

    PROBLEM --> A2A_TRACE
    A2A_TRACE --> MIXED
    LF_TRACE --> MIXED

    CLEAN --> PURE_LF
    CLEAN --> NO_A2A

    style PROBLEM fill:#ffebee
    style NOISE fill:#ffebee
    style MIXED fill:#ffebee
    style SOLUTION fill:#e8f5e8
    style CLEAN fill:#e8f5e8
    style PURE_LF fill:#e8f5e8
```

**Monkey Patching Method:**

The A2A framework has built-in telemetry that creates unwanted trace spans. Our solution uses Python's module system to intercept and disable this tracing:

```mermaid
graph TD
    subgraph "Monkey Patch Implementation"
        TIMING[CRITICAL: Patch BEFORE imports]
        CREATE[Create fake telemetry module]
        NOOP[Define no-op trace_function]
        INJECT[Inject into sys.modules]
        IMPORT[Import A2A components]
        RESULT[A2A uses no-op traces]
    end

    TIMING --> CREATE
    CREATE --> NOOP
    NOOP --> INJECT
    INJECT --> IMPORT
    IMPORT --> RESULT

    style TIMING fill:#ffebee
    style NOOP fill:#e8f5e8
    style INJECT fill:#e8f5e8
    style RESULT fill:#e8f5e8
```

**Implementation Details:**

- **Timing is Critical**: Patch must happen before any A2A imports
- **Module Replacement**: Replace `a2a.utils.telemetry` with custom no-op module
- **Function Signature Preservation**: No-op function maintains same interface as original
- **Clean Separation**: Langfuse tracing continues unaffected by A2A framework

## Environment Configuration

### Development Setup

```bash
# Enable tracing
ENABLE_TRACING=true

# Langfuse configuration
LANGFUSE_PUBLIC_KEY=<your-public-key>
LANGFUSE_SECRET_KEY=<your-secret-key>
LANGFUSE_HOST=http://langfuse-web:3000
LANGFUSE_SESSION_ID=ai-platform-engineering
LANGFUSE_USER_ID=platform-engineer
```

### Tracing Implementation Details

#### Conditional Langfuse Imports

The system uses environment-based conditional imports to prevent dependency issues:

```python
# Conditional langfuse import based on ENABLE_TRACING
if os.getenv("ENABLE_TRACING", "false").lower() == "true":
    from langfuse import get_client
    from langfuse.langchain import CallbackHandler
    langfuse_handler = CallbackHandler()
else:
    langfuse_handler = None
```

#### Thread-Safe Context Management

Each agent container maintains its own context variable for trace ID storage:

```python
# Context variable declaration (supervisor)
current_trace_id: ContextVar[Optional[str]] = ContextVar('current_trace_id', default=None)

# Context variable declaration (GitHub agent)
current_trace_id: ContextVar[Optional[str]] = ContextVar('current_trace_id', default=None)
```

#### Langfuse Span Creation

Spans are created with the CallbackHandler in LangChain's RunnableConfig:

```python
runnable_config = RunnableConfig(
    configurable={"thread_id": context_id},
    callbacks=[langfuse_handler] if langfuse_handler else []
)

# Execute with tracing
result = await self.graph.ainvoke(inputs, config=runnable_config)
```

### Docker Compose Profiles

**Development with Tracing**:
```bash
docker-compose -f docker-compose.dev.yaml --profile build-tracing up
```

**Production with Tracing**:
```bash
docker-compose --profile tracing up
```

## Recent Improvements

Based on recent commits, the distributed tracing system has been enhanced with:

1. **Unified Trace Trees** (`5cd9edf`): Connected supervisor-github-agent traces into coherent trace hierarchies
2. **A2A Noise Elimination** (`0d4926f`): Disabled A2A framework's built-in tracing to prevent interference
3. **Volume Mount Updates** (`48287cd`): All agents now receive tracing environment variables
4. **Langfuse Environment Setup** (`887f879`): Enhanced build-tracing profile with proper Langfuse configuration
5. **Code Deduplication** (`e231568`): Cleaned up duplicate tracing code across agent implementations

