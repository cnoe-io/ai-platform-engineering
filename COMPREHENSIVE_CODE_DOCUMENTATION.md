# AI Platform Engineering - Comprehensive Code Documentation

## 🏗️ Architecture Overview

The **AI Platform Engineering Multi-Agent System** is a sophisticated distributed system that orchestrates multiple specialized agents to handle platform engineering operations. The system follows a microservices architecture with agent-to-agent communication (A2A) protocol.

### Core Architecture Components

```
┌─────────────────────────────────────────────────────────────────┐
│                 AI Platform Engineer (Supervisor)               │
│                     Port: 8000                                  │
└─────────────────────┬───────────────────────────────────────────┘
                      │
          ┌───────────┴───────────┐
          │   LangGraph Router    │
          │   (Supervisor Agent)  │
          └───────────┬───────────┘
                      │
    ┌─────────────────┼─────────────────┐
    │                 │                 │
    ▼                 ▼                 ▼
┌─────────┐    ┌─────────────┐    ┌──────────┐
│ ArgoCD  │    │   GitHub    │    │PagerDuty │
│Agent    │    │   Agent     │    │ Agent    │
│Port:8001│    │  Port:8003  │    │Port:8004 │
└─────────┘    └─────────────┘    └──────────┘
    │                 │                 │
┌─────────┐    ┌─────────────┐    ┌──────────┐
│Atlassian│    │   Slack     │    │Backstage │
│ Agent   │    │   Agent     │    │ Agent    │
│Port:8002│    │  Port:8005  │    │Port:8006 │
└─────────┘    └─────────────┘    └──────────┘
```

---

## 📁 Project Structure Deep Dive

### Root Directory Structure
```
ai-platform-engineering/
├── ai_platform_engineering/          # Main application package
│   ├── __main__.py                   # CLI entry point
│   ├── agents/                       # Individual agent implementations
│   ├── mas/                         # Multi-Agent System core
│   ├── utils/                       # Utility modules
│   └── graph.py                     # Graph configuration
├── deployment/                      # Kubernetes & Helm charts
├── docs/                           # Documentation
├── tests/                          # Test suite
├── docker-compose.yaml             # Container orchestration
├── pyproject.toml                  # Python project configuration
└── Makefile                        # Build automation
```

---

## 🎯 Core Module Documentation

### 1. Entry Point (`__main__.py`)

**File**: `ai_platform_engineering/__main__.py`

#### Key Functions:

##### `main(ctx, host, port)` - Lines 15-21
- **Purpose**: Main CLI entry point using Click framework
- **Parameters**: 
  - `ctx`: Click context for passing configuration
  - `host`: Server bind address (default: "0.0.0.0")
  - `port`: Server port (default: 8000)
- **Functionality**: Initializes the MAS system selector interface

##### `platform_engineer(ctx)` - Lines 24-48
- **Purpose**: Starts the AI Platform Engineer system
- **Protocol Selection**: Supports both `fastapi` and `a2a` protocols
- **Environment Variables**:
  - `AGENT_PROTOCOL`: Protocol selection ("fastapi" or "a2a")
  - Uses uvicorn for ASGI server deployment
- **Error Handling**: Validates protocol selection with clear error messages

##### `incident_engineer(ctx)` - Lines 51-53
- **Purpose**: Placeholder for future Incident Management system
- **Status**: Not yet implemented

##### `product_owner(ctx)` - Lines 56-59
- **Purpose**: Placeholder for future Product Owner system  
- **Status**: Not yet implemented

---

### 2. Supervisor Agent (`supervisor_agent.py`)

**File**: `ai_platform_engineering/mas/platform_engineer/supervisor_agent.py`

#### Class: `AIPlatformEngineerMAS`

##### `__init__(self)` - Line 36-37
- **Purpose**: Initializes the MAS with compiled LangGraph

##### `get_graph(self) -> CompiledStateGraph` - Lines 39-51
- **Purpose**: Returns the compiled LangGraph instance
- **Lazy Loading**: Creates graph only if not already instantiated
- **Return Type**: `CompiledStateGraph` from LangGraph

