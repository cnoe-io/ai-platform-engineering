# Platform Engineer Evaluation System

A comprehensive evaluation framework for multi-agent AI systems using Langfuse for trace analysis and LLM-based behavioral evaluation.

## Quick Start

### Option 1: Docker Compose (Recommended)

```bash
# From the root directory
# Configure environment variables in .env file
echo "LANGFUSE_PUBLIC_KEY=your_key" >> .env
echo "LANGFUSE_SECRET_KEY=your_secret" >> .env
echo "OPENAI_API_KEY=your_openai_key" >> .env

# Start with evaluation service
docker-compose -f docker-compose.dev.yaml --profile slim-tracing up evaluation-webhook

# Or start full dev environment with evaluation
docker-compose -f docker-compose.dev.yaml --profile slim-tracing up
```

### Option 2: Local Development

```bash
# Clone and setup
cd evals
uv sync

# Configure environment
export LANGFUSE_PUBLIC_KEY=your_key
export LANGFUSE_SECRET_KEY=your_secret
export OPENAI_API_KEY=your_openai_key

# Start webhook service
uv run eval-webhook
```

## Features

- **Tool Call Extraction**: Extracts detailed tool calls and agent interactions from Langfuse traces
- **Multiple Evaluators**: 
  - Simple trajectory matching (agent usage comparison)
  - LLM-based behavior evaluation (semantic analysis of expected vs actual behavior)
- **Webhook Integration**: FastAPI webhook service for integration with Langfuse UI
- **Comprehensive Dataset Support**: YAML-based datasets with expected agents and behavior descriptions
- **Async Processing**: Full async/await support for efficient evaluation

## Directory Structure

```
evals/
├── models/                   # Pydantic data models
│   ├── dataset.py           # Dataset and item models
│   └── trajectory.py        # Tool call and trajectory models
├── evaluators/              # Evaluation implementations
│   ├── base.py             # Base evaluator interface
│   ├── trajectory_evaluator.py  # Simple agent matching
│   └── llm_evaluator.py    # LLM-based behavior analysis
├── trace_analysis/         # Langfuse trace extraction
│   └── extractor.py        # Tool call extraction logic
├── webhook/                # Webhook service
│   └── langfuse_webhook.py # FastAPI webhook for Langfuse
├── datasets/               # Evaluation datasets
│   ├── single_agent.yaml  # Single agent tests
│   ├── multi_agent.yaml   # Multi-agent workflows
│   └── complex_workflows.yaml  # Complex integration scenarios
└── runner.py              # Main evaluation orchestrator
```

## Dataset Format

Enhanced dataset format without `category` and `operation` fields:

```yaml
name: multi_agent_workflows
description: Multi-agent integration tests
prompts:
  - id: "github_and_jira_integration"
    messages:
      - role: "user"
        content: "Create a Jira issue for the latest GitHub issue in cnoe-io/ai-platform-engineering repo"
    expected_agents: ["github", "jira"]
    expected_behavior: "Should first use GitHub agent to fetch the latest issue, then use Jira agent to create a new issue with the relevant details"
```

## Setup

1. **Install uv** (if not already installed):
   ```bash
   curl -LsSf https://astral.sh/uv/install.sh | sh
   ```

2. **Install Dependencies**:
   ```bash
   cd evals
   uv sync
   ```

3. **Configure Environment Variables**:
   ```bash
   export LANGFUSE_PUBLIC_KEY=your_public_key
   export LANGFUSE_SECRET_KEY=your_secret_key
   export LANGFUSE_HOST=http://langfuse-web:3000
   export PLATFORM_ENGINEER_URL=http://platform-engineering:8000
   export OPENAI_API_KEY=your_openai_key  # For LLM evaluation
   ```

4. **Start Webhook Service**:

   **Docker Compose (Recommended):**
   ```bash
   # From project root
   docker-compose -f docker-compose.dev.yaml --profile slim-tracing up evaluation-webhook
   ```

   **Local Development:**
   ```bash
   cd evals
   
   # Option 1: Using uv
   uv run eval-webhook
   
   # Option 2: Using uv with module
   uv run python -m webhook.langfuse_webhook
   
   # Option 3: Activate venv and run
   source .venv/bin/activate
   eval-webhook
   ```

## Usage

### Docker Service Integration

The evaluation service is integrated into the development environment as a Docker service:

**Service Details:**
- **Container**: `evaluation-webhook`
- **Port**: `8001` (external) → `8000` (internal)
- **Profiles**: `slim-tracing`, `p2p-tracing`, `evaluation`
- **Dependencies**: `platform-engineering`, `langfuse-web`

**Starting the Service:**
```bash
# Start with tracing environment
docker-compose -f docker-compose.dev.yaml --profile slim-tracing up

# Or start just the evaluation service
docker-compose -f docker-compose.dev.yaml --profile slim-tracing up evaluation-webhook
```

### Webhook Integration

The webhook service provides these endpoints:

