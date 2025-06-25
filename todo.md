
# 🔍 Phoenix Distributed Tracing Implementation Plan

## 📋 Overview
Implement Phoenix distributed tracing for the AI Platform Engineering Multi-Agent System to provide comprehensive observability, performance monitoring, and evaluation capabilities.

**⚠️ ARCHITECTURAL CONSTRAINT**: Only the main agent (`ai-platform-engineer`) can be modified for tracing. Sub-agents use pre-built images from GitHub Container Registry and cannot be instrumented directly.

## 🚀 Phase 1: Phoenix Infrastructure Setup

### 1.1 Phoenix Container Setup (Clean Visualization)
- [ ] Create Phoenix Docker container configuration with trace filtering
- [ ] Add Phoenix service to `docker-compose.yaml` with optimized settings:
  ```yaml
  phoenix:
    image: arizephoenix/phoenix:latest
    environment:
      - PHOENIX_ENABLE_PROMETHEUS=false  # Reduce metric noise
      - PHOENIX_TRACE_SAMPLING_RATE=0.1  # Sample non-user traces
      - PHOENIX_MAX_TRACE_SIZE=10MB      # Limit trace payload
  ```
- [ ] Configure Phoenix environment variables and networking
- [ ] Set up persistent storage for trace data
- [ ] Verify Phoenix UI accessibility with clean trajectory graphs

### 1.2 Dependencies & Configuration (Optimized Tracing)
- [ ] Add Phoenix tracing dependencies to `pyproject.toml`:
  - `arize-phoenix`
  - `opentelemetry-api`
  - `opentelemetry-sdk`
  - `opentelemetry-exporter-otlp`
  - `opentelemetry-instrumentation-requests` # For A2A HTTP calls
- [ ] Create Phoenix configuration module in `ai_platform_engineering/utils/phoenix_config.py`:
  ```python
  # Configure clean span processors
  span_processor = BatchSpanProcessor(
      OTLPSpanExporter(endpoint="http://phoenix:4317"),
      max_queue_size=512,
      schedule_delay_millis=2000,  # Batch spans for efficiency
  )
  ```
- [ ] Set up environment variables for noise reduction:
  - `PHOENIX_TRACE_USER_REQUESTS_ONLY=true`
  - `PHOENIX_FILTER_HEALTH_CHECKS=true`
  - `PHOENIX_SPAN_ATTRIBUTE_LIMIT=10`

## 🔧 Phase 2: Tracing Integration

### 2.1 Core System Instrumentation (Main Agent Only)
- [ ] Instrument LangGraph supervisor in `supervisor_agent.py`
- [ ] ⚠️ SKIP: Individual agents use pre-built images - cannot instrument directly
- [ ] Instrument LLM calls via `cnoe_agent_utils.LLMFactory` in main agent
- [ ] Add tracing to A2A protocol bindings (`protocol_bindings/a2a/`) - outbound requests to sub-agents
- [ ] Instrument FastAPI endpoints (`protocol_bindings/fastapi/`)

### 2.2 A2A Communication Tracing (Main Agent Perspective)
- [ ] Trace A2A remote agent connections (`a2a_remote_agent_connect.py`) - outbound requests
- [ ] ⚠️ LIMITED: Agent skill executions only visible in main agent supervisor
- [ ] Add custom spans for supervisor agent decision-making and routing
- [ ] Trace A2A request/response cycles to sub-agents
- [ ] Capture main agent state transitions and checkpointing

### 2.3 Data Collection & Filtering (Clean Trajectory Graphs)
- [ ] **Noise Reduction Configuration**:
  - [ ] Filter out health checks (`/health`, `/metrics`, `/ready` endpoints)
  - [ ] Exclude internal system calls (heartbeats, keepalives)
  - [ ] Remove verbose HTTP client spans for external APIs
  - [ ] Skip repetitive authentication/token refresh spans
  - [ ] Filter out background tasks and scheduled jobs
- [ ] **Span Name Standardization**:
  - [ ] Use meaningful span names: `supervisor_route_decision`, `a2a_agent_call`, `llm_completion`
  - [ ] Avoid generic names like `HTTP POST` or `function_call`
  - [ ] Group related operations under parent spans
- [ ] **Attribute Optimization**:
  - [ ] Add essential attributes only: `agent_type`, `user_query`, `tool_name`
  - [ ] Remove verbose payloads and replace with summaries
  - [ ] Use structured attributes for consistent filtering
- [ ] **Sampling Strategies**:
  - [ ] Sample background operations at 1-5%
  - [ ] Always trace user-initiated requests (100%)
  - [ ] Reduce sampling for repetitive A2A health checks
