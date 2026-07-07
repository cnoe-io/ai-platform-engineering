"""Per-project agent container orchestration.

Splits the agent loop (Claude SDK + MCPs) out of `ttt-backend` into its own
containerized service. Each project gets its own long-lived `ttt-agent`
container; the backend talks to it over HTTP/SSE.

This package owns:
- `contract` — wire schemas shared by backend ↔ agent.
- `base` — `AgentOrchestrator` ABC + `AgentEndpoint`/`AgentStatus`.
- `docker_driver` — local-dev impl using the docker SDK.
- `k8s_driver` — reference impl for K8s deployments.

Backend chooses an implementation via the `TTT_ORCHESTRATOR` env var
(`docker` | `k8s`).
"""

from tome_agent.orchestrator.base import (
    AgentEndpoint,
    AgentOrchestrator,
    AgentSecrets,
    AgentStatus,
)

# Module-level handle on the running orchestrator. Set by `main.py`'s
# lifespan; read by surfaces that don't have a `request.app` (the MCP
# server, background tasks called outside a FastAPI request context).
# Always None before lifespan startup; never None during request handling.
_orchestrator: AgentOrchestrator | None = None


def get_orchestrator() -> AgentOrchestrator | None:
    return _orchestrator


def set_orchestrator(orch: AgentOrchestrator | None) -> None:
    global _orchestrator
    _orchestrator = orch


def build_orchestrator(kind: str) -> AgentOrchestrator:
    """Resolve an `AgentOrchestrator` driver by name. Raises on an
    unknown driver."""
    from tome_agent.config import settings

    if kind == "docker":
        from tome_agent.orchestrator.docker_driver import DockerOrchestrator
        return DockerOrchestrator(
            backend_url=settings.ttt_backend_url,
            image=settings.ttt_agent_image,
            publish_to_host=settings.ttt_orchestrator_publish_to_host,
        )
    if kind == "k8s":
        from tome_agent.orchestrator.k8s_driver import KubernetesOrchestrator
        return KubernetesOrchestrator(
            image=settings.ttt_agent_image,
            backend_url=settings.ttt_backend_url,
            storage_class=settings.ttt_k8s_storage_class,
        )
    raise ValueError(f"unknown TTT_ORCHESTRATOR: {kind!r}")


__all__ = [
    "AgentEndpoint",
    "AgentOrchestrator",
    "AgentSecrets",
    "AgentStatus",
    "build_orchestrator",
    "get_orchestrator",
    "set_orchestrator",
]
