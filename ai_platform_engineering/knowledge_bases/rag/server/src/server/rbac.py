"""
Role-Based Access Control (RBAC) implementation for the RAG API.

Role Hierarchy:
- READONLY: Authenticated human users and read-only service clients
- INGESTONLY: Ingestor service clients
- ADMIN: Administrative service clients

This module provides:
- User context extraction from JWT tokens (Bearer authentication)
- Service role determination for client-credentials tokens
- Fine-grained knowledge-base and datasource authorization via OpenFGA
- FastAPI dependencies for role-based endpoint protection
"""

import os
import re
from typing import List, Dict, Any, Optional
from fastapi import Depends, HTTPException, Request
from jwt.exceptions import PyJWTError as JWTError
import httpx
from common.models.rbac import Role, UserContext
from common.models.server import QueryRequest
from common import utils
from server.auth import get_auth_manager, AuthManager

logger = utils.get_logger(__name__)

# Email validation regex (RFC 5322 simplified)
EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")
OPENFGA_ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")
DEFAULT_OPENFGA_STORE_NAME = "caipe-openfga"
DEFAULT_ORG_KEY = "caipe"

# ============================================================================
# Configuration
# ============================================================================

# Default role for client credentials tokens (machine-to-machine)
# These tokens don't have user/group information, so we assign a fixed role
RBAC_CLIENT_CREDENTIALS_ROLE = os.getenv("RBAC_CLIENT_CREDENTIALS_ROLE", Role.INGESTONLY)

# Validate roles at startup
VALID_ROLES = {Role.READONLY, Role.INGESTONLY, Role.ADMIN}

if RBAC_CLIENT_CREDENTIALS_ROLE not in VALID_ROLES:
  logger.error(f"Invalid RBAC_CLIENT_CREDENTIALS_ROLE: '{RBAC_CLIENT_CREDENTIALS_ROLE}'. Must be one of: {VALID_ROLES}")
  raise ValueError(f"Invalid RBAC_CLIENT_CREDENTIALS_ROLE: '{RBAC_CLIENT_CREDENTIALS_ROLE}'. Valid values are: {', '.join(VALID_ROLES)}")

logger.info("RBAC Configuration:")
logger.info("  Human coarse roles: authenticated identity only")
logger.info("  RAG authorization: OpenFGA ReBAC")
logger.info(f"  RBAC_CLIENT_CREDENTIALS_ROLE: {RBAC_CLIENT_CREDENTIALS_ROLE}")

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


_KB_SCOPE_RANK = {"read": 1, "ingest": 2, "admin": 3}


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
# FastAPI Dependencies
# ============================================================================


async def _authenticate_from_token(request: Request, auth_manager: AuthManager) -> Optional[UserContext]:
  """
  Internal helper to authenticate user from JWT token.

  For user tokens, extracts identity from the already-validated OIDC access
  token. Knowledge-base authorization is enforced later through OpenFGA.

  Flow:
  1. Validate access_token (signature, expiry, audience, issuer)
  2. Check if client credentials token (machine-to-machine) → return immediately
  3. Extract 'sub', email, and realm roles from access_token for audit context
  4. Assign the authenticated human baseline role; resource grants come from OpenFGA

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
        role=RBAC_CLIENT_CREDENTIALS_ROLE,
        is_authenticated=True,
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

    # Validate email format for human tokens. Service-account tokens return
    # before this branch, and KB authz is OpenFGA-based instead of email-based.
    if email and email != "unknown" and not EMAIL_REGEX.match(email):
      logger.warning(f"Invalid email format in claims: {email[:50]}")

    role = Role.READONLY

    user_context = UserContext(
      subject=sub if sub != "unknown" else None,
      email=email,
      role=role,
      is_authenticated=True,
    )

    logger.info(
      "User authenticated successfully: email=%s, source=access_token, authorization=openfga",
      email,
    )
    return user_context

  except JWTError as e:
    logger.warning(f"Token validation failed: {e}")
    return None


async def require_authenticated_user(request: Request, auth_manager: AuthManager = Depends(get_auth_manager)) -> UserContext:
  """
  Require authentication and extract user context from a JWT token.

  This dependency REQUIRES valid authentication. If authentication is missing or invalid,
  it raises HTTPException(401). Use this for protected endpoints that need authentication.

  Authentication flow:
  1. If Bearer token present, validate JWT and extract user context
  2. Otherwise raise 401

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

  # No token
  raise HTTPException(status_code=401, detail="Missing Authorization header. Please provide a valid Bearer token.")


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
# OpenFGA-backed RAG authorization
# ============================================================================

# MongoDB URI for channel-to-team lookup data.
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


