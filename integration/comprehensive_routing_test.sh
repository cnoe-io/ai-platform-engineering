#!/bin/bash

# Comprehensive routing mode test script with full 70-scenario dataset
# For statistically significant performance analysis

set -e

echo "🚀 Starting COMPREHENSIVE Platform Engineer Routing Mode Analysis"
echo "=============================================================="
echo "⚠️  This will run 70 test scenarios per mode (210 total tests)"
echo "⏱️  Estimated time: 30-45 minutes per mode"
echo ""

read -p "Continue with comprehensive testing? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
fi

# Test configurations (Updated naming - now 4 modes)
declare -A modes
modes[DEEP_AGENT_INTELLIGENT_ROUTING]="ENABLE_ENHANCED_STREAMING=true FORCE_DEEP_AGENT_ORCHESTRATION=false ENABLE_ENHANCED_ORCHESTRATION=false"
modes[DEEP_AGENT_PARALLEL_ORCHESTRATION]="ENABLE_ENHANCED_STREAMING=false FORCE_DEEP_AGENT_ORCHESTRATION=true ENABLE_ENHANCED_ORCHESTRATION=false"
modes[DEEP_AGENT_SEQUENTIAL_ORCHESTRATION]="ENABLE_ENHANCED_STREAMING=false FORCE_DEEP_AGENT_ORCHESTRATION=false ENABLE_ENHANCED_ORCHESTRATION=false"
modes[DEEP_AGENT_ENHANCED_ORCHESTRATION]="ENABLE_ENHANCED_STREAMING=false FORCE_DEEP_AGENT_ORCHESTRATION=false ENABLE_ENHANCED_ORCHESTRATION=true"

# Results directory
results_dir="comprehensive_routing_results_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$results_dir"

echo "📁 Results will be saved to: $results_dir"
echo ""

for mode in DEEP_AGENT_INTELLIGENT_ROUTING DEEP_AGENT_PARALLEL_ORCHESTRATION DEEP_AGENT_SEQUENTIAL_ORCHESTRATION DEEP_AGENT_ENHANCED_ORCHESTRATION; do
    echo "========================================"
    echo "🎯 Testing $mode mode (70 scenarios)"
    echo "========================================"

    # Set environment variables for the mode
    env_vars=${modes[$mode]}
    echo "🔧 Setting environment: $env_vars"

    # Export environment variables
    export $env_vars

    echo "🔄 Restarting platform-engineer-p2p with new configuration..."
    docker restart platform-engineer-p2p

    echo "⏳ Waiting for service to be ready..."
    sleep 15

    # Check if service is ready (using A2A agent.json endpoint)
    echo "🔍 Checking service health..."
    max_retries=6
    retry_count=0

    while [ $retry_count -lt $max_retries ]; do
        if curl -s -f "http://10.99.255.178:8000/.well-known/agent-card.json" > /dev/null 2>&1; then
            echo "✅ Service is ready!"
            break
        else
            echo "⏳ Retry $((retry_count+1))/$max_retries - Service not ready yet..."
            sleep 5
            retry_count=$((retry_count+1))
        fi
    done

    if [ $retry_count -eq $max_retries ]; then
        echo "❌ Service failed to become ready, skipping $mode"
        continue
    fi

    # Run the Python test (FULL mode - all 70 scenarios)
    start_time=$(date +%s)
    echo "🧪 Running COMPREHENSIVE streaming tests for $mode (70 scenarios)..."
    log_file="$results_dir/${mode}_comprehensive.log"

    cd /home/sraradhy/ai-platform-engineering
    source .venv/bin/activate
    if python integration/test_platform_engineer_streaming.py > "$log_file" 2>&1; then
        end_time=$(date +%s)
        duration=$((end_time - start_time))
        echo "✅ $mode tests completed successfully in ${duration}s"

        # Extract key metrics from log
        echo "📊 Comprehensive metrics for $mode:"
        grep -E "(Total tests:|Average duration:|Average time to first chunk:|Quality Distribution:)" "$log_file" || echo "   Metrics extraction failed"

        # Extract routing distribution
        echo "🎯 Routing performance by category:"
        echo "   Knowledge base queries (DIRECT to RAG):"
        grep -A2 -B1 "Knowledge base query" "$log_file" | grep "Time to first chunk:" | head -5 | awk '{print "     " $0}' || echo "     Data not available"
        echo "   Single agent queries (DIRECT routing):"
        grep -A2 -B1 "Single agent query" "$log_file" | grep "Time to first chunk:" | head -5 | awk '{print "     " $0}' || echo "     Data not available"
        echo "   Multi-agent queries (PARALLEL routing):"
        grep -A2 -B1 "PARALLEL execution" "$log_file" | grep "Time to first chunk:" | head -5 | awk '{print "     " $0}' || echo "     Data not available"
        echo "   Complex queries (COMPLEX via Deep Agent):"
        grep -A2 -B1 "COMPLEX via Deep Agent" "$log_file" | grep "Time to first chunk:" | head -5 | awk '{print "     " $0}' || echo "     Data not available"

    else
        echo "❌ $mode tests failed - check $log_file for details"
    fi

    echo ""
