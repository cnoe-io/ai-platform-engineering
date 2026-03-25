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
- Groups caching via Redis (fetched from OIDC userinfo endpoint)
- FastAPI dependencies for role-based endpoint protection
"""

import os
import re
import json
import ipaddress
from dataclasses import dataclass
from typing import List, Dict, Any, Optional
from fastapi import Depends, HTTPException, Request
from jwt.exceptions import PyJWTError as JWTError
import redis.asyncio as redis
from common.models.rbac import Role, UserContext, KbPermission, KeycloakRole
from common.models.server import QueryRequest
from common.constants import REDIS_USERINFO_CACHE_PREFIX
from common import utils
from server.auth import get_auth_manager, AuthManager

try:
  from cel_evaluator import evaluate as cel_evaluate
except ImportError:
  cel_evaluate = None  # type: ignore[misc, assignment]

logger = utils.get_logger(__name__)

# Email validation regex (RFC 5322 simplified)
EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")

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
# Groups Cache (Redis-backed)
# ============================================================================

# Userinfo cache TTL in seconds (default: 30 minutes)
# User info (email, groups) is fetched from OIDC userinfo endpoint and cached to reduce load
USERINFO_CACHE_TTL_SECONDS = int(os.getenv("USERINFO_CACHE_TTL_SECONDS", 1800))

logger.info(f"  USERINFO_CACHE_TTL_SECONDS: {USERINFO_CACHE_TTL_SECONDS}")


@dataclass
class CachedUserInfo:
  """Cached user information from OIDC userinfo endpoint."""

  email: str
  groups: List[str]


class UserInfoCache:
  """
  Redis-backed cache for user info fetched from OIDC userinfo endpoint.

  This cache reduces load on the OIDC provider by caching user information
  (email and groups) for a configurable TTL. Data is keyed by the user's
  'sub' claim from the access token.
  """

  def __init__(self, redis_client: redis.Redis):
    """
    Initialize userinfo cache with Redis client.

    Args:
        redis_client: Async Redis client instance
    """
    self.redis_client = redis_client
    self._ttl = USERINFO_CACHE_TTL_SECONDS

  async def get(self, sub: str) -> Optional[CachedUserInfo]:
    """
    Get cached user info for a user.

    Args:
        sub: User's subject identifier from access token

    Returns:
        CachedUserInfo if cached and not expired, None otherwise
    """
    try:
      data = await self.redis_client.get(f"{REDIS_USERINFO_CACHE_PREFIX}{sub}")
      if data:
        parsed = json.loads(data)
        user_info = CachedUserInfo(email=parsed["email"], groups=parsed["groups"])
        logger.debug(f"Userinfo cache hit for sub={sub[:16]}..., email={user_info.email}, groups_count={len(user_info.groups)}")
        return user_info
      logger.debug(f"Userinfo cache miss for sub={sub[:16]}...")
      return None
    except Exception as e:
      logger.warning(f"Userinfo cache get failed for sub={sub[:16]}...: {e}")
      return None

  async def set(self, sub: str, user_info: CachedUserInfo) -> None:
    """
    Cache user info with TTL.

    Args:
        sub: User's subject identifier from access token
        user_info: User information to cache
    """
    try:
      data = json.dumps({"email": user_info.email, "groups": user_info.groups})
      await self.redis_client.setex(f"{REDIS_USERINFO_CACHE_PREFIX}{sub}", self._ttl, data)
      logger.debug(f"Userinfo cached for sub={sub[:16]}..., email={user_info.email}, groups_count={len(user_info.groups)}, ttl={self._ttl}s")
    except Exception as e:
      logger.warning(f"Userinfo cache set failed for sub={sub[:16]}...: {e}")

  async def delete(self, sub: str) -> None:
    """
    Delete cached user info.

    Args:
        sub: User's subject identifier from access token
    """
    try:
      await self.redis_client.delete(f"{REDIS_USERINFO_CACHE_PREFIX}{sub}")
      logger.debug(f"Userinfo cache deleted for sub={sub[:16]}...")
    except Exception as e:
      logger.warning(f"Userinfo cache delete failed for sub={sub[:16]}...: {e}")


# Global userinfo cache instance (set by restapi.py on startup)
_userinfo_cache: Optional[UserInfoCache] = None


def set_userinfo_cache(cache: UserInfoCache) -> None:
  """Set the global userinfo cache instance."""
  global _userinfo_cache
  _userinfo_cache = cache
  logger.info("Userinfo cache initialized")


def get_userinfo_cache() -> Optional[UserInfoCache]:
  """Get the global userinfo cache instance."""
  return _userinfo_cache


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


def determine_role_from_keycloak_roles(roles: List[str]) -> str:
  """
  Map Keycloak realm roles in the JWT to internal RAG roles (most permissive wins).

  ``admin`` → ADMIN, ``kb_admin`` → INGESTONLY, ``team_member`` / ``chat_user`` → READONLY,
  ``denied`` or no recognized role → ANONYMOUS.
  """
  rs = set(roles)
  if KeycloakRole.ADMIN in rs or "admin" in rs:
    return Role.ADMIN
  if KeycloakRole.KB_ADMIN in rs or "kb_admin" in rs:
    return Role.INGESTONLY
  if KeycloakRole.TEAM_MEMBER in rs or "team_member" in rs:
    return Role.READONLY
  if KeycloakRole.CHAT_USER in rs or "chat_user" in rs:
    return Role.READONLY
  if KeycloakRole.DENIED in rs or "denied" in rs:
    return Role.ANONYMOUS
  return Role.ANONYMOUS


_KB_REALM_ROLE_SCOPE = {
  "kb_reader": "read",
  "kb_ingestor": "ingest",
  "kb_admin": "admin",
}

_KB_SCOPE_RANK = {"read": 1, "ingest": 2, "admin": 3}


def extract_kb_permissions_from_roles(roles: List[str]) -> List[KbPermission]:
  """
  Parse per-KB realm roles: ``kb_reader:<id>``, ``kb_ingestor:<id>``, ``kb_admin:<id>``.
  Wildcard ``*`` is a valid ``kb_id``. Highest scope wins per ``kb_id``.
  """
  best: Dict[str, int] = {}
  for role in roles:
    m = re.match(r"^(kb_reader|kb_ingestor|kb_admin):(.+)$", str(role).strip())
    if not m:
      continue
    prefix, kb_id = m.group(1), m.group(2).strip()
    if not kb_id:
      continue
    scope = _KB_REALM_ROLE_SCOPE.get(prefix)
    if not scope:
      continue
    rank = _KB_SCOPE_RANK[scope]
    prev = best.get(kb_id, 0)
    if rank > prev:
      best[kb_id] = rank
  rank_to_scope = {1: "read", 2: "ingest", 3: "admin"}
  return [KbPermission(kb_id=kid, scope=rank_to_scope[rk]) for kid, rk in best.items()]


def extract_realm_roles_from_claims(claims: Dict[str, Any]) -> List[str]:
  """Collect realm role names from ``roles`` and/or ``realm_access.roles`` claims."""
  out: List[str] = []
  seen: set[str] = set()

  def add(value: Any) -> None:
    if isinstance(value, list):
      for item in value:
        s = str(item).strip()
        if s and s not in seen:
          seen.add(s)
          out.append(s)
    elif isinstance(value, str) and value.strip():
      for part in re.split(r"[,\s]+", value):
        p = part.strip()
        if p and p not in seen:
          seen.add(p)
          out.append(p)

  r = claims.get("roles")
  if r is not None:
    add(r)
  realm_access = claims.get("realm_access")
  if isinstance(realm_access, dict) and realm_access.get("roles"):
    add(realm_access["roles"])
  return out


def kb_scope_satisfies(perm_scope: str, required: str) -> bool:
  """Return True if a KB permission scope meets the required access level."""
  return _KB_SCOPE_RANK.get(perm_scope, 0) >= _KB_SCOPE_RANK.get(required, 0)


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
  has_user_claims = bool(claims.get("email") or claims.get("preferred_username") or claims.get("upn") or claims.get("name"))

  logger.debug(f"Client credentials check: has_client_id={has_client_id}, has_user_claims={has_user_claims}")

  # If has client_id but no user claims, likely client credentials
  if has_client_id and not has_user_claims:
    logger.debug("Client credentials detected: has client_id but no user claims")
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
    logger.debug("Client credentials detected: UUID-like sub with no user claims")
    return True

  logger.debug("Not detected as client credentials token")
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
    claims.get("client_id")
    or claims.get("azp")  # Authorized party (Google, Keycloak)
    or claims.get("clientId")
    or claims.get("appid")  # Azure AD
    or claims.get("sub")  # Fallback to subject
    or "unknown-client"
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
  return claims.get("email") or claims.get("preferred_username") or claims.get("upn") or claims.get("sub") or "unknown"


def extract_groups_from_claims(claims: Dict[str, Any]) -> List[str]:
  """
  Extract groups from JWT claims with configurable claim name.
  Mirrors the logic in ui/src/lib/auth-config.ts extractGroups()

  Uses OIDC_GROUP_CLAIM if set (comma-separated for multiple claims),
  otherwise checks ALL common claim names and combines groups from all
  of them (using a set for deduplication).

  Args:
      claims: JWT token claims

  Returns:
      List of unique group names
  """
  # Default group claim names to check (in order of priority)
  # Note: Duo SSO uses "members" for full group list, "groups" for limited set
  default_group_claims = ["members", "memberOf", "groups", "group", "roles", "cognito:groups"]

  # Use a set to collect all groups and deduplicate
  all_groups: set[str] = set()

  def add_groups_from_value(value: Any) -> None:
    """Helper to extract groups from a claim value and add to set."""
    if isinstance(value, list):
      for g in value:
        all_groups.add(str(g))
    elif isinstance(value, str):
      # Split on comma or whitespace
      for g in re.split(r"[,\s]+", value):
        if g.strip():
          all_groups.add(g.strip())

  # If explicit group claim(s) configured, use only those
  # Supports comma-separated list of claim names (e.g., "groups,members,roles")
  if OIDC_GROUP_CLAIM:
    configured_claims = [c.strip() for c in OIDC_GROUP_CLAIM.split(",") if c.strip()]
    for claim_name in configured_claims:
      value = claims.get(claim_name)
      if value is not None:
        add_groups_from_value(value)
    if not all_groups:
      logger.warning(f"No groups found in configured claims: {configured_claims}")
    return list(all_groups)

  # Auto-detect: check ALL common group claim names and combine them
  # This is important for Duo SSO which uses both "groups" and "members"
  for claim_name in default_group_claims:
    value = claims.get(claim_name)
    if value is not None:
      add_groups_from_value(value)

  if not all_groups:
    logger.debug("No group claims found in token")

  return list(all_groups)


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
  # Prefer X-Forwarded-For (real client IP set by Istio ingress) over the direct
  # connection IP (request.client.host), which is always the ingress gateway.
  if TRUSTED_NETWORK_CIDRS:
    xff = request.headers.get("X-Forwarded-For")
    raw_ip = xff.split(",")[0].strip() if xff else (request.client.host if request.client else None)
    if raw_ip:
      try:
        client_ip = ipaddress.ip_address(raw_ip)
        for cidr in TRUSTED_NETWORK_CIDRS:
          if client_ip in cidr:
            logger.debug(f"Request from trusted network: {client_ip} in {cidr}")
            return True
      except ValueError as e:
        logger.warning(f"Invalid client IP address: {raw_ip} - {e}")

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


async def _authenticate_from_token(request: Request, auth_manager: AuthManager) -> Optional[UserContext]:
  """
  Internal helper to authenticate user from JWT token.

  For user tokens, always fetches user info (email, groups) from the OIDC
  userinfo endpoint, with Redis caching to reduce load on the provider.
  This ensures we always get authoritative email and group information,
  regardless of what claims are in the access token.

  Flow:
  1. Validate access_token (signature, expiry, audience, issuer)
  2. Check if client credentials token (machine-to-machine) → return immediately
  3. Extract 'sub' (user ID) from access_token for cache key
  4. Check Redis cache for userinfo (email + groups)
  5. On cache miss, fetch from OIDC userinfo endpoint and cache result
  6. Determine role from groups

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
    provider, access_claims = await auth_manager.validate_token(token)
    logger.debug(f"Access token validated by provider '{provider.name}'")
    logger.debug(f"Access token claims keys: {list(access_claims.keys())}")

    # Check if this is a client credentials token (machine-to-machine)
    if is_client_credentials_token(access_claims):
      client_id = extract_client_id_from_claims(access_claims)

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
        is_authenticated=True,
        kb_permissions=[],
        realm_roles=extract_realm_roles_from_claims(access_claims),
      )

      logger.debug(f"Client authenticated: {email}, role: {RBAC_CLIENT_CREDENTIALS_ROLE}")
      return user_context
    else:
      logger.debug("Regular user token detected (not client credentials)")

    # Extract user's subject identifier for cache key
    sub = access_claims.get("sub")
    if not sub:
      logger.warning("Access token missing 'sub' claim, cannot use cache")
      sub = "unknown"
    else:
      logger.debug(f"Extracted sub from access_token: {sub[:16]}...")

    # For user tokens, always get email and groups from userinfo (with caching)
    # This ensures we have authoritative user info regardless of access_token claims
    email = None
    groups = None
    info_source = None

    # Step 1: Check Redis cache for userinfo
    userinfo_cache = get_userinfo_cache()
    if userinfo_cache and sub != "unknown":
      logger.debug("Checking Redis cache for userinfo...")
      cached_info = await userinfo_cache.get(sub)
      if cached_info is not None:
        email = cached_info.email
        groups = cached_info.groups
        info_source = "cache"
        logger.info(f"Userinfo found in cache: email={email}, groups_count={len(groups)}")

    # Step 2: Fetch from userinfo endpoint on cache miss
    if email is None:
      logger.debug("Fetching userinfo from OIDC endpoint...")
      try:
        userinfo = await auth_manager.fetch_userinfo(token, provider)
        logger.debug(f"Userinfo response keys: {list(userinfo.keys())}")

        email = extract_email_from_claims(userinfo)
        groups = extract_groups_from_claims(userinfo)
        info_source = "userinfo"
        logger.info(f"Userinfo fetched: email={email}, groups_count={len(groups)}")

        # Cache the userinfo for future requests
        if userinfo_cache and sub != "unknown":
          await userinfo_cache.set(sub, CachedUserInfo(email=email, groups=groups))
          logger.debug(f"Userinfo cached for sub={sub[:16]}...")
        elif not userinfo_cache:
          logger.debug("Userinfo cache not available, skipping cache write")

      except Exception as e:
        # Userinfo fetch failed - fall back to access_token claims
        logger.warning(f"Userinfo fetch failed, falling back to access_token claims: {e}")
        email = extract_email_from_claims(access_claims)
        groups = extract_groups_from_claims(access_claims)
        info_source = "access_token_fallback"
        logger.info(f"Using fallback claims: email={email}, groups_count={len(groups)}")

    logger.info(f"User info resolution complete: email={email}, groups_count={len(groups) if groups else 0}, source={info_source}")

    # Ensure groups is always a list (defensive)
    if groups is None:
      groups = []

    # Validate email format
    if email and email != "unknown" and not EMAIL_REGEX.match(email):
      logger.warning(f"Invalid email format in claims: {email[:50]}")

    jwt_roles = extract_realm_roles_from_claims(access_claims)
    kb_permissions = extract_kb_permissions_from_roles(jwt_roles)
    noise = {"offline_access", "uma_authorization"}
    platform_roles = [
      r
      for r in jwt_roles
      if r not in noise and not re.match(r"^(kb_reader|kb_ingestor|kb_admin):", r)
    ]
    if platform_roles:
      kr = determine_role_from_keycloak_roles(platform_roles)
      if kr != Role.ANONYMOUS:
        role = kr
        logger.info(f"Role determined from JWT realm roles: email={email}, role={role}, roles={platform_roles}")
      elif KeycloakRole.DENIED in platform_roles or "denied" in platform_roles:
        role = Role.ANONYMOUS
        logger.info(f"Role denied via JWT realm roles: email={email}, roles={platform_roles}")
      else:
        role = determine_role_from_groups(groups)
        logger.info(f"Role fallback to groups (no mapped realm role): email={email}, role={role}, groups={groups}")
    else:
      role = determine_role_from_groups(groups)
      logger.info(f"Role determined from groups: email={email}, role={role}, groups={groups}")

    user_context = UserContext(
      email=email,
      groups=groups,
      role=role,
      is_authenticated=True,
      kb_permissions=kb_permissions,
      realm_roles=jwt_roles,
    )

    logger.info(f"User authenticated successfully: email={email}, role={role}, groups_count={len(groups)}, source={info_source}")
    return user_context

  except JWTError as e:
    logger.warning(f"Token validation failed: {e}")
    return None


