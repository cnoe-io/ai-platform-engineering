# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""Authentication utilities.

Spec 102 (T021): re-exports the canonical Python RBAC helper so call sites can
write `from ai_platform_engineering.utils.auth import require_rbac_permission`.
"""

from ai_platform_engineering.utils.auth.audit import log_authz_decision
from ai_platform_engineering.utils.auth.jwks_validate import (
    InvalidTokenError,
    validate_bearer_jwt,
)
from ai_platform_engineering.utils.auth.keycloak_authz import (
    AuthzDecision,
    AuthzReason,
    current_bearer_token,
    require_rbac_permission,
    require_rbac_permission_dep,
)
from ai_platform_engineering.utils.auth.realm_extras import get_fallback_rule

__all__ = [
    "AuthzDecision",
    "AuthzReason",
    "InvalidTokenError",
    "current_bearer_token",
    "get_fallback_rule",
    "log_authz_decision",
    "require_rbac_permission",
    "require_rbac_permission_dep",
    "validate_bearer_jwt",
]
