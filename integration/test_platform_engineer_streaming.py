#!/usr/bin/env python3
"""
Test Platform Engineer agent streaming with different routing modes.

This test verifies:
1. Direct routing to sub-agents (token streaming)
2. Parallel routing (multiple agents)
3. Deep Agent routing (complex queries)

Usage:
    python integration/test_platform_engineer_streaming.py
"""

import asyncio
import httpx
from uuid import uuid4
from a2a.client import A2AClient, A2ACardResolver
from a2a.types import SendStreamingMessageRequest, MessageSendParams


async def test_query(client, query, description, collect_metrics=True):
    """Test a single query and print streaming results with detailed metrics."""
    print(f"\n{'='*80}")
    print(f"📝 Test: {description}")
    print(f"Query: '{query}'")
    print(f"{'='*80}\n")

    # Create message payload in the correct A2A format
    message_payload = {
        "message": {
            "role": "user",
            "parts": [{"kind": "text", "text": query}],
            "messageId": str(uuid4()),
        }
    }

    streaming_request = SendStreamingMessageRequest(
        id=str(uuid4()),
        params=MessageSendParams(**message_payload)
    )

    # Metrics collection
    chunk_count = 0
    total_chars = 0
    first_chunk_time = None
    start_time = asyncio.get_event_loop().time()
    chunk_times = []
    full_response = []

    try:
        async for response_wrapper in client.send_message_streaming(streaming_request):
            chunk_count += 1
            current_time = asyncio.get_event_loop().time()
            
            if first_chunk_time is None:
                first_chunk_time = current_time
                print(f"⚡ First chunk received after {first_chunk_time - start_time:.2f}s")

            # Extract event from wrapper
            response_dict = response_wrapper.model_dump()
            result_data = response_dict.get('result', {})
            event_kind = result_data.get('kind', '')

            # Print artifact updates
            if event_kind == 'artifact-update':
                artifact_data = result_data.get('artifact', {})
                parts_data = artifact_data.get('parts', [])

                for part in parts_data:
                    if isinstance(part, dict):
                        text_content = part.get('text', '')
                        if text_content:
                            if collect_metrics:
                                total_chars += len(text_content)
                                chunk_times.append(current_time - start_time)
                                full_response.append(text_content)
                            print(text_content, end='', flush=True)

            # Print status updates
            elif event_kind == 'status-update':
                status_data = result_data.get('status', {})
                message_data = status_data.get('message')

                if message_data:
                    parts_data = message_data.get('parts', [])
                    for part in parts_data:
                        if isinstance(part, dict):
                            text_content = part.get('text', '')
                            if text_content:
                                if collect_metrics:
                                    total_chars += len(text_content)
                                    full_response.append(text_content)
                                print(text_content, end='', flush=True)

                state = status_data.get('state', '')
                if state == 'completed':
                    break

    except Exception as e:
        print(f"\n❌ Error during streaming: {e}")
        import traceback
        traceback.print_exc()
        return None

    end_time = asyncio.get_event_loop().time()
    duration = end_time - start_time
    time_to_first_chunk = first_chunk_time - start_time if first_chunk_time else 0

    # Calculate streaming metrics
    if collect_metrics and chunk_times:
        avg_chars_per_chunk = total_chars / chunk_count if chunk_count > 0 else 0
        chars_per_second = total_chars / duration if duration > 0 else 0
        chunks_per_second = chunk_count / duration if duration > 0 else 0
        
        print("\n\n📊 STREAMING METRICS:")
        print(f"   ⏱️  Total time: {duration:.2f}s")
        print(f"   ⚡ Time to first chunk: {time_to_first_chunk:.2f}s")
        print(f"   📦 Total chunks: {chunk_count}")
        print(f"   📝 Total characters: {total_chars}")
        print(f"   📊 Avg chars/chunk: {avg_chars_per_chunk:.1f}")
        print(f"   🚀 Chars/second: {chars_per_second:.1f}")
        print(f"   📈 Chunks/second: {chunks_per_second:.1f}")
        
        # Streaming quality assessment
        if time_to_first_chunk < 2.0:
            quality = "⭐⭐⭐⭐⭐ Excellent"
        elif time_to_first_chunk < 5.0:
            quality = "⭐⭐⭐⭐ Good"
        elif time_to_first_chunk < 10.0:
            quality = "⭐⭐⭐ Fair"
        else:
            quality = "⭐⭐ Poor"
        
        print(f"   🎯 Streaming quality: {quality}")
        
        return {
            "query": query,
            "description": description,
            "duration": duration,
            "time_to_first_chunk": time_to_first_chunk,
            "chunk_count": chunk_count,
            "total_chars": total_chars,
            "chars_per_second": chars_per_second,
            "chunks_per_second": chunks_per_second,
            "quality": quality,
            "full_response": "".join(full_response)
        }
    else:
        print(f"\n\n✅ Completed in {duration:.2f}s ({chunk_count} chunks)")
        return None


