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
from typing import List, Dict, Any, Optional
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

# Default role for client credentials tokens (machine-to-machine)
# These tokens don't have user/group information, so we assign a fixed role
RBAC_CLIENT_CREDENTIALS_ROLE = os.getenv("RBAC_CLIENT_CREDENTIALS_ROLE", Role.INGESTONLY)

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

if RBAC_CLIENT_CREDENTIALS_ROLE not in VALID_ROLES:
    logger.error(f"Invalid RBAC_CLIENT_CREDENTIALS_ROLE: '{RBAC_CLIENT_CREDENTIALS_ROLE}'. Must be one of: {VALID_ROLES}")
    raise ValueError(f"Invalid RBAC_CLIENT_CREDENTIALS_ROLE: '{RBAC_CLIENT_CREDENTIALS_ROLE}'. Valid values are: {', '.join(VALID_ROLES)}")

if TRUSTED_NETWORK_DEFAULT_ROLE not in VALID_ROLES:
    logger.error(f"Invalid TRUSTED_NETWORK_DEFAULT_ROLE: '{TRUSTED_NETWORK_DEFAULT_ROLE}'. Must be one of: {VALID_ROLES}")
    raise ValueError(f"Invalid TRUSTED_NETWORK_DEFAULT_ROLE: '{TRUSTED_NETWORK_DEFAULT_ROLE}'. Valid values are: {', '.join(VALID_ROLES)}")

