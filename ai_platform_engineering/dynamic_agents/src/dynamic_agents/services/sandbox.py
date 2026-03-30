"""Sandbox manager for OpenShell integration.

Manages sandbox lifecycle, policy operations, and denial event streaming
for dynamic agents with sandbox execution enabled.
"""

from __future__ import annotations

import asyncio
import logging
import subprocess
import threading
from typing import Any

import time

import yaml
from openshell import SandboxClient, SandboxSession
from openshell._proto import datamodel_pb2, openshell_pb2

from dynamic_agents.config import Settings, get_settings
from dynamic_agents.services.sandbox_policy import (
    add_network_rule_to_policy,
    build_policy_from_template,
    remove_network_rule_from_policy,
    remove_temporary_rules,
    serialize_policy,
)

logger = logging.getLogger(__name__)

_manager_instance: SandboxManager | None = None
_manager_lock = threading.Lock()


class SandboxManager:
    """Manages OpenShell sandbox lifecycle, policy, and event streaming.

    Singleton — use get_sandbox_manager() to obtain the shared instance.
    Each dynamic agent with sandbox enabled gets a persistent sandbox
    identified by its agent-scoped name.
    """

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._client: SandboxClient | None = None
        self._sessions: dict[str, SandboxSession] = {}
        self._policies: dict[str, dict[str, Any]] = {}
        self._denial_queues: dict[str, asyncio.Queue] = {}
        self._subscribers: dict[str, set[asyncio.Queue]] = {}
        self._watch_tasks: dict[str, asyncio.Task] = {}

    def _get_client(self) -> SandboxClient:
        if self._client is None:
            if self._settings.openshell_gateway:
                self._client = SandboxClient(endpoint=self._settings.openshell_gateway)
            else:
                gw_name = self._ensure_gateway()
                self._client = SandboxClient.from_active_cluster(cluster=gw_name)
        return self._client

    def _ensure_gateway(self) -> str:
        """Start an OpenShell gateway if one is not already running.

        The gateway runs k3s inside Docker and can take 30-60 s on
        first start.  Subsequent calls reuse the existing gateway
        because ``gateway start`` is idempotent.

        Returns:
            The gateway name (used to connect via
            ``SandboxClient.from_active_cluster(cluster=name)``).
        """
        gw_name = self._settings.openshell_gateway_name or "openshell"

        probe = subprocess.run(
            ["openshell", "gateway", "info", "--gateway", gw_name],
            capture_output=True, text=True, timeout=10,
        )
        if probe.returncode == 0:
            logger.info("[sandbox] OpenShell gateway '%s' already running", gw_name)
            return gw_name

        logger.info(
            "[sandbox] Starting OpenShell gateway '%s' (may take ~60 s on first run)...",
            gw_name,
        )
        result = subprocess.run(
            ["openshell", "gateway", "start", "--name", gw_name],
            capture_output=True, text=True, timeout=180,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"Failed to start OpenShell gateway '{gw_name}': "
                f"{result.stderr or result.stdout}"
            )

        self._wait_for_gateway_metadata(gw_name)
        logger.info("[sandbox] OpenShell gateway '%s' started", gw_name)
        return gw_name

    @staticmethod
    def _wait_for_gateway_metadata(gw_name: str, timeout: float = 30.0) -> None:
        """Wait until the gateway metadata files are written to disk."""
        from pathlib import Path

        config_dir = Path.home() / ".config" / "openshell" / "gateways" / gw_name
        metadata_file = config_dir / "metadata.json"
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if metadata_file.exists():
                return
            time.sleep(0.5)
        raise RuntimeError(
            f"Gateway '{gw_name}' started but metadata not found at {metadata_file}"
        )

    def get_or_create_sandbox(self, sandbox_name: str) -> SandboxSession:
        """Get an existing sandbox session or create a new persistent one.

        Uses named sandboxes so the same agent always reconnects to the
        same sandbox across chat sessions.

        Args:
            sandbox_name: Unique sandbox identifier (typically derived from agent ID).

        Returns:
            Active SandboxSession ready for command execution.
        """
        if sandbox_name in self._sessions:
            return self._sessions[sandbox_name]

        client = self._get_client()

        try:
            ref = client.get(sandbox_name)
            logger.info("[sandbox] Connected to existing sandbox: %s", sandbox_name)
        except Exception:
            logger.info("[sandbox] Creating new named sandbox: %s", sandbox_name)
            resp = client._stub.CreateSandbox(
                openshell_pb2.CreateSandboxRequest(
                    name=sandbox_name,
                    spec=datamodel_pb2.SandboxSpec(),
                ),
                timeout=client._timeout,
            )
            from openshell.sandbox import _sandbox_ref
            ref = _sandbox_ref(resp.sandbox)
            ref = client.wait_ready(ref.name)
            logger.info("[sandbox] Sandbox ready: %s", ref.name)

        session = SandboxSession(client, ref)
        self._sessions[sandbox_name] = session
        return session

    def get_session(self, sandbox_name: str) -> SandboxSession | None:
        """Get an existing sandbox session without creating one."""
        return self._sessions.get(sandbox_name)

    # ── Policy operations ───────────────────────────────────────────────

    def get_policy(self, sandbox_name: str) -> dict[str, Any]:
        """Get the current policy for a sandbox.

        First checks the in-memory cache, then falls back to querying
        the OpenShell gateway via CLI.
        """
        if sandbox_name in self._policies:
            return self._policies[sandbox_name]

        try:
            result = subprocess.run(
                ["openshell", "policy", "get", sandbox_name, "--format", "yaml"],
                capture_output=True,
                text=True,
                timeout=30,
            )
            if result.returncode == 0 and result.stdout.strip():
                policy = yaml.safe_load(result.stdout)
                self._policies[sandbox_name] = policy
                return policy
        except Exception as exc:
            logger.warning(f"Failed to get policy for {sandbox_name}: {exc}")

        return {}

    def update_policy(self, sandbox_name: str, policy: dict[str, Any]) -> dict[str, Any]:
        """Update the sandbox policy with hot reload.

        Writes the policy YAML to a temp file and applies it via the
        openshell CLI with --wait for confirmation of hot reload.

        Args:
            sandbox_name: Target sandbox.
            policy: Full policy dict to apply.

        Returns:
            Status dict with version and reload result.
        """
        import tempfile

        policy_yaml = serialize_policy(policy)

        try:
            with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as f:
                f.write(policy_yaml)
                tmp_path = f.name

            result = subprocess.run(
                ["openshell", "policy", "set", sandbox_name, "--policy", tmp_path, "--wait"],
                capture_output=True,
                text=True,
                timeout=60,
            )

            if result.returncode == 0:
                self._policies[sandbox_name] = policy
                logger.info(f"Policy updated for sandbox {sandbox_name}")
                return {"status": "loaded", "sandbox": sandbox_name}
            else:
                logger.error(f"Policy update failed for {sandbox_name}: {result.stderr}")
                return {"status": "failed", "error": result.stderr}

        except Exception as exc:
            logger.exception(f"Policy update error for {sandbox_name}")
            return {"status": "error", "error": str(exc)}
        finally:
            import os
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    def add_allow_rule(
        self,
        sandbox_name: str,
        *,
        host: str,
        port: int = 443,
        binary: str | None = None,
        temporary: bool = False,
    ) -> dict[str, Any]:
        """Add a network allow rule and hot-reload the policy.

        Args:
            sandbox_name: Target sandbox.
            host: Hostname to allow.
            port: Port number.
            binary: Optional binary path to scope the rule.
            temporary: If True, rule is marked for auto-cleanup.

        Returns:
            Status dict with the new rule_id.
        """
        policy = self.get_policy(sandbox_name)
        if not policy:
            policy = build_policy_from_template("permissive")

        policy, rule_id = add_network_rule_to_policy(
            policy,
            host=host,
            port=port,
            binary=binary,
            temporary=temporary,
        )

        result = self.update_policy(sandbox_name, policy)
        result["rule_id"] = rule_id
        return result

    def remove_rule(self, sandbox_name: str, rule_id: str) -> dict[str, Any]:
        """Remove a network rule and hot-reload the policy.

        Args:
            sandbox_name: Target sandbox.
            rule_id: Rule key to remove.

        Returns:
            Status dict.
        """
        policy = self.get_policy(sandbox_name)
        if not policy:
            return {"status": "error", "error": "No policy found"}

        policy = remove_network_rule_from_policy(policy, rule_id)
        return self.update_policy(sandbox_name, policy)

    def cleanup_temporary_rules(self, sandbox_name: str) -> dict[str, Any]:
        """Remove all temporary rules from the policy (session cleanup).

        Args:
            sandbox_name: Target sandbox.

        Returns:
            Status dict.
        """
        policy = self.get_policy(sandbox_name)
        if not policy:
            return {"status": "noop"}

        policy = remove_temporary_rules(policy)
        return self.update_policy(sandbox_name, policy)

    def initialize_policy(
        self,
        sandbox_name: str,
        template: str = "permissive",
        custom_yaml: str | None = None,
    ) -> dict[str, Any]:
        """Set the initial policy for a sandbox from a template.

        Args:
            sandbox_name: Target sandbox.
            template: Template name ('permissive', 'restrictive', 'custom').
            custom_yaml: Custom YAML when template is 'custom'.

        Returns:
            Status dict.
        """
        policy = build_policy_from_template(template, custom_yaml)
        return self.update_policy(sandbox_name, policy)

    def push_policy_update(
        self,
        sandbox_name: str,
        status: str,
        rule_id: str | None = None,
    ) -> None:
        """Push a policy-update notification to all subscribers.

        This is picked up by active SSE streams (chat route, policy tab)
        and forwarded to the UI.
        """
        event = {
            "_type": "policy_update",
            "sandbox_name": sandbox_name,
            "status": status,
            "rule_id": rule_id,
        }
        self._broadcast(sandbox_name, event)

    # ── Event pub/sub ────────────────────────────────────────────────────

    def _broadcast(self, sandbox_name: str, event: dict) -> None:
        """Broadcast an event to all subscribers for a sandbox."""
        subs = self._subscribers.get(sandbox_name, set())
        dead: list[asyncio.Queue] = []
        for q in subs:
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                dead.append(q)
        for q in dead:
            subs.discard(q)

    def subscribe(self, sandbox_name: str) -> asyncio.Queue:
        """Create a new subscriber queue for sandbox events.

        Each caller gets its own queue so multiple consumers (chat SSE,
        policy tab SSE) all receive every event independently.
        Returns an asyncio.Queue that the caller should read from.
        Call ``unsubscribe`` when done.
        """
        q: asyncio.Queue = asyncio.Queue(maxsize=200)
        if sandbox_name not in self._subscribers:
            self._subscribers[sandbox_name] = set()
        self._subscribers[sandbox_name].add(q)
        return q

    def unsubscribe(self, sandbox_name: str, q: asyncio.Queue) -> None:
        """Remove a subscriber queue."""
        subs = self._subscribers.get(sandbox_name)
        if subs:
            subs.discard(q)

    def get_denial_queue(self, sandbox_name: str) -> asyncio.Queue:
        """Get or create the shared internal queue for the watch loop.

        The watch loop pushes raw events here; a background task
        then broadcasts them to all subscribers.
        """
        if sandbox_name not in self._denial_queues:
            self._denial_queues[sandbox_name] = asyncio.Queue(maxsize=100)
        return self._denial_queues[sandbox_name]

    async def start_watch(self, sandbox_name: str) -> None:
        """Start watching a sandbox for denial events via gRPC WatchSandbox.

        Denial events are broadcast to all subscribers for this sandbox.
        """
        if sandbox_name in self._watch_tasks:
            return

        async def _watch_loop() -> None:
            """Poll for denial events using the openshell CLI.

            The WatchSandbox gRPC stream is not directly exposed by the
            Python SDK, so we use a polling approach with the CLI as a
            pragmatic fallback. In production, this should be replaced
            with direct gRPC stub usage when the SDK supports it.
            """
            client = self._get_client()
            logger.info(f"Started denial watcher for sandbox {sandbox_name}")

            while True:
                try:
                    for chunk in client.exec_stream(
                        sandbox_name,
                        ["bash", "-c", "cat /proc/openshell/denials 2>/dev/null || sleep 5"],
                        timeout_seconds=10,
                    ):
                        if chunk.stdout and chunk.stdout.strip():
                            for line in chunk.stdout.strip().split("\n"):
                                try:
                                    import json
                                    denial = json.loads(line)
                                    denial["sandbox_name"] = sandbox_name
                                    self._broadcast(sandbox_name, denial)
                                except (json.JSONDecodeError, ValueError):
                                    pass
                except asyncio.CancelledError:
                    logger.info(f"Denial watcher cancelled for {sandbox_name}")
                    return
                except Exception as exc:
                    logger.debug(f"Watch iteration error for {sandbox_name}: {exc}")
                    await asyncio.sleep(5)

        task = asyncio.create_task(_watch_loop())
        self._watch_tasks[sandbox_name] = task

    async def stop_watch(self, sandbox_name: str) -> None:
        """Stop the denial watcher for a sandbox."""
        task = self._watch_tasks.pop(sandbox_name, None)
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    def get_sandbox_status(self, sandbox_name: str) -> dict[str, Any]:
        """Get sandbox health and status information.

        Checks both in-memory state and the gateway to determine
        whether the sandbox is provisioned and ready.  Also queries
        the live policy status so callers can detect validation failures.
        """
        session = self._sessions.get(sandbox_name)
        has_watcher = sandbox_name in self._watch_tasks
        has_policy = sandbox_name in self._policies

        provisioned = False
        phase = "unknown"
        sandbox_error: str | None = None
        try:
            client = self._get_client()
            ref = client.get(sandbox_name)
            provisioned = True
            phase_map = {
                datamodel_pb2.SANDBOX_PHASE_PROVISIONING: "pending",
                datamodel_pb2.SANDBOX_PHASE_READY: "ready",
                datamodel_pb2.SANDBOX_PHASE_ERROR: "error",
                datamodel_pb2.SANDBOX_PHASE_DELETING: "pending",
                datamodel_pb2.SANDBOX_PHASE_UNKNOWN: "unknown",
                datamodel_pb2.SANDBOX_PHASE_UNSPECIFIED: "pending",
            }
            phase = phase_map.get(ref.phase, "unknown")
        except Exception as exc:
            provisioned = False
            phase = "not_found"
            sandbox_error = str(exc)

        policy_status, policy_error = self._query_policy_status(sandbox_name)

        result: dict[str, Any] = {
            "sandbox_name": sandbox_name,
            "provisioned": provisioned,
            "phase": phase,
            "connected": session is not None,
            "watcher_active": has_watcher,
            "policy_loaded": has_policy,
            "policy_status": policy_status,
        }
        if policy_error:
            result["policy_error"] = policy_error
        if sandbox_error:
            result["sandbox_error"] = sandbox_error
        return result

    def _query_policy_status(self, sandbox_name: str) -> tuple[str, str | None]:
        """Query the live policy status from the gateway.

        Returns:
            Tuple of (status, error_message | None).
            Status is one of: 'loaded', 'failed', 'unknown', 'none'.
        """
        try:
            result = subprocess.run(
                ["openshell", "policy", "get", sandbox_name],
                capture_output=True,
                text=True,
                timeout=10,
            )
            if result.returncode != 0:
                return ("unknown", result.stderr.strip() or None)

            stdout = result.stdout
            status = "unknown"
            error = None
            for line in stdout.splitlines():
                line_stripped = line.strip()
                if line_stripped.startswith("Status:"):
                    val = line_stripped.split(":", 1)[1].strip().lower()
                    if val == "loaded":
                        status = "loaded"
                    elif val == "failed":
                        status = "failed"
                    else:
                        status = val
                elif line_stripped.startswith("Error:"):
                    error = line_stripped.split(":", 1)[1].strip()
            return (status, error)
        except Exception as exc:
            logger.debug("Could not query policy status for %s: %s", sandbox_name, exc)
            return ("unknown", None)

    # ── Lifecycle ───────────────────────────────────────────────────────

    async def cleanup(self) -> None:
        """Stop all watchers and clean up resources."""
        for name in list(self._watch_tasks):
            await self.stop_watch(name)
        self._sessions.clear()
        self._policies.clear()
        self._denial_queues.clear()
        self._subscribers.clear()
        if self._client:
            self._client.close()
            self._client = None


def get_sandbox_manager(settings: Settings | None = None) -> SandboxManager:
    """Get the shared SandboxManager singleton."""
    global _manager_instance
    if _manager_instance is None:
        with _manager_lock:
            if _manager_instance is None:
                _manager_instance = SandboxManager(settings)
    return _manager_instance