- `POST /evaluate` - Trigger evaluation from Langfuse UI
- `GET /health` - Health check
- `GET /evaluations/{id}` - Get evaluation status
- `GET /evaluations` - List all evaluations

Configure Langfuse to send webhooks to: 
- Docker: `http://evaluation-webhook:8000/evaluate`
- Local: `http://localhost:8001/evaluate`

### Manual Evaluation

```python
import asyncio
from evals import EvaluationRunner, load_dataset_from_yaml
from langfuse import Langfuse

async def run_evaluation():
    # Load dataset
    dataset = await load_dataset_from_yaml('evals/datasets/multi_agent.yaml')
    
    # Initialize components
    langfuse = Langfuse(public_key="...", secret_key="...", host="...")
    runner = EvaluationRunner(langfuse, ...)
    
    # Run evaluation
    await runner.run_dataset_evaluation(dataset, evaluation_info, config)

# Run with uv
# uv run python your_evaluation_script.py
asyncio.run(run_evaluation())
```

### Development Workflow

```bash
# Install development dependencies
uv sync --extra dev

# Run tests
uv run pytest

# Format code
uv run black .
uv run ruff check --fix .

# Type checking
uv run mypy evals/
```

## Evaluation Process

1. **Dataset Loading**: Load YAML dataset with expected agents and behaviors
2. **Platform Engineer Execution**: Send prompts to Platform Engineer via A2A protocol
3. **Trace Collection**: Wait for Langfuse traces to be created
4. **Tool Call Extraction**: Parse traces to extract agent interactions and tool calls
5. **Evaluation**: Run configured evaluators (simple matching + LLM analysis)
6. **Score Submission**: Submit scores back to Langfuse for tracking

## Trace Extraction

The system extracts tool calls from Langfuse traces using multiple methods:

### Method 1: Observation Metadata
```python
# Extracts from observation metadata
{
    "agent_name": "github",
    "tool_name": "get_repository", 
    "input": {...},
    "output": {...}
}
```

### Method 2: Langchain Messages
```python
# Extracts from AIMessage.tool_calls and ToolMessage results
{
    "agent_name": "inferred_from_tool_name",
    "tool_calls": [...],
    "responses": [...]
}
```

## Evaluators

### Simple Trajectory Evaluator
- Compares expected vs actual agents used
- Calculates proportion of expected agents that were actually used
- Fast and reliable baseline evaluation

### LLM Trajectory Evaluator  
- Uses LLM to analyze if actual behavior matches expected behavior
- Provides detailed reasoning and identifies missing/unexpected actions
- Supports multiple LLM providers (OpenAI, Anthropic)

Example LLM evaluation prompt:
```
Expected Behavior: Should first use GitHub agent to fetch the latest issue, then use Jira agent to create a new issue with the relevant details

Actual Trajectory:
1. github agent used tool 'get_latest_issue' with parameters: {repo: "ai-platform-engineering"}
2. jira agent used tool 'create_issue' with parameters: {title: "...", description: "..."}

Evaluate how well the actual trajectory matches the expected behavior...
```

## Datasets

### Single Agent Tests (`single_agent.yaml`)
- Individual agent capability testing
- GitHub, Jira, Slack, PagerDuty, ArgoCD, Backstage, Confluence, Komodor

### Multi-Agent Workflows (`multi_agent.yaml`)  
- Cross-platform integration scenarios
- GitHub + Jira issue tracking
- PagerDuty + Slack + Jira incident management
- ArgoCD + Confluence deployment documentation

### Complex Workflows (`complex_workflows.yaml`)
- Enterprise-grade scenarios
- Complete CI/CD pipelines
- Incident response workflows
- Service lifecycle management
- Compliance and audit procedures

## Configuration

### Automatic Evaluator Selection
- **Simple Evaluator**: Always enabled (fast agent matching)
- **LLM Evaluator**: Automatically enabled when LLM API key is configured

### LLM Provider Selection
1. Anthropic Claude (preferred): Set `ANTHROPIC_API_KEY`
2. OpenAI GPT-4: Set `OPENAI_API_KEY`
3. Fallback to simple evaluator if no LLM configured

### Langfuse Integration
- Automatically submits trajectory, behavior, and overall scores
- Includes detailed reasoning and analysis
- Tracks evaluation progress and completion

## Monitoring and Debugging

- Comprehensive logging at INFO/DEBUG levels
- Health check endpoints for service monitoring
- Evaluation progress tracking
- Error handling and graceful degradation

## Example Output

```json
{
  "trajectory_match_score": 1.0,
  "behavior_match_score": 0.9,
  "overall_score": 0.95,
  "reasoning": "Expected agents: ['github', 'jira']. Actual agents: ['github', 'jira']. Perfect agent matching. The sequence was correct: GitHub agent fetched the latest issue first, then Jira agent created a corresponding issue with appropriate details.",
  "expected_agents": ["github", "jira"],
  "actual_agents": ["github", "jira"], 
  "missing_agents": [],
  "unexpected_agents": []
}
```