async def require_authenticated_user(request: Request, auth_manager: AuthManager = Depends(get_auth_manager)) -> UserContext:
  """
  Require authentication and extract user context from JWT token or trusted network.

  This dependency REQUIRES valid authentication. If authentication is missing or invalid,
  it raises HTTPException(401). Use this for protected endpoints that need authentication.

  For endpoints that should work for both authenticated and anonymous users,
  use get_user_or_anonymous() instead.

  Authentication flow:
  1. If Bearer token present, validate JWT and extract user context
  2. If no token, check if request is from trusted network (if enabled)
  3. Otherwise raise 401

  Args:
      request: FastAPI request object
      auth_manager: Auth manager with OIDC providers

  Returns:
      UserContext with authentication and role information

  Raises:
      HTTPException(401): If authentication fails or is missing
  """
  # If an Authorization header is present, always authenticate via JWT
  auth_header = request.headers.get("Authorization")
  if auth_header:
    if not auth_header.startswith("Bearer "):
      raise HTTPException(status_code=401, detail="Invalid Authorization header format. Expected 'Bearer <token>'.")

    user = await _authenticate_from_token(request, auth_manager)
    if user:
      return user

    raise HTTPException(status_code=401, detail="Invalid or expired token.")

  # No Authorization header — fall back to trusted network (if enabled)
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
      is_authenticated=False,
      kb_permissions=[],
      realm_roles=[],
    )

  # No token and not trusted network
  raise HTTPException(status_code=401, detail="Missing Authorization header. Please provide a valid Bearer token.")


