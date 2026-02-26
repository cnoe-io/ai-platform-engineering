# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
Pytest configuration.
Provides fixtures and default setup for all tests.
"""

import os

# Set env vars BEFORE pytest collects tests (which imports modules at collection time)
os.environ["CAIPE_URL"] = "http://localhost:8000"
os.environ["SLACK_INTEGRATION_BOT_TOKEN"] = "xoxb-test-token"
os.environ["SLACK_INTEGRATION_BOT_CONFIG"] = """
C123:
  name: "#test-channel"
  ai_enabled: "true"
  qanda:
    enabled: "false"
  ai_alerts:
    enabled: "false"
  default:
    project_key: TEST
"""
os.environ["SLACK_INTEGRATION_SILENCE_ENV"] = "false"
