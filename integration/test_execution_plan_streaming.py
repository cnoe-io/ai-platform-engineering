#!/usr/bin/env python3
"""
AI Platform Engineering - Execution Plan Streaming Test
Purpose: Test the execution plan system prompt functionality with streaming tokens
"""

import requests
import json
import time
import sys
from datetime import datetime

# Configuration
PLATFORM_URL = "http://localhost:8000"
TIMEOUT = 30

def test_execution_plan_streaming(test_name, query, expected_patterns):
    """Test execution plan creation and streaming response"""
    print(f"\n🧪 Testing: {test_name}")
    print(f"📝 Query: {query}")
    print("="*80)
    
    # Prepare request
    test_id = f"exec-plan-test-{int(time.time())}"
    payload = {
        "id": test_id,
        "method": "message/stream",
        "params": {
            "message": {
                "role": "user",
                "parts": [{"kind": "text", "text": query}],
                "messageId": f"msg-{test_id}"
            }
        }
    }
    
    headers = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream"
    }
    
    try:
        print("🔄 Sending request...")
        response = requests.post(
            PLATFORM_URL, 
            json=payload, 
            headers=headers, 
            timeout=TIMEOUT,
            stream=True
        )
        
        if response.status_code != 200:
            print(f"❌ HTTP Error: {response.status_code}")
            return False
            
        print("✅ Connection established, reading stream...")
        
        # Collect streaming response
        full_response = ""
        execution_plan_found = False
        markdown_checklist_found = False
        write_todos_called = False
        
        for line in response.iter_lines(decode_unicode=True):
            if line and line.startswith('data: '):
                try:
                    data = json.loads(line[6:])  # Remove 'data: ' prefix
                    
                    # Debug: print raw response structure
                    if 'result' in data:
                        result = data['result']
                        if 'artifacts' in result:
                            for artifact in result['artifacts']:
                                if 'parts' in artifact:
                                    for part in artifact['parts']:
                                        if part.get('kind') == 'text':
                                            content = part.get('text', '')
                                            if content:
                                                full_response += content
                                                print(content, end='', flush=True)
                                                
                                                # Check for execution plan patterns
                                                if ("Execution Plan" in content or 
                                                    "write_todos" in content or
                                                    "## " in content):
                                                    execution_plan_found = True
                                                    
                                                if "- [ ]" in content or "- [x]" in content:
                                                    markdown_checklist_found = True
                                                
                                                if "write_todos" in content:
                                                    write_todos_called = True
                    
                    # Also check params format
                    if 'params' in data:
                        params = data['params']
                        if 'artifacts' in params:
                            for artifact in params['artifacts']:
                                if 'parts' in artifact:
                                    for part in artifact['parts']:
                                        if part.get('kind') == 'text':
                                            content = part.get('text', '')
                                            if content:
                                                full_response += content
                                                print(content, end='', flush=True)
                                                
                                                if ("Execution Plan" in content or 
                                                    "write_todos" in content or
                                                    "## " in content):
                                                    execution_plan_found = True
                                                    
                                                if "- [ ]" in content or "- [x]" in content:
                                                    markdown_checklist_found = True
                                                
                                                if "write_todos" in content:
                                                    write_todos_called = True
                            
                except json.JSONDecodeError:
                    continue
                except KeyError:
                    continue
        
        print(f"\n\n📊 Test Results for: {test_name}")
        print("-"*50)
        
        # Analyze results
        results = {
            "execution_plan_created": execution_plan_found,
            "markdown_checklist_used": markdown_checklist_found,
            "write_todos_called": write_todos_called,
            "response_length": len(full_response),
            "contains_expected_patterns": []
        }
        
        # Check for expected patterns
        for pattern in expected_patterns:
            if pattern.lower() in full_response.lower():
                results["contains_expected_patterns"].append(pattern)
        
        # Print detailed results
        print(f"✅ Execution Plan Created: {execution_plan_found}")
        print(f"✅ Markdown Checklist Used: {markdown_checklist_found}")
        print(f"🔧 write_todos Called: {write_todos_called}")
        print(f"📏 Response Length: {len(full_response)} characters")
        print(f"🎯 Expected Patterns Found: {len(results['contains_expected_patterns'])}/{len(expected_patterns)}")
        
        for pattern in expected_patterns:
            found = pattern.lower() in full_response.lower()
            print(f"   {'✅' if found else '❌'} {pattern}")
        
        # Overall success criteria
        success = (
            (execution_plan_found or write_todos_called) and 
            len(results["contains_expected_patterns"]) >= len(expected_patterns) * 0.5
        )
        
        print(f"\n🏆 Overall Result: {'PASS ✅' if success else 'FAIL ❌'}")
        
        return success, results, full_response
        
    except requests.exceptions.Timeout:
        print("❌ Request timed out")
        return False, {}, ""
    except requests.exceptions.ConnectionError:
        print("❌ Connection error - is the platform running?")
        return False, {}, ""
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        return False, {}, ""

def main():
    print("🚀 AI Platform Engineering - Execution Plan Streaming Test")
    print(f"⏰ Started at: {datetime.now()}")
    print(f"🌐 Testing platform at: {PLATFORM_URL}")
    print("="*80)
    
    # Test cases covering different request types from the system prompt
    test_cases = [
        {
            "name": "Operational Request - Get Deployment Status",
            "query": "Get the status of all ArgoCD applications in production",
            "expected_patterns": [
                "Execution Plan",
                "- [ ]",
                "ArgoCD",
                "applications",
                "status"
            ]
        },
        {
            "name": "Analytical Request - Get Incident Summary", 
            "query": "Get a summary of all PagerDuty incidents from last week",
            "expected_patterns": [
                "Execution Plan",
                "- [ ]",
                "PagerDuty",
                "incidents", 
                "summary"
            ]
        },
        {
            "name": "Documentation Request - Get Policy Info",
            "query": "Get information about our ArgoCD sync policies",
            "expected_patterns": [
                "Execution Plan",
                "- [ ]",
                "RAG",
                "ArgoCD",
                "sync"
            ]
        },
        {
            "name": "Multi-Agent Request - Get Infrastructure Overview",
            "query": "Get an overview of our AWS infrastructure and current monitoring alerts",
            "expected_patterns": [
                "Execution Plan", 
                "- [ ]",
                "AWS",
                "monitoring",
                "infrastructure"
            ]
        }
    ]
    
    results = []
    
    for test_case in test_cases:
        success, test_results, response = test_execution_plan_streaming(
            test_case["name"],
            test_case["query"], 
            test_case["expected_patterns"]
        )
        
        results.append({
            "name": test_case["name"],
            "success": success,
            "results": test_results,
            "response_preview": response[:200] + "..." if len(response) > 200 else response
        })
        
        # Wait between tests
        time.sleep(2)
    
    # Final summary
    print("\n" + "="*80)
    print("📋 FINAL TEST SUMMARY")
    print("="*80)
    
    passed = sum(1 for r in results if r["success"])
    total = len(results)
    
    print(f"🎯 Tests Passed: {passed}/{total}")
    print(f"📊 Success Rate: {(passed/total)*100:.1f}%")
    print()
    
    for result in results:
        status = "✅ PASS" if result["success"] else "❌ FAIL"
        print(f"{status} - {result['name']}")
    
    if passed == total:
        print("\n🎉 ALL TESTS PASSED! The execution plan system prompt is working correctly.")
    else:
        print("\n⚠️  Some tests failed. Check the system prompt configuration.")
    
    print(f"\n⏰ Completed at: {datetime.now()}")

if __name__ == "__main__":
    main()
