# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

"""Pytest configuration for autonomous_agents tests.

Isolates ``Settings`` from the developer's shell so test outcomes only
depend on values the test itself supplies. Two layers of defence:

1. Strip every env var ``Settings`` can read from ``os.environ`` so a
   shell that has e.g. ``WEBEX_BOT_TOKEN`` exported does not leak in.
2. Disable the dotenv source on ``Settings.model_config`` so a stray
   ``.env`` in the developer's shell cwd does not leak in either.

Both run BEFORE pytest collects tests so module-level ``Settings()``
calls (including any ``@lru_cache``d ``get_settings()``) see a clean
configuration.
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
    "HOST",
    "PORT",
    "DEBUG",
)

for _var in _ENV_VARS_TO_STRIP:
    os.environ.pop(_var, None)

from autonomous_agents import config as _config  # noqa: E402

_config.Settings.model_config = {
    **_config.Settings.model_config,
    "env_file": None,
    "env_file_encoding": None,
}
_config.get_settings.cache_clear()
