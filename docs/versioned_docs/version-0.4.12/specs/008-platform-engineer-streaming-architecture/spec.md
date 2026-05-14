---
sidebar_position: 2
sidebar_label: Specification
title: "2024-10-23: Platform Engineer Streaming Architecture"
---

# Platform Engineer Streaming Architecture

**Status**: 🟢 In-use
**Category**: Architecture & Core Design
**Date**: October 23, 2024

## Executive Summary

**Latest Test Results (October 2025) - Updated 4-Mode System:**
- 🥇 **DEEP_AGENT_PARALLEL_ORCHESTRATION_ORCHESTRATION** wins with 4.94s average (29% faster than expected)
- 🥈 **DEEP_AGENT_SEQUENTIAL_ORCHESTRATION** second with 6.55s average (baseline performance)
- 🥉 **DEEP_AGENT_INTELLIGENT_ROUTING** third with 6.97s average (needs investigation)
- 🆕 **DEEP_AGENT_ENHANCED_ORCHESTRATION** - NEW experimental mode combining smart routing + orchestration hints
- ⭐ **100% excellent streaming quality** across all modes (0.02s first chunk)
- 📊 **70 comprehensive test scenarios** provide statistical significance

**Production Default:** **DEEP_AGENT_PARALLEL_ORCHESTRATION_ORCHESTRATION** mode is now the default configuration for best performance with unified intelligence across all query types.


## Architecture Overview

The Platform Engineer implements an intelligent routing and streaming system that provides optimal performance through three distinct execution paths: **DIRECT**, **PARALLEL**, and **COMPLEX** routing. This architecture enables token-by-token streaming while maintaining backward compatibility and supporting complex multi-agent orchestration.


## DEEP_AGENT_PARALLEL_ORCHESTRATION (Testing/Comparison Mode)
```bash
ENABLE_DEEP_AGENT_INTELLIGENT_ROUTING=false
FORCE_DEEP_AGENT_ORCHESTRATION=true
```

**How it works:**
- **All queries** go through Deep Agent (no direct routing)
- Provides **orchestration hints** by detecting mentioned agents in query
- Deep Agent handles **all decision-making** and execution
- Logs detected agents for parallel orchestration guidance

**Examples:**
- `"docs: setup guide"` → Deep Agent → RAG (~15s, via orchestration)
- `"show me komodor clusters"` → Deep Agent → Komodor (~18s, via orchestration)
- `"github repos and komodor clusters"` → Deep Agent → Parallel GitHub + Komodor (~20s)
- `"who is on call?"` → Deep Agent → Orchestrated execution (~25s)

**Performance:** **Medium** - consistent orchestration overhead but potential for intelligent parallel execution
**Use Case:** **Testing** orchestration capabilities and ensuring all queries benefit from Deep Agent intelligence

---


## Summary Comparison Table

| Aspect | DEEP_AGENT_INTELLIGENT_ROUTING | DEEP_AGENT_PARALLEL_ORCHESTRATION | DEEP_AGENT_SEQUENTIAL_ORCHESTRATION |
|--------|-------------------|-------------------|-----------------|
| **Routing Strategy** | Intelligent (DIRECT/PARALLEL/COMPLEX) | Always Deep Agent + hints | Always Deep Agent |
| **Simple Queries** | Direct streaming (~5-8s) | Via Deep Agent (~15-18s) | Via Deep Agent (~15-18s) |
| **Multi-Agent Queries** | Smart parallel (~8s) | Orchestrated parallel (~20s) | Sequential execution (~25s) |
| **Token Streaming** | True token-level for DIRECT | Via Deep Agent subagents | Via Deep Agent subagents |
| **Intelligence Level** | Route-optimized | Full orchestration always | Full orchestration always |
| **Parallel Execution** | Smart detection | Orchestration hints provided | No parallel hints |
| **Fallback Behavior** | Falls back to Deep Agent on failure | No fallback needed | No fallback needed |
| **Latency** | **Fastest** (5-23s) | **Medium** (15-25s) | **Slowest** (15-25s) |
| **Use Case** | **Production** | **Testing orchestration** | **Legacy compatibility** |

### Configuration Examples