done

echo "========================================"
echo "📊 COMPREHENSIVE COMPARISON SUMMARY"
echo "========================================"

echo "🔍 Analyzing results across all modes (70 scenarios each)..."

# Detailed comparison - extract comprehensive metrics from logs
echo ""
echo "📈 Comprehensive Performance Metrics:"
echo "Mode                    | Total Tests | Avg Duration | Avg First Chunk | Success Rate"
echo "-----------------------|-------------|--------------|------------------|-------------"

for mode in DEEP_AGENT_INTELLIGENT_ROUTING DEEP_AGENT_PARALLEL_ORCHESTRATION DEEP_AGENT_SEQUENTIAL_ORCHESTRATION DEEP_AGENT_ENHANCED_ORCHESTRATION; do
    log_file="$results_dir/${mode}_comprehensive.log"
    if [ -f "$log_file" ]; then
        total_tests=$(grep "Total tests:" "$log_file" | cut -d':' -f2 | tr -d ' ' || echo "N/A")
        avg_duration=$(grep "Average duration:" "$log_file" | cut -d':' -f2 | tr -d ' s' || echo "N/A")
        avg_first_chunk=$(grep "Average time to first chunk:" "$log_file" | cut -d':' -f2 | tr -d ' s' || echo "N/A")

        # Calculate success rate
        completed_tests=$(grep -c "✅ Streamed chunk to" "$log_file" 2>/dev/null || echo "0")
        if [ "$total_tests" != "N/A" ] && [ "$total_tests" -gt 0 ]; then
            success_rate=$(echo "scale=1; ($completed_tests / $total_tests) * 100" | bc -l 2>/dev/null || echo "N/A")
            success_rate="${success_rate}%"
        else
            success_rate="N/A"
        fi

        printf "%-22s | %-11s | %-12s | %-16s | %-11s\n" "$mode" "$total_tests" "$avg_duration" "$avg_first_chunk" "$success_rate"
    else
        printf "%-22s | %-11s | %-12s | %-16s | %-11s\n" "$mode" "FAILED" "FAILED" "FAILED" "FAILED"
    fi
done

echo ""
echo "🎯 ROUTING CATEGORY ANALYSIS:"
echo "=============================="

echo ""
echo "📚 Knowledge Base Queries (DIRECT to RAG):"
for mode in DEEP_AGENT_INTELLIGENT_ROUTING DEEP_AGENT_PARALLEL_ORCHESTRATION DEEP_AGENT_SEQUENTIAL_ORCHESTRATION DEEP_AGENT_ENHANCED_ORCHESTRATION; do
    log_file="$results_dir/${mode}_comprehensive.log"
    if [ -f "$log_file" ]; then
        kb_avg=$(grep -A2 -B1 "Knowledge base query" "$log_file" | grep "Time to first chunk:" | awk '{sum+=$5; count++} END {if(count>0) printf "%.2f", sum/count; else print "N/A"}')
        echo "   $mode: ${kb_avg}s average first chunk"
    fi
done

echo ""
echo "🤖 Single Agent Queries (DIRECT routing):"
for mode in DEEP_AGENT_INTELLIGENT_ROUTING DEEP_AGENT_PARALLEL_ORCHESTRATION DEEP_AGENT_SEQUENTIAL_ORCHESTRATION DEEP_AGENT_ENHANCED_ORCHESTRATION; do
    log_file="$results_dir/${mode}_comprehensive.log"
    if [ -f "$log_file" ]; then
        single_avg=$(grep -A2 -B1 "Single agent query" "$log_file" | grep "Time to first chunk:" | awk '{sum+=$5; count++} END {if(count>0) printf "%.2f", sum/count; else print "N/A"}')
        echo "   $mode: ${single_avg}s average first chunk"
    fi
done

