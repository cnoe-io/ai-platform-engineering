# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Unit tests for the get_current_date tool.

Tests cover:
- ISO 8601 format validation
- UTC timezone
- Datetime string parsing
- Consistency checks
- Date components validation
"""

import unittest
from datetime import datetime
from zoneinfo import ZoneInfo
import re
from ai_platform_engineering.multi_agents.tools.get_current_date import get_current_date


class TestGetCurrentDate(unittest.TestCase):
    """Test suite for get_current_date tool."""

    def test_returns_string(self):
        """Test that function returns a string."""
        result = get_current_date.invoke({})

        self.assertIsInstance(result, str)
        print("✓ Returns string type")

    def test_iso8601_format(self):
        """Test that output is in ISO 8601 format."""
        result = get_current_date.invoke({})

        # ISO 8601 format: YYYY-MM-DDTHH:MM:SS+00:00 or YYYY-MM-DDTHH:MM:SS.ffffff+00:00
        iso_pattern = r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(\+00:00|Z)$'
        self.assertIsNotNone(
            re.match(iso_pattern, result),
            f"Date string '{result}' does not match ISO 8601 format"
        )
        print("✓ Returns ISO 8601 format")

    def test_parseable_datetime(self):
        """Test that returned string can be parsed as datetime."""
        result = get_current_date.invoke({})

        try:
            parsed = datetime.fromisoformat(result.replace('Z', '+00:00'))
            self.assertIsInstance(parsed, datetime)
        except ValueError as e:
            self.fail(f"Failed to parse datetime: {e}")

        print("✓ Datetime string is parseable")

    def test_utc_timezone(self):
        """Test that returned datetime is in UTC timezone."""
        result = get_current_date.invoke({})

        # Should end with +00:00 (UTC) or Z
        self.assertTrue(
            result.endswith('+00:00') or result.endswith('Z'),
            f"Date string '{result}' does not indicate UTC timezone"
        )
        print("✓ Returns UTC timezone")

    def test_contains_date_components(self):
        """Test that result contains valid date components."""
        result = get_current_date.invoke({})

        # Parse and verify components
        parsed = datetime.fromisoformat(result.replace('Z', '+00:00'))

        # Verify year is reasonable (2024-2030)
        self.assertGreaterEqual(parsed.year, 2024)
        self.assertLessEqual(parsed.year, 2030)

        # Verify month (1-12)
        self.assertGreaterEqual(parsed.month, 1)
        self.assertLessEqual(parsed.month, 12)

        # Verify day (1-31)
        self.assertGreaterEqual(parsed.day, 1)
        self.assertLessEqual(parsed.day, 31)

        # Verify hour (0-23)
        self.assertGreaterEqual(parsed.hour, 0)
        self.assertLessEqual(parsed.hour, 23)

        # Verify minute (0-59)
        self.assertGreaterEqual(parsed.minute, 0)
        self.assertLessEqual(parsed.minute, 59)

        # Verify second (0-59)
        self.assertGreaterEqual(parsed.second, 0)
        self.assertLessEqual(parsed.second, 59)

        print("✓ Date components are valid")

    def test_consistency_across_calls(self):
        """Test that multiple calls return consistent formats."""
        result1 = get_current_date.invoke({})
        result2 = get_current_date.invoke({})

        # Both should be ISO 8601 format
        iso_pattern = r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}'
        self.assertIsNotNone(re.match(iso_pattern, result1))
        self.assertIsNotNone(re.match(iso_pattern, result2))

        # Should be very close in time (within a few seconds)
        time1 = datetime.fromisoformat(result1.replace('Z', '+00:00'))
        time2 = datetime.fromisoformat(result2.replace('Z', '+00:00'))

        time_diff = abs((time2 - time1).total_seconds())
        self.assertLess(time_diff, 5, "Consecutive calls should be within 5 seconds")

        print("✓ Consistent format across calls")

    def test_current_time_accuracy(self):
        """Test that returned time is close to actual current time."""
        before = datetime.now(ZoneInfo("UTC"))
        result = get_current_date.invoke({})
        after = datetime.now(ZoneInfo("UTC"))

        result_time = datetime.fromisoformat(result.replace('Z', '+00:00'))

        # Result should be between before and after
        self.assertGreaterEqual(result_time, before)
        self.assertLessEqual(result_time, after)

        print("✓ Returns current time accurately")

    def test_contains_t_separator(self):
        """Test that ISO format contains 'T' separator between date and time."""
        result = get_current_date.invoke({})

        self.assertIn('T', result, "ISO 8601 format should contain 'T' separator")
        print("✓ Contains T separator")

    def test_no_microseconds_or_has_microseconds(self):
        """Test that microseconds are handled consistently."""
        result = get_current_date.invoke({})

        # Either has microseconds or doesn't, but format should be valid
        # Pattern with optional microseconds
        pattern_with_micro = r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+'
        pattern_without_micro = r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?!\.\d)'

        has_micro = re.search(pattern_with_micro, result) is not None
        no_micro = re.search(pattern_without_micro, result) is not None

        self.assertTrue(has_micro or no_micro, "Should have valid time format")
        print("✓ Microseconds format is valid")


class TestGetCurrentDateEdgeCases(unittest.TestCase):
    """Test edge cases and special scenarios."""

    def test_midnight_boundary(self):
        """Test that function works correctly near midnight."""
        # This test just ensures no errors occur
        result = get_current_date.invoke({})
        self.assertIsInstance(result, str)
        print("✓ Works at any time of day")

    def test_year_boundary(self):
        """Test that function returns valid year."""
        result = get_current_date.invoke({})
        parsed = datetime.fromisoformat(result.replace('Z', '+00:00'))

        # Year should be 4 digits
        year_str = str(parsed.year)
        self.assertEqual(len(year_str), 4)
        print("✓ Year format is valid")

    def test_timezone_offset(self):
        """Test that timezone offset is correctly represented."""
        result = get_current_date.invoke({})

        # Should have timezone info (either +00:00 or Z)
        self.assertTrue(
            '+00:00' in result or result.endswith('Z'),
            "Should include timezone information"
        )
        print("✓ Timezone offset is present")

    def test_multiple_rapid_calls(self):
        """Test making multiple rapid calls."""
        results = []
        for _ in range(10):
            results.append(get_current_date.invoke({}))

        # All should be valid ISO 8601 strings
        for result in results:
            parsed = datetime.fromisoformat(result.replace('Z', '+00:00'))
            self.assertIsInstance(parsed, datetime)

        # Should be in chronological order or very close
        times = [datetime.fromisoformat(r.replace('Z', '+00:00')) for r in results]
        for i in range(len(times) - 1):
            # Allow for same timestamp or slightly increasing
            self.assertLessEqual(times[i], times[i + 1])

        print("✓ Handles multiple rapid calls")

    def test_different_execution_contexts(self):
        """Test that function works in different contexts."""
        # Direct call
        result1 = get_current_date.invoke({})
        self.assertIsInstance(result1, str)

        # Multiple sequential calls
        result2 = get_current_date.invoke({})
        self.assertIsInstance(result2, str)

        # Both should be valid
        datetime.fromisoformat(result1.replace('Z', '+00:00'))
        datetime.fromisoformat(result2.replace('Z', '+00:00'))

        print("✓ Works in different contexts")


if __name__ == '__main__':
    unittest.main()



