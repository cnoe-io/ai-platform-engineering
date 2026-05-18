"""Keycloak Admin API sync for dynamic agent authz resources.

OpenFGA is the authoritative resource-grant store. This service keeps only the
Keycloak Authorization Services resource registration needed by legacy clients;
it no longer creates per-agent realm roles such as ``agent_user:<id>``.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)


class KeycloakSyncService:
  """Register Keycloak authz resources for dynamic agents."""

  def __init__(self) -> None:
    self._base = os.getenv("KEYCLOAK_URL", "http://localhost:7080").rstrip("/")
    self._realm = os.getenv("KEYCLOAK_REALM", "caipe")
    self._admin_client_id = os.getenv("KEYCLOAK_ADMIN_CLIENT_ID", "").strip()
    self._admin_client_secret = (os.getenv("KEYCLOAK_ADMIN_CLIENT_SECRET") or "").strip()
    self._authz_client_id = os.getenv("KEYCLOAK_AUTHZ_CLIENT_ID", "").strip()

  @property
  def enabled(self) -> bool:
    return bool(self._admin_client_id and self._admin_client_secret)

  def _admin_token(self) -> str:
    url = f"{self._base}/realms/{self._realm}/protocol/openid-connect/token"
    data = {
      "grant_type": "client_credentials",
      "client_id": self._admin_client_id,
      "client_secret": self._admin_client_secret,
    }
    with httpx.Client(timeout=15.0) as client:
      r = client.post(url, data=data)
      r.raise_for_status()
      return str(r.json()["access_token"])

  def _headers(self) -> dict[str, str]:
    return {"Authorization": f"Bearer {self._admin_token()}"}

  def _client_uuid(self, client_id: str) -> str | None:
    url = f"{self._base}/admin/realms/{self._realm}/clients"
    with httpx.Client(timeout=15.0) as client:
      r = client.get(url, params={"clientId": client_id}, headers=self._headers())
      r.raise_for_status()
      items = r.json()
      if isinstance(items, list) and items:
        cid = items[0].get("id")
        return str(cid) if cid else None
    return None

  def _delete_authz_resource_by_name(self, client_uuid: str, name: str) -> None:
    base = f"{self._base}/admin/realms/{self._realm}/clients/{client_uuid}/authz/resource-server/resource"
    with httpx.Client(timeout=15.0) as client:
      r = client.get(base, params={"name": name}, headers=self._headers())
      r.raise_for_status()
      rows = r.json() if isinstance(r.json(), list) else []
      for row in rows:
        if not isinstance(row, dict):
          continue
        rid = row.get("id") or row.get("_id")
        if row.get("name") == name and rid:
          dr = client.delete(f"{base}/{rid}", headers=self._headers())
          if dr.status_code not in (200, 204, 404):
            dr.raise_for_status()
          return

  def sync_agent_resource(self, agent_id: str, agent_name: str, visibility: str) -> None:
    if not self.enabled:
      logger.debug("Keycloak sync skipped: admin client credentials not configured")
      return
    if not self._authz_client_id:
      return
    c_uuid = self._client_uuid(self._authz_client_id)
    if not c_uuid:
      logger.warning("Keycloak authz client %r not found — skipping resource sync", self._authz_client_id)
      return
    scope_names = ["view", "invoke", "configure", "delete"]
    res_name = f"dynamic_agent:{agent_id}"
    base = f"{self._base}/admin/realms/{self._realm}/clients/{c_uuid}/authz/resource-server/resource"
    payload: dict[str, Any] = {
      "name": res_name,
      "displayName": agent_name,
      "type": "dynamic_agent",
      "attributes": {"visibility": [visibility], "agent_id": [agent_id]},
      "uris": [],
      "scopes": [{"name": n} for n in scope_names],
    }
    with httpx.Client(timeout=20.0) as client:
      r = client.post(base, json=payload, headers=self._headers())
      if r.status_code == 409:
        return
      r.raise_for_status()

  def remove_agent_resource(self, agent_id: str) -> None:
    if not self.enabled:
      return
    if not self._authz_client_id:
      return
    c_uuid = self._client_uuid(self._authz_client_id)
    if c_uuid:
      self._delete_authz_resource_by_name(c_uuid, f"dynamic_agent:{agent_id}")


_sync_singleton: KeycloakSyncService | None = None


def get_keycloak_sync_service() -> KeycloakSyncService:
  global _sync_singleton
  if _sync_singleton is None:
    _sync_singleton = KeycloakSyncService()
  return _sync_singleton
