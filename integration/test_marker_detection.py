#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import requests
import json
import re
import time

def test_marker_detection():
    """Test if execution plan markers and querying announcement markers are working"""
    
    # Test query that should trigger execution plan and agent calls including tasks
    test_query = "show me my assigned jira tasks and tickets"
    
    url = "http://10.99.255.178:8000"
    headers = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream"
    }
    
    test_id = f"test-marker-{int(time.time())}"
    payload = {
        "id": test_id,
        "method": "message/stream",
        "params": {
            "message": {
                "role": "user",
                "parts": [{"kind": "text", "text": test_query}],
                "messageId": f"msg-{test_id}"
            }
        }
    }
    
    print(f"🧪 Testing marker detection with query: '{test_query}'")
    print("=" * 60)
    
    # Tracking variables
    execution_plan_found = False
    execution_plan_start_marker = False
    execution_plan_end_marker = False
    querying_announcements = []
    querying_tasks_events = []
    tool_update_events = []
    full_response = []
    
    try:
        response = requests.post(url, json=payload, headers=headers, stream=True, timeout=60)
        response.raise_for_status()
        
        print("📡 Streaming response received, analyzing content...")
        print("-" * 40)
        
        for line in response.iter_lines(decode_unicode=True):
            if not line.strip():
                continue
                
            # Handle Server-Sent Events (SSE) format
            if line.startswith('data: '):
                json_data = line[6:]  # Remove 'data: ' prefix
            else:
                json_data = line.strip()
                
            if not json_data:
                continue
                
            try:
                # A2A streaming format - parse each line as JSON
                parsed_data = json.loads(json_data)
                
                # Extract content from A2A response structure
                content = ""
                if isinstance(parsed_data, dict):
                    # Check for different A2A response structures
                    if 'result' in parsed_data:
                        result = parsed_data['result']
                        if isinstance(result, dict):
                            # artifact-update events contain the actual content
                            if result.get('kind') == 'artifact-update':
                                artifact = result.get('artifact', {})
                                if isinstance(artifact, dict):
                                    parts = artifact.get('parts', [])
                                    if parts and isinstance(parts, list) and len(parts) > 0:
                                        text_part = parts[0]
                                        if isinstance(text_part, dict) and text_part.get('kind') == 'text':
                                            # Extract text directly from the part
                                            content = text_part.get('text', '')
                            # Direct content in result
                            elif 'content' in result:
                                content = result['content']
                    elif 'params' in parsed_data:
                        params = parsed_data['params']
                        if isinstance(params, dict) and 'content' in params:
                            content = params['content']
                
                if content:
                    full_response.append(content)
                    
                    # Check for execution plan markers
                    if '⟦' in content:
                        execution_plan_start_marker = True
                        print("✅ FOUND: Execution plan start marker ⟦")
                    
                    if '⟧' in content:
                        execution_plan_end_marker = True
                        execution_plan_found = True
                        print("✅ FOUND: Execution plan end marker ⟧")
                    
                    # Check for querying announcements with 🔍 marker
                    querying_pattern = r'🔍\s+Querying\s+(\w+)\s+for\s+([^.]+?)\.\.\.'
                    querying_matches = re.findall(querying_pattern, content)
                    for match in querying_matches:
                        agent_name, purpose = match
                        announcement = f"🔍 Querying {agent_name} for {purpose}..."
                        querying_announcements.append(announcement)
                        print(f"✅ FOUND: Querying announcement - {agent_name} for {purpose}")
                        
                        # Check specifically for tasks-related querying events
                        if 'tasks' in purpose.lower() or 'task' in purpose.lower():
                            task_event = {
                                'agent': agent_name,
                                'purpose': purpose,
                                'announcement': announcement
                            }
                            querying_tasks_events.append(task_event)
                            print(f"🎯 FOUND: Querying TASKS event - {agent_name} for {purpose}")
                    
                    # Print content chunks for debugging (first 100 chars)
                    if content.strip():
                        preview = content[:100].replace('\n', '\\n')
                        print(f"📄 Content: {preview}{'...' if len(content) > 100 else ''}")
                
                # Check for tool_update events in parsed data
                if isinstance(parsed_data, dict):
                    result = parsed_data.get('result', {})
                    if isinstance(result, dict) and 'tool_update' in result:
                        tool_update = result['tool_update']
                        tool_update_events.append(tool_update)
                        print(f"✅ FOUND: tool_update event - {tool_update.get('name', 'unknown')} ({tool_update.get('status', 'unknown')})")
                        
                        # Check if this is a querying tasks tool_update event
                        if (tool_update.get('status') == 'querying' and 
                            tool_update.get('purpose') and 
                            ('task' in tool_update.get('purpose', '').lower() or 'tasks' in tool_update.get('purpose', '').lower())):
                            task_tool_event = {
                                'name': tool_update.get('name', 'unknown'),
                                'purpose': tool_update.get('purpose', ''),
                                'status': tool_update.get('status', ''),
                                'type': tool_update.get('type', '')
                            }
                            querying_tasks_events.append(task_tool_event)
                            print(f"🎯 FOUND: Querying TASKS tool_update event - {tool_update.get('name')} for {tool_update.get('purpose')}")
                
            except json.JSONDecodeError as e:
                print(f"⚠️  JSON decode error: {e}")
                continue
        
        print("\n" + "=" * 60)
        print("📊 TEST RESULTS:")
        print("=" * 60)
        
        print(f"🎯 Execution Plan Found: {execution_plan_found}")
        print(f"⟦ Start Marker Found: {execution_plan_start_marker}")
        print(f"⟧ End Marker Found: {execution_plan_end_marker}")
        print(f"🔍 Querying Announcements Found: {len(querying_announcements)}")
        print(f"📋 Querying TASKS Events Found: {len(querying_tasks_events)}")
        print(f"🔧 Tool Update Events Found: {len(tool_update_events)}")
        
        if querying_announcements:
            print("\n📋 Querying Announcements:")
            for i, announcement in enumerate(querying_announcements, 1):
                print(f"  {i}. {announcement}")
        
        if querying_tasks_events:
            print("\n🎯 Querying TASKS Events:")
            for i, event in enumerate(querying_tasks_events, 1):
                if isinstance(event, dict) and 'agent' in event:
                    print(f"  {i}. {event['agent']} -> {event['purpose']}")
                elif isinstance(event, dict) and 'name' in event:
                    print(f"  {i}. {event['name']} -> {event['purpose']} (status: {event['status']})")
                else:
                    print(f"  {i}. {event}")
        
        if tool_update_events:
            print("\n🔧 Tool Update Events:")
            for i, event in enumerate(tool_update_events, 1):
                print(f"  {i}. {event}")
        
        print(f"\n📝 Total Response Chunks: {len(full_response)}")
        print(f"📏 Total Response Length: {sum(len(chunk) for chunk in full_response)} chars")
        
        # Overall test result
        markers_working = execution_plan_start_marker and execution_plan_end_marker
        tasks_querying_working = len(querying_tasks_events) > 0
        print(f"\n🎉 MARKER DETECTION TEST: {'PASSED' if markers_working else 'FAILED'}")
        print(f"🎯 QUERYING TASKS TEST: {'PASSED' if tasks_querying_working else 'FAILED'}")
        print(f"🏆 OVERALL TEST: {'PASSED' if (markers_working and tasks_querying_working) else 'PARTIAL' if (markers_working or tasks_querying_working) else 'FAILED'}")
        
        return {
            'execution_plan_found': execution_plan_found,
            'start_marker_found': execution_plan_start_marker,
            'end_marker_found': execution_plan_end_marker,
            'querying_announcements': len(querying_announcements),
            'querying_tasks_events': len(querying_tasks_events),
            'tool_update_events': len(tool_update_events),
            'total_chunks': len(full_response)
        }
        
    except requests.exceptions.RequestException as e:
        print(f"❌ Request failed: {e}")
        return None
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        return None

if __name__ == "__main__":
    result = test_marker_detection()
    if result:
        print(f"\n📋 Summary: {result}")
