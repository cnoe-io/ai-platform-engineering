# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0
# Generated by CNOE OpenAPI MCP Codegen tool

"""Tools for /api/v1/projects/{project.metadata.name} operations"""

import logging
from typing import Dict, Any, List
from mcp_argocd.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def project_service__update(
    path_project_metadata_name: str,
    body_project_metadata_annotations: Dict[str, Any] = None,
    body_project_metadata_creationTimestamp: str = None,
    body_project_metadata_deletionGracePeriodSeconds: int = None,
    body_project_metadata_deletionTimestamp: str = None,
    body_project_metadata_finalizers: List[str] = None,
    body_project_metadata_generateName: str = None,
    body_project_metadata_generation: int = None,
    body_project_metadata_labels: Dict[str, Any] = None,
    body_project_metadata_managedFields: List[str] = None,
    body_project_metadata_name: str = None,
    body_project_metadata_namespace: str = None,
    body_project_metadata_ownerReferences: List[str] = None,
    body_project_metadata_resourceVersion: str = None,
    body_project_metadata_selfLink: str = None,
    body_project_metadata_uid: str = None,
    body_project_spec_clusterResourceBlacklist: List[str] = None,
    body_project_spec_clusterResourceWhitelist: List[str] = None,
    body_project_spec_description: str = None,
    body_project_spec_destinationServiceAccounts: List[str] = None,
    body_project_spec_destinations: List[str] = None,
    body_project_spec_namespaceResourceBlacklist: List[str] = None,
    body_project_spec_namespaceResourceWhitelist: List[str] = None,
    body_project_spec_orphanedResources_ignore: List[str] = None,
    body_project_spec_orphanedResources_warn: bool = None,
    body_project_spec_permitOnlyProjectScopedClusters: bool = None,
    body_project_spec_roles: List[str] = None,
    body_project_spec_signatureKeys: List[str] = None,
    body_project_spec_sourceNamespaces: List[str] = None,
    body_project_spec_sourceRepos: List[str] = None,
    body_project_spec_syncWindows: List[str] = None,
    body_project_status_jwtTokensByRole: Dict[str, Any] = None,
) -> Dict[str, Any]:
    '''
    Update a project with the specified metadata and specifications.

    Args:
        path_project_metadata_name (str): The unique name of the project within a namespace. This is required for resource creation and cannot be updated. More info: https://kubernetes.io/docs/concepts/overview/working-with-objects/names#names.
        body_project_metadata_annotations (Dict[str, Any], optional): Annotations for the project metadata.
        body_project_metadata_creationTimestamp (str, optional): The creation timestamp of the project metadata.
        body_project_metadata_deletionGracePeriodSeconds (int, optional): The grace period in seconds before the project metadata is deleted.
        body_project_metadata_deletionTimestamp (str, optional): The deletion timestamp of the project metadata.
        body_project_metadata_finalizers (List[str], optional): Finalizers for the project metadata.
        body_project_metadata_generateName (str, optional): A prefix used by the server to generate a unique name if the Name field is not provided.
        body_project_metadata_generation (int, optional): The generation of the project metadata.
        body_project_metadata_labels (Dict[str, Any], optional): Labels for the project metadata.
        body_project_metadata_managedFields (List[str], optional): Managed fields for the project metadata.
        body_project_metadata_name (str, optional): The name of the project metadata.
        body_project_metadata_namespace (str, optional): The namespace of the project metadata.
        body_project_metadata_ownerReferences (List[str], optional): Owner references for the project metadata.
        body_project_metadata_resourceVersion (str, optional): The resource version of the project metadata.
        body_project_metadata_selfLink (str, optional): The self link of the project metadata.
        body_project_metadata_uid (str, optional): The unique identifier of the project metadata.
        body_project_spec_clusterResourceBlacklist (List[str], optional): Cluster resource blacklist for the project specification.
        body_project_spec_clusterResourceWhitelist (List[str], optional): Cluster resource whitelist for the project specification.
        body_project_spec_description (str, optional): Description of the project specification.
        body_project_spec_destinationServiceAccounts (List[str], optional): Service accounts to be impersonated for the application sync operation for each destination.
        body_project_spec_destinations (List[str], optional): Destinations for the project specification.
        body_project_spec_namespaceResourceBlacklist (List[str], optional): Namespace resource blacklist for the project specification.
        body_project_spec_namespaceResourceWhitelist (List[str], optional): Namespace resource whitelist for the project specification.
        body_project_spec_orphanedResources_ignore (List[str], optional): Orphaned resources to ignore for the project specification.
        body_project_spec_orphanedResources_warn (bool, optional): Whether to warn about orphaned resources in the project specification.
        body_project_spec_permitOnlyProjectScopedClusters (bool, optional): Whether to permit only project-scoped clusters in the project specification.
        body_project_spec_roles (List[str], optional): Roles for the project specification.
        body_project_spec_signatureKeys (List[str], optional): Signature keys for the project specification.
        body_project_spec_sourceNamespaces (List[str], optional): Source namespaces for the project specification.
        body_project_spec_sourceRepos (List[str], optional): Source repositories for the project specification.
        body_project_spec_syncWindows (List[str], optional): Sync windows for the project specification.
        body_project_status_jwtTokensByRole (Dict[str, Any], optional): JWT tokens by role for the project status.

    Returns:
        Dict[str, Any]: The JSON response from the API call.

    Raises:
        Exception: If the API request fails or returns an error.
    '''
    logger.debug("Making PUT request to /api/v1/projects/{project.metadata.name}")

    params = {}
    data = {}

    flat_body = {}
    if body_project_metadata_annotations is not None:
        flat_body["project_metadata_annotations"] = body_project_metadata_annotations
    if body_project_metadata_creationTimestamp is not None:
        flat_body["project_metadata_creationTimestamp"] = body_project_metadata_creationTimestamp
    if body_project_metadata_deletionGracePeriodSeconds is not None:
        flat_body["project_metadata_deletionGracePeriodSeconds"] = body_project_metadata_deletionGracePeriodSeconds
    if body_project_metadata_deletionTimestamp is not None:
        flat_body["project_metadata_deletionTimestamp"] = body_project_metadata_deletionTimestamp
    if body_project_metadata_finalizers is not None:
        flat_body["project_metadata_finalizers"] = body_project_metadata_finalizers
    if body_project_metadata_generateName is not None:
        flat_body["project_metadata_generateName"] = body_project_metadata_generateName
    if body_project_metadata_generation is not None:
        flat_body["project_metadata_generation"] = body_project_metadata_generation
    if body_project_metadata_labels is not None:
        flat_body["project_metadata_labels"] = body_project_metadata_labels
    if body_project_metadata_managedFields is not None:
        flat_body["project_metadata_managedFields"] = body_project_metadata_managedFields
    if body_project_metadata_name is not None:
        flat_body["project_metadata_name"] = body_project_metadata_name
    if body_project_metadata_namespace is not None:
        flat_body["project_metadata_namespace"] = body_project_metadata_namespace
    if body_project_metadata_ownerReferences is not None:
        flat_body["project_metadata_ownerReferences"] = body_project_metadata_ownerReferences
    if body_project_metadata_resourceVersion is not None:
        flat_body["project_metadata_resourceVersion"] = body_project_metadata_resourceVersion
    if body_project_metadata_selfLink is not None:
        flat_body["project_metadata_selfLink"] = body_project_metadata_selfLink
    if body_project_metadata_uid is not None:
        flat_body["project_metadata_uid"] = body_project_metadata_uid
    if body_project_spec_clusterResourceBlacklist is not None:
        flat_body["project_spec_clusterResourceBlacklist"] = body_project_spec_clusterResourceBlacklist
    if body_project_spec_clusterResourceWhitelist is not None:
        flat_body["project_spec_clusterResourceWhitelist"] = body_project_spec_clusterResourceWhitelist
    if body_project_spec_description is not None:
        flat_body["project_spec_description"] = body_project_spec_description
    if body_project_spec_destinationServiceAccounts is not None:
        flat_body["project_spec_destinationServiceAccounts"] = body_project_spec_destinationServiceAccounts
    if body_project_spec_destinations is not None:
        flat_body["project_spec_destinations"] = body_project_spec_destinations
    if body_project_spec_namespaceResourceBlacklist is not None:
        flat_body["project_spec_namespaceResourceBlacklist"] = body_project_spec_namespaceResourceBlacklist
    if body_project_spec_namespaceResourceWhitelist is not None:
        flat_body["project_spec_namespaceResourceWhitelist"] = body_project_spec_namespaceResourceWhitelist
    if body_project_spec_orphanedResources_ignore is not None:
        flat_body["project_spec_orphanedResources_ignore"] = body_project_spec_orphanedResources_ignore
    if body_project_spec_orphanedResources_warn is not None:
        flat_body["project_spec_orphanedResources_warn"] = body_project_spec_orphanedResources_warn
    if body_project_spec_permitOnlyProjectScopedClusters is not None:
        flat_body["project_spec_permitOnlyProjectScopedClusters"] = body_project_spec_permitOnlyProjectScopedClusters
    if body_project_spec_roles is not None:
        flat_body["project_spec_roles"] = body_project_spec_roles
    if body_project_spec_signatureKeys is not None:
        flat_body["project_spec_signatureKeys"] = body_project_spec_signatureKeys
    if body_project_spec_sourceNamespaces is not None:
        flat_body["project_spec_sourceNamespaces"] = body_project_spec_sourceNamespaces
    if body_project_spec_sourceRepos is not None:
        flat_body["project_spec_sourceRepos"] = body_project_spec_sourceRepos
    if body_project_spec_syncWindows is not None:
        flat_body["project_spec_syncWindows"] = body_project_spec_syncWindows
    if body_project_status_jwtTokensByRole is not None:
        flat_body["project_status_jwtTokensByRole"] = body_project_status_jwtTokensByRole
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request(
        f"/api/v1/projects/{path_project_metadata_name}", method="PUT", params=params, data=data
    )

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response