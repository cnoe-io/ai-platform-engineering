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
from a2a.client import A2AClient
from a2a.types import SendStreamingMessageRequest, MessageSendParams


async def test_query(client, query, description):
    """Test a single query and print streaming results."""
    print(f"\n{'='*80}")
    print(f"📝 Test: {description}")
    print(f"Query: '{query}'")
    print(f"{'='*80}\n")
    
    streaming_request = SendStreamingMessageRequest(
        params=MessageSendParams(
            query=query,
            context_id=f"test-{hash(query)}"
        )
    )
    
    chunk_count = 0
    start_time = asyncio.get_event_loop().time()
    
    try:
        async for response_wrapper in client.send_message_streaming(streaming_request):
            chunk_count += 1
            
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
                                print(text_content, end='', flush=True)
                
                state = status_data.get('state', '')
                if state == 'completed':
                    break
    
    except Exception as e:
        print(f"\n❌ Error during streaming: {e}")
        import traceback
        traceback.print_exc()
        return
    
    end_time = asyncio.get_event_loop().time()
    duration = end_time - start_time
    
    print(f"\n\n✅ Completed in {duration:.2f}s ({chunk_count} chunks)")


async def test_platform_engineer_streaming():
    """Test platform engineer with various routing scenarios."""
    
    # Platform engineer URL (adjust if needed)
    platform_engineer_url = "http://localhost:8080"
    
    print(f"🔍 Testing Platform Engineer streaming at {platform_engineer_url}")
    
    # Create A2A client
    async with httpx.AsyncClient(timeout=120.0) as http_client:
        # Fetch agent card
        agent_card_response = await http_client.get(f"{platform_engineer_url}/.well-known/agent.json")
        if agent_card_response.status_code != 200:
            print(f"❌ Failed to fetch agent card: {agent_card_response.status_code}")
            return
        
        agent_card = agent_card_response.json()
        print(f"✅ Fetched Platform Engineer agent card\n")
        
        # Initialize A2A client
        client = A2AClient(agent_card=agent_card, httpx_client=http_client)
        
        # Test 1: Direct routing to RAG (documentation query)
        await test_query(
            client,
            "docs duo-sso cli instructions",
            "Direct routing to RAG (token streaming)"
        )
        
        # Test 2: Direct routing to operational agent
        await test_query(
            client,
            "show me komodor clusters",
            "Direct routing to Komodor (token streaming)"
        )
        
        # Test 3: Parallel routing (multiple agents)
        await test_query(
            client,
            "show me github repos and komodor clusters",
            "Parallel routing to GitHub + Komodor"
        )
        
        # Test 4: Deep Agent routing (ambiguous query)
        await test_query(
            client,
            "who is on call for SRE?",
            "Deep Agent routing (PagerDuty + RAG)"
        )
        
        # Test 5: Deep Agent with RAG (knowledge base query without explicit keywords)
        await test_query(
            client,
            "what is the escalation policy?",
            "Deep Agent routing to RAG (semantic routing)"
        )
        
        print(f"\n{'='*80}")
        print("✅ All streaming tests completed!")
        print(f"{'='*80}")


if __name__ == "__main__":
    asyncio.run(test_platform_engineer_streaming())

