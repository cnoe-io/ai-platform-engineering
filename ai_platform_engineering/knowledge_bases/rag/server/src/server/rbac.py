"""
Role-Based Access Control (RBAC) implementation for the RAG API.

Role Hierarchy:
- READONLY: Can view/query all data
- INGESTONLY: READONLY + can ingest data and manage ingestion jobs
- ADMIN: INGESTONLY + can delete resources and perform bulk operations

This module provides:
- User context extraction from authentication proxy headers (X-Forwarded-*)
- Role determination from group membership
- FastAPI dependencies for role-based endpoint protection
- Extensible design for future full RBAC system
"""
import os
import re
from typing import List
from fastapi import Depends, HTTPException, Request
from common.models.rbac import Role, UserContext
from common import utils

logger = utils.get_logger(__name__)

# Email validation regex (RFC 5322 simplified)
EMAIL_REGEX = re.compile(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$')

# ============================================================================
# Configuration
# ============================================================================

# Environment variables for RBAC configuration
RBAC_READONLY_GROUPS = os.getenv("RBAC_READONLY_GROUPS", "").split(",")
RBAC_INGESTONLY_GROUPS = os.getenv("RBAC_INGESTONLY_GROUPS", "").split(",")
RBAC_ADMIN_GROUPS = os.getenv("RBAC_ADMIN_GROUPS", "").split(",")

# Default role for authenticated users (those with OAuth headers) who don't match any group
RBAC_DEFAULT_AUTHENTICATED_ROLE = os.getenv("RBAC_DEFAULT_AUTHENTICATED_ROLE", Role.READONLY)

# Default role for unauthenticated requests (no OAuth headers)
# If empty string, unauthenticated requests are rejected with 401
# If set to a role (readonly/ingestonly/admin), unauthenticated requests get that role
RBAC_DEFAULT_UNAUTHENTICATED_ROLE = os.getenv("RBAC_DEFAULT_UNAUTHENTICATED_ROLE", Role.ADMIN)

# Validate roles at startup
VALID_ROLES = {Role.READONLY, Role.INGESTONLY, Role.ADMIN}

if RBAC_DEFAULT_AUTHENTICATED_ROLE not in VALID_ROLES:
    logger.error(f"Invalid RBAC_DEFAULT_AUTHENTICATED_ROLE: '{RBAC_DEFAULT_AUTHENTICATED_ROLE}'. Must be one of: {VALID_ROLES}")
    raise ValueError(f"Invalid RBAC_DEFAULT_AUTHENTICATED_ROLE: '{RBAC_DEFAULT_AUTHENTICATED_ROLE}'. Valid values are: {', '.join(VALID_ROLES)}")

if RBAC_DEFAULT_UNAUTHENTICATED_ROLE and RBAC_DEFAULT_UNAUTHENTICATED_ROLE not in VALID_ROLES:
    logger.error(f"Invalid RBAC_DEFAULT_UNAUTHENTICATED_ROLE: '{RBAC_DEFAULT_UNAUTHENTICATED_ROLE}'. Must be empty or one of: {VALID_ROLES}")
    raise ValueError(f"Invalid RBAC_DEFAULT_UNAUTHENTICATED_ROLE: '{RBAC_DEFAULT_UNAUTHENTICATED_ROLE}'. Valid values are: empty string or {', '.join(VALID_ROLES)}")

# Determine if unauthenticated access is allowed
ALLOW_UNAUTHENTICATED = bool(RBAC_DEFAULT_UNAUTHENTICATED_ROLE)

logger.info("RBAC Configuration:")
logger.info(f"  RBAC_READONLY_GROUPS: {[g for g in RBAC_READONLY_GROUPS if g.strip()]}")
logger.info(f"  RBAC_INGESTONLY_GROUPS: {[g for g in RBAC_INGESTONLY_GROUPS if g.strip()]}")
logger.info(f"  RBAC_ADMIN_GROUPS: {[g for g in RBAC_ADMIN_GROUPS if g.strip()]}")
logger.info(f"  RBAC_DEFAULT_AUTHENTICATED_ROLE: {RBAC_DEFAULT_AUTHENTICATED_ROLE}")
logger.info(f"  RBAC_DEFAULT_UNAUTHENTICATED_ROLE: {RBAC_DEFAULT_UNAUTHENTICATED_ROLE if RBAC_DEFAULT_UNAUTHENTICATED_ROLE else '(disabled - will reject unauthenticated requests)'}")
logger.info(f"  Unauthenticated access allowed: {ALLOW_UNAUTHENTICATED}")

# ============================================================================
# Role Hierarchy and Permission Logic
# ============================================================================

# Define role hierarchy (higher number = more permissions, inherits lower)
_ROLE_HIERARCHY = {
    Role.READONLY: 1,
    Role.INGESTONLY: 2,
    Role.ADMIN: 3,
}


def has_permission(user_role: str, required_role: str) -> bool:
    """
    Check if a user's role has sufficient permissions for the required role.
    
    Roles are hierarchical - higher roles inherit permissions from lower roles.
    
    Args:
        user_role: The user's current role
        required_role: The minimum required role for the operation
        
    Returns:
        True if user has sufficient permissions, False otherwise
        
    Examples:
        has_permission(Role.ADMIN, Role.READONLY) -> True
        has_permission(Role.INGESTONLY, Role.READONLY) -> True
        has_permission(Role.READONLY, Role.ADMIN) -> False
    """
    user_level = _ROLE_HIERARCHY.get(user_role, 0)
    required_level = _ROLE_HIERARCHY.get(required_role, 0)
    return user_level >= required_level


def get_permissions(user_role: str) -> List[str]:
    """
    Get all permissions the user has based on their role.
    
    Permissions are hierarchical based on role:
    - READONLY: ["read"]
    - INGESTONLY: ["read", "ingest"]
    - ADMIN: ["read", "ingest", "delete"]
    
    Args:
        user_role: The user's current role
        
    Returns:
        List of permission strings (without "can_" prefix)
        
    Examples:
        get_permissions(Role.READONLY) -> ["read"]
        get_permissions(Role.INGESTONLY) -> ["read", "ingest"]
        get_permissions(Role.ADMIN) -> ["read", "ingest", "delete"]
    """
    permissions = []
    
    # All roles can read
    if has_permission(user_role, Role.READONLY):
        permissions.append("read")
    
    # INGESTONLY and ADMIN can ingest
    if has_permission(user_role, Role.INGESTONLY):
        permissions.append("ingest")
    
    # Only ADMIN can delete
    if has_permission(user_role, Role.ADMIN):
        permissions.append("delete")
    
    return permissions


def determine_role_from_groups(user_groups: List[str]) -> str:
    """
    Determine user's role based on their group membership.
    
    Priority order (most permissive wins):
    1. ADMIN groups
    2. INGESTONLY groups
    3. READONLY groups
    4. Default role
    
    Args:
        user_groups: List of groups the user belongs to
        
    Returns:
        Role string (Role.READONLY, Role.INGESTONLY, or Role.ADMIN)
    """
    # Clean up empty strings from config
    readonly_groups = [g.strip() for g in RBAC_READONLY_GROUPS if g.strip()]
    ingestonly_groups = [g.strip() for g in RBAC_INGESTONLY_GROUPS if g.strip()]
    admin_groups = [g.strip() for g in RBAC_ADMIN_GROUPS if g.strip()]
    
    # Most permissive role wins
    if any(group in admin_groups for group in user_groups):
        matching_groups = [g for g in user_groups if g in admin_groups]
        logger.info(f"Role determination: Assigned ADMIN role based on group membership: {matching_groups}")
        return Role.ADMIN
    
    if any(group in ingestonly_groups for group in user_groups):
        matching_groups = [g for g in user_groups if g in ingestonly_groups]
        logger.info(f"Role determination: Assigned INGESTONLY role based on group membership: {matching_groups}")
        return Role.INGESTONLY
    
    if any(group in readonly_groups for group in user_groups):
        matching_groups = [g for g in user_groups if g in readonly_groups]
        logger.info(f"Role determination: Assigned READONLY role based on group membership: {matching_groups}")
        return Role.READONLY
    
    logger.info(f"Role determination: No group match found, assigned default authenticated role: {RBAC_DEFAULT_AUTHENTICATED_ROLE}")
    return RBAC_DEFAULT_AUTHENTICATED_ROLE


# ============================================================================
# FastAPI Dependencies
# ============================================================================

async def get_current_user(request: Request) -> UserContext:
    """
    Extract user context from authentication proxy headers.
    
    The authentication proxy sets these headers:
    - X-Forwarded-Email: user email
    - X-Forwarded-Groups: comma-separated list of groups
    - X-Forwarded-User: username (fallback if no email)
    
    If RBAC_DEFAULT_UNAUTHENTICATED_ROLE is set and no headers are present,
    returns an unauthenticated user context with the specified role
    (for service-to-service communication).
    
    Args:
        request: FastAPI request object
        
    Returns:
        UserContext with authentication and role information
        
    Raises:
        HTTPException(401): If authentication is required but not provided
    """
    # Debug: Log all request headers
    logger.debug("=== Request Headers ===")
    for header_name, header_value in request.headers.items():
        if header_name.lower().startswith("x-forwarded-"):
            logger.debug(f"  {header_name}: {header_value}")
    logger.debug("======================")
    
    user_email = request.headers.get("X-Forwarded-Email")
    user_groups_raw = request.headers.get("X-Forwarded-Groups", "")
    user_groups = [g.strip() for g in user_groups_raw.split(",") if g.strip()]
    
    if not user_email:
        # No authentication headers present
        if ALLOW_UNAUTHENTICATED:
            logger.debug(f"Unauthenticated request allowed with role: {RBAC_DEFAULT_UNAUTHENTICATED_ROLE}")
            return UserContext(
                email="unauthenticated",
                groups=[],
                role=RBAC_DEFAULT_UNAUTHENTICATED_ROLE,
                is_authenticated=False
            )
        else:
            logger.warning("Authentication required but not provided (RBAC_DEFAULT_UNAUTHENTICATED_ROLE not set)")
            raise HTTPException(
                status_code=401,
                detail="Authentication required. Please ensure you are logged in through the authentication proxy."
            )
    
    # Validate email format
    user_email = user_email.strip()
    if not user_email or not EMAIL_REGEX.match(user_email):
        logger.warning(f"Invalid email format received: {user_email[:50]}")  # Truncate for logging
        raise HTTPException(
            status_code=401,
            detail="Authentication failed. Invalid email format received from authentication proxy."
        )
    
    # Determine role from groups
    role = determine_role_from_groups(user_groups)
    
    user_context = UserContext(
        email=user_email,
        groups=user_groups,
        role=role,
        is_authenticated=True
    )
    
    logger.debug(f"User authenticated: {user_email}, role: {role}, groups: {user_groups}")
    return user_context


def require_role(required_role: str):
    """
    Factory function to create role-checking dependencies.
    
    This is the recommended way to protect endpoints with role requirements.
    
    Usage:
        @app.get("/protected")
        async def protected_endpoint(user: UserContext = Depends(require_role(Role.READONLY))):
            # Only users with READONLY or higher can access
            pass
        
        @app.post("/ingest")
        async def ingest_endpoint(user: UserContext = Depends(require_role(Role.INGESTONLY))):
            # Only INGESTONLY or ADMIN can access
            pass
        
        @app.delete("/resource")
        async def delete_endpoint(user: UserContext = Depends(require_role(Role.ADMIN))):
            # Only ADMIN can access
            pass
    
    Args:
        required_role: The minimum role required (Role.READONLY, Role.INGESTONLY, or Role.ADMIN)
        
    Returns:
        FastAPI dependency function that validates user has required role
    """
    async def role_checker(user: UserContext = Depends(get_current_user)) -> UserContext:
        if not has_permission(user.role, required_role):
            logger.warning(
                f"Access denied for {user.email}: "
                f"required {required_role}, has {user.role}"
            )
            raise HTTPException(
                status_code=403,
                detail=(
                    f"Insufficient permissions. This operation requires '{required_role}' role, "
                    f"but you have '{user.role}' role. Please contact your administrator to request "
                    f"the appropriate access level."
                )
            )
        return user
    
    # Set a descriptive name for better debugging
    role_checker.__name__ = f"require_{required_role}"
    return role_checker