- [ ] **Span Hierarchy Organization**:
  - [ ] Create clear parent-child relationships for logical flow
  - [ ] Group LLM calls under supervisor decision spans
  - [ ] Nest A2A requests under agent routing spans

## 📊 Phase 3: Monitoring & Evaluation

### 3.1 Trace Collection & Export
- [ ] Configure OTLP exporter for Phoenix
- [ ] Set up trace batching and retry mechanisms  
- [ ] Implement graceful degradation when Phoenix is unavailable
- [ ] Add trace correlation IDs across agent interactions
- [ ] Configure trace retention and storage policies

### 3.2 Phoenix Data Extraction for Evaluation
- [ ] **Phoenix Trace Parser**: Create `PhoenixDataParser` class to extract evaluation data from Phoenix traces:
  - [ ] `get_conversation()` - Extract message sequences from LangGraph spans
  - [ ] `get_tool_calls_sequence()` - Parse A2A remote agent tool calls from spans
  - [ ] `get_tool_definitions_arguments()` - Extract tool schemas from LLM span attributes  
  - [ ] `get_tool_calls_with_arguments()` - Map tool names to input parameters
  - [ ] `get_response()` - Extract LLM outputs and final agent responses
  - [ ] `get_query()` - Identify initial user query from trace root span
  - [ ] `get_latency()` - Calculate end-to-end latency from span timestamps
  - [ ] `get_tool_error_rate()` - Analyze span status codes for tool failure rates
  - [ ] `get_cycles()` - Detect retry patterns in A2A agent communication
  - [ ] `get_tools_efficiency()` - Calculate tool utilization metrics

### 3.3 Phoenix-Specific Evaluation Metrics
- [ ] **Span Attribute Mapping**:
  - [ ] Map LangGraph node names to span names
  - [ ] Extract LLM token usage from span attributes (`llm.usage.*`)
  - [ ] Parse A2A request/response data from span events
  - [ ] Correlate supervisor decisions with sub-agent executions
- [ ] **Trace Analysis Queries**:
  - [ ] Query traces by user session or conversation ID
  - [ ] Filter spans by agent type (supervisor vs sub-agent calls)
  - [ ] Aggregate metrics across multiple trace sessions
  - [ ] Identify patterns in agent routing decisions

### 3.4 Evaluation Framework Integration
- [ ] **Phoenix Query API Usage**:
  - [ ] Use Phoenix GraphQL API to retrieve trace data programmatically
  - [ ] Implement batch trace processing for evaluation pipelines
  - [ ] Create evaluation datasets from Phoenix trace exports
- [ ] **Metric Calculations**:
  - [ ] Adapt existing evaluation metrics for Phoenix trace structure
  - [ ] Calculate tool utilization accuracy from A2A spans
  - [ ] Measure API call precision for external service interactions
  - [ ] Compute conversation quality scores from LLM spans
- [ ] **Dashboard Creation**:
  - [ ] Create Phoenix dashboards for real-time evaluation metrics
  - [ ] Set up automated evaluation pipelines using Phoenix data
  - [ ] Implement alerting for performance degradation based on trace analysis

### 3.5 Analysis & Insights
- [ ] Create trace analysis queries for common patterns
- [ ] Generate reports on agent utilization and efficiency  
- [ ] Identify bottlenecks in multi-agent workflows
- [ ] Monitor LLM token usage and costs from Phoenix spans

## 🧪 Phase 5: Testing & Validation

### 5.1 Integration Testing
- [ ] Create test scenarios covering all agent types
- [ ] Validate trace completeness and accuracy
- [ ] Test trace collection under load
- [ ] Verify Phoenix UI displays traces correctly
- [ ] Test graceful handling of Phoenix downtime

### 5.2 Performance Impact Assessment
- [ ] Measure tracing overhead on system performance
- [ ] Optimize trace collection for production use
- [ ] Validate that tracing doesn't affect agent functionality
- [ ] Load test with tracing enabled

## 📚 Phase 6: Documentation & Deployment

### 6.1 Documentation
- [ ] Update README.md with Phoenix setup instructions
- [ ] Create troubleshooting guide for tracing issues
- [ ] Document evaluation metrics and their interpretation
- [ ] Add operational runbooks for Phoenix maintenance

### 6.2 Production Deployment
- [ ] Create production-ready Phoenix configuration
- [ ] Set up monitoring for Phoenix infrastructure itself
- [ ] Implement backup and recovery procedures
- [ ] Create deployment scripts and automation

