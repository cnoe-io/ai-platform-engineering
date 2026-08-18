"""Deployment-owned bridge router for parallel caipe-authz migration."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import threading
import time
from concurrent import futures
from dataclasses import dataclass
from typing import Any, Callable, Protocol

import grpc


class Response(Protocol):
  status: Any


@dataclass(frozen=True)
class Selection:
  surface: str
  subject: str
  resource_type: str
  resource_id: str
  action: str
  correlation_id: str | None


@dataclass(frozen=True)
class Scope:
  surface: str
  resource_type: str
  action: str
  mode: str
  exact_resources: tuple[str, ...] = ()
  subject_types: tuple[str, ...] = ()
  canary_percent: float = 0
  expression_mode: str = "off"
  owner: str = ""

  def matches(self, selection: Selection) -> bool:
    subject_type = selection.subject.split(":", 1)[0]
    return (
      self.surface == selection.surface
      and self.resource_type == selection.resource_type
      and self.action == selection.action
      and (not self.exact_resources or selection.resource_id in self.exact_resources)
      and (not self.subject_types or subject_type in self.subject_types)
    )

  @property
  def specificity(self) -> int:
    return int(bool(self.exact_resources)) + int(bool(self.subject_types))


@dataclass(frozen=True)
class Rollout:
  revision: str
  default_mode: str
  canary_seed: str
  shadow_timeout_ms: int
  scopes: tuple[Scope, ...]

  def configured_mode(self, selection: Selection) -> tuple[str, Scope | None]:
    matches = sorted(
      (scope for scope in self.scopes if scope.matches(selection)),
      key=lambda scope: scope.specificity,
      reverse=True,
    )
    if len(matches) > 1 and matches[0].specificity == matches[1].specificity:
      raise ValueError("ambiguous migration scopes")
    scope = matches[0] if matches else None
    return (scope.mode if scope else self.default_mode), scope

  def mode(self, selection: Selection) -> str:
    mode, scope = self.configured_mode(selection)
    if mode != "CANARY":
      return mode
    assert scope is not None
    message = "\x1f".join(
      (
        self.revision,
        selection.surface,
        selection.subject,
        selection.resource_type,
        selection.resource_id,
        selection.action,
      )
    ).encode()
    digest = hmac.new(self.canary_seed.encode(), message, hashlib.sha256).digest()
    bucket = int.from_bytes(digest[:8], "big") % 10000
    return "AUTHZ" if bucket < round(scope.canary_percent * 100) else "SHADOW"


def parse_rollout(raw: str) -> Rollout:
  if not raw.strip():
    return Rollout("legacy-default", "LEGACY", "default-disabled-canary-seed", 100, ())
  value = json.loads(raw)
  if not isinstance(value, dict):
    raise ValueError("AUTHZ_ROLLOUT_JSON must be an object")
  allowed = {"revision", "default_mode", "canary_seed", "shadow_timeout_ms", "scopes"}
  if set(value) - allowed:
    raise ValueError("unknown rollout field")
  modes = {"LEGACY", "SHADOW", "CANARY", "AUTHZ", "AUTHZ_ONLY"}
  if value.get("default_mode") not in modes:
    raise ValueError("invalid default migration mode")
  seed = value.get("canary_seed")
  if not isinstance(seed, str) or len(seed) < 16:
    raise ValueError("invalid canary seed")
  revision = value.get("revision")
  if not isinstance(revision, str) or not revision:
    raise ValueError("rollout revision is required")
  shadow_timeout = value.get("shadow_timeout_ms", 100)
  if not isinstance(shadow_timeout, int) or not 10 <= shadow_timeout <= 5000:
    raise ValueError("invalid shadow timeout")
  scopes: list[Scope] = []
  for item in value.get("scopes", []):
    if not isinstance(item, dict) or item.get("mode") not in modes:
      raise ValueError("invalid migration scope")
    scope_allowed = {
      "surface", "resource_type", "action", "mode", "exact_resources",
      "subject_types", "canary_percent", "expression_mode", "owner",
    }
    if set(item) - scope_allowed:
      raise ValueError("unknown migration scope field")
    scope = Scope(
      surface=str(item.get("surface", "")),
      resource_type=str(item.get("resource_type", "")),
      action=str(item.get("action", "")),
      mode=str(item["mode"]),
      exact_resources=tuple(item.get("exact_resources", [])),
      subject_types=tuple(item.get("subject_types", [])),
      canary_percent=float(item.get("canary_percent", 0)),
      expression_mode=str(item.get("expression_mode", "off")),
      owner=str(item.get("owner", "")),
    )
    if scope.mode == "CANARY" and not 0 < scope.canary_percent <= 100:
      raise ValueError("CANARY scope requires a percentage")
    if scope.expression_mode not in {"off", "shadow", "enforce"}:
      raise ValueError("invalid expression mode")
    if scope.expression_mode == "enforce" and scope.mode not in {"AUTHZ", "AUTHZ_ONLY"}:
      raise ValueError("expression enforcement requires Authz authority")
    if scope.expression_mode == "enforce" and not scope.owner:
      raise ValueError("expression enforcement requires an owner")
    if scope.expression_mode != "off" and (
      scope.surface != "agentgateway"
      or scope.resource_type != "tool"
      or scope.action != "invoke"
      or not scope.exact_resources
    ):
      raise ValueError("expression rollout requires exact AgentGateway tool scopes")
    scopes.append(scope)
  return Rollout(
    revision=revision,
    default_mode=str(value["default_mode"]),
    canary_seed=seed,
    shadow_timeout_ms=shadow_timeout,
    scopes=tuple(scopes),
  )


class AuthzGrpcClient:
  def __init__(self, target: str, response_type: type, *, service_token: str = "") -> None:
    self._channel = grpc.insecure_channel(target)
    self._service_token = service_token
    self._check = self._channel.unary_unary(
      "/envoy.service.auth.v3.Authorization/Check",
      request_serializer=lambda request: request.SerializeToString(),
      response_deserializer=response_type.FromString,
    )

  def check(self, request: object, *, purpose: str, timeout_seconds: float) -> Response:
    metadata = (("x-caipe-evaluation-purpose", purpose),)
    if self._service_token:
      metadata += (("authorization", f"Bearer {self._service_token}"),)
    return self._check(request, timeout=timeout_seconds, metadata=metadata)

  def close(self) -> None:
    self._channel.close()


class MigrationRouter:
  def __init__(
    self,
    *,
    legacy: Callable[[object, object], Response],
    legacy_shadow: Callable[[object, object], Response],
    authz: Callable[[object, str, float], Response],
    select: Callable[[object], Selection],
    unavailable: Callable[[], Response],
    compare: Callable[..., object],
    rollout: Rollout | None = None,
    max_shadow_workers: int = 4,
  ) -> None:
    self.legacy = legacy
    self.legacy_shadow = legacy_shadow
    self.authz = authz
    self.select = select
    self.unavailable = unavailable
    self.compare = compare
    self.rollout = rollout or parse_rollout(os.getenv("AUTHZ_ROLLOUT_JSON", ""))
    self._executor = futures.ThreadPoolExecutor(max_workers=max_shadow_workers)
    self._shadow_slots = threading.BoundedSemaphore(max_shadow_workers)

  def _evaluate_authz(self, request: object, purpose: str) -> tuple[Response, float]:
    started = time.perf_counter()
    try:
      result = self.authz(request, purpose, self.rollout.shadow_timeout_ms / 1000)
    except grpc.RpcError:
      result = self.unavailable()
    return result, (time.perf_counter() - started) * 1000

  def _compare_later(
    self,
    request: object,
    selection: Selection,
    authoritative_path: str,
    known: tuple[Response, float],
    evaluate_other: Callable[[], tuple[Response, float]],
  ) -> None:
    if not self._shadow_slots.acquire(blocking=False):
      return

    def run() -> None:
      try:
        other = evaluate_other()
        legacy, authz = (known, other) if authoritative_path == "LEGACY" else (other, known)
        self.compare(
          correlation_id=selection.correlation_id,
          rollout_revision=self.rollout.revision,
          authoritative_path=authoritative_path,
          resource_type=selection.resource_type,
          action=selection.action,
          legacy_code=legacy[0].status.code,
          authz_code=authz[0].status.code,
          legacy_duration_ms=legacy[1],
          authz_duration_ms=authz[1],
        )
      finally:
        self._shadow_slots.release()

    self._executor.submit(run)

  def Check(self, request: object, context: object) -> Response:  # noqa: N802
    selection = self.select(request)
    mode = self.rollout.mode(selection)
    if mode == "LEGACY":
      return self.legacy(request, context)
    if mode == "SHADOW":
      started = time.perf_counter()
      legacy = self.legacy(request, context)
      known = (legacy, (time.perf_counter() - started) * 1000)
      self._compare_later(
        request,
        selection,
        "LEGACY",
        known,
        lambda: self._evaluate_authz(request, "shadow"),
      )
      return legacy
    authz = self._evaluate_authz(request, "authoritative")
    if mode == "AUTHZ":
      self._compare_later(
        request,
        selection,
        "AUTHZ",
        authz,
        lambda: self._timed_legacy_shadow(request, context),
      )
    return authz[0]

  def _timed_legacy_shadow(self, request: object, context: object) -> tuple[Response, float]:
    started = time.perf_counter()
    result = self.legacy_shadow(request, context)
    return result, (time.perf_counter() - started) * 1000
