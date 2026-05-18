"""
Role-Based Access Control (RBAC) implementation for the RAG API.

Role Hierarchy:
- READONLY: Can view/query all data
- INGESTONLY: READONLY + can ingest data and manage ingestion jobs
- ADMIN: INGESTONLY + can delete resources and perform bulk operations

This module provides:
- User context extraction from JWT tokens (Bearer authentication)
- Trusted network access (IP-based or header-based)
- Coarse service role determination from Keycloak realm roles
- Fine-grained knowledge_base authorization via OpenFGA / team ReBAC
- FastAPI dependencies for role-based endpoint protection
"""

import os
import re
import ipaddress
from typing import List, Dict, Any, Optional
from fastapi import Depends, HTTPException, Request
from jwt.exceptions import PyJWTError as JWTError
import httpx
from common.models.rbac import Role, UserContext, KbPermission, KeycloakRole
from common.models.server import QueryRequest
from common import utils
from server.auth import get_auth_manager, AuthManager

logger = utils.get_logger(__name__)

# Email validation regex (RFC 5322 simplified)
EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")
OPENFGA_ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")
DEFAULT_OPENFGA_STORE_NAME = "caipe-openfga"

# ============================================================================
# Configuration
# ============================================================================

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
        logger.error("Invalid CIDR in TRUSTED_NETWORK_CIDRS: [redacted] - %s", type(e).__name__)

# Validate roles at startup
VALID_ROLES = {Role.READONLY, Role.INGESTONLY, Role.ADMIN}

if RBAC_CLIENT_CREDENTIALS_ROLE not in VALID_ROLES:
  logger.error(f"Invalid RBAC_CLIENT_CREDENTIALS_ROLE: '{RBAC_CLIENT_CREDENTIALS_ROLE}'. Must be one of: {VALID_ROLES}")
  raise ValueError(f"Invalid RBAC_CLIENT_CREDENTIALS_ROLE: '{RBAC_CLIENT_CREDENTIALS_ROLE}'. Valid values are: {', '.join(VALID_ROLES)}")

if TRUSTED_NETWORK_DEFAULT_ROLE not in VALID_ROLES:
  logger.error("Invalid TRUSTED_NETWORK_DEFAULT_ROLE: [redacted]. Must be one of: %s", VALID_ROLES)
  raise ValueError(f"Invalid TRUSTED_NETWORK_DEFAULT_ROLE. Valid values are: {', '.join(VALID_ROLES)}")

logger.info("RBAC Configuration:")
logger.info("  Human coarse roles: Keycloak realm roles only")
logger.info("  KB authorization: OpenFGA knowledge_base / team ReBAC")
logger.info(f"  RBAC_CLIENT_CREDENTIALS_ROLE: {RBAC_CLIENT_CREDENTIALS_ROLE}")
logger.info("  ALLOW_TRUSTED_NETWORK: %s", "enabled" if ALLOW_TRUSTED_NETWORK else "disabled")
if ALLOW_TRUSTED_NETWORK:
  logger.info("  TRUSTED_NETWORK_CIDRS: %d ranges configured", len(TRUSTED_NETWORK_CIDRS))
  logger.info("  TRUSTED_NETWORK_TOKEN: %s", "(set)" if TRUSTED_NETWORK_TOKEN else "(not set)")
  logger.info("  TRUSTED_NETWORK_DEFAULT_ROLE: [configured]")

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


def determine_role_from_keycloak_roles(roles: List[str]) -> str:
  """
  Map Keycloak realm roles in the JWT to internal RAG roles (most permissive wins).

  Mapping:
    - ``admin`` / ``admin_user`` (Spec 104 platform admin) → ADMIN
    - ``kb_admin`` → INGESTONLY
    - ``team_member`` / ``chat_user`` → READONLY
    - ``denied`` or no recognized role → ANONYMOUS

  Spec 104 note: ``admin_user`` is the realm role assigned to
  ``BOOTSTRAP_ADMIN_EMAILS`` users by ``init-idp.sh``. Treating it as RAG
  ADMIN means a single Keycloak grant gives platform admins full RAG
  access (read + ingest + delete) without having to also assign the
  legacy ``admin`` realm role.
  """
  rs = set(roles)
  if (
    KeycloakRole.ADMIN in rs
    or "admin" in rs
    or KeycloakRole.ADMIN_USER in rs
    or "admin_user" in rs
  ):
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


