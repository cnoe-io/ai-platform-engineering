# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Token Sanitizer - Centralized credential redaction for all agent output.

Prevents any authentication tokens (GitHub App installation tokens, PATs,
GitLab tokens, JWTs, etc.) from being returned to users in agent responses.

Covers:
- GitHub App installation tokens (ghs_*)
- GitHub PATs (ghp_*, gho_*, ghu_*, ghs_*, ghr_*)
- GitLab tokens (glpat-*)
- Bearer/token auth headers
- x-access-token URLs
- Known token values from environment variables and the GitHub App token provider

Usage:
    from ai_platform_engineering.utils.token_sanitizer import sanitize_output

    # In any agent output path:
    safe_text = sanitize_output(text)
"""

import logging
import os
import re
from typing import List, Optional

logger = logging.getLogger(__name__)

# Placeholder for redacted tokens
REDACTED = "[REDACTED]"

# ---- Pattern-based redaction (catches tokens we don't explicitly know) ----

# GitHub App installation tokens: ghs_ followed by alphanumeric chars
# Full tokens are 36 chars, but partial tokens in logs can be shorter
_GITHUB_INSTALLATION_TOKEN_RE = re.compile(r'ghs_[A-Za-z0-9]{8,}')

# GitHub PATs (classic & fine-grained): ghp_, gho_, ghu_, ghr_ prefix
_GITHUB_PAT_RE = re.compile(r'gh[pousr]_[A-Za-z0-9]{8,}')

# GitLab personal access tokens: glpat- prefix
_GITLAB_PAT_RE = re.compile(r'glpat-[A-Za-z0-9\-_]{8,}')

# Generic Bearer / token auth in headers or output
_BEARER_TOKEN_RE = re.compile(
    r'(Bearer\s+|token\s+)([A-Za-z0-9_\-\.]{20,})',
    re.IGNORECASE,
)

# x-access-token in URLs (GitHub HTTPS auth)
_X_ACCESS_TOKEN_URL_RE = re.compile(
    r'x-access-token:[^@\s]+@'
)

# gitlab-ci-token in URLs (GitLab HTTPS auth)
_GITLAB_CI_TOKEN_URL_RE = re.compile(
    r'gitlab-ci-token:[^@\s]+@'
)

# Authorization header values
_AUTH_HEADER_RE = re.compile(
    r'(Authorization:\s*)(Bearer\s+|token\s+|Basic\s+)([A-Za-z0-9_\-\.=+/]{20,})',
    re.IGNORECASE,
)

# All regex patterns with their replacement strings
_PATTERNS = [
    (_GITHUB_INSTALLATION_TOKEN_RE, REDACTED),
    (_GITHUB_PAT_RE, REDACTED),
    (_GITLAB_PAT_RE, REDACTED),
    (_X_ACCESS_TOKEN_URL_RE, f'x-access-token:{REDACTED}@'),
    (_GITLAB_CI_TOKEN_URL_RE, f'gitlab-ci-token:{REDACTED}@'),
]


def _get_known_tokens() -> List[str]:
    """
    Collect all known token values from environment and the GitHub App provider.

    This ensures that even if a token doesn't match a known prefix pattern,
    it gets redacted if we know its exact value.
    """
    tokens: List[str] = []

    # Env var tokens
    for env_var in [
        "GITHUB_PERSONAL_ACCESS_TOKEN",
        "GITHUB_TOKEN",
        "GH_TOKEN",
        "GITLAB_PERSONAL_ACCESS_TOKEN",
        "GITLAB_TOKEN",
        "GIT_TOKEN",
    ]:
        val = os.getenv(env_var)
        if val and len(val) > 4:
            tokens.append(val)

    # GitHub App installation token (dynamically generated, not in env)
    try:
        from ai_platform_engineering.utils.github_app_token_provider import (
            _get_provider,
        )
        provider = _get_provider()
        if provider and provider._token and len(provider._token) > 4:
            tokens.append(provider._token)
    except (ImportError, Exception):
        pass

    return tokens


def sanitize_output(text: str, extra_tokens: Optional[List[str]] = None) -> str:
    """
    Remove all authentication tokens and credentials from text.

    Applies both:
    1. **Exact-value redaction**: replaces known token values from env vars
       and the GitHub App provider.
    2. **Pattern-based redaction**: catches GitHub (ghs_*, ghp_*, etc.),
       GitLab (glpat-*), Bearer tokens, and auth URLs.

    This function is safe to call on any text — it's fast for short strings
    and handles None/empty gracefully.

    Args:
        text: Text that may contain tokens
        extra_tokens: Additional token strings to redact (optional)

    Returns:
        Sanitized text with all tokens replaced by [REDACTED]
    """
    if not text:
        return text

    logger.debug("Entering token_sanitizer.sanitize_output (input length=%d)", len(text))

    sanitized = text

    # 1. Exact value redaction (known tokens)
    known = _get_known_tokens()
    if extra_tokens:
        known.extend(t for t in extra_tokens if t and len(t) > 4)

    for token in known:
        if token in sanitized:
            sanitized = sanitized.replace(token, REDACTED)

    # 2. Pattern-based redaction
    for pattern, replacement in _PATTERNS:
        sanitized = pattern.sub(replacement, sanitized)

    # 3. Authorization header redaction (preserve header name + scheme)
    sanitized = _AUTH_HEADER_RE.sub(
        lambda m: f"{m.group(1)}{m.group(2)}{REDACTED}",
        sanitized,
    )

    # 4. Bearer/token value redaction (standalone)
    sanitized = _BEARER_TOKEN_RE.sub(
        lambda m: f"{m.group(1)}{REDACTED}",
        sanitized,
    )

    if sanitized != text:
        logger.warning("token_sanitizer: Redacted credential(s) from output (length=%d)", len(text))
    else:
        logger.debug("token_sanitizer: No credentials found in output")

    return sanitized
