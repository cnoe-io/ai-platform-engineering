#!/usr/bin/env python3
"""
Test script to demonstrate TraceExtractor functionality.
"""

import os
import sys
from dotenv import load_dotenv
from langfuse import Langfuse
from trace_analysis.extractor import TraceExtractor

def main():
    """Test the TraceExtractor with a sample trace ID."""
    
    # Load environment variables
    load_dotenv()
    
    # Check if Langfuse credentials are configured
    public_key = os.getenv("LANGFUSE_PUBLIC_KEY")
    secret_key = os.getenv("LANGFUSE_SECRET_KEY")
    host = os.getenv("LANGFUSE_HOST", "https://cloud.langfuse.com")
    
    if not public_key or not secret_key:
        print("❌ Langfuse credentials not configured!")
        print("\nPlease set the following environment variables:")
        print("  LANGFUSE_PUBLIC_KEY=pk-lf-...")
        print("  LANGFUSE_SECRET_KEY=sk-lf-...")
        print("  LANGFUSE_HOST=https://cloud.langfuse.com  # optional")
        print("\nYou can:")
        print("  1. Set them in .env file")
        print("  2. Export them in your shell")
        print("  3. Pass them as arguments to this script")
        return 1
    
    print(f"🔗 Connecting to Langfuse at: {host}")
    
    try:
        # Initialize Langfuse client
        langfuse = Langfuse(
            public_key=public_key,
            secret_key=secret_key,
            host=host
        )
        
        # Initialize TraceExtractor
        extractor = TraceExtractor(langfuse)
        
        # Get trace ID from command line or use a test ID
        if len(sys.argv) > 1:
            trace_id = sys.argv[1]
            print(f"📋 Using provided trace ID: {trace_id}")
        else:
            print("🔍 No trace ID provided. To test with a real trace:")
            print(f"  python {sys.argv[0]} <your-trace-id>")
            print("\n💡 For now, let's test with a dummy trace ID to show the error handling...")
            trace_id = "test-trace-id-that-does-not-exist"
        
        print(f"\n🚀 Testing TraceExtractor.get_trace() with ID: {trace_id}")
        print("=" * 80)
        
        # Test the get_trace method
        trace = extractor.get_trace(trace_id)
        
        if trace:
            print("\n✅ Test completed successfully!")
            print(f"📊 Trace object type: {type(trace)}")
        else:
            print("\n⚠️  No trace found (expected for test ID)")
            
    except Exception as e:
        print(f"\n❌ Error during testing: {e}")
        return 1
    
    return 0

if __name__ == "__main__":
    exit(main())