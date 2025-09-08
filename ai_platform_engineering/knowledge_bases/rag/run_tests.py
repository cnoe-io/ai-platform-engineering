#!/usr/bin/env python3
"""
Test runner script for RAG server tests.
"""
import sys
import subprocess
import os
from pathlib import Path

def main():
    """Run the test suite."""
    # Get the directory containing this script
    script_dir = Path(__file__).parent

    # Change to the RAG directory
    os.chdir(script_dir)

    # Run pytest with appropriate options
    cmd = [
        sys.executable, "-m", "pytest",
        "tests/",
        "-v",
        "--tb=short",
        "--disable-warnings",
        "--maxfail=1",
        "--asyncio-mode=auto",
        "--cov=server",
        "--cov-report=term",
        "--cov-report=xml"
    ]

    print(f"Running tests from: {script_dir}")
    print(f"Command: {' '.join(cmd)}")
    print("-" * 50)

    try:
        subprocess.run(cmd, check=True)
        print("\n✅ All tests passed!")
        return 0
    except subprocess.CalledProcessError as e:
        print(f"\n❌ Tests failed with exit code: {e.returncode}")
        return e.returncode
    except Exception as e:
        print(f"\n❌ Error running tests: {e}")
        return 1

if __name__ == "__main__":
    sys.exit(main())
