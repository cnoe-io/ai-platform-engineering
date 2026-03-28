"""Test configuration and fixtures for Webex bot tests."""

import os
import sys

# Add the webex_bot directory to sys.path so non-relative imports work
# (e.g., from utils.config import load_config, from a2a_client import A2AClient)
webex_bot_dir = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, os.path.abspath(webex_bot_dir))
