# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0
# Generated by CNOE OpenAPI MCP Codegen tool

"""Tools for /api/v1/applications/{name}/logs operations"""

import logging
from typing import Dict, Any
from mcp_argocd.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def application_service__pod_logs2(
    path_name: str,
    param_namespace: str = None,
    param_podName: str = None,
    param_container: str = None,
    param_sinceSeconds: str = None,
    param_sinceTime_seconds: str = None,
    param_sinceTime_nanos: int = None,
    param_tailLines: str = None,
    param_follow: bool = False,
    param_untilTime: str = None,
    param_filter: str = None,
    param_kind: str = None,
    param_group: str = None,
    param_resourceName: str = None,
    param_previous: bool = False,
    param_appNamespace: str = None,
    param_project: str = None,
    param_matchCase: bool = False,
) -> Dict[str, Any]:
    """
        PodLogs returns stream of log entries for the specified pod. Pod

        OpenAPI Description:


        Args:

            path_name (str): OpenAPI parameter corresponding to 'path_name'

            param_namespace (str): OpenAPI parameter corresponding to 'param_namespace'

            param_podName (str): OpenAPI parameter corresponding to 'param_podName'

            param_container (str): OpenAPI parameter corresponding to 'param_container'

            param_sinceSeconds (str): OpenAPI parameter corresponding to 'param_sinceSeconds'

            param_sinceTime_seconds (str): Represents seconds of UTC time since Unix epoch
    1970-01-01T00:00:00Z. Must be from 0001-01-01T00:00:00Z to
    9999-12-31T23:59:59Z inclusive.

            param_sinceTime_nanos (int): Non-negative fractions of a second at nanosecond resolution. Negative
    second values with fractions must still have non-negative nanos values
    that count forward in time. Must be from 0 to 999,999,999
    inclusive. This field may be limited in precision depending on context.

            param_tailLines (str): OpenAPI parameter corresponding to 'param_tailLines'

            param_follow (bool): OpenAPI parameter corresponding to 'param_follow'

            param_untilTime (str): OpenAPI parameter corresponding to 'param_untilTime'

            param_filter (str): OpenAPI parameter corresponding to 'param_filter'

            param_kind (str): OpenAPI parameter corresponding to 'param_kind'

            param_group (str): OpenAPI parameter corresponding to 'param_group'

            param_resourceName (str): OpenAPI parameter corresponding to 'param_resourceName'

            param_previous (bool): OpenAPI parameter corresponding to 'param_previous'

            param_appNamespace (str): OpenAPI parameter corresponding to 'param_appNamespace'

            param_project (str): OpenAPI parameter corresponding to 'param_project'

            param_matchCase (bool): OpenAPI parameter corresponding to 'param_matchCase'


        Returns:
            Dict[str, Any]: The JSON response from the API call.

        Raises:
            Exception: If the API request fails or returns an error.
    """
    logger.debug("Making GET request to /api/v1/applications/{name}/logs")

    params = {}
    data = {}

    if param_namespace is not None:
        params["namespace"] = str(param_namespace).lower() if isinstance(param_namespace, bool) else param_namespace

    if param_podName is not None:
        params["podName"] = str(param_podName).lower() if isinstance(param_podName, bool) else param_podName

    if param_container is not None:
        params["container"] = str(param_container).lower() if isinstance(param_container, bool) else param_container

    if param_sinceSeconds is not None:
        params["sinceSeconds"] = (
            str(param_sinceSeconds).lower() if isinstance(param_sinceSeconds, bool) else param_sinceSeconds
        )

    if param_sinceTime_seconds is not None:
        params["sinceTime_seconds"] = (
            str(param_sinceTime_seconds).lower()
            if isinstance(param_sinceTime_seconds, bool)
            else param_sinceTime_seconds
        )

    if param_sinceTime_nanos is not None:
        params["sinceTime_nanos"] = (
            str(param_sinceTime_nanos).lower() if isinstance(param_sinceTime_nanos, bool) else param_sinceTime_nanos
        )

    if param_tailLines is not None:
        params["tailLines"] = str(param_tailLines).lower() if isinstance(param_tailLines, bool) else param_tailLines

    if param_follow is not None:
        params["follow"] = str(param_follow).lower() if isinstance(param_follow, bool) else param_follow

    if param_untilTime is not None:
        params["untilTime"] = str(param_untilTime).lower() if isinstance(param_untilTime, bool) else param_untilTime

    if param_filter is not None:
        params["filter"] = str(param_filter).lower() if isinstance(param_filter, bool) else param_filter

    if param_kind is not None:
        params["kind"] = str(param_kind).lower() if isinstance(param_kind, bool) else param_kind

    if param_group is not None:
        params["group"] = str(param_group).lower() if isinstance(param_group, bool) else param_group

    if param_resourceName is not None:
        params["resourceName"] = (
            str(param_resourceName).lower() if isinstance(param_resourceName, bool) else param_resourceName
        )

    if param_previous is not None:
        params["previous"] = str(param_previous).lower() if isinstance(param_previous, bool) else param_previous

    if param_appNamespace is not None:
        params["appNamespace"] = (
            str(param_appNamespace).lower() if isinstance(param_appNamespace, bool) else param_appNamespace
        )

    if param_project is not None:
        params["project"] = str(param_project).lower() if isinstance(param_project, bool) else param_project

    if param_matchCase is not None:
        params["matchCase"] = str(param_matchCase).lower() if isinstance(param_matchCase, bool) else param_matchCase

    flat_body = {}
    data = assemble_nested_body(flat_body)

    success, response = await make_api_request(
        f"/api/v1/applications/{path_name}/logs", method="GET", params=params, data=data
    )

    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get("error", "Request failed")}
    return response
