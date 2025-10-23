#!/usr/bin/env python3
"""
Quick verification script to check if Platform Engineer is accessible and working.
"""

import asyncio
import httpx
from a2a.client import A2AClient, A2ACardResolver
from a2a.types import SendStreamingMessageRequest, MessageSendParams
from uuid import uuid4


async def verify_platform_engineer():
    """Verify Platform Engineer is accessible and responsive"""
    platform_engineer_url = "http://10.99.255.178:8000"
    
    print(f"🔍 Verifying Platform Engineer at {platform_engineer_url}")
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as http_client:
            # Test 1: Fetch agent card
            print("📋 Step 1: Fetching agent card...")
            resolver = A2ACardResolver(httpx_client=http_client, base_url=platform_engineer_url)
            agent_card = await resolver.get_agent_card()
            print(f"✅ Agent card fetched: {agent_card.name}")
            
            # Test 2: Initialize A2A client
            print("🔗 Step 2: Initializing A2A client...")
            client = A2AClient(agent_card=agent_card, httpx_client=http_client)
            print("✅ A2A client initialized")
            
            # Test 3: Send a simple query
            print("💬 Step 3: Sending test query...")
            message_payload = {
                "message": {
                    "role": "user",
                    "parts": [{"kind": "text", "text": "hello"}],
                    "messageId": str(uuid4()),
                }
            }
            
            streaming_request = SendStreamingMessageRequest(
                id=str(uuid4()),
                params=MessageSendParams(**message_payload)
            )
            
            response_received = False
            async for response_wrapper in client.send_message_streaming(streaming_request):
                response_received = True
                print("✅ Received streaming response")
                break  # Just test first response
            
            if response_received:
                print("🎉 Platform Engineer is working correctly!")
                return True
            else:
                print("❌ No response received")
                return False
                
    except Exception as e:
        print(f"❌ Error: {e}")
        return False


if __name__ == "__main__":
    success = asyncio.run(verify_platform_engineer())
    exit(0 if success else 1)

