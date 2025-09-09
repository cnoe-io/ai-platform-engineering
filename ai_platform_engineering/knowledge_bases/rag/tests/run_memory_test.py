#!/usr/bin/env python3
"""
Simple script to run the memory optimization test.
"""

import subprocess
import sys
import os

def run_test():
    """Run the memory optimization test"""

    # Get the directory of this script
    script_dir = os.path.dirname(os.path.abspath(__file__))
    test_file = os.path.join(script_dir, "platform_docs_memory_optimization.py")

    print("🚀 Running Memory Optimization Test for Outshift Platform Documentation")
    print("=" * 80)
    print()

    try:
        # Run the test
        result = subprocess.run([sys.executable, test_file],
                              capture_output=False,
                              text=True,
                              cwd=os.path.dirname(script_dir))

        if result.returncode == 0:
            print("\n✅ Test completed successfully!")
        else:
            print(f"\n❌ Test failed with return code: {result.returncode}")

    except Exception as e:
        print(f"\n❌ Error running test: {e}")

if __name__ == "__main__":
    run_test()