```bash
# Mode 1: Deep Agent Parallel (Production Default - BEST PERFORMANCE)
export ENABLE_DEEP_AGENT_INTELLIGENT_ROUTING=false
export FORCE_DEEP_AGENT_ORCHESTRATION=true
# All queries through Deep Agent with parallel execution hints (4.94s avg)

# Mode 2: Enhanced Streaming (Alternative)
export ENABLE_DEEP_AGENT_INTELLIGENT_ROUTING=true
export FORCE_DEEP_AGENT_ORCHESTRATION=false
# Fast direct routing + intelligent orchestration when needed (6.97s avg)

# Mode 3: Deep Agent Sequential (Legacy)
export ENABLE_DEEP_AGENT_INTELLIGENT_ROUTING=false
export FORCE_DEEP_AGENT_ORCHESTRATION=false
export ENABLE_ENHANCED_ORCHESTRATION=false
# Original behavior - all queries through Deep Agent sequentially (6.55s avg)

# Mode 4: Deep Agent Enhanced (EXPERIMENTAL - NEW)
export ENABLE_DEEP_AGENT_INTELLIGENT_ROUTING=false
export FORCE_DEEP_AGENT_ORCHESTRATION=false
export ENABLE_ENHANCED_ORCHESTRATION=true
# Smart routing + orchestration hints: DIRECT/PARALLEL when possible, Deep Agent + hints for COMPLEX

# Custom keyword configuration (applies to all modes)
export KNOWLEDGE_BASE_KEYWORDS="help:,guide:,howto:,@help"
export ORCHESTRATION_KEYWORDS="analyze,orchestrate,workflow,pipeline"
```

### New Experimental Mode: DEEP_AGENT_ENHANCED_ORCHESTRATION

**Hypothesis:** Combine the best of both worlds:
- ✅ Fast DIRECT routing for knowledge base queries (like DEEP_AGENT_INTELLIGENT_ROUTING)
- ✅ Efficient PARALLEL routing for multi-agent queries (like DEEP_AGENT_INTELLIGENT_ROUTING)
- ✅ Deep Agent with orchestration hints for COMPLEX queries (like DEEP_AGENT_PARALLEL_ORCHESTRATION)

**Expected Benefits:**
1. **Optimal routing** - Uses fastest path for each query type
2. **Enhanced Deep Agent** - When Deep Agent is needed, it gets orchestration hints for better performance
3. **Best of both modes** - Fast paths when possible, intelligent orchestration when needed

**Configuration:**
```bash
export ENABLE_ENHANCED_ORCHESTRATION=true
export ENABLE_DEEP_AGENT_INTELLIGENT_ROUTING=false
export FORCE_DEEP_AGENT_ORCHESTRATION=false
```

**Testing Status:** 🆕 Ready for comparative testing against the existing 3 modes.


## Testing and Comparison

### How to Test Different Routing Modes

#### 1. Test Enhanced Streaming (Default)
```bash
export ENABLE_DEEP_AGENT_INTELLIGENT_ROUTING=true
export FORCE_DEEP_AGENT_ORCHESTRATION=false
docker restart platform-engineer-p2p

# Test queries
python integration/test_platform_engineer_streaming.py
```

#### 2. Test Deep Agent with Parallel Orchestration
```bash
export ENABLE_DEEP_AGENT_INTELLIGENT_ROUTING=false
export FORCE_DEEP_AGENT_ORCHESTRATION=true
docker restart platform-engineer-p2p

# Same test queries - compare performance and behavior
python integration/test_platform_engineer_streaming.py
```

#### 3. Test Deep Agent Only (Legacy)
```bash
export ENABLE_DEEP_AGENT_INTELLIGENT_ROUTING=false
export FORCE_DEEP_AGENT_ORCHESTRATION=false
docker restart platform-engineer-p2p

# Same test queries - compare against baselines
python integration/test_platform_engineer_streaming.py
```

### Test Methodology

#### Comprehensive Test Dataset (70 Scenarios)

**Knowledge Base Queries (15 scenarios)**
- `docs:` and `@docs` prefixed queries
- Topics: duo-sso, kubernetes, jenkins, terraform, helm, monitoring, security
- Expected routing: DIRECT to RAG in DEEP_AGENT_INTELLIGENT_ROUTING mode

**Single Agent Queries (20 scenarios)**
- Queries targeting specific agents: komodor, github, pagerduty, jira, argocd, etc.
- Examples: `show me komodor clusters`, `pagerduty current incidents`
- Expected routing: DIRECT to target agent in DEEP_AGENT_INTELLIGENT_ROUTING mode

**Multi-Agent Queries (15 scenarios)**
- Queries requiring multiple agents: `github repos and komodor clusters`
- Simple parallel execution without complex orchestration
- Expected routing: PARALLEL in DEEP_AGENT_INTELLIGENT_ROUTING mode