def extract_active_team_from_claims(claims: Dict[str, Any]) -> Optional[str]:
  """Spec 104: read the signed `active_team` JWT claim, if present.

  Returns the literal sentinel ``"__personal__"`` for DM/personal mode,
  a team slug like ``"platform-eng"`` for mapped channels, or ``None``
  when the token has no claim (legacy SA tokens, BFF-issued login tokens
  before the per-team scope rollout, etc.). Callers decide whether
  ``None`` is a hard reject or a soft fallback to legacy behavior.
  """
  value = claims.get("active_team")
  if isinstance(value, str) and value.strip():
    return value.strip()
  return None


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

  # Keycloak client-credentials tokens include `preferred_username` in the
  # form `service-account-<client_id>`, which is not a human user claim.
  has_client_id = bool(claims.get("client_id") or claims.get("azp") or claims.get("clientId"))
  preferred_username = claims.get("preferred_username")
  if has_client_id and isinstance(preferred_username, str) and preferred_username.startswith("service-account-"):
    logger.debug("Client credentials detected: Keycloak service account token")
    return True

  # Check for client_id without typical user claims
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
            logger.debug("Trusted network access granted via CIDR match")
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

  For user tokens, extracts identity and coarse service roles directly from
  the already-validated Keycloak access token. Knowledge-base authorization is
  enforced later through OpenFGA/team ReBAC checks, not IdP/AD group fallback.

  Flow:
  1. Validate access_token (signature, expiry, audience, issuer)
  2. Check if client credentials token (machine-to-machine) → return immediately
  3. Extract 'sub', email, realm roles, and active_team from access_token
  4. Determine coarse RAG service role from Keycloak realm roles

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
        subject=access_claims.get("sub") if isinstance(access_claims.get("sub"), str) else client_id,
        email=email,
        groups=[],  # Client credentials don't have groups
        role=RBAC_CLIENT_CREDENTIALS_ROLE,
        is_authenticated=True,
        kb_permissions=[],
        realm_roles=extract_realm_roles_from_claims(access_claims),
        active_team=extract_active_team_from_claims(access_claims),
      )

      logger.debug(f"Client authenticated: {email}, role: {RBAC_CLIENT_CREDENTIALS_ROLE}")
      return user_context
    else:
      logger.debug("Regular user token detected (not client credentials)")

    # Extract user identity from the validated Keycloak token.
    sub = access_claims.get("sub")
    if not sub:
      logger.warning("Access token missing 'sub' claim")
      sub = "unknown"
    else:
      logger.debug(f"Extracted sub from access_token: {sub[:16]}...")

    email = extract_email_from_claims(access_claims)
    groups: List[str] = []

    # Validate email format for human tokens. Service-account tokens return
    # before this branch, and KB authz is ReBAC-based instead of email/group-based.
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
        role = Role.ANONYMOUS
        logger.info(f"Role denied: no mapped Keycloak realm role for email={email}, roles={platform_roles}")
    else:
      role = Role.ANONYMOUS
      logger.info(f"Role denied: no Keycloak realm roles for email={email}")

    active_team = extract_active_team_from_claims(access_claims)
    user_context = UserContext(
      subject=sub if sub != "unknown" else None,
      email=email,
      groups=groups,
      role=role,
      is_authenticated=True,
      kb_permissions=kb_permissions,
      realm_roles=jwt_roles,
      active_team=active_team,
    )

    logger.info(
      f"User authenticated successfully: email={email}, role={role}, "
      f"active_team={active_team}, source=access_token"
    )
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
      logger.info("Trusted network request: ingestor_type=%s, ingestor_name=%s", ingestor_type, ingestor_name)
      email = f"trusted:{ingestor_type}:{ingestor_name}"
    else:
      logger.info("Trusted network request (anonymous)")
      email = "trusted-network"

    return UserContext(
      subject=None,
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
      logger.info("Trusted network request: ingestor_type=%s, ingestor_name=%s", ingestor_type, ingestor_name)
      email = f"trusted:{ingestor_type}:{ingestor_name}"
    else:
      logger.info("Trusted network request (anonymous)")
      email = "trusted-network"

    return UserContext(
      subject=None,
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
    subject=None,
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


def _openfga_http_url() -> Optional[str]:
  """Return the configured OpenFGA HTTP base URL, if enabled."""
  value = os.getenv("OPENFGA_HTTP", "").strip().rstrip("/")
  return value or None


def _openfga_store_name() -> str:
  return os.getenv("OPENFGA_STORE_NAME", "").strip() or DEFAULT_OPENFGA_STORE_NAME


def _scope_to_openfga_relation(scope: str) -> str:
  if scope == "admin":
    return "can_manage"
  if scope == "ingest":
    return "can_ingest"
  return "can_read"


def _has_unrestricted_kb_access(user_context: UserContext) -> bool:
  """Return True for principals that intentionally bypass per-KB filtering."""
  if user_context.email.startswith("client:"):
    return True
  if user_context.email == "trusted-network" or user_context.email.startswith("trusted:"):
    return True
  if user_context.role == Role.ADMIN:
    return True
  roles = user_context.realm_roles
  return KeycloakRole.KB_ADMIN in roles or "kb_admin" in roles


def _openfga_user(user_context: UserContext) -> Optional[str]:
  subject = getattr(user_context, "subject", None)
  if isinstance(subject, str) and OPENFGA_ID_PATTERN.fullmatch(subject):
    return f"user:{subject}"
  return None


async def _get_openfga_store_id(client: httpx.AsyncClient, base_url: str) -> str:
  explicit_store_id = os.getenv("OPENFGA_STORE_ID", "").strip()
  if explicit_store_id:
    return explicit_store_id

  response = await client.get(f"{base_url}/stores", headers={"Content-Type": "application/json"})
  response.raise_for_status()
  body = response.json()
  store_name = _openfga_store_name()
  for store in body.get("stores", []):
    if store.get("name") == store_name and store.get("id"):
      return str(store["id"])
  raise RuntimeError(f"OpenFGA store {store_name} was not found")


async def _openfga_check_knowledge_base(
  user_context: UserContext,
  relation: str,
  object_id: str,
) -> bool:
  """Check a user's derived relation on a knowledge_base object in OpenFGA."""
  base_url = _openfga_http_url()
  user = _openfga_user(user_context)
  if not base_url or not user:
    return False

  async with httpx.AsyncClient(timeout=5.0) as client:
    store_id = await _get_openfga_store_id(client, base_url)
    response = await client.post(
      f"{base_url}/stores/{store_id}/check",
      headers={"Content-Type": "application/json"},
      json={
        "tuple_key": {
          "user": user,
          "relation": relation,
          "object": f"knowledge_base:{object_id}",
        }
      },
    )
    response.raise_for_status()
    return bool(response.json().get("allowed"))


async def _openfga_list_objects(
  user_context: UserContext,
  relation: str,
  object_type: str,
) -> List[str]:
  """List OpenFGA objects of a type that the authenticated user can access."""
  base_url = _openfga_http_url()
  user = _openfga_user(user_context)
  if not base_url or not user:
    return []

  async with httpx.AsyncClient(timeout=5.0) as client:
    store_id = await _get_openfga_store_id(client, base_url)
    response = await client.post(
      f"{base_url}/stores/{store_id}/list-objects",
      headers={"Content-Type": "application/json"},
      json={
        "user": user,
        "relation": relation,
        "type": object_type,
      },
    )
    response.raise_for_status()
    body = response.json()
    return [str(obj) for obj in body.get("objects", []) if isinstance(obj, str)]


def _strip_openfga_object_prefix(value: str, object_type: str) -> str:
  prefix = f"{object_type}:"
  return value[len(prefix):] if value.startswith(prefix) else value


async def _get_team_kb_ownership_from_mongo(
  team_id: str,
  tenant_id: str,
) -> Optional[Dict[str, Any]]:
  """Query MongoDB ``team_kb_ownership`` for a single team. Returns None on error (fail-closed)."""
  if not RBAC_MONGODB_URI or not RBAC_MONGODB_DATABASE:
    logger.warning("RBAC MongoDB not configured — cannot load team KB ownership")
    return None
  try:
    from motor.motor_asyncio import AsyncIOMotorClient

    client: AsyncIOMotorClient = AsyncIOMotorClient(
      RBAC_MONGODB_URI, serverSelectionTimeoutMS=5000
    )
    db = client[RBAC_MONGODB_DATABASE]
    return await db["team_kb_ownership"].find_one(
      {"team_id": team_id, "tenant_id": tenant_id}
    )
  except Exception as e:
    logger.error("MongoDB error resolving team KB access for team=%s: %s", team_id, e)
    return None


async def get_global_read_kb_ids(tenant_id: str = "default") -> List[str]:
  """
  Return datasource IDs from the ``global`` pseudo-team (FR-038).

  These KBs are readable by all authenticated users.
  """
  ownership = await _get_team_kb_ownership_from_mongo("global", tenant_id)
  if not ownership:
    return []
  return [str(kb) for kb in ownership.get("kb_ids", [])]


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
  Global-read KBs (pseudo-team ``global``) are always included for ``read`` scope.
  """
  if _has_unrestricted_kb_access(user_context):
    return ["*"]

  ids: set[str] = set()
  for perm in user_context.kb_permissions:
    if kb_scope_satisfies(perm.scope, scope):
      ids.add(perm.kb_id)

  if _openfga_http_url() and user_context.is_authenticated:
    relation = _scope_to_openfga_relation(scope)
    try:
      objects = await _openfga_list_objects(user_context, relation, "knowledge_base")
    except Exception as exc:
      logger.warning("OpenFGA knowledge_base list-objects failed: %s", exc)
      raise HTTPException(
        status_code=503,
        detail="Authorization service is temporarily unavailable",
      ) from exc
    for obj in objects:
      ids.add(_strip_openfga_object_prefix(obj, "knowledge_base"))

  if RBAC_TEAM_SCOPE_ENABLED:
    if team_id:
      ownership = await _get_team_kb_ownership_from_mongo(team_id, tenant_id)
      if ownership is None and RBAC_MONGODB_URI:
        return []
      if ownership:
        kb_perms = ownership.get("kb_permissions", {})
        for kb in ownership.get("kb_ids", []):
          kb_str = str(kb)
          perm_level = kb_perms.get(kb_str, "read")
          if kb_scope_satisfies(perm_level, scope):
            ids.add(kb_str)

    if scope == "read":
      global_kbs = await get_global_read_kb_ids(tenant_id)
      for kb in global_kbs:
        ids.add(kb)

  if "*" in ids:
    return ["*"]
  return list(ids)


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
  if _has_unrestricted_kb_access(user_context):
    return
  openfga_denied = False
  if _openfga_http_url() and user_context.is_authenticated:
    relation = _scope_to_openfga_relation(scope)
    try:
      allowed = await _openfga_check_knowledge_base(user_context, relation, datasource_id)
    except Exception as exc:
      logger.warning("OpenFGA knowledge_base check failed: %s", exc)
      raise HTTPException(
        status_code=503,
        detail="Authorization service is temporarily unavailable",
      ) from exc
    if allowed:
      return
    openfga_denied = True

  if openfga_denied:
    for perm in user_context.kb_permissions:
      if perm.kb_id in (datasource_id, "*") and kb_scope_satisfies(perm.scope, scope):
        return
    raise HTTPException(status_code=403, detail="Access denied for this datasource")

  # Spec 104: `active_team` JWT claim is the single source of truth.
  # Fall back to the legacy `X-Team-Id` header only when the token has no
  # claim (e.g. legacy SA tokens) so mid-rollout traffic doesn't 403.
  team_id = user_context.active_team or request.headers.get("X-Team-Id")
  if team_id == "__personal__":
    team_id = None
  accessible = await get_accessible_kb_ids(user_context, scope, tenant_id, team_id=team_id, request=request)
  if "*" in accessible:
    return
  if not accessible:
    if openfga_denied:
      raise HTTPException(status_code=403, detail="Access denied for this datasource")
    raise HTTPException(
      status_code=403,
      detail="No accessible knowledge bases for this operation",
    )
  if datasource_id in accessible:
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
  # Hybrid ACL (per-doc acl_tags) — opt-in via RBAC_DOC_ACL_TAGS_ENABLED.
  # Apply BEFORE the early-returns below so it still runs when team-scope
  # is off but doc-ACL is on. The helper is itself a no-op for trusted /
  # anonymous / client-credentials principals, so this is safe.
  try:
    from .doc_acl import apply_doc_acl_filter

    apply_doc_acl_filter(query_request, user_context)
  except Exception as exc:  # noqa: BLE001 — never break the query path on ACL bugs
    logger.warning("doc_acl: apply_doc_acl_filter failed (non-fatal): %s", exc)

  if not RBAC_TEAM_SCOPE_ENABLED:
    return False
  if user_context.email == "anonymous":
    return False
  if user_context.email == "trusted-network" or user_context.email.startswith("trusted:"):
    return False
  if user_context.email.startswith("client:"):
    return False

  # Spec 104: prefer signed `active_team` claim; fall back to legacy header.
  team_id = user_context.active_team or request.headers.get("X-Team-Id")
  if team_id == "__personal__":
    team_id = None
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