def is_unsafe_rbac_bypass_enabled() -> bool:
  """Return True when the shared emergency RBAC bypass is explicitly enabled."""
  return os.getenv("CAIPE_UNSAFE_RBAC_BYPASS", "").strip().lower() in ("true", "1", "yes")


def is_org_admin_bypass_disabled() -> bool:
  """Return True when the RAG org-admin OpenFGA super-grant is disabled."""
  return os.getenv("RAG_ADMIN_BYPASS_DISABLED", "").strip().lower() in ("true", "1", "yes")


def _caipe_org_key() -> str:
  """Return the configured CAIPE organization key for OpenFGA checks."""
  value = os.getenv("CAIPE_ORG_KEY", "").strip()
  return value if OPENFGA_ID_PATTERN.fullmatch(value) else DEFAULT_ORG_KEY


def _has_unrestricted_kb_access(user_context: UserContext) -> bool:
  """Return True for principals that intentionally bypass per-KB filtering."""
  if is_unsafe_rbac_bypass_enabled():
    logger.warning("CAIPE_UNSAFE_RBAC_BYPASS=true: allowing unrestricted RAG KB access")
    return True
  if user_context.email.startswith("client:"):
    return True
  return False

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


async def _openfga_check_object(
  user_context: UserContext,
  relation: str,
  object_type: str,
  object_id: str,
) -> bool:
  """Check a user's derived relation on an OpenFGA object."""
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
          "object": f"{object_type}:{object_id}",
        }
      },
    )
    response.raise_for_status()
    return bool(response.json().get("allowed"))


async def _openfga_check_data_source(
  user_context: UserContext,
  relation: str,
  object_id: str,
) -> bool:
  """Check a user's derived relation on a data_source object in OpenFGA."""
  return await _openfga_check_object(user_context, relation, "data_source", object_id)


async def _openfga_check_org_admin(user_context: UserContext) -> bool:
  """Check whether the user has the organization admin super-grant."""
  if is_org_admin_bypass_disabled():
    return False
  return await _openfga_check_object(user_context, "can_manage", "organization", _caipe_org_key())


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


async def _resolve_team_slug_from_channel(channel_id: str) -> Optional[str]:
  """Derive a team slug from an originating collaboration channel.

  Looks up the ``channel_team_mappings`` MongoDB collection by channel
  identifier and returns the joined ``teams.slug``.

  Returns ``None`` when:
  - Mongo is not configured
  - No active mapping exists for ``channel_id``
  - The mapping points to a team that is missing or has no slug
  - Mongo errors (we degrade rather than 503 — caller treats no-team as
    "fall back to user grants only", which is safe for read-side queries)

  This helper is intentionally minimal: identifier resolution lives in the
  BFF; the RAG server only needs the slug.
  """
  if not channel_id or not RBAC_MONGODB_URI or not RBAC_MONGODB_DATABASE:
    return None
  try:
    from motor.motor_asyncio import AsyncIOMotorClient

    client: AsyncIOMotorClient = AsyncIOMotorClient(
      RBAC_MONGODB_URI, serverSelectionTimeoutMS=5000
    )
    db = client[RBAC_MONGODB_DATABASE]
    mapping = await db["channel_team_mappings"].find_one(
      {"slack_channel_id": channel_id, "active": {"$ne": False}},
    )
    if not mapping:
      return None
    team_id = mapping.get("team_id")
    if not team_id:
      return None
    team = await db["teams"].find_one({"_id": team_id})
    if not team:
      return None
    slug = team.get("slug")
    return slug.strip() if isinstance(slug, str) and slug.strip() else None
  except Exception as exc:  # noqa: BLE001 — never break the request on Mongo glitches
    logger.warning(
      "Channel→team lookup failed (channel_id=%s): %s", channel_id, exc
    )
    return None


async def derive_team_for_request(
  request: Optional[Request],
  user_context: Any,  # noqa: ARG001 — accepted for dependency call-site parity
) -> Optional[str]:
  """Resolve the optional team scope carried by the request.

  Resolution order:

  1. ``X-Team-Id`` request header — explicit team scope (used by Web UI BFF
     and bot envelopes that have already resolved a team from a channel
     mapping).
  2. ``X-Channel-Id`` header → ``channel_team_mappings`` → ``teams.slug``.
  3. ``None`` — caller interprets as "no team scope" (personal / DM).

  ``"__personal__"`` in the header is normalized to ``None``; it is the
  caller's explicit "DM / no team" signal.

  ``request`` may be ``None`` (MCP tool path doesn't always have one);
  in that case the function returns ``None``.
  """
  if request is None:
    return None

  header_team = request.headers.get("X-Team-Id") if request.headers else None
  if isinstance(header_team, str) and header_team.strip():
    stripped = header_team.strip()
    return None if stripped == "__personal__" else stripped

  channel_id = request.headers.get("X-Channel-Id") if request.headers else None
  if isinstance(channel_id, str) and channel_id.strip():
    try:
      return await _resolve_team_slug_from_channel(channel_id.strip())
    except Exception as exc:  # noqa: BLE001 — defense in depth
      logger.warning(
        "derive_team_for_request: channel resolver raised (channel_id=%s): %s",
        channel_id,
        exc,
      )
      return None

  return None


