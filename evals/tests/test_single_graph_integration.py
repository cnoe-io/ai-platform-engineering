#!/usr/bin/env python3
"""
Integration tests for single-graph mode evaluations.

These tests send prompts from multi_agent.yaml to the running server
and verify that responses are received successfully.

Tests run in parallel using asyncio.gather for faster execution.
"""

import asyncio
import json
import os
import sys
from pathlib import Path
import logging
import time
from dataclasses import dataclass
from typing import Optional

import httpx
import pytest
import yaml

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

# Server configuration
PLATFORM_ENGINEER_URL = os.getenv("PLATFORM_ENGINEER_URL", "http://localhost:8002")
REQUEST_TIMEOUT = float(os.getenv("EVAL_REQUEST_TIMEOUT", "60.0"))  # Reduced to 60s


@dataclass
class TestResult:
    """Result of a single test execution."""
    test_name: str
    prompt: str
    passed: bool
    response_text: str
    events_received: int
    status: Optional[str]
    duration: float
    error: Optional[str] = None


async def send_message(prompt: str, test_name: str) -> TestResult:
    """Send a message to the platform engineer and collect response."""
    import uuid
    
    start_time = time.time()
    message_id = str(uuid.uuid4())
    request_id = str(uuid.uuid4())
    
    payload = {
        "jsonrpc": "2.0",
        "method": "message/stream",
        "params": {
            "message": {
                "role": "user",
                "parts": [{"kind": "text", "text": prompt}],
                "messageId": message_id
            }
        },
        "id": request_id
    }
    
    logger.info(f"🚀 [{test_name}] Sending: {prompt[:50]}...")
    
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            response_text = ""
            events_received = 0
            status = None
            
            async with client.stream("POST", PLATFORM_ENGINEER_URL, json=payload) as response:
                response.raise_for_status()
                
                async for line in response.aiter_lines():
                    if not line or not line.startswith("data: "):
                        continue
                    
                    try:
                        data = json.loads(line[6:])
                        result = data.get("result", {})
                        kind = result.get("kind")
                        events_received += 1
                        
                        if kind == "artifact-update":
                            artifact = result.get("artifact", {})
                            parts = artifact.get("parts", [])
                            for part in parts:
                                if part.get("kind") == "text":
                                    response_text += part.get("text", "")
                        
                        elif kind == "status-update":
                            status = result.get("status", {}).get("state")
                            if status == "completed":
                                break
                    
                    except json.JSONDecodeError:
                        continue
            
            duration = time.time() - start_time
            passed = status == "completed" and events_received > 0
            
            if passed:
                logger.info(f"✅ [{test_name}] PASSED in {duration:.1f}s - {events_received} events, {len(response_text)} chars")
            else:
                logger.warning(f"❌ [{test_name}] FAILED in {duration:.1f}s - status={status}, events={events_received}")
            
            return TestResult(
                test_name=test_name,
                prompt=prompt,
                passed=passed,
                response_text=response_text,
                events_received=events_received,
                status=status,
                duration=duration
            )
    
    except Exception as e:
        duration = time.time() - start_time
        logger.error(f"❌ [{test_name}] ERROR in {duration:.1f}s: {str(e)}")
        return TestResult(
            test_name=test_name,
            prompt=prompt,
            passed=False,
            response_text="",
            events_received=0,
            status=None,
            duration=duration,
            error=str(e)
        )


# Define test cases
TEST_CASES = [
    ("test_argocd_version", "Show me the ArgoCD version"),
    ("test_argocd_list_apps", "List all ArgoCD applications"),
    ("test_jira_list_projects", "List all Jira projects I have access to"),
    ("test_github_list_repos", "List repositories in cnoe-io organization"),
    ("test_pagerduty_incidents", "Show current open incidents in PagerDuty"),
    ("test_confluence_spaces", "List all Confluence spaces"),
    ("test_splunk_indexes", "List available Splunk indexes"),
    ("test_komodor_services", "List Kubernetes services in Komodor"),
    ("test_slack_channels", "List Slack channels I have access to"),
    ("test_backstage_entities", "List all entities in Backstage catalog"),
    ("test_weather_current", "What's the current weather in San Francisco?"),
]


class TestSingleGraphParallel:
    """Parallel integration tests for single-graph mode."""
    
    @pytest.fixture(autouse=True)
    async def check_server(self):
        """Check that server is running before tests."""
        logger.info(f"🔍 Checking server at {PLATFORM_ENGINEER_URL}")
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                response = await client.get(f"{PLATFORM_ENGINEER_URL}/.well-known/agent-card.json")
                response.raise_for_status()
                logger.info(f"✅ Server is available at {PLATFORM_ENGINEER_URL}")
            except Exception as e:
                logger.error(f"❌ Server not available: {e}")
                pytest.skip(f"Server not available at {PLATFORM_ENGINEER_URL}: {e}")
    
    @pytest.mark.asyncio
    async def test_all_agents_parallel(self):
        """Run all agent tests in parallel for speed."""
        logger.info(f"🏃 Starting parallel execution of {len(TEST_CASES)} tests...")
        start_time = time.time()
        
        # Run all tests in parallel
        tasks = [send_message(prompt, name) for name, prompt in TEST_CASES]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        total_duration = time.time() - start_time
        
        # Process results
        passed = 0
        failed = 0
        errors = []
        
        logger.info("\n" + "=" * 60)
        logger.info("📊 TEST RESULTS SUMMARY")
        logger.info("=" * 60)
        
        for result in results:
            if isinstance(result, Exception):
                failed += 1
                errors.append(f"Exception: {str(result)}")
                logger.error(f"❌ Exception: {result}")
            elif result.passed:
                passed += 1
            else:
                failed += 1
                errors.append(f"{result.test_name}: {result.error or result.status}")
        
        logger.info(f"\n✅ Passed: {passed}/{len(TEST_CASES)}")
        logger.info(f"❌ Failed: {failed}/{len(TEST_CASES)}")
        logger.info(f"⏱️  Total Duration: {total_duration:.1f}s")
        logger.info("=" * 60 + "\n")
        
        # Assert based on results (allow some failures for external services)
        min_pass_rate = 0.5  # At least 50% must pass
        pass_rate = passed / len(TEST_CASES)
        
        if pass_rate < min_pass_rate:
            pytest.fail(
                f"Too many failures: {failed}/{len(TEST_CASES)} tests failed. "
                f"Pass rate {pass_rate:.0%} < {min_pass_rate:.0%} minimum. "
                f"Errors: {errors}"
            )
        
        # Log warning if some tests failed but within acceptable range
        if failed > 0:
            logger.warning(f"⚠️  {failed} tests failed but within acceptable threshold")


# Individual tests for more granular reporting (run sequentially if needed)
@pytest.mark.asyncio
async def test_server_health():
    """Quick health check - should complete fast."""
    logger.info("🔍 Running server health check...")
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(f"{PLATFORM_ENGINEER_URL}/.well-known/agent-card.json")
        response.raise_for_status()
        data = response.json()
        logger.info(f"✅ Server healthy: {data.get('name', 'Unknown')}")
        assert "name" in data


if __name__ == "__main__":
    # Run with: python test_single_graph_integration.py
    asyncio.run(test_server_health())
    
    # Run parallel tests
    async def run_parallel():
        test = TestSingleGraphParallel()
        await test.test_all_agents_parallel()
    
    asyncio.run(run_parallel())
