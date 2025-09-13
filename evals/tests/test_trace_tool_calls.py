#!/usr/bin/env python3
"""
Interactive test script for testing tool call extraction with different trace IDs.
"""

import os
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
from langfuse import Langfuse
from trace_analysis.extractor import TraceExtractor


def test_trace_tool_calls(trace_id: str):
    """Test tool call extraction for a specific trace ID."""
    
    # Load configuration
    load_dotenv('/home/ubuntu/ai-platform-engineering/.env')
    
    config = {
        'public_key': os.getenv('LANGFUSE_PUBLIC_KEY'),
        'secret_key': os.getenv('LANGFUSE_SECRET_KEY'),
        'host': 'http://localhost:3000'
    }
    
    print(f"🧪 TESTING TOOL CALL EXTRACTION")
    print("="*60)
    print(f"Trace ID: {trace_id}")
    print(f"Host: {config['host']}")
    print()
    
    try:
        # Initialize Langfuse client and TraceExtractor
        langfuse = Langfuse(
            public_key=config['public_key'],
            secret_key=config['secret_key'],
            host=config['host']
        )
        
        extractor = TraceExtractor(langfuse)
        
        # Extract tool calls
        tool_calls = extractor.extract_tool_calls(trace_id)
        
        # Show summary
        print("📊 SUMMARY:")
        print("-" * 30)
        if tool_calls:
            print(f"✅ Successfully extracted {len(tool_calls)} unique tool calls")
            print("\n🎯 AGENT → TOOL MAPPING:")
            for tc in tool_calls:
                print(f"  {tc['agent']} → {tc['tool']}")
                if tc['arguments']:
                    args_str = str(tc['arguments'])[:80] + '...' if len(str(tc['arguments'])) > 80 else str(tc['arguments'])
                    print(f"    Args: {args_str}")
        else:
            print("⚠️  No tool calls found in this trace")
        
        return tool_calls
        
    except Exception as e:
        print(f"❌ Error: {e}")
        return None


def main():
    """Main function to handle command line arguments."""
    
    if len(sys.argv) < 2:
        print("📋 USAGE:")
        print(f"  python {sys.argv[0]} <trace-id>")
        print(f"  python {sys.argv[0]} <trace-id1> <trace-id2> <trace-id3>")
        print()
        print("📝 EXAMPLES:")
        print("  # GitHub agent trace")
        print(f"  python {sys.argv[0]} a611481ab405d927a23626f3ffbd2bbc")
        print()
        print("  # Confluence agent trace") 
        print(f"  python {sys.argv[0]} 2b622b7dffffbc7aab85d2e8a2560092")
        print()
        print("  # ArgoCD agent trace")
        print(f"  python {sys.argv[0]} ad266835b287238e52cb077f9a87fc05")
        print()
        print("  # Test multiple traces")
        print(f"  python {sys.argv[0]} a611481ab405d927a23626f3ffbd2bbc 2b622b7dffffbc7aab85d2e8a2560092")
        return 1
    
    # Test each provided trace ID
    for i, trace_id in enumerate(sys.argv[1:], 1):
        if i > 1:
            print("\n" + "="*60)
        
        result = test_trace_tool_calls(trace_id)
        
        if not result:
            print(f"❌ Failed to extract tool calls from trace {trace_id}")
    
    return 0


if __name__ == "__main__":
    exit(main())