## 🎯 Success Criteria (Adjusted for Architecture)
- [ ] Complete visibility into main agent operations and LLM calls
- [ ] A2A communication tracing to sub-agents (request/response level)
- [ ] <100ms additional latency overhead from tracing
- [ ] Ability to trace user requests through supervisor → sub-agent routing
- [ ] Actionable insights for main agent optimization and A2A performance
- [ ] Reliable evaluation metrics for supervisor decision-making

## 🔄 Ongoing Maintenance
- [ ] Regular Phoenix version updates
- [ ] Periodic evaluation of trace data retention policies  
- [ ] Continuous optimization of trace collection efficiency
- [ ] Review and refinement of evaluation metrics

## 📋 Phoenix DataParser Implementation Reference

### Clean Trajectory Graph Configuration:
```python
# Configure span filtering for clean visualizations
class CleanSpanProcessor(SpanProcessor):
    def on_start(self, span, parent_context):
        # Filter noisy spans before they reach Phoenix
        if self._is_noise(span.name):
            span.set_status(StatusCode.UNSET)
            return
            
    def _is_noise(self, span_name):
        noise_patterns = [
            "GET /health", "POST /metrics", 
            "token_refresh", "heartbeat",
            "background_task"
        ]
        return any(pattern in span_name for pattern in noise_patterns)
```

### Phoenix Trace Structure Mapping (Clean):
- **DataFrame `run_type`** → **Phoenix `span.name`** (standardized names)
- **DataFrame `inputs/outputs`** → **Phoenix `span.attributes`** (essential only)
- **DataFrame `start_time/end_time`** → **Phoenix `span.start_time/end_time`**
- **DataFrame `status`** → **Phoenix `span.status.status_code`**
- **DataFrame `extra.metadata`** → **Phoenix `span.attributes.custom.*`** (filtered)

### Clean Span Naming Convention:
```python
# User Journey Spans (Always Visible)
"user_request"           # Root span for user query
"supervisor_decision"    # Agent routing decision
"a2a_argocd_call"       # Specific agent invocation
"llm_completion"        # LLM response generation

# Background Spans (Filtered/Sampled)
"health_check"          # System health verification
"auth_token_refresh"    # Authentication maintenance
"metrics_collection"    # Internal telemetry
```

### Required Phoenix Integration Points:
- [ ] Phoenix GraphQL API client for filtered trace queries
- [ ] Clean span attribute parsers for essential data only
- [ ] A2A request/response extractors (summary level)
- [ ] Noise filtering span processors

## 🎯 Phase 4: Evaluation Metrics Framework

### 4.1 Core Evaluation Metrics Implementation
After extracting data from Phoenix traces, implement focused evaluation metrics:

#### 4.1.1 Intent Recognition Accuracy  
- [ ] **Objective**: Measure how well the Assistant understands and correctly identifies user intents
- [ ] **Implementation**:
  ```python
  def evaluate_intent_recognition(query, response, ground_truth=None):
      # Evaluate based on:
      # 1. Does the response correctly identify the user's intent?
      # 2. Does the response address the identified intent accurately?  
      # 3. Is the response appropriate for the identified intent?
  ```
- [ ] **Scoring Criteria** (1-3 scale):
  - **Score 3**: Assistant accurately identifies user's intent and responds appropriately
  - **Score 2**: Assistant mostly identifies intent correctly with minor inaccuracies
  - **Score 1**: Assistant fails to identify user's intent correctly
- [ ] **Data Sources**: 
  - Extract `query` from initial user message in Phoenix trace
  - Extract `response` from final LLM output span
  - Use optional `ground_truth` reference answers for validation

#### 4.1.2 Context Preservation
- [ ] **Objective**: Assess the Assistant's ability to provide relevant and coherent responses
- [ ] **Implementation**:
  ```python  
  def evaluate_context_preservation(conversation):
      # Evaluate based on:
      # 1. Does the response accurately understand and address the given input?
      # 2. Is the response relevant and logically structured?
      # 3. Does the response provide useful or insightful information?
  ```
- [ ] **Scoring Criteria** (1-3 scale):
  - **Score 3**: Response is highly relevant, well-structured, and insightful
  - **Score 2**: Response is mostly relevant but may have minor inaccuracies or lack depth
  - **Score 1**: Response is irrelevant, unclear, or fails to address input effectively
- [ ] **Data Sources**:
  - Extract full `conversation` flow from LangGraph spans in Phoenix traces
  - Include multi-turn interactions and context handoffs between agents

#### 4.1.3 Tool Utilization Accuracy
- [ ] **Objective**: Measure if correct A2A agents are selected for specific tasks
- [ ] **Implementation**: 
  - Map query intent to expected agent types (ArgoCD, PagerDuty, GitHub, Slack, Atlassian)
  - Evaluate supervisor routing decisions from Phoenix traces
  - Assess tool parameter accuracy and completeness