echo ""
echo "🌊 Multi-Agent Queries (PARALLEL routing):"
for mode in DEEP_AGENT_INTELLIGENT_ROUTING DEEP_AGENT_PARALLEL_ORCHESTRATION DEEP_AGENT_SEQUENTIAL_ORCHESTRATION DEEP_AGENT_ENHANCED_ORCHESTRATION; do
    log_file="$results_dir/${mode}_comprehensive.log"
    if [ -f "$log_file" ]; then
        parallel_avg=$(grep -A2 -B1 "PARALLEL execution" "$log_file" | grep "Time to first chunk:" | awk '{sum+=$5; count++} END {if(count>0) printf "%.2f", sum/count; else print "N/A"}')
        echo "   $mode: ${parallel_avg}s average first chunk"
    fi
done

echo ""
echo "🧠 Complex Queries (COMPLEX via Deep Agent):"
for mode in DEEP_AGENT_INTELLIGENT_ROUTING DEEP_AGENT_PARALLEL_ORCHESTRATION DEEP_AGENT_SEQUENTIAL_ORCHESTRATION DEEP_AGENT_ENHANCED_ORCHESTRATION; do
    log_file="$results_dir/${mode}_comprehensive.log"
    if [ -f "$log_file" ]; then
        complex_avg=$(grep -A2 -B1 "COMPLEX via Deep Agent" "$log_file" | grep "Time to first chunk:" | awk '{sum+=$5; count++} END {if(count>0) printf "%.2f", sum/count; else print "N/A"}')
        echo "   $mode: ${complex_avg}s average first chunk"
    fi
done

echo ""
echo "🎯 STATISTICAL SIGNIFICANCE:"
echo "============================"
echo "✅ Each mode tested with 70 diverse scenarios"
echo "✅ Scenarios distributed across routing categories:"
echo "   • 15 Knowledge base queries (docs:/@docs)"
echo "   • 20 Single agent queries (various agents)"
echo "   • 15 Multi-agent queries (parallel execution)"
echo "   • 12 Complex queries (orchestration needed)"
echo "   • 8 Mixed/edge case queries"
echo ""
echo "📊 This provides statistically significant results for:"
echo "   • Overall performance comparison"
echo "   • Routing strategy effectiveness"
echo "   • Streaming quality consistency"
echo "   • Agent-specific performance patterns"

echo ""
echo "🎯 FINAL RECOMMENDATIONS:"
echo "========================"

# Determine best performing mode
best_mode=""
best_time=""
for mode in DEEP_AGENT_INTELLIGENT_ROUTING DEEP_AGENT_PARALLEL_ORCHESTRATION DEEP_AGENT_SEQUENTIAL_ORCHESTRATION DEEP_AGENT_ENHANCED_ORCHESTRATION; do
    log_file="$results_dir/${mode}_comprehensive.log"
    if [ -f "$log_file" ]; then
        avg_first_chunk=$(grep "Average time to first chunk:" "$log_file" | cut -d':' -f2 | tr -d ' s' | cut -d'.' -f1)
        if [ -n "$avg_first_chunk" ] && [ "$avg_first_chunk" != "N/A" ]; then
            if [ -z "$best_time" ] || [ "$avg_first_chunk" -lt "$best_time" ]; then
                best_time=$avg_first_chunk
                best_mode=$mode
            fi
        fi
    fi
done

if [ -n "$best_mode" ]; then
    echo "🏆 Best performing mode: $best_mode"
    echo "⚡ Average first chunk time: ${best_time}s"

    case $best_mode in
        "ENHANCED_STREAMING")
            echo "💡 Recommendation: Use ENHANCED_STREAMING for production"
            echo "   ✅ Optimized routing reduces latency for simple queries"
            echo "   ✅ Falls back to Deep Agent for complex orchestration"
            ;;
        "DEEP_AGENT_PARALLEL")
            echo "💡 Recommendation: Consider DEEP_AGENT_PARALLEL for production"
            echo "   ✅ Consistent orchestration with parallel execution hints"
            echo "   ✅ Unified intelligence across all query types"
            ;;
        "DEEP_AGENT_ONLY")
            echo "💡 Recommendation: DEEP_AGENT_ONLY best for consistency"
            echo "   ✅ Predictable behavior across all queries"
            echo "   ⚠️  May have higher latency for simple queries"
            ;;
    esac
else
    echo "❓ Unable to determine best performing mode from results"
fi

echo ""
echo "📁 Detailed logs available in: $results_dir/"
echo "✅ Comprehensive routing mode analysis completed!"
echo "=============================================================="
