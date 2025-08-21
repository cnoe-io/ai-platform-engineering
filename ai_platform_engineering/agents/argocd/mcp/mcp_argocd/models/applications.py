"""ArgoCD application models for MCP"""

from typing import Dict, List, Any, Optional
from dataclasses import dataclass, field


@dataclass
class ApplicationSource:
    """
    A source for an application - typically a Git repository
    """

    repo_url: str
    path: str
    target_revision: str = "HEAD"
    helm: Optional[Dict[str, Any]] = None
    kustomize: Optional[Dict[str, Any]] = None
    directory: Optional[Dict[str, Any]] = None


@dataclass
class ApplicationDestination:
    """
    The destination where an application will be deployed
    """

    server: str
    namespace: str
    name: Optional[str] = None


@dataclass
class ApplicationSyncPolicy:
    """
    Sync policy for an application
    """

    automated: bool = False
    prune: bool = False
    self_heal: bool = False
    allow_empty: bool = False
    sync_options: List[str] = field(default_factory=list)
    retry: Optional[Dict[str, Any]] = None


@dataclass
class ApplicationStatus:
    """
    Status of an ArgoCD application
    """

    sync_status: str
    health_status: str
    resources: List[Dict[str, Any]] = field(default_factory=list)
    conditions: List[Dict[str, Any]] = field(default_factory=list)
    operation_state: Optional[Dict[str, Any]] = None


@dataclass
class Application:
    """
    ArgoCD application model
    """

    name: str
    project: str
    source: ApplicationSource
    destination: ApplicationDestination
    sync_policy: Optional[ApplicationSyncPolicy] = None
    namespace: str = "argocd"
    status: Optional[ApplicationStatus] = None


def application_to_api_format(app: Application) -> Dict[str, Any]:
    """
    Convert an Application object to the format expected by ArgoCD API

    Args:
        app: Application object

    Returns:
        Dictionary in ArgoCD API format
    """
    source = {
        "repoURL": app.source.repo_url,
        "path": app.source.path,
        "targetRevision": app.source.target_revision,
    }

    # Add optional source fields if they exist
    if app.source.helm is not None:
        source["helm"] = app.source.helm  # type: ignore
    if app.source.kustomize is not None:
        source["kustomize"] = app.source.kustomize  # type: ignore
    if app.source.directory is not None:
        source["directory"] = app.source.directory  # type: ignore

    destination = {
        "server": app.destination.server,
        "namespace": app.destination.namespace,
    }

    if app.destination.name:
        destination["name"] = app.destination.name

    result = {
        "metadata": {"name": app.name, "namespace": app.namespace},
        "spec": {"project": app.project, "source": source, "destination": destination},
    }

    # Add sync policy if provided
    if app.sync_policy:
        sync_policy = {}

        if app.sync_policy.automated:
            sync_policy["automated"] = {
                "prune": app.sync_policy.prune,
                "selfHeal": app.sync_policy.self_heal,
                "allowEmpty": app.sync_policy.allow_empty,
            }

        if app.sync_policy.sync_options:
            # Convert to list for compatibility with API
            sync_policy["syncOptions"] = list(app.sync_policy.sync_options)  # type: ignore

        if app.sync_policy.retry:
            sync_policy["retry"] = app.sync_policy.retry

        # Add the sync policy to the spec
        spec = result.get("spec")
        if isinstance(spec, dict):
            spec["syncPolicy"] = sync_policy

    return result


def api_format_to_application(data: Dict[str, Any]) -> Application:
    """
    Convert ArgoCD API response to an Application object

    Args:
        data: Dictionary from ArgoCD API

    Returns:
        Application object
    """
    metadata = data.get("metadata", {})
    spec = data.get("spec", {})
    status_data = data.get("status", {})

    # Extract source information
    source_data = spec.get("source", {})
    source = ApplicationSource(
        repo_url=source_data.get("repoURL", ""),
        path=source_data.get("path", ""),
        target_revision=source_data.get("targetRevision", "HEAD"),
        helm=source_data.get("helm"),
        kustomize=source_data.get("kustomize"),
        directory=source_data.get("directory"),
    )

    # Extract destination information
    dest_data = spec.get("destination", {})
    destination = ApplicationDestination(
        server=dest_data.get("server", ""),
        namespace=dest_data.get("namespace", ""),
        name=dest_data.get("name"),
    )

    # Extract sync policy if available
    sync_policy = None
    if "syncPolicy" in spec:
        sync_policy_data = spec["syncPolicy"]
        automated = sync_policy_data.get("automated", {})

        sync_policy = ApplicationSyncPolicy(
            automated=bool(automated),
            prune=automated.get("prune", False),
            self_heal=automated.get("selfHeal", False),
            allow_empty=automated.get("allowEmpty", False),
            sync_options=sync_policy_data.get("syncOptions"),
            retry=sync_policy_data.get("retry"),
        )

    # Extract status if available
    status = None
    if status_data:
        status = ApplicationStatus(
            sync_status=status_data.get("sync", {}).get("status", "Unknown"),
            health_status=status_data.get("health", {}).get("status", "Unknown"),
            resources=status_data.get("resources", []),
            conditions=status_data.get("conditions", []),
            operation_state=status_data.get("operationState"),
        )

    # Create the application object
    return Application(
        name=metadata.get("name", ""),
        project=spec.get("project", "default"),
        source=source,
        destination=destination,
        sync_policy=sync_policy,
        namespace=metadata.get("namespace", "argocd"),
        status=status,
    )
