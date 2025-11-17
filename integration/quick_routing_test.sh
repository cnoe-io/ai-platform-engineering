#!/bin/bash

# Quick routing mode test script
# Tests all three routing modes and compares performance

set -e

echo "🚀 Starting Platform Engineer Routing Mode Comparison"
echo "======================================================"

# Test configurations (Updated naming - now 4 modes)
declare -A modes
modes[DEEP_AGENT_INTELLIGENT_ROUTING]="ENABLE_ENHANCED_STREAMING=true FORCE_DEEP_AGENT_ORCHESTRATION=false ENABLE_ENHANCED_ORCHESTRATION=false"
modes[DEEP_AGENT_PARALLEL_ORCHESTRATION]="ENABLE_ENHANCED_STREAMING=false FORCE_DEEP_AGENT_ORCHESTRATION=true ENABLE_ENHANCED_ORCHESTRATION=false"
modes[DEEP_AGENT_SEQUENTIAL_ORCHESTRATION]="ENABLE_ENHANCED_STREAMING=false FORCE_DEEP_AGENT_ORCHESTRATION=false ENABLE_ENHANCED_ORCHESTRATION=false"
modes[DEEP_AGENT_ENHANCED_ORCHESTRATION]="ENABLE_ENHANCED_STREAMING=false FORCE_DEEP_AGENT_ORCHESTRATION=false ENABLE_ENHANCED_ORCHESTRATION=true"

# Results directory
results_dir="routing_test_results_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$results_dir"

echo "📁 Results will be saved to: $results_dir"
echo ""

for mode in DEEP_AGENT_INTELLIGENT_ROUTING DEEP_AGENT_PARALLEL_ORCHESTRATION DEEP_AGENT_SEQUENTIAL_ORCHESTRATION DEEP_AGENT_ENHANCED_ORCHESTRATION; do
    echo "========================================"
    echo "🎯 Testing $mode mode"
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

    # Run the Python test (use quick mode for faster comparison)
    echo "🧪 Running streaming tests for $mode..."
    log_file="$results_dir/${mode}_test.log"

    cd /home/sraradhy/ai-platform-engineering
    source .venv/bin/activate
    if python integration/test_platform_engineer_streaming.py --quick > "$log_file" 2>&1; then
        echo "✅ $mode tests completed successfully"

        # Extract key metrics from log
        echo "📊 Quick metrics for $mode:"
        grep -E "(Average duration:|Average time to first chunk:|Quality Distribution:)" "$log_file" || echo "   Metrics extraction failed"
    else
        echo "❌ $mode tests failed - check $log_file for details"
    fi

    echo ""
done

echo "========================================"
echo "📊 COMPARISON SUMMARY"
echo "========================================"

echo "🔍 Analyzing results across all modes..."

# Simple comparison - extract average durations from logs
echo ""
echo "⏱️  Average Response Times:"
echo "Mode                    | Avg Duration | Avg First Chunk"
echo "-----------------------|--------------|----------------"

for mode in DEEP_AGENT_INTELLIGENT_ROUTING DEEP_AGENT_PARALLEL_ORCHESTRATION DEEP_AGENT_SEQUENTIAL_ORCHESTRATION DEEP_AGENT_ENHANCED_ORCHESTRATION; do
    log_file="$results_dir/${mode}_test.log"
    if [ -f "$log_file" ]; then
        avg_duration=$(grep "Average duration:" "$log_file" | cut -d':' -f2 | tr -d ' s' || echo "N/A")
        avg_first_chunk=$(grep "Average time to first chunk:" "$log_file" | cut -d':' -f2 | tr -d ' s' || echo "N/A")
        printf "%-22s | %-12s | %-12s\n" "$mode" "$avg_duration" "$avg_first_chunk"
    else
        printf "%-22s | %-12s | %-12s\n" "$mode" "FAILED" "FAILED"
    fi
done

echo ""
echo "🎯 RECOMMENDATIONS:"
echo "==================="

enhanced_log="$results_dir/ENHANCED_STREAMING_test.log"
if [ -f "$enhanced_log" ]; then
    enhanced_first_chunk=$(grep "Average time to first chunk:" "$enhanced_log" | cut -d':' -f2 | tr -d ' s' | cut -d'.' -f1)
    if [ "$enhanced_first_chunk" -lt 5 ] 2>/dev/null; then
        echo "✅ ENHANCED_STREAMING shows excellent performance (<5s) - recommended for production"
    elif [ "$enhanced_first_chunk" -lt 10 ] 2>/dev/null; then
        echo "⚠️  ENHANCED_STREAMING shows good performance (5-10s) - acceptable for production"
    else
        echo "❌ ENHANCED_STREAMING performance may need optimization (>10s)"
    fi
else
    echo "❓ Unable to analyze ENHANCED_STREAMING performance"
fi

echo ""
echo "📁 Detailed logs available in: $results_dir/"
echo "✅ All routing mode tests completed!"
echo "======================================================"