**Complex Orchestration Queries (12 scenarios)**
- Cross-agent analysis: `compare github activity with komodor health`
- Conditional logic: `if critical alerts, create issue and notify on-call`
- Analytics: `analyze incident patterns and suggest preventive measures`
- Expected routing: COMPLEX via Deep Agent in all modes

**Mixed/Edge Cases (8 scenarios)**
- Ambiguous queries that could route multiple ways
- Help queries with alternative keywords
- Complex searches requiring intelligence

#### Test Infrastructure
- **Platform Engineer URL**: http://10.99.255.178:8000
- **Test Framework**: Python asyncio with A2A client library
- **Metrics Collected**: Duration, first chunk latency, chunk count, streaming quality
- **Service Management**: Docker restart between mode changes
- **Health Checks**: A2A agent.json endpoint validation

#### Performance Metrics
- **First Chunk Latency**: Time from query start to first response chunk
- **Total Duration**: Complete query processing time
- **Streaming Quality**: Based on first chunk latency (⭐⭐⭐⭐⭐ < 2s)
- **Chunk Analysis**: Count and size distribution of streaming chunks

### Actual Results vs Expected

| Aspect | Expected | Actual Results |
|--------|----------|----------------|
| **DEEP_AGENT_INTELLIGENT_ROUTING** | Fastest overall | 3rd place (6.97s avg) ⚠️ |
| **DEEP_AGENT_PARALLEL_ORCHESTRATION** | Medium performance | 1st place (4.94s avg) 🏆 |
| **DEEP_AGENT_SEQUENTIAL_ORCHESTRATION** | Slowest baseline | 2nd place (6.55s avg) |
| **Streaming Quality** | Variable by mode | 100% Excellent across all modes |
| **First Chunk Latency** | Direct < Deep Agent | Consistent 0.02s across all modes |

### Test Reproducibility

#### Test Scripts and Files

**Enhanced Test Suite (`integration/test_platform_engineer_streaming.py`)**
- 70 comprehensive test scenarios across all routing patterns
- Detailed metrics collection and streaming quality analysis
- Quick mode (`--quick`): 16 representative scenarios for fast iteration
- Full mode: Complete 70-scenario statistical analysis

**Quick Routing Comparison (`integration/quick_routing_test.sh`)**
- Automated testing of all three routing modes
- Uses quick mode (16 scenarios per mode) for rapid comparison
- Automatically switches environment variables and restarts services
- Generates comparative performance reports

**Comprehensive Analysis (`integration/comprehensive_routing_test.sh`)**
- Full statistical analysis with all 70 scenarios per mode
- Detailed performance breakdown by query category
- Statistical significance validation
- Production-ready recommendations

**Service Verification (`integration/verify_setup.py`)**
- Health check utility for Platform Engineer service
- Validates A2A client connectivity and basic functionality
- Useful for debugging connection issues

#### Running the Tests

```bash
# Quick comparison (16 scenarios per mode, ~5 minutes total)
./integration/quick_routing_test.sh

# Full comprehensive analysis (70 scenarios per mode, ~45 minutes total)
./integration/comprehensive_routing_test.sh

# Individual mode testing
python integration/test_platform_engineer_streaming.py --quick
python integration/test_platform_engineer_streaming.py  # Full mode
```

#### Test Results Archive

Test results are automatically saved with timestamps:
- `routing_test_results_YYYYMMDD_HHMMSS/` (quick tests)
- `comprehensive_routing_results_YYYYMMDD_HHMMSS/` (full analysis)

Each directory contains:
- Individual mode log files with detailed streaming metrics
- Performance summaries and quality distributions
- Error logs and debugging information

### Key Learnings for Future Optimization

1. **DEEP_AGENT_INTELLIGENT_ROUTING Investigation Needed**
   - Routing decision overhead appears significant
   - May benefit from caching routing decisions
   - Consider optimizing the `_route_query` method

2. **DEEP_AGENT_PARALLEL_ORCHESTRATION Success Factors**
   - Orchestration hints (`detected_agents` metadata) are effective
   - Unified intelligence path reduces complexity
   - Parallel execution planning works better than expected

3. **Streaming Protocol Optimization**
   - A2A protocol `append=False`/`append=True` logic is working correctly
   - First chunk latency is consistently excellent across all modes
   - Token-level streaming is functioning as designed

4. **Statistical Validation**
   - 70-scenario dataset provides reliable, non-arbitrary results
   - Large sample sizes eliminate performance variance noise
   - Category-based analysis reveals routing effectiveness


## Related

- Architecture: [architecture.md](./architecture.md)
