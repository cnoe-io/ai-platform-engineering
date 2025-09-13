#!/usr/bin/env python3
"""
Utility script to save trace structures to JSON files for analysis.
"""

import os
import json
import sys
from datetime import datetime
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
from langfuse import Langfuse


def save_trace_to_file(trace_id: str, output_format: str = 'json', output_dir: str = None):
    """Save trace structure to file."""
    
    # Load configuration
    load_dotenv('/home/ubuntu/ai-platform-engineering/.env')
    
    config = {
        'public_key': os.getenv('LANGFUSE_PUBLIC_KEY'),
        'secret_key': os.getenv('LANGFUSE_SECRET_KEY'),
        'host': os.getenv('LANGFUSE_HOST', 'http://localhost:3000')
    }
    
    print(f"💾 SAVING TRACE TO FILE")
    print("="*50)
    print(f"Trace ID: {trace_id}")
    print(f"Format: {output_format}")
    print(f"Host: {config['host']}")
    
    try:
        # Initialize Langfuse client
        langfuse = Langfuse(
            public_key=config['public_key'],
            secret_key=config['secret_key'],
            host=config['host']
        )
        
        print("\n🔍 Fetching trace...")
        trace = langfuse.api.trace.get(trace_id)
        
        if not trace:
            print(f"❌ Trace not found: {trace_id}")
            return None
            
        print("✅ Trace fetched successfully!")
        
        # Convert to dict
        if hasattr(trace, 'dict'):
            trace_dict = trace.dict()
        elif hasattr(trace, 'model_dump'):
            trace_dict = trace.model_dump()
        else:
            trace_dict = trace.__dict__
        
        # Determine output directory
        if output_dir:
            os.makedirs(output_dir, exist_ok=True)
        else:
            output_dir = '.'
        
        # Generate filename
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = os.path.join(output_dir, f"trace_{trace_id}_{timestamp}.{output_format}")
        
        print(f"\n💾 Saving to: {filename}")
        
        if output_format == 'json':
            # Save as pretty JSON
            with open(filename, 'w', encoding='utf-8') as f:
                json.dump(trace_dict, f, indent=2, default=str, ensure_ascii=False)
                
        elif output_format == 'compact':
            # Save as compact JSON (one line)
            with open(filename, 'w', encoding='utf-8') as f:
                json.dump(trace_dict, f, default=str, ensure_ascii=False)
                
        elif output_format == 'txt':
            # Save as formatted text
            with open(filename, 'w', encoding='utf-8') as f:
                f.write(f"LANGFUSE TRACE STRUCTURE\\n")
                f.write(f"{'='*50}\\n\\n")
                f.write(f"Trace ID: {trace_id}\\n")
                f.write(f"Retrieved: {datetime.now().isoformat()}\\n")
                f.write(f"Host: {config['host']}\\n\\n")
                f.write("JSON STRUCTURE:\\n")
                f.write("-" * 30 + "\\n")
                f.write(json.dumps(trace_dict, indent=2, default=str, ensure_ascii=False))
        
        # Show file info
        file_size = os.path.getsize(filename)
        print(f"✅ File saved successfully!")
        print(f"📂 File: {filename}")
        print(f"📏 Size: {file_size:,} bytes")
        
        # Show trace summary
        print(f"\\n📊 TRACE SUMMARY:")
        print(f"   ID: {trace_dict.get('id', 'N/A')}")
        print(f"   Name: {trace_dict.get('name', 'N/A')}")
        observations = trace_dict.get('observations', [])
        scores = trace_dict.get('scores', [])
        print(f"   Observations: {len(observations)}")
        print(f"   Scores: {len(scores)}")
        if 'totalCost' in trace_dict:
            print(f"   Total Cost: ${trace_dict['totalCost']}")
        if 'latency' in trace_dict:
            print(f"   Latency: {trace_dict['latency']}s")
        
        return filename
        
    except Exception as e:
        print(f"❌ Error: {e}")
        return None


def main():
    """Main function."""
    
    if len(sys.argv) < 2:
        print("📋 USAGE:")
        print(f"  python {sys.argv[0]} <trace-id> [format] [output-dir]")
        print()
        print("📝 FORMATS:")
        print("  json    - Pretty-printed JSON (default)")
        print("  compact - Single-line JSON")
        print("  txt     - Formatted text with JSON")
        print()
        print("📁 OUTPUT DIRECTORY:")
        print("  Optional directory to save files (default: current directory)")
        print()
        print("📝 EXAMPLES:")
        print(f"  python {sys.argv[0]} a611481ab405d927a23626f3ffbd2bbc")
        print(f"  python {sys.argv[0]} a611481ab405d927a23626f3ffbd2bbc json ./traces")
        print(f"  python {sys.argv[0]} 2b622b7dffffbc7aab85d2e8a2560092 compact")
        return 1
    
    trace_id = sys.argv[1]
    output_format = sys.argv[2] if len(sys.argv) > 2 else 'json'
    output_dir = sys.argv[3] if len(sys.argv) > 3 else None
    
    if output_format not in ['json', 'compact', 'txt']:
        print("❌ Invalid format. Use: json, compact, or txt")
        return 1
    
    filename = save_trace_to_file(trace_id, output_format, output_dir)
    
    if filename:
        print(f"\\n🎉 SUCCESS! Trace saved to: {filename}")
        return 0
    else:
        return 1


if __name__ == "__main__":
    exit(main())