logger.info("RBAC Configuration:")
logger.info(f"  RBAC_READONLY_GROUPS: {[g for g in RBAC_READONLY_GROUPS if g.strip()]}")
logger.info(f"  RBAC_INGESTONLY_GROUPS: {[g for g in RBAC_INGESTONLY_GROUPS if g.strip()]}")
logger.info(f"  RBAC_ADMIN_GROUPS: {[g for g in RBAC_ADMIN_GROUPS if g.strip()]}")
logger.info(f"  RBAC_DEFAULT_AUTHENTICATED_ROLE: {RBAC_DEFAULT_AUTHENTICATED_ROLE}")
logger.info(f"  RBAC_CLIENT_CREDENTIALS_ROLE: {RBAC_CLIENT_CREDENTIALS_ROLE}")
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
    Role.ANONYMOUS: 0,
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
    - ANONYMOUS: [] (no permissions)
    - READONLY: ["read"]
    - INGESTONLY: ["read", "ingest"]
    - ADMIN: ["read", "ingest", "delete"]
    
    Args:
        user_role: The user's current role
        
    Returns:
        List of permission strings (without "can_" prefix)
        
    Examples:
        get_permissions(Role.ANONYMOUS) -> []
        get_permissions(Role.READONLY) -> ["read"]
        get_permissions(Role.INGESTONLY) -> ["read", "ingest"]
        get_permissions(Role.ADMIN) -> ["read", "ingest", "delete"]
    """
    permissions = []
    
    # Anonymous users have no permissions
    if user_role == Role.ANONYMOUS:
        return []
    
    # All authenticated roles can read
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

def is_client_credentials_token(claims: Dict[str, Any]) -> bool:
    """
    Detect if a token is a client credentials token (machine-to-machine).
    
    Client credentials tokens typically:
    - Have client_id but no user-specific claims (email, preferred_username)
    - May have grant_type or token_use indicating client credentials
    - Subject (sub) is often a client ID (UUID or client identifier)
    
    Args:
        claims: JWT token claims
        
    Returns:
        True if token appears to be client credentials, False otherwise
    """
    # Check for explicit grant type
    grant_type = claims.get("grant_type")
    if grant_type == "client_credentials":
        logger.debug(f"Client credentials detected via grant_type: {grant_type}")
        return True
    
    # Check for client_id without typical user claims
    has_client_id = bool(claims.get("client_id") or claims.get("azp") or claims.get("clientId"))
    has_user_claims = bool(
        claims.get("email") or 
        claims.get("preferred_username") or 
        claims.get("upn") or 
        claims.get("name")
    )
    
    logger.debug(f"Client credentials check: has_client_id={has_client_id}, has_user_claims={has_user_claims}")
    
    # If has client_id but no user claims, likely client credentials
    if has_client_id and not has_user_claims:
        logger.debug(f"Client credentials detected: has client_id but no user claims")
        return True
    
    # Check token_use claim (some providers include this)
    token_use = claims.get("token_use")
    if token_use == "client_credentials":
        logger.debug(f"Client credentials detected via token_use: {token_use}")
        return True
    
    # Check if sub is a UUID (common for client credentials) and no user claims
    sub = claims.get("sub", "")
    if not has_user_claims and len(sub) == 36 and sub.count("-") == 4:
        # Looks like a UUID format
        logger.debug(f"Client credentials detected: UUID-like sub with no user claims")
        return True
    
    logger.debug(f"Not detected as client credentials token")
    return False


def extract_client_id_from_claims(claims: Dict[str, Any]) -> str:
    """
    Extract client ID from JWT claims for client credentials tokens.
    
    Args:
        claims: JWT token claims
        
    Returns:
        Client ID string
    """
    return (
        claims.get("client_id") or
        claims.get("azp") or  # Authorized party (Google, Keycloak)
        claims.get("clientId") or
        claims.get("appid") or  # Azure AD
        claims.get("sub") or  # Fallback to subject
        "unknown-client"
    )


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

async def _authenticate_from_token(
    request: Request,
    auth_manager: AuthManager
) -> Optional[UserContext]:
    """
    Internal helper to authenticate user from JWT token.
    
    Returns:
        UserContext if authentication successful, None if no auth or invalid
    """
    # Extract Bearer token
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        return None
    
    token = auth_header[7:]  # Remove "Bearer " prefix
    
    # Extract optional ingestor identification headers
    ingestor_type = request.headers.get("X-Ingestor-Type")
    ingestor_name = request.headers.get("X-Ingestor-Name")
    
    # Validate token against configured providers
    try:
        provider, claims = await auth_manager.validate_token(token)
        logger.debug(f"Token validated by provider '{provider.name}'")
        logger.debug(f"Token claims keys: {list(claims.keys())}")
        
        # Check if this is a client credentials token (machine-to-machine)
        if is_client_credentials_token(claims):
            client_id = extract_client_id_from_claims(claims)
            
            # Enrich logging with ingestor info if provided
            if ingestor_type and ingestor_name:
                logger.info(f"Client credentials token detected: client_id={client_id}, ingestor_type={ingestor_type}, ingestor_name={ingestor_name}, provider={provider.name}, assigning role={RBAC_CLIENT_CREDENTIALS_ROLE}")
                email = f"client:{ingestor_type}:{ingestor_name}"
            else:
                logger.info(f"Client credentials token detected: client_id={client_id}, provider={provider.name}, assigning role={RBAC_CLIENT_CREDENTIALS_ROLE}")
                email = f"client:{client_id}"
            
            user_context = UserContext(
                email=email,
                groups=[],  # Client credentials don't have groups
                role=RBAC_CLIENT_CREDENTIALS_ROLE,
                is_authenticated=True
            )
            
            logger.debug(f"Client authenticated: {email}, role: {RBAC_CLIENT_CREDENTIALS_ROLE}")
            return user_context
        else:
            logger.debug(f"Regular user token detected (not client credentials)")
        
        # Regular user token - extract email and groups
        email = extract_email_from_claims(claims)
        groups = extract_groups_from_claims(claims)
        
        # Validate email format
        if email and email != "unknown" and not EMAIL_REGEX.match(email):
            logger.warning(f"Invalid email format in token claims: {email[:50]}")
        
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
        
    except JWTError as e:
        logger.debug(f"Token validation failed: {e}")
        return None


async def require_authenticated_user(
    request: Request,
    auth_manager: AuthManager = Depends(get_auth_manager)
) -> UserContext:
    """
    Require authentication and extract user context from JWT token or trusted network.
    
    This dependency REQUIRES valid authentication. If authentication is missing or invalid,
    it raises HTTPException(401). Use this for protected endpoints that need authentication.
    
    For endpoints that should work for both authenticated and anonymous users,
    use get_user_or_anonymous() instead.
    
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
        HTTPException(401): If authentication fails or is missing
    """
    # Check for trusted network access first (if enabled)
    if is_trusted_request(request):
        # Extract optional ingestor identification headers
        ingestor_type = request.headers.get("X-Ingestor-Type")
        ingestor_name = request.headers.get("X-Ingestor-Name")
        
        if ingestor_type and ingestor_name:
            logger.info(f"Trusted network request from {request.client.host if request.client else 'unknown'}: ingestor_type={ingestor_type}, ingestor_name={ingestor_name}, role={TRUSTED_NETWORK_DEFAULT_ROLE}")
            email = f"trusted:{ingestor_type}:{ingestor_name}"
        else:
            logger.info(f"Trusted network request from {request.client.host if request.client else 'unknown'}, role={TRUSTED_NETWORK_DEFAULT_ROLE}")
            email = "trusted-network"
        
        return UserContext(
            email=email,
            groups=[],
            role=TRUSTED_NETWORK_DEFAULT_ROLE,
            is_authenticated=False
        )
    
    # Try to authenticate from token
    user = await _authenticate_from_token(request, auth_manager)
    if user:
        return user
    
    # No valid authentication - raise 401
    auth_header = request.headers.get("Authorization")
    if not auth_header:
        raise HTTPException(
            status_code=401,
            detail="Missing Authorization header. Please provide a valid Bearer token."
        )
    elif not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Invalid Authorization header format. Expected 'Bearer <token>'."
        )
    else:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired token."
        )


async def get_user_or_anonymous(
    request: Request,
    auth_manager: AuthManager = Depends(get_auth_manager)
) -> UserContext:
    """
    Get user context if authenticated, or return anonymous user if not.
    
    This dependency does NOT require authentication. It gracefully handles missing
    or invalid authentication by returning an anonymous user context. Use this for
    endpoints that should work for everyone, regardless of authentication status.
    
    For endpoints that require authentication, use require_authenticated_user() instead.
    
    Authentication flow:
    1. Check if request is from trusted network (if enabled)
    2. Try to extract Bearer token from Authorization header
    3. If token exists and valid, return authenticated user
    4. If no token or invalid token, return anonymous user
    
    Returns:
    - Authenticated user with email, role, groups if valid token provided
    - Anonymous user (email="anonymous", is_authenticated=False) if no auth
    - Trusted network user (email="trusted-network") if from trusted network
    
    Args:
        request: FastAPI request object
        auth_manager: Auth manager with OIDC providers
        
    Returns:
        UserContext with authentication status (authenticated or anonymous)
    """
    # Check for trusted network access first (if enabled)
    if is_trusted_request(request):
        # Extract optional ingestor identification headers
        ingestor_type = request.headers.get("X-Ingestor-Type")
        ingestor_name = request.headers.get("X-Ingestor-Name")
        
        if ingestor_type and ingestor_name:
            logger.info(f"Trusted network request from {request.client.host if request.client else 'unknown'}: ingestor_type={ingestor_type}, ingestor_name={ingestor_name}, role={TRUSTED_NETWORK_DEFAULT_ROLE}")
            email = f"trusted:{ingestor_type}:{ingestor_name}"
        else:
            logger.info(f"Trusted network request from {request.client.host if request.client else 'unknown'}, role={TRUSTED_NETWORK_DEFAULT_ROLE}")
            email = "trusted-network"
        
        return UserContext(
            email=email,
            groups=[],
            role=TRUSTED_NETWORK_DEFAULT_ROLE,
            is_authenticated=False
        )
    
    # Try to authenticate from token
    user = await _authenticate_from_token(request, auth_manager)
    if user:
        return user
    
    # No authentication provided - return anonymous user
    logger.debug("No valid authentication, returning anonymous user")
    return UserContext(
        email="anonymous",
        groups=[],
        role=Role.ANONYMOUS,  # No permissions for unauthenticated users
        is_authenticated=False
    )


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
    async def role_checker(user: UserContext = Depends(require_authenticated_user)) -> UserContext:
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
