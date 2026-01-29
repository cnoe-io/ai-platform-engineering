"""
Role-Based Access Control (RBAC) implementation for the RAG API.

Role Hierarchy:
- READONLY: Can view/query all data
- INGESTONLY: READONLY + can ingest data and manage ingestion jobs
- ADMIN: INGESTONLY + can delete resources and perform bulk operations

This module provides:
- User context extraction from JWT tokens (Bearer authentication)
- Trusted network access (IP-based or header-based)
- Role determination from group membership
- FastAPI dependencies for role-based endpoint protection
"""
import os
import re
import ipaddress
from typing import List, Dict, Any
from fastapi import Depends, HTTPException, Request
from jose import JWTError
from common.models.rbac import Role, UserContext
from common import utils
from server.auth import get_auth_manager, AuthManager

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

# Trusted network configuration (replaces RBAC_DEFAULT_UNAUTHENTICATED_ROLE)
ALLOW_TRUSTED_NETWORK = os.getenv("ALLOW_TRUSTED_NETWORK", "false").lower() in ("true", "1", "yes")
TRUSTED_NETWORK_CIDRS_STR = os.getenv("TRUSTED_NETWORK_CIDRS", "127.0.0.0/8")
TRUSTED_NETWORK_TOKEN = os.getenv("TRUSTED_NETWORK_TOKEN", "")
TRUSTED_NETWORK_DEFAULT_ROLE = os.getenv("TRUSTED_NETWORK_DEFAULT_ROLE", Role.ADMIN)

# Parse CIDR ranges for trusted networks
TRUSTED_NETWORK_CIDRS = []
if ALLOW_TRUSTED_NETWORK and TRUSTED_NETWORK_CIDRS_STR:
    for cidr_str in TRUSTED_NETWORK_CIDRS_STR.split(","):
        cidr_str = cidr_str.strip()
        if cidr_str:
            try:
                TRUSTED_NETWORK_CIDRS.append(ipaddress.ip_network(cidr_str))
            except ValueError as e:
                logger.error(f"Invalid CIDR in TRUSTED_NETWORK_CIDRS: '{cidr_str}' - {e}")

# Group claim configuration (matches UI configuration)
OIDC_GROUP_CLAIM = os.getenv("OIDC_GROUP_CLAIM", "")

# Validate roles at startup
VALID_ROLES = {Role.READONLY, Role.INGESTONLY, Role.ADMIN}

if RBAC_DEFAULT_AUTHENTICATED_ROLE not in VALID_ROLES:
    logger.error(f"Invalid RBAC_DEFAULT_AUTHENTICATED_ROLE: '{RBAC_DEFAULT_AUTHENTICATED_ROLE}'. Must be one of: {VALID_ROLES}")
    raise ValueError(f"Invalid RBAC_DEFAULT_AUTHENTICATED_ROLE: '{RBAC_DEFAULT_AUTHENTICATED_ROLE}'. Valid values are: {', '.join(VALID_ROLES)}")

if TRUSTED_NETWORK_DEFAULT_ROLE not in VALID_ROLES:
    logger.error(f"Invalid TRUSTED_NETWORK_DEFAULT_ROLE: '{TRUSTED_NETWORK_DEFAULT_ROLE}'. Must be one of: {VALID_ROLES}")
    raise ValueError(f"Invalid TRUSTED_NETWORK_DEFAULT_ROLE: '{TRUSTED_NETWORK_DEFAULT_ROLE}'. Valid values are: {', '.join(VALID_ROLES)}")

logger.info("RBAC Configuration:")
logger.info(f"  RBAC_READONLY_GROUPS: {[g for g in RBAC_READONLY_GROUPS if g.strip()]}")
logger.info(f"  RBAC_INGESTONLY_GROUPS: {[g for g in RBAC_INGESTONLY_GROUPS if g.strip()]}")
logger.info(f"  RBAC_ADMIN_GROUPS: {[g for g in RBAC_ADMIN_GROUPS if g.strip()]}")
logger.info(f"  RBAC_DEFAULT_AUTHENTICATED_ROLE: {RBAC_DEFAULT_AUTHENTICATED_ROLE}")
logger.info(f"  ALLOW_TRUSTED_NETWORK: {ALLOW_TRUSTED_NETWORK}")
if ALLOW_TRUSTED_NETWORK:
    logger.info(f"  TRUSTED_NETWORK_CIDRS: {[str(cidr) for cidr in TRUSTED_NETWORK_CIDRS]}")
    logger.info(f"  TRUSTED_NETWORK_TOKEN: {'(set)' if TRUSTED_NETWORK_TOKEN else '(not set)'}")
    logger.info(f"  TRUSTED_NETWORK_DEFAULT_ROLE: {TRUSTED_NETWORK_DEFAULT_ROLE}")
logger.info(f"  OIDC_GROUP_CLAIM: {OIDC_GROUP_CLAIM if OIDC_GROUP_CLAIM else '(auto-detect)'}")

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
# Claim Extraction (matches UI logic)
# ============================================================================

def extract_email_from_claims(claims: Dict[str, Any]) -> str:
    """
    Extract email from JWT claims with fallback chain.
    Matches the logic used in UI for consistency.
    
    Priority order:
    1. email claim (standard OIDC)
    2. preferred_username (common in Keycloak, Azure AD)
    3. upn (User Principal Name - Microsoft)
    4. sub (subject - last resort, usually opaque ID)
    
    Args:
        claims: JWT token claims
        
    Returns:
        Email or user identifier string
    """
    return (
        claims.get("email") or 
        claims.get("preferred_username") or 
        claims.get("upn") or
        claims.get("sub") or
        "unknown"
    )