##### `build_graph(self) -> CompiledStateGraph` - Lines 53-95
- **Purpose**: Constructs and compiles the supervisor graph
- **Components**:
  - **Model**: Uses `LLMFactory().get_llm()` for LLM initialization
  - **Agents**: Integrates 6 specialized agents:
    - `argocd_agent`
    - `atlassian_agent` 
    - `pagerduty_agent`
    - `github_agent`
    - `slack_agent`
    - `backstage_agent`
  - **Checkpointer**: `InMemorySaver()` for state persistence
  - **Store**: `InMemoryStore()` for data storage
- **Configuration**:
  - `add_handoff_back_messages=False`
  - `output_mode="last_message"`
  - `response_format=(response_format_instruction, ResponseFormat)`

##### `async serve(self, prompt: str)` - Lines 97-134
- **Purpose**: Processes user prompts and returns responses
- **Parameters**: `prompt` - User input string
- **Flow**:
  1. Validates prompt is non-empty string
  2. Invokes graph with user message
  3. Generates unique thread ID using `uuid.uuid4()`
  4. Extracts last valid `AIMessage` from response
- **Error Handling**:
  - `ValueError` for invalid prompts
  - `RuntimeError` for missing messages or invalid responses
- **Logging**: Comprehensive debug and error logging

---

### 3. Agent Communication Tool (`a2a_remote_agent_connect.py`)

**File**: `ai_platform_engineering/utils/a2a/a2a_remote_agent_connect.py`

#### Class: `A2ARemoteAgentConnectTool(BaseTool)`

##### `__init__(self, remote_agent_card, skill_id, access_token=None)` - Lines 36-58
- **Purpose**: Initializes A2A remote agent connection
- **Parameters**:
  - `remote_agent_card`: `AgentCard` object or URL string
  - `skill_id`: Target skill identifier
  - `access_token`: Optional bearer token for authenticated cards
- **Private Attributes**: Uses Pydantic `PrivateAttr()` for internal state

##### `async _connect(self)` - Lines 60-107
- **Purpose**: Establishes connection to remote A2A agent
- **Card Resolution**:
  - Direct `AgentCard` usage if provided
  - URL-based card fetching using `A2ACardResolver`
  - Extended card support with authentication
- **HTTP Client**: Uses `httpx.AsyncClient` with 300s timeout
- **Error Handling**: Comprehensive exception handling with logging

##### `async _arun(self, input: Input) -> Any` - Lines 112-135
- **Purpose**: Asynchronously executes agent communication
- **Input Processing**: Handles both dict and Pydantic model inputs
- **Response**: Returns `Output` object with agent response
- **Error Handling**: Converts exceptions to `RuntimeError` with context

##### `async send_message(self, prompt: str) -> str` - Lines 137-218
- **Purpose**: Core message sending functionality
- **Message Structure**:
  ```python
  {
    'message': {
      'role': 'user',
      'parts': [{'kind': 'text', 'text': prompt}],
      'messageId': uuid4().hex
    }
  }
  ```
- **Response Processing**: Extracts text from artifact parts
- **Error Handling**: Handles A2A protocol errors and unknown response types

##### `extract_text_from_parts(artifacts)` - Lines 172-209
- **Purpose**: Extracts text content from A2A response artifacts
- **Logic**: Iterates through artifacts → parts → root → text
- **Error Resilience**: Handles missing attributes gracefully

---

### 4. System Prompts (`prompts.py`)

**File**: `ai_platform_engineering/mas/platform_engineer/prompts.py`

#### Key Variables:

##### `agent_name` - Line 28
```python
agent_name = "AI Platform Engineer"
```

##### `agent_description` - Lines 30-38
- **Purpose**: Comprehensive system description
- **Coverage**: Details all integrated tools and capabilities
- **Tools Listed**: PagerDuty, GitHub, Jira, Slack, ArgoCD, Backstage

##### `tools` - Lines 40-47
- **Structure**: Dictionary mapping agent names to example tasks
- **Agents**: Maps to skill examples from each agent card

##### `generate_system_prompt(tools)` - Lines 61-96
- **Purpose**: Dynamically generates system prompt based on available tools
- **Logic**: 
  1. Creates tool-specific instructions
  2. Generates routing logic for each agent
  3. Includes fallback responses for unsupported requests