async def test_platform_engineer_streaming(quick_mode=False):
    """Test platform engineer with various routing scenarios.
    
    Args:
        quick_mode: If True, run only a subset of tests for faster iteration
    """

    # Platform engineer URL (adjust if needed)
    platform_engineer_url = "http://10.99.255.178:8000"

    print(f"🔍 Testing Platform Engineer streaming at {platform_engineer_url}")
    if quick_mode:
        print("⚡ Running in QUICK MODE - subset of tests for faster results")
    else:
        print("📊 Running FULL TEST SUITE - comprehensive statistical analysis")
    print("📊 Test will show routing mode and performance characteristics")

    # Create A2A client
    async with httpx.AsyncClient(timeout=120.0) as http_client:
        # Fetch agent card using A2ACardResolver
        resolver = A2ACardResolver(httpx_client=http_client, base_url=platform_engineer_url)
        try:
            agent_card = await resolver.get_agent_card()
            print(f"✅ Fetched Platform Engineer agent card: {agent_card.name}\n")
        except Exception as e:
            print(f"❌ Failed to fetch agent card: {e}")
            return

        # Initialize A2A client
        client = A2AClient(agent_card=agent_card, httpx_client=http_client)

        # Comprehensive test scenarios for different routing strategies and streaming quality analysis
        # Large dataset for statistical significance (50+ scenarios)
        test_scenarios = [
            # DIRECT routing tests (knowledge base) - 15 scenarios
            ("docs: duo-sso cli instructions", "Knowledge base query - DIRECT to RAG"),
            ("@docs kubernetes deployment guide", "Knowledge base query with @docs prefix - DIRECT to RAG"),
            ("docs: troubleshooting network issues", "Knowledge base query - DIRECT to RAG"),
            ("docs: setting up ArgoCD", "Knowledge base query - DIRECT to RAG"),
            ("@docs prometheus monitoring setup", "Knowledge base query - DIRECT to RAG"),
            ("docs: jenkins pipeline configuration", "Knowledge base query - DIRECT to RAG"),
            ("docs: terraform best practices", "Knowledge base query - DIRECT to RAG"),
            ("@docs helm chart deployment", "Knowledge base query - DIRECT to RAG"),
            ("docs: service mesh configuration", "Knowledge base query - DIRECT to RAG"),
            ("docs: observability stack setup", "Knowledge base query - DIRECT to RAG"),
            ("@docs database migration guide", "Knowledge base query - DIRECT to RAG"),
            ("docs: security scanning procedures", "Knowledge base query - DIRECT to RAG"),
            ("docs: incident response playbook", "Knowledge base query - DIRECT to RAG"),
            ("@docs backup and recovery procedures", "Knowledge base query - DIRECT to RAG"),
            ("docs: compliance requirements checklist", "Knowledge base query - DIRECT to RAG"),
            
            # DIRECT routing tests (single agents) - 20 scenarios
            ("show me komodor clusters", "Single agent query - DIRECT to Komodor"),
            ("list github repositories", "Single agent query - DIRECT to GitHub"),
            ("komodor cluster status", "Single agent query - DIRECT to Komodor"),
            ("github pull requests for platform repo", "Single agent query - DIRECT to GitHub"),
            ("show github issues assigned to me", "Single agent query - DIRECT to GitHub"),
            ("komodor application health", "Single agent query - DIRECT to Komodor"),
            ("github recent commits in main branch", "Single agent query - DIRECT to GitHub"),
            ("komodor pod restart events", "Single agent query - DIRECT to Komodor"),
            ("github workflow status", "Single agent query - DIRECT to GitHub"),
            ("komodor deployment history", "Single agent query - DIRECT to Komodor"),
            ("pagerduty current incidents", "Single agent query - DIRECT to PagerDuty"),
            ("jira open tickets in platform project", "Single agent query - DIRECT to Jira"),
            ("argocd application sync status", "Single agent query - DIRECT to ArgoCD"),
            ("confluence recent documentation updates", "Single agent query - DIRECT to Confluence"),
            ("slack recent messages in platform channel", "Single agent query - DIRECT to Slack"),
            ("backstage service catalog", "Single agent query - DIRECT to Backstage"),
            ("weather forecast for San Francisco", "Single agent query - DIRECT to Weather"),
            ("petstore available pets", "Single agent query - DIRECT to Petstore"),
            ("jira critical bugs", "Single agent query - DIRECT to Jira"),
            ("argocd failed deployments", "Single agent query - DIRECT to ArgoCD"),
            
            # PARALLEL routing tests (multi-agent, simple) - 15 scenarios
            ("list github repos and show komodor clusters", "Multi-agent simple - PARALLEL execution"),
            ("github repositories and komodor services", "Multi-agent simple - PARALLEL execution"),
            ("show me komodor nodes and github issues", "Multi-agent simple - PARALLEL execution"),
            ("github pull requests and jira tickets", "Multi-agent simple - PARALLEL execution"),
            ("komodor alerts and pagerduty incidents", "Multi-agent simple - PARALLEL execution"),
            ("argocd applications and github repositories", "Multi-agent simple - PARALLEL execution"),
            ("jira bugs and confluence documentation", "Multi-agent simple - PARALLEL execution"),
            ("github commits and komodor deployments", "Multi-agent simple - PARALLEL execution"),
            ("slack notifications and pagerduty alerts", "Multi-agent simple - PARALLEL execution"),
            ("backstage services and argocd status", "Multi-agent simple - PARALLEL execution"),
            ("github workflows and jira sprints", "Multi-agent simple - PARALLEL execution"),
            ("komodor pods and github branches", "Multi-agent simple - PARALLEL execution"),
            ("pagerduty on-call and slack activity", "Multi-agent simple - PARALLEL execution"),
            ("argocd sync and confluence pages", "Multi-agent simple - PARALLEL execution"),
            ("jira backlog and github milestones", "Multi-agent simple - PARALLEL execution"),
            
            # COMPLEX routing tests (orchestration needed) - 12 scenarios
            ("who is on call for the SRE team?", "Complex query - COMPLEX via Deep Agent"),
            ("analyze platform health and create jira ticket if issues found", "Complex orchestration - COMPLEX via Deep Agent"),
            ("compare github commit activity with komodor cluster health", "Complex analysis - COMPLEX via Deep Agent"),
            ("if there are any critical alerts in komodor, create github issue and notify on-call", "Complex conditional logic - COMPLEX via Deep Agent"),
            ("check if any failed deployments correlate with recent code changes", "Complex correlation analysis - COMPLEX via Deep Agent"),
            ("analyze incident patterns and suggest preventive measures", "Complex analysis - COMPLEX via Deep Agent"),
            ("create deployment summary based on argocd and github activity", "Complex synthesis - COMPLEX via Deep Agent"),
            ("if service is down, check logs and create incident report", "Complex conditional workflow - COMPLEX via Deep Agent"),
            ("analyze team productivity based on github and jira metrics", "Complex metrics analysis - COMPLEX via Deep Agent"),
            ("recommend scaling decisions based on monitoring data", "Complex recommendation - COMPLEX via Deep Agent"),
            ("correlate user feedback with deployment timeline", "Complex correlation - COMPLEX via Deep Agent"),
            ("generate weekly platform status report", "Complex reporting - COMPLEX via Deep Agent"),
            
            # Mixed complexity and edge cases - 8 scenarios
            ("what documentation do we have about komodor setup?", "Mixed query - could be DIRECT to RAG or COMPLEX"),
            ("show me recent github commits for repositories that have komodor alerts", "Complex cross-agent correlation - COMPLEX via Deep Agent"),
            ("help: setting up monitoring dashboards", "Knowledge base with help prefix"),
            ("find services owned by platform team", "Mixed query - Backstage or complex search"),
            ("what's the weather like for our data centers?", "Ambiguous query - might need Deep Agent routing"),
            ("show me all integration test results", "Mixed query - could involve multiple agents"),
            ("list all production incidents this week", "Mixed query - PagerDuty or complex analysis"),
            ("what are the current capacity constraints?", "Mixed query - requires analysis across multiple sources"),
        ]

        # Select test scenarios based on mode
        if quick_mode:
            # Quick mode: run representative sample from each category (16 total)
            selected_scenarios = [
                # 4 knowledge base queries
                test_scenarios[0], test_scenarios[2], test_scenarios[5], test_scenarios[8],
                # 4 single agent queries  
                test_scenarios[15], test_scenarios[17], test_scenarios[21], test_scenarios[25],
                # 4 parallel queries
                test_scenarios[35], test_scenarios[37], test_scenarios[40], test_scenarios[43],
                # 4 complex queries
                test_scenarios[50], test_scenarios[52], test_scenarios[55], test_scenarios[58]
            ]
        else:
            # Full mode: run all scenarios
            selected_scenarios = test_scenarios

        print(f"📊 Running {len(selected_scenarios)} test scenarios...")
        
        # Run selected test scenarios and collect metrics
        results = []
        for i, (query, description) in enumerate(selected_scenarios, 1):
            print(f"\n🔄 Running test {i}/{len(selected_scenarios)}")
            result = await test_query(client, query, description, collect_metrics=True)
            if result:
                results.append(result)

        # Summary report
        if results:
            print(f"\n{'='*100}")
            print("📈 PERFORMANCE SUMMARY REPORT")
            print(f"{'='*100}")
            
            # Calculate averages
            avg_duration = sum(r['duration'] for r in results) / len(results)
            avg_first_chunk = sum(r['time_to_first_chunk'] for r in results) / len(results)
            avg_chunks = sum(r['chunk_count'] for r in results) / len(results)
            avg_chars = sum(r['total_chars'] for r in results) / len(results)
            avg_chars_per_sec = sum(r['chars_per_second'] for r in results) / len(results)
            
            print(f"🎯 Total tests: {len(results)}")
            print(f"⏱️  Average duration: {avg_duration:.2f}s")
            print(f"⚡ Average time to first chunk: {avg_first_chunk:.2f}s")
            print(f"📦 Average chunks per query: {avg_chunks:.1f}")
            print(f"📝 Average characters per query: {avg_chars:.0f}")
            print(f"🚀 Average chars/second: {avg_chars_per_sec:.1f}")
            
            # Quality distribution
            quality_counts = {}
            for result in results:
                quality = result['quality'].split(' ')[1]  # Extract quality level
                quality_counts[quality] = quality_counts.get(quality, 0) + 1
            
            print("\n🎭 Quality Distribution:")
            for quality, count in sorted(quality_counts.items()):
                percentage = (count / len(results)) * 100
                print(f"   {quality}: {count} tests ({percentage:.1f}%)")
            
            # Top performers
            fastest_queries = sorted(results, key=lambda x: x['time_to_first_chunk'])[:3]
            print("\n🏆 Fastest Response Times:")
            for i, result in enumerate(fastest_queries, 1):
                print(f"   {i}. {result['time_to_first_chunk']:.2f}s - {result['description']}")
            
            # Slowest queries
            slowest_queries = sorted(results, key=lambda x: x['time_to_first_chunk'], reverse=True)[:3]
            print("\n🐌 Slowest Response Times:")
            for i, result in enumerate(slowest_queries, 1):
                print(f"   {i}. {result['time_to_first_chunk']:.2f}s - {result['description']}")

        print(f"\n{'='*100}")
        print("✅ All streaming tests completed!")
        print(f"{'='*100}")


if __name__ == "__main__":
    import sys
    
    # Check for quick mode flag
    quick_mode = "--quick" in sys.argv or "-q" in sys.argv
    
    if quick_mode:
        print("🏃‍♂️ Quick mode enabled - running representative subset")
    
    asyncio.run(test_platform_engineer_streaming(quick_mode=quick_mode))