async def get_user_or_anonymous(request: Request, auth_manager: AuthManager = Depends(get_auth_manager)) -> UserContext:
  """
  Get user context if authenticated, or return anonymous user if not.

  This dependency does NOT require authentication. It gracefully handles missing
  or invalid authentication by returning an anonymous user context. Use this for
  endpoints that should work for everyone, regardless of authentication status.

  For endpoints that require authentication, use require_authenticated_user() instead.

  Authentication flow:
  1. If Bearer token present, validate JWT and return authenticated user
  2. If no token, check if request is from trusted network (if enabled)
  3. Otherwise return anonymous user

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
  # If an Authorization header is present, always authenticate via JWT
  auth_header = request.headers.get("Authorization")
  if auth_header:
    user = await _authenticate_from_token(request, auth_manager)
    if user:
      return user

  # No Authorization header or invalid token — fall back to trusted network (if enabled)
  if not auth_header and is_trusted_request(request):
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
      is_authenticated=False,
      kb_permissions=[],
      realm_roles=[],
    )

  # No valid authentication — return anonymous user
  logger.debug("No valid authentication, returning anonymous user")
  return UserContext(
    email="anonymous",
    groups=[],
    role=Role.ANONYMOUS,  # No permissions for unauthenticated users
    is_authenticated=False,
    kb_permissions=[],
    realm_roles=[],
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
      logger.warning(f"Access denied for {user.email}: required {required_role}, has {user.role}")
      raise HTTPException(status_code=403, detail=(f"Insufficient permissions. This operation requires '{required_role}' role, but you have '{user.role}' role. Please contact your administrator to request the appropriate access level."))
    return user

  # Set a descriptive name for better debugging
  role_checker.__name__ = f"require_{required_role}"
  return role_checker


# ============================================================================
# 098 Enterprise RBAC — Datasource binding validation (FR-009, T050)
# ============================================================================

# MongoDB URI for team/KB ownership lookups (optional — feature-flagged)
RBAC_MONGODB_URI = os.getenv("RBAC_MONGODB_URI", "")
RBAC_MONGODB_DATABASE = os.getenv("RBAC_MONGODB_DATABASE", "")
RBAC_TEAM_SCOPE_ENABLED = os.getenv("RBAC_TEAM_SCOPE_ENABLED", "false").lower() in ("true", "1", "yes")

CEL_KB_ACCESS_EXPRESSION = os.getenv("CEL_KB_ACCESS_EXPRESSION", "").strip()
CEL_KB_ACCESS_EXPRESSIONS_RAW = os.getenv("CEL_KB_ACCESS_EXPRESSIONS", "").strip()


def _kb_cel_expression_for(datasource_id: str) -> str:
  """Resolve CEL expression for a datasource: per-id map entry or global default."""
  if CEL_KB_ACCESS_EXPRESSIONS_RAW:
    try:
      mapping = json.loads(CEL_KB_ACCESS_EXPRESSIONS_RAW)
      if isinstance(mapping, dict):
        per = mapping.get(datasource_id) or mapping.get(str(datasource_id))
        if isinstance(per, str) and per.strip():
          return per.strip()
    except json.JSONDecodeError as e:
      logger.error("Invalid JSON in CEL_KB_ACCESS_EXPRESSIONS: %s", e)
  return CEL_KB_ACCESS_EXPRESSION


def _kb_cel_context(
  user_context: UserContext,
  datasource_id: str,
  scope: str,
  request: Optional[Request],
) -> Dict[str, Any]:
  team_id = request.headers.get("X-Team-Id") if request else None
  teams = list(user_context.groups or [])
  if team_id and team_id not in teams:
    teams = [*teams, team_id]
  return {
    "user": {
      "roles": list(user_context.realm_roles or []),
      "teams": teams,
      "email": user_context.email,
    },
    "resource": {
      "id": datasource_id,
      "type": "knowledge_base",
      "visibility": "",
      "owner_id": "",
      "shared_with_teams": [],
    },
    "action": scope,
  }


def _filter_kb_ids_by_cel(
  user_context: UserContext,
  scope: str,
  kb_ids: List[str],
  request: Optional[Request],
) -> List[str]:
  if "*" in kb_ids:
    return ["*"]
  if not kb_ids:
    return []
  if not (CEL_KB_ACCESS_EXPRESSION or CEL_KB_ACCESS_EXPRESSIONS_RAW):
    return kb_ids
  if not cel_evaluate:
    logger.warning("CEL KB expressions configured but cel_evaluator is not installed — denying all KB ids (fail-closed)")
    return []
  filtered: List[str] = []
  for kid in kb_ids:
    expr = _kb_cel_expression_for(kid)
    if not expr:
      filtered.append(kid)
      continue
    ctx = _kb_cel_context(user_context, kid, scope, request)
    if cel_evaluate(expr, ctx):
      filtered.append(kid)
  return filtered


def _enforce_cel_kb_access(
  user_context: UserContext,
  datasource_id: str,
  scope: str,
  request: Request,
) -> None:
  if not cel_evaluate:
    logger.warning("CEL KB access configured but cel_evaluator is not installed")
    raise HTTPException(status_code=503, detail="CEL policy engine unavailable (fail-closed)")
  expr = _kb_cel_expression_for(datasource_id)
  if not expr:
    return
  ctx = _kb_cel_context(user_context, datasource_id, scope, request)
  if not cel_evaluate(expr, ctx):
    logger.warning("CEL denied KB access: user=%s datasource=%s scope=%s", user_context.email, datasource_id, scope)
    raise HTTPException(status_code=403, detail="CEL policy denied access to this knowledge base")


async def get_accessible_kb_ids(
  user_context: UserContext,
  scope: str,
  tenant_id: str,
  team_id: Optional[str] = None,
  request: Optional[Request] = None,
) -> List[str]:
  """
  Resolve datasource / KB identifiers the caller may use for the given scope.

  ``Role.ADMIN`` or realm role ``kb_admin`` yields full access (``["*"]``).
  Merges per-KB realm roles with ``TeamKbOwnership.kb_ids`` when ``team_id`` is set.
  """
  if user_context.email.startswith("client:"):
    return ["*"]
  if user_context.email == "trusted-network" or user_context.email.startswith("trusted:"):
    return ["*"]

  if user_context.role == Role.ADMIN:
    return ["*"]
  roles = user_context.realm_roles
  if KeycloakRole.KB_ADMIN in roles or "kb_admin" in roles:
    return ["*"]

  ids: set[str] = set()
  for perm in user_context.kb_permissions:
    if kb_scope_satisfies(perm.scope, scope):
      ids.add(perm.kb_id)

  if team_id and RBAC_TEAM_SCOPE_ENABLED:
    if not RBAC_MONGODB_URI or not RBAC_MONGODB_DATABASE:
      logger.warning("RBAC team scope enabled but MongoDB not configured — cannot load team KB ownership")
    else:
      try:
        from motor.motor_asyncio import AsyncIOMotorClient

        client: AsyncIOMotorClient = AsyncIOMotorClient(
          RBAC_MONGODB_URI, serverSelectionTimeoutMS=5000
        )
        db = client[RBAC_MONGODB_DATABASE]
        ownership = await db["team_kb_ownership"].find_one(
          {"team_id": team_id, "tenant_id": tenant_id}
        )
      except Exception as e:
        logger.error("MongoDB error resolving team KB access: %s", e)
        return []
      else:
        if ownership:
          for kb in ownership.get("kb_ids", []):
            ids.add(str(kb))

  if "*" in ids:
    return ["*"]
  return _filter_kb_ids_by_cel(user_context, scope, list(ids), request)


async def check_kb_datasource_access(
  request: Request,
  user_context: UserContext,
  datasource_id: str,
  scope: str,
) -> None:
  """Raise ``HTTPException(403)`` if the user cannot access this datasource for ``scope``."""
  if not RBAC_TEAM_SCOPE_ENABLED:
    return
  tenant_id = request.headers.get("X-Tenant-Id") or "default"
  team_id = request.headers.get("X-Team-Id")
  accessible = await get_accessible_kb_ids(user_context, scope, tenant_id, team_id=team_id, request=request)
  if "*" in accessible:
    _enforce_cel_kb_access(user_context, datasource_id, scope, request)
    return
  if not accessible:
    raise HTTPException(
      status_code=403,
      detail="No accessible knowledge bases for this operation",
    )
  if datasource_id in accessible:
    _enforce_cel_kb_access(user_context, datasource_id, scope, request)
    return
  raise HTTPException(status_code=403, detail="Access denied for this datasource")


def require_kb_access(kb_id: str, scope: str):
  """FastAPI dependency factory for a fixed KB/datasource id (e.g. path parameters)."""

  async def _dep(
    request: Request,
    user: UserContext = Depends(require_authenticated_user),
  ) -> UserContext:
    await check_kb_datasource_access(request, user, kb_id, scope)
    return user

  _dep.__name__ = f"require_kb_access_{kb_id}_{scope}"
  return _dep


async def inject_kb_filter(
  query_request: QueryRequest,
  user_context: UserContext,
  tenant_id: str,
  request: Request,
) -> bool:
  """
  Restrict vector search to accessible datasources by mutating ``query_request.filters``.

  Returns:
      True if the handler should return an empty result set without querying the vector DB.
  """
  if not RBAC_TEAM_SCOPE_ENABLED:
    return False
  if user_context.email == "anonymous":
    return False
  if user_context.email == "trusted-network" or user_context.email.startswith("trusted:"):
    return False
  if user_context.email.startswith("client:"):
    return False

  team_id = request.headers.get("X-Team-Id")
  accessible = await get_accessible_kb_ids(user_context, "read", tenant_id, team_id=team_id, request=request)
  if "*" in accessible:
    return False
  if not accessible:
    return True

  filters: Dict[str, Any] = dict(query_request.filters) if query_request.filters else {}
  existing = filters.get("datasource_id")

  if existing is None:
    filters["datasource_id"] = accessible if len(accessible) > 1 else accessible[0]
    query_request.filters = filters
    return False

  if isinstance(existing, str):
    if existing not in accessible:
      return True
    return False

  if isinstance(existing, list):
    inter = [x for x in existing if x in accessible]
    if not inter:
      return True
    filters["datasource_id"] = inter
    query_request.filters = filters
    return False

  return False


async def validate_datasource_binding(
    team_id: str,
    datasource_ids: List[str],
    tenant_id: str = "default",
) -> None:
  """
  Validate that requested datasource_ids are within the team's allowed set.

  Loads the team's TeamKbOwnership record from MongoDB and checks that every
  requested datasource_id is in ``allowed_datasource_ids``.

  Args:
      team_id: Team identifier for the ownership lookup.
      datasource_ids: Datasource IDs the caller wants to bind to a RAG tool.
      tenant_id: Tenant identifier for multi-tenant isolation.

  Raises:
      HTTPException(403): If any datasource_id is outside the team's allowed set.
      HTTPException(503): If MongoDB is unreachable and team-scope is enabled.
  """
  if not RBAC_TEAM_SCOPE_ENABLED:
    logger.debug("Team-scoped datasource binding validation disabled")
    return

  if not datasource_ids:
    return

  if not RBAC_MONGODB_URI or not RBAC_MONGODB_DATABASE:
    logger.warning("RBAC_MONGODB_URI/DATABASE not configured — skipping datasource binding check")
    return

  try:
    from motor.motor_asyncio import AsyncIOMotorClient
    client: AsyncIOMotorClient = AsyncIOMotorClient(
      RBAC_MONGODB_URI, serverSelectionTimeoutMS=5000
    )
    db = client[RBAC_MONGODB_DATABASE]
    ownership = await db["team_kb_ownership"].find_one(
      {"team_id": team_id, "tenant_id": tenant_id}
    )
  except Exception as e:
    logger.error("MongoDB unavailable for datasource binding check: %s", e)
    raise HTTPException(
      status_code=503,
      detail="Team ownership data unavailable — cannot validate datasource binding (fail-closed)",
    )

  if ownership is None:
    logger.warning("No TeamKbOwnership record for team=%s tenant=%s — denying binding", team_id, tenant_id)
    raise HTTPException(
      status_code=403,
      detail=f"No ownership record found for team '{team_id}' — datasource binding denied",
    )

  allowed = set(ownership.get("allowed_datasource_ids", []))
  violations = [ds for ds in datasource_ids if ds not in allowed]

  if violations:
    logger.warning(
      "Datasource binding rejected for team=%s: %s not in allowed set %s",
      team_id, violations, list(allowed),
    )
    raise HTTPException(
      status_code=403,
      detail=f"Datasource binding rejected — {', '.join(violations)} not in team's allowed set",
    )