- **Reflection Instructions**: Status management (`completed`, `input_required`, `error`)

---

### 5. Agent Implementations

#### GitHub Agent (`agents/github/agent.py`)

**File**: `ai_platform_engineering/agents/github/agent.py`

##### Core Components:
- **Tool**: `A2ARemoteAgentConnectTool` configured for GitHub
- **Agent**: `create_react_agent` with GitHub-specific tools
- **Capabilities**: Repository management, pull requests, workflows

#### PagerDuty Agent (`agents/pagerduty/agent.py`)

**File**: `ai_platform_engineering/agents/pagerduty/agent.py`

##### Core Components:
- **Tool**: `A2ARemoteAgentConnectTool` configured for PagerDuty
- **Agent**: `create_react_agent` with PagerDuty-specific tools
- **Capabilities**: Incident management, alerts, on-call schedules

#### Slack Agent (`agents/slack/agent.py`)

**File**: `ai_platform_engineering/agents/slack/agent.py`

##### Core Components:
- **Tool**: `A2ARemoteAgentConnectTool` configured for Slack
- **Agent**: `create_react_agent` with Slack-specific tools
- **Capabilities**: Team communication, channel management, notifications

---

### 6. A2A Protocol Binding (`protocol_bindings/a2a/`)

#### Agent Executor (`agent_executor.py`)

**File**: `ai_platform_engineering/mas/platform_engineer/protocol_bindings/a2a/agent_executor.py`

##### Class: `AIPlatformEngineerA2AExecutor(AgentExecutor)`

##### `async execute(self, context, event_queue)` - Lines 27-97
- **Purpose**: Main execution loop for A2A requests
- **Flow**:
  1. Extracts user input from context
  2. Creates or retrieves task
  3. Streams agent responses
  4. Enqueues appropriate events based on response type
- **Event Types**:
  - `TaskArtifactUpdateEvent`: For completed tasks
  - `TaskStatusUpdateEvent`: For status changes
- **States**: `completed`, `input_required`, `working`

#### Main Server (`main.py`)

**File**: `ai_platform_engineering/mas/platform_engineer/protocol_bindings/a2a/main.py`

##### `get_agent_card(host: str, port: int)` - Lines 31-51
- **Purpose**: Creates A2A agent card for service discovery
- **Capabilities**: Streaming and push notifications enabled
- **Skills**: Maps to platform engineer skill examples

##### Server Configuration - Lines 69-82
- **Framework**: Starlette with A2A application wrapper
- **CORS**: Enabled for all origins, methods, and headers
- **Components**:
  - `AIPlatformEngineerA2AExecutor`: Main executor
  - `InMemoryTaskStore`: Task persistence
  - `InMemoryPushNotifier`: Real-time updates

---

### 7. Agent Cards Configuration

#### GitHub Agent Card (`agents/github/a2a_agentcards.py`)

**File**: `ai_platform_engineering/agents/github/a2a_agentcards.py`

##### `github_agent_skill` - Lines 15-30
- **ID**: "github_agent_skill"
- **Capabilities**: Repository management, pull requests, workflows
- **Examples**: 5 practical GitHub operation examples
- **Tags**: "github", "repository management", "pull requests", "workflows"

##### `github_agent_card` - Lines 32-44
- **URL**: Configurable via environment variables
- **Default**: `http://localhost:8003`
- **Capabilities**: Text input/output, no streaming
- **Authentication**: No extended card support

#### ArgoCD Agent Card (`agents/argocd/a2a_agentcards.py`)

**File**: `ai_platform_engineering/agents/argocd/a2a_agentcards.py`

##### `argocd_agent_skill` - Lines 15-29
- **ID**: "argocd_agent_skill"
- **Capabilities**: Application management, GitOps operations
- **Examples**: 5 practical ArgoCD operation examples
- **Tags**: "argocd", "list apps", "gitops"

---

## 🔧 State Management (`state.py`)

**File**: `ai_platform_engineering/mas/platform_engineer/state.py`

### Data Models:

#### `MsgType(Enum)` - Lines 10-13
```python
class MsgType(Enum):
    human = "human"
    assistant = "assistant"
```