def extract_groups_from_claims(claims: Dict[str, Any]) -> List[str]:
    """
    Extract groups from JWT claims with configurable claim name.
    Mirrors the logic in ui/src/lib/auth-config.ts extractGroups()
    
    Uses OIDC_GROUP_CLAIM if set, otherwise tries common claim names.
    
    Args:
        claims: JWT token claims
        
    Returns:
        List of group names
    """
    # Default group claim names to try (in order)
    default_group_claims = ["memberOf", "groups", "group", "roles", "cognito:groups"]
    
    # If explicit group claim is configured, use only that
    if OIDC_GROUP_CLAIM:
        value = claims.get(OIDC_GROUP_CLAIM)
        if isinstance(value, list):
            return [str(g) for g in value]
        elif isinstance(value, str):
            # Split on comma or whitespace
            return [g.strip() for g in re.split(r'[,\s]+', value) if g.strip()]
        else:
            logger.warning(f"Group claim '{OIDC_GROUP_CLAIM}' not found in token")
            return []
    
    # Auto-detect: Try common group claim names in order
    for claim_name in default_group_claims:
        value = claims.get(claim_name)
        if isinstance(value, list):
            return [str(g) for g in value]
        elif isinstance(value, str):
            return [g.strip() for g in re.split(r'[,\s]+', value) if g.strip()]
    
    # No groups found
    logger.debug("No group claims found in token")
    return []


# ============================================================================
# Trusted Network Access
# ============================================================================

def is_trusted_request(request: Request) -> bool:
    """
    Check if request comes from trusted network.
    
    Checks:
    1. Source IP against CIDR ranges (TRUSTED_NETWORK_CIDRS)
    2. X-Trust-Token header (TRUSTED_NETWORK_TOKEN)
    
    Args:
        request: FastAPI request object
        
    Returns:
        True if request is from trusted network, False otherwise
    """
    if not ALLOW_TRUSTED_NETWORK:
        return False
    
    # Option 1: Check source IP against CIDR ranges
    if TRUSTED_NETWORK_CIDRS and request.client:
        try:
            client_ip = ipaddress.ip_address(request.client.host)
            for cidr in TRUSTED_NETWORK_CIDRS:
                if client_ip in cidr:
                    logger.debug(f"Request from trusted network: {client_ip} in {cidr}")
                    return True
        except ValueError as e:
            logger.warning(f"Invalid client IP address: {request.client.host} - {e}")
    
    # Option 2: Check for trusted header
    if TRUSTED_NETWORK_TOKEN:
        trust_token = request.headers.get("X-Trust-Token")
        if trust_token == TRUSTED_NETWORK_TOKEN:
            logger.debug("Request authenticated via X-Trust-Token header")
            return True
    
    return False


# ============================================================================
# FastAPI Dependencies
# ============================================================================

async def get_current_user(
    request: Request,
    auth_manager: AuthManager = Depends(get_auth_manager)
) -> UserContext:
    """
    Extract user context from JWT token or trusted network.
    
    Authentication flow:
    1. Check if request is from trusted network (if enabled)
    2. Extract Bearer token from Authorization header
    3. Validate JWT against configured OIDC providers
    4. Extract email and groups from token claims
    5. Determine role from group membership
    
    Args:
        request: FastAPI request object
        auth_manager: Auth manager with OIDC providers
        
    Returns:
        UserContext with authentication and role information
        
    Raises:
        HTTPException(401): If authentication fails
    """
    # Check for trusted network access first (if enabled)
    if is_trusted_request(request):
        logger.info(f"Trusted network request from {request.client.host if request.client else 'unknown'}")
        return UserContext(
            email="trusted-network",
            groups=[],
            role=TRUSTED_NETWORK_DEFAULT_ROLE,
            is_authenticated=False
        )
    
    # Extract Bearer token
    auth_header = request.headers.get("Authorization")
    if not auth_header:
        raise HTTPException(
            status_code=401,
            detail="Missing Authorization header. Please provide a valid Bearer token."
        )
    
    if not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Invalid Authorization header format. Expected 'Bearer <token>'."
        )
    
    token = auth_header[7:]  # Remove "Bearer " prefix
    
    # Validate token against configured providers
    try:
        provider, claims = await auth_manager.validate_token(token)
        logger.debug(f"Token validated by provider '{provider.name}'")
    except JWTError as e:
        logger.warning(f"Token validation failed: {e}")
        raise HTTPException(
            status_code=401,
            detail=f"Invalid or expired token: {str(e)}"
        )
    
    # Extract email and groups from claims
    email = extract_email_from_claims(claims)
    groups = extract_groups_from_claims(claims)
    
    # Validate email format
    if email and email != "unknown" and not EMAIL_REGEX.match(email):
        logger.warning(f"Invalid email format in token claims: {email[:50]}")
        # Don't fail - use it anyway as identifier
    
    # Determine role from groups
    role = determine_role_from_groups(groups)
    
    user_context = UserContext(
        email=email,
        groups=groups,
        role=role,
        is_authenticated=True
    )
    
    logger.debug(f"User authenticated: {email}, role: {role}, groups: {groups}")
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