async def get_accessible_datasource_ids(
  user_context: UserContext,
  scope: str,
  tenant_id: str,
  team_id: Optional[str] = None,
  request: Optional[Request] = None,
) -> List[str]:
  """
  Resolve datasource-component identifiers the caller may use for the given scope.

  Knowledge bases remain the parent RAG feature resource. This helper is for
  operations that target the data sources inside that feature, where read and
  ingest/write grants may differ per datasource.
  """
  if _has_unrestricted_kb_access(user_context):
    return ["*"]

  ids: set[str] = set()

  if _openfga_http_url() and user_context.is_authenticated:
    relation = _scope_to_openfga_relation(scope)
    try:
      if await _openfga_check_org_admin(user_context):
        return ["*"]
      objects = await _openfga_list_objects(user_context, relation, "data_source")
    except Exception as exc:
      logger.warning("OpenFGA data_source list-objects failed: %s", exc)
      raise HTTPException(
        status_code=503,
        detail="Authorization service is temporarily unavailable",
      ) from exc
    for obj in objects:
      ids.add(_strip_openfga_object_prefix(obj, "data_source"))
  elif RBAC_TEAM_SCOPE_ENABLED and user_context.is_authenticated:
    raise HTTPException(
      status_code=503,
      detail="Authorization service is temporarily unavailable",
    )

  if "*" in ids:
    return ["*"]
  return list(ids)


async def check_datasource_access(
  request: Request,
  user_context: UserContext,
  datasource_id: str,
  scope: str,
) -> None:
  """Raise ``HTTPException(403)`` if the user cannot use this datasource component for ``scope``."""
  if not RBAC_TEAM_SCOPE_ENABLED:
    return
  tenant_id = request.headers.get("X-Tenant-Id") or "default"
  if _has_unrestricted_kb_access(user_context):
    return
  if _openfga_http_url() and user_context.is_authenticated:
    relation = _scope_to_openfga_relation(scope)
    try:
      allowed = await _openfga_check_data_source(user_context, relation, datasource_id)
    except Exception as exc:
      logger.warning("OpenFGA data_source check failed: %s", exc)
      raise HTTPException(
        status_code=503,
        detail="Authorization service is temporarily unavailable",
      ) from exc
    if allowed:
      return
    try:
      if await _openfga_check_org_admin(user_context):
        return
    except Exception as exc:
      logger.warning("OpenFGA organization admin check failed: %s", exc)
      raise HTTPException(
        status_code=503,
        detail="Authorization service is temporarily unavailable",
      ) from exc
    raise HTTPException(status_code=403, detail="Access denied for this datasource")

  if user_context.is_authenticated:
    raise HTTPException(
      status_code=503,
      detail="Authorization service is temporarily unavailable",
    )

  team_id = await derive_team_for_request(request, user_context)
  accessible = await get_accessible_datasource_ids(user_context, scope, tenant_id, team_id=team_id, request=request)
  if "*" in accessible:
    return
  if not accessible:
    raise HTTPException(
      status_code=403,
      detail="No accessible datasources for this operation",
    )
  if datasource_id in accessible:
    return
  raise HTTPException(status_code=403, detail="Access denied for this datasource")


def require_kb_access(kb_id: str, scope: str):
  """FastAPI dependency factory for routes whose path id addresses a datasource component."""

  async def _dep(
    request: Request,
    user: UserContext = Depends(require_authenticated_user),
  ) -> UserContext:
    await check_datasource_access(request, user, kb_id, scope)
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
  # is off but doc-ACL is on. The helper is itself a no-op for
  # client-credentials principals, so this is safe.
  try:
    from .doc_acl import apply_doc_acl_filter

    apply_doc_acl_filter(query_request, user_context)
  except Exception as exc:  # noqa: BLE001 — never break the query path on ACL bugs
    logger.warning("doc_acl: apply_doc_acl_filter failed (non-fatal): %s", exc)

  if not RBAC_TEAM_SCOPE_ENABLED:
    return False
  if user_context.email.startswith("client:"):
    return False

  team_id = await derive_team_for_request(request, user_context)
  accessible = await get_accessible_datasource_ids(user_context, "read", tenant_id, team_id=team_id, request=request)
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