#### `Message(BaseModel)` - Lines 15-21
- **Fields**: `type` (MsgType), `content` (str)
- **Purpose**: Standardized message format for agent communication

#### `InputState(BaseModel)` - Lines 28-30
- **Field**: `messages` (Optional[list[Message]])
- **Purpose**: Input state container for agent processing

#### `OutputState(BaseModel)` - Lines 32-34
- **Field**: `messages` (Optional[list[Message]])
- **Purpose**: Output state container for agent responses

#### `AgentState(BaseModel)` - Lines 36-38
- **Fields**: `input` (InputState), `output` (Optional[OutputState])
- **Purpose**: Complete agent state representation

---

## 🐳 Container Orchestration (`docker-compose.yaml`)

**File**: `docker-compose.yaml`

### Service Architecture:

#### Main Platform Engineer - Lines 3-32
- **Image**: `ghcr.io/cnoe-io/ai-platform-engineering:stable`
- **Port**: 8000 (external and internal)
- **Dependencies**: All 6 specialized agents
- **Protocol**: A2A agent communication

#### Specialized Agents:
- **ArgoCD Agent**: Port 8001 → 8000 (internal)
- **Atlassian Agent**: Port 8002 → 8000 (internal)
- **GitHub Agent**: Port 8003 → 8000 (internal)
- **PagerDuty Agent**: Port 8004 → 8000 (internal)
- **Slack Agent**: Port 8005 → 8000 (internal)
- **Backstage Agent**: Port 8006 → 8000 (internal)

#### UI Components:
- **Backstage Agent Forge**: Port 3000 for UI interaction

---

## 🛠️ Build System (`Makefile`)

**File**: `Makefile`

### Key Targets:

#### `setup-venv` - Lines 19-27
- **Purpose**: Creates Python virtual environment
- **Logic**: Checks for existing .venv directory
- **Output**: Instructions for manual activation

#### `run-ai-platform-engineer` - Lines 69-71
- **Purpose**: Main application runner
- **Dependencies**: setup-venv, build, install
- **Command**: `poetry run ai-platform-engineering platform-engineer`

#### `build` - Lines 50-52
- **Purpose**: Package building with Poetry
- **Dependency**: setup-venv

#### `install` - Lines 54-56
- **Purpose**: Package installation with Poetry
- **Dependency**: setup-venv

#### `lint` - Lines 79-81
- **Purpose**: Code linting with Ruff
- **Command**: `poetry run ruff check .`

#### `test` - Lines 85-87
- **Purpose**: Test execution with pytest
- **Command**: `poetry run pytest`

---

## 🔍 Key Insights and Design Patterns

### 1. **Multi-Agent Orchestration**
The system uses LangGraph's supervisor pattern to route requests to appropriate specialized agents based on request analysis.

### 2. **A2A Protocol**
Agent-to-Agent communication protocol enables distributed microservices architecture with standardized message passing.

### 3. **Reactive Agent Pattern**
Each agent uses `create_react_agent` from LangGraph for reasoning and action loops.

### 4. **State Management**
Comprehensive state tracking with Pydantic models ensures type safety and clear data flow.

### 5. **Error Resilience**
Multiple layers of error handling with logging and graceful degradation.

### 6. **Configuration Management**
Environment-based configuration for flexible deployment across different environments.

### 7. **Extensibility**
Modular agent design allows easy addition of new platform tools and capabilities.

---

## 🚀 Getting Started Guide

### Development Setup:
```bash
# Setup virtual environment
make setup-venv

# Install dependencies  
make install

# Run the platform
make run-ai-platform-engineer

# Or with Docker Compose
docker-compose up
```

### Adding New Agents:
1. Create agent directory under `ai_platform_engineering/agents/`
2. Implement `agent.py` with `A2ARemoteAgentConnectTool`
3. Create `a2a_agentcards.py` with skill definitions
4. Add to supervisor in `supervisor_agent.py`
5. Update `prompts.py` with new capabilities

---

This documentation provides a comprehensive view of the AI Platform Engineering system, covering architecture, implementation details, and operational guidance for developers working with this multi-agent platform.