- [ ] **Scoring**: Precision/Recall of agent selection vs ground truth

#### 4.1.4 API Call Precision  
- [ ] **Objective**: Evaluate quality of A2A requests sent to sub-agents
- [ ] **Implementation**:
  - Parse A2A request parameters from Phoenix span events
  - Validate parameter completeness and correctness
  - Check for unnecessary or redundant API calls
- [ ] **Metrics**: Parameter accuracy rate, call efficiency ratio

#### 4.1.5 Error Recovery Effectiveness
- [ ] **Objective**: Measure how well the system handles A2A communication failures
- [ ] **Implementation**:
  - Identify failed spans and retry patterns from Phoenix traces
  - Evaluate fallback mechanisms and error messaging
  - Assess graceful degradation when sub-agents unavailable
- [ ] **Metrics**: Recovery success rate, error handling quality

### 4.2 Multi-Agent Specific Metrics

#### 4.2.1 Agent Routing Efficiency
- [ ] **Objective**: Evaluate supervisor's agent selection accuracy
- [ ] **Metrics**:
  - Routing accuracy: Correct agent selected for task type
  - Multi-agent coordination: Proper handoffs between agents
  - Load balancing: Even distribution across available agents

#### 4.2.2 A2A Communication Quality
- [ ] **Objective**: Assess inter-agent communication effectiveness
- [ ] **Metrics**:
  - Message completeness: All required parameters included
  - Protocol adherence: Proper A2A message formatting
  - Response timeliness: Communication latency within SLA

#### 4.2.3 Workflow Orchestration
- [ ] **Objective**: Evaluate complex multi-step task execution
- [ ] **Metrics**:
  - Task decomposition quality: Breaking complex requests into sub-tasks
  - Execution sequence optimization: Parallel vs sequential execution
  - State management: Proper context passing between agents

### 4.3 Performance & Reliability Metrics

#### 4.3.1 Latency Analysis
- [ ] **End-to-end latency**: User query to final response
- [ ] **Agent-specific latency**: Time spent in each sub-agent
- [ ] **A2A communication overhead**: Network latency between agents
- [ ] **LLM processing time**: Token generation latency in supervisor

#### 4.3.2 Reliability Metrics  
- [ ] **Success rate**: Percentage of queries resolved successfully
- [ ] **Failure categorization**: Types of failures (agent down, timeout, auth)
- [ ] **Availability**: System uptime and sub-agent availability
- [ ] **Error recovery time**: Time to recover from failures

#### 4.3.3 Resource Utilization
- [ ] **Token usage efficiency**: LLM tokens per successful query
- [ ] **API rate limiting**: Efficient use of external service quotas
- [ ] **Memory usage**: State management and context retention
- [ ] **Concurrent request handling**: System scalability metrics

### 4.4 Evaluation Pipeline Implementation

#### 4.4.1 Automated Evaluation Framework
- [ ] **Phoenix Trace Processor**: Batch process traces for evaluation
- [ ] **Metric Calculator**: Compute all evaluation metrics from trace data
- [ ] **Scoring Engine**: Generate composite scores and rankings
- [ ] **Report Generator**: Create detailed evaluation reports

#### 4.4.2 Evaluation Triggers
- [ ] **Real-time evaluation**: Process traces as they arrive in Phoenix
- [ ] **Scheduled evaluation**: Daily/weekly batch processing
- [ ] **On-demand evaluation**: Manual trigger for specific trace sets
- [ ] **Regression testing**: Evaluate after system changes

#### 4.4.3 Evaluation Data Management
- [ ] **Ground truth datasets**: Curated examples for validation
- [ ] **Evaluation history**: Track metric trends over time
- [ ] **Benchmark comparisons**: Compare against baseline performance
- [ ] **A/B testing framework**: Compare different agent configurations

### 4.5 Evaluation Metrics Dashboard

#### 4.5.1 Real-time Monitoring
- [ ] **Live metrics dashboard**: Real-time evaluation scores
- [ ] **Alert system**: Notifications when metrics drop below thresholds
- [ ] **Trend analysis**: Historical performance visualization
- [ ] **Drill-down capability**: Investigate specific poor-performing traces

#### 4.5.2 Reporting & Analytics
- [ ] **Executive summaries**: High-level performance reports  
- [ ] **Technical deep-dives**: Detailed metric analysis for engineers
- [ ] **Comparative analysis**: Performance across different query types
- [ ] **Improvement recommendations**: Actionable insights for optimization