#!/usr/bin/env python3
"""
Comprehensive test script for Platform Engineer routing modes.

This script automatically tests all three routing modes by:
1. Updating docker-compose.dev.yaml environment variables
2. Restarting platform-engineer-p2p service
3. Running streaming tests
4. Collecting and comparing performance metrics

Usage:
    python integration/test_routing_modes.py
"""

import asyncio
import subprocess
import yaml
import json
import time
from pathlib import Path
from datetime import datetime
import httpx
from a2a.client import A2AClient, A2ACardResolver
from a2a.types import SendStreamingMessageRequest, MessageSendParams
from uuid import uuid4


class RoutingModeTestRunner:
    def __init__(self):
        self.docker_compose_path = Path("docker-compose.dev.yaml")
        self.platform_engineer_url = "http://10.99.255.178:8000"
        self.test_results = {}
        
        # Test scenarios - subset for faster comparison
        self.quick_test_scenarios = [
            ("docs: duo-sso cli instructions", "Knowledge base - DIRECT to RAG"),
            ("show me komodor clusters", "Single agent - DIRECT to Komodor"),
            ("list github repos and komodor clusters", "Multi-agent - PARALLEL execution"),
            ("who is on call for SRE?", "Complex - COMPLEX via Deep Agent"),
        ]
        
        self.routing_modes = [
            {
                "name": "ENHANCED_STREAMING",
                "description": "Intelligent routing (Production Default)",
                "env_vars": {
                    "ENABLE_ENHANCED_STREAMING": "true",
                    "FORCE_DEEP_AGENT_ORCHESTRATION": "false"
                }
            },
            {
                "name": "DEEP_AGENT_PARALLEL", 
                "description": "Deep Agent with parallel hints (Testing)",
                "env_vars": {
                    "ENABLE_ENHANCED_STREAMING": "false",
                    "FORCE_DEEP_AGENT_ORCHESTRATION": "true"
                }
            },
            {
                "name": "DEEP_AGENT_ONLY",
                "description": "Deep Agent only (Legacy)",
                "env_vars": {
                    "ENABLE_ENHANCED_STREAMING": "false",
                    "FORCE_DEEP_AGENT_ORCHESTRATION": "false"
                }
            }
        ]

    def update_docker_compose_env(self, env_vars):
        """Update environment variables in docker-compose.dev.yaml"""
        print("📝 Updating docker-compose.dev.yaml environment variables...")
        
        with open(self.docker_compose_path, 'r') as f:
            compose_data = yaml.safe_load(f)
        
        # Find platform-engineer-p2p service
        if 'services' not in compose_data or 'platform-engineer-p2p' not in compose_data['services']:
            raise Exception("platform-engineer-p2p service not found in docker-compose.dev.yaml")
        
        service = compose_data['services']['platform-engineer-p2p']
        
        # Initialize environment if it doesn't exist
        if 'environment' not in service:
            service['environment'] = {}
        
        # Update environment variables
        for key, value in env_vars.items():
            service['environment'][key] = value
            print(f"   {key}={value}")
        
        # Write back to file
        with open(self.docker_compose_path, 'w') as f:
            yaml.dump(compose_data, f, default_flow_style=False, sort_keys=False)
        
        print("✅ Docker compose file updated")

    def restart_service(self):
        """Restart platform-engineer-p2p service"""
        print("🔄 Restarting platform-engineer-p2p service...")
        
        try:
            # Stop the service
            result = subprocess.run(
                ["docker", "restart", "platform-engineer-p2p"],
                capture_output=True,
                text=True,
                timeout=60
            )
            
            if result.returncode != 0:
                print(f"❌ Failed to restart service: {result.stderr}")
                return False
            
            print("✅ Service restarted successfully")
            
            # Wait for service to be ready
            print("⏳ Waiting for service to be ready...")
            time.sleep(10)
            
            return True
            
        except subprocess.TimeoutExpired:
            print("❌ Service restart timed out")
            return False
        except Exception as e:
            print(f"❌ Error restarting service: {e}")
            return False

    async def wait_for_service_ready(self, max_retries=10, delay=5):
        """Wait for platform engineer service to be ready"""
        print("🔍 Checking if Platform Engineer is ready...")
        
        for attempt in range(max_retries):
            try:
                async with httpx.AsyncClient(timeout=10.0) as http_client:
                    resolver = A2ACardResolver(httpx_client=http_client, base_url=self.platform_engineer_url)
                    agent_card = await resolver.get_agent_card()
                    print(f"✅ Platform Engineer is ready: {agent_card.name}")
                    return True
            except Exception as e:
                print(f"⏳ Attempt {attempt + 1}/{max_retries}: Service not ready yet ({str(e)[:50]}...)")
                if attempt < max_retries - 1:
                    await asyncio.sleep(delay)
        
        print("❌ Service failed to become ready")
        return False

    async def run_quick_test(self, mode_name):
        """Run a quick test for the current routing mode"""
        print(f"\n🧪 Running quick tests for {mode_name} mode...")
        
        results = []
        
        async with httpx.AsyncClient(timeout=120.0) as http_client:
            # Fetch agent card
            resolver = A2ACardResolver(httpx_client=http_client, base_url=self.platform_engineer_url)
            try:
                agent_card = await resolver.get_agent_card()
            except Exception as e:
                print(f"❌ Failed to fetch agent card: {e}")
                return []

            # Initialize A2A client
            client = A2AClient(agent_card=agent_card, httpx_client=http_client)
            
            # Run test scenarios
            for i, (query, description) in enumerate(self.quick_test_scenarios, 1):
                print(f"\n🔄 Test {i}/{len(self.quick_test_scenarios)}: {description}")
                result = await self.test_single_query(client, query, description)
                if result:
                    results.append(result)
        
        return results

    async def test_single_query(self, client, query, description):
        """Test a single query and collect metrics"""
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

        try:
            async for response_wrapper in client.send_message_streaming(streaming_request):
                chunk_count += 1
                current_time = asyncio.get_event_loop().time()
                
                if first_chunk_time is None:
                    first_chunk_time = current_time

                # Extract event from wrapper
                response_dict = response_wrapper.model_dump()
                result_data = response_dict.get('result', {})
                event_kind = result_data.get('kind', '')

                # Count characters from artifact updates
                if event_kind == 'artifact-update':
                    artifact_data = result_data.get('artifact', {})
                    parts_data = artifact_data.get('parts', [])

                    for part in parts_data:
                        if isinstance(part, dict):
                            text_content = part.get('text', '')
                            if text_content:
                                total_chars += len(text_content)

                # Count characters from status updates
                elif event_kind == 'status-update':
                    status_data = result_data.get('status', {})
                    message_data = status_data.get('message')

                    if message_data:
                        parts_data = message_data.get('parts', [])
                        for part in parts_data:
                            if isinstance(part, dict):
                                text_content = part.get('text', '')
                                if text_content:
                                    total_chars += len(text_content)

                    state = status_data.get('state', '')
                    if state == 'completed':
                        break

        except Exception as e:
            print(f"❌ Error during test: {str(e)[:100]}...")
            return None

        end_time = asyncio.get_event_loop().time()
        duration = end_time - start_time
        time_to_first_chunk = first_chunk_time - start_time if first_chunk_time else duration

        print(f"   ⏱️  {duration:.2f}s total, ⚡ {time_to_first_chunk:.2f}s first chunk, 📦 {chunk_count} chunks")

        return {
            "query": query,
            "description": description,
            "duration": duration,
            "time_to_first_chunk": time_to_first_chunk,
            "chunk_count": chunk_count,
            "total_chars": total_chars,
        }

    def generate_comparison_report(self):
        """Generate a comprehensive comparison report"""
        print(f"\n{'='*120}")
        print("📊 ROUTING MODE COMPARISON REPORT")
        print(f"{'='*120}")
        
        # Summary table
        print(f"\n{'Mode':<20} {'Avg Duration':<15} {'Avg First Chunk':<18} {'Avg Chunks':<12} {'Avg Chars':<12}")
        print("-" * 80)
        
        for mode_name, results in self.test_results.items():
            if results:
                avg_duration = sum(r['duration'] for r in results) / len(results)
                avg_first_chunk = sum(r['time_to_first_chunk'] for r in results) / len(results)
                avg_chunks = sum(r['chunk_count'] for r in results) / len(results)
                avg_chars = sum(r['total_chars'] for r in results) / len(results)
                
                print(f"{mode_name:<20} {avg_duration:<15.2f} {avg_first_chunk:<18.2f} {avg_chunks:<12.1f} {avg_chars:<12.0f}")
        
        # Detailed comparison by query type
        print("\n📋 Performance by Query Type:")
        print("-" * 80)
        
        for i, (query, description) in enumerate(self.quick_test_scenarios):
            print(f"\n🔍 {description}")
            print(f"Query: '{query}'")
            print(f"{'Mode':<20} {'Duration':<12} {'First Chunk':<12} {'Chunks':<8} {'Quality'}")
            print("-" * 65)
            
            for mode_name, results in self.test_results.items():
                if results and i < len(results):
                    result = results[i]
                    quality = "⭐⭐⭐⭐⭐" if result['time_to_first_chunk'] < 2 else \
                             "⭐⭐⭐⭐" if result['time_to_first_chunk'] < 5 else \
                             "⭐⭐⭐" if result['time_to_first_chunk'] < 10 else "⭐⭐"
                    
                    print(f"{mode_name:<20} {result['duration']:<12.2f} {result['time_to_first_chunk']:<12.2f} {result['chunk_count']:<8} {quality}")
        
        # Recommendations
        print("\n🎯 RECOMMENDATIONS:")
        print("-" * 40)
        
        if 'ENHANCED_STREAMING' in self.test_results:
            enhanced_results = self.test_results['ENHANCED_STREAMING']
            if enhanced_results:
                avg_first_chunk = sum(r['time_to_first_chunk'] for r in enhanced_results) / len(enhanced_results)
                if avg_first_chunk < 5.0:
                    print("✅ ENHANCED_STREAMING shows excellent performance - recommended for production")
                else:
                    print("⚠️  ENHANCED_STREAMING performance may need optimization")
        
        if all(mode in self.test_results for mode in ['ENHANCED_STREAMING', 'DEEP_AGENT_PARALLEL', 'DEEP_AGENT_ONLY']):
            enhanced_avg = sum(r['time_to_first_chunk'] for r in self.test_results['ENHANCED_STREAMING']) / len(self.test_results['ENHANCED_STREAMING'])
            parallel_avg = sum(r['time_to_first_chunk'] for r in self.test_results['DEEP_AGENT_PARALLEL']) / len(self.test_results['DEEP_AGENT_PARALLEL'])
            only_avg = sum(r['time_to_first_chunk'] for r in self.test_results['DEEP_AGENT_ONLY']) / len(self.test_results['DEEP_AGENT_ONLY'])
            
            fastest = min(enhanced_avg, parallel_avg, only_avg)
            if fastest == enhanced_avg:
                improvement = ((parallel_avg - enhanced_avg) / enhanced_avg) * 100
                print(f"🚀 ENHANCED_STREAMING is {improvement:.1f}% faster than DEEP_AGENT_PARALLEL")
            elif fastest == parallel_avg:
                improvement = ((enhanced_avg - parallel_avg) / parallel_avg) * 100
                print(f"🤔 DEEP_AGENT_PARALLEL is {improvement:.1f}% faster than ENHANCED_STREAMING")

    async def run_all_tests(self):
        """Run tests for all routing modes"""
        print("🚀 Starting comprehensive routing mode comparison")
        print(f"Timestamp: {datetime.now().isoformat()}")
        print(f"Platform Engineer URL: {self.platform_engineer_url}")
        
        for mode_config in self.routing_modes:
            mode_name = mode_config["name"]
            print(f"\n{'='*80}")
            print(f"🎯 Testing {mode_name}: {mode_config['description']}")
            print(f"{'='*80}")
            
            # Update docker-compose configuration
            self.update_docker_compose_env(mode_config["env_vars"])
            
            # Restart service
            if not self.restart_service():
                print(f"❌ Failed to restart service for {mode_name}, skipping...")
                continue
            
            # Wait for service to be ready
            if not await self.wait_for_service_ready():
                print(f"❌ Service not ready for {mode_name}, skipping...")
                continue
            
            # Run tests
            results = await self.run_quick_test(mode_name)
            self.test_results[mode_name] = results
            
            print(f"✅ Completed {mode_name} tests ({len(results)} successful)")
        
        # Generate comparison report
        self.generate_comparison_report()
        
        # Save results to file
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        results_file = f"routing_comparison_{timestamp}.json"
        
        with open(results_file, 'w') as f:
            json.dump(self.test_results, f, indent=2)
        
        print(f"\n💾 Results saved to: {results_file}")
        print(f"\n{'='*80}")
        print("🎉 All routing mode tests completed!")
        print(f"{'='*80}")


async def main():
    """Main test execution"""
    runner = RoutingModeTestRunner()
    await runner.run_all_tests()


if __name__ == "__main__":
    asyncio.run(main())

