# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

"""Pytest configuration for autonomous_agents tests.

Strips environment variables that ``Settings`` reads via
``pydantic-settings`` so test outcomes only depend on values the test
itself supplies. Without this, a developer who has ``WEBEX_BOT_TOKEN``,
``LLM_PROVIDER``, ``CORS_ORIGINS``, etc. exported in their shell sees
spurious failures in tests that construct ``Settings()`` with no args.

Removed BEFORE any tests are collected so module-level ``Settings()``
calls (e.g. in ``get_settings()`` caches) see a clean environment.
"""

import os

_ENV_VARS_TO_STRIP = (
    "LLM_PROVIDER",
    "SUPERVISOR_URL",
    "DYNAMIC_AGENTS_URL",
    "DYNAMIC_AGENTS_SYSTEM_EMAIL",
    "DYNAMIC_AGENTS_TIMEOUT_SECONDS",
    "DYNAMIC_AGENTS_PREFLIGHT_TIMEOUT_SECONDS",
    "WEBHOOK_SECRET",
    "WEBHOOK_REPLAY_WINDOW_SECONDS",
    "WEBHOOK_PROVIDERS_FILE",
    "CORS_ORIGINS",
    "AUTONOMOUS_CORS_ORIGINS",
    "MONGODB_URI",
    "MONGODB_DATABASE",
    "WEBEX_BOT_TOKEN",
    "WEBEX_WEBHOOK_SECRET",
    "WEBEX_BOT_PUBLIC_URL",
    "WEBEX_API_BASE",
    "WEBEX_HTTP_TIMEOUT_SECONDS",
    "CHAT_HISTORY_PUBLISH_ENABLED",
    "CHAT_HISTORY_INCLUDE_CONTEXT",
    "CIRCUIT_BREAKER_ENABLED",
    "CIRCUIT_BREAKER_FAILURE_THRESHOLD",
    "CIRCUIT_BREAKER_COOLDOWN_SECONDS",
    "A2A_TIMEOUT_SECONDS",
    "A2A_MAX_RETRIES",
    "A2A_RETRY_BACKOFF_INITIAL_SECONDS",
    "A2A_RETRY_BACKOFF_MAX_SECONDS",
)

for _var in _ENV_VARS_TO_STRIP:
    os.environ.pop(_var, None)
