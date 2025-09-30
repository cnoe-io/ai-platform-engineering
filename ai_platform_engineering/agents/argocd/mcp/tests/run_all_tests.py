#!/usr/bin/env python3
"""
Test runner script to execute all mcp_argocd tests
"""

import sys
import os
import subprocess
from pathlib import Path

def run_test_file(test_file):
    """Run a single test file and return the result"""
    print(f"\n{'=' * 60}")
    print(f"Running {test_file}")
    print(f"{'=' * 60}")

    try:
        result = subprocess.run(
            [sys.executable, test_file],
            cwd=os.path.dirname(test_file),
            capture_output=True,
            text=True,
            timeout=30
        )

        print(result.stdout)
        if result.stderr:
            print("STDERR:", result.stderr)

        if result.returncode == 0:
            print(f"✅ {os.path.basename(test_file)} PASSED")
            return True
        else:
            print(f"❌ {os.path.basename(test_file)} FAILED (exit code: {result.returncode})")
            return False

    except subprocess.TimeoutExpired:
        print(f"⏰ {os.path.basename(test_file)} TIMED OUT")
        return False
    except Exception as e:
        print(f"💥 {os.path.basename(test_file)} ERROR: {e}")
        return False

def main():
    """Run all test files in the tests directory"""

    # Get the directory containing this script
    tests_dir = Path(__file__).parent

    # Find all test files
    test_files = list(tests_dir.glob("test_*.py"))
    test_files = [f for f in test_files if f.name != "run_all_tests.py"]

    if not test_files:
        print("No test files found!")
        return 1

    print(f"Found {len(test_files)} test files:")
    for test_file in test_files:
        print(f"  - {test_file.name}")

    # Run all tests
    passed = 0
    failed = 0

    for test_file in sorted(test_files):
        if run_test_file(str(test_file)):
            passed += 1
        else:
            failed += 1

    # Print summary
    print(f"\n{'=' * 60}")
    print("TEST SUMMARY")
    print(f"{'=' * 60}")
    print(f"Total tests: {len(test_files)}")
    print(f"Passed: {passed} ✅")
    print(f"Failed: {failed} ❌")

    if failed == 0:
        print("\n🎉 All tests passed!")
        return 0
    else:
        print(f"\n💔 {failed} test(s) failed!")
        return 1

if __name__ == "__main__":
    sys.exit(main())
