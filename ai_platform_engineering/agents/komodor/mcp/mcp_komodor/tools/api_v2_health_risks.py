"""Tools for /api/v2/health/risks operations"""

import logging
from typing import Any, List, Literal, Optional
from mcp_komodor.api.client import make_api_request, assemble_nested_body

# Configure logging
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("mcp_tools")


async def get_health_risks(
  param_page_size: int,
  param_offset: int,
  param_impact_group_type: List[Literal["static", "dynamic", "realtime"]],
  param_check_type: List[
    Literal[
      "throttledCPU",
      "requestsLimitsRatio",
      "deprecatedApis",
      "kubernetesEndOfLife",
      "noisyNeighbor",
      "kubernetesVersionDeprecated",
      "nodeTerminationAutoScaling",
      "nodeTerminationSpotInstance",
      "restartingContainers",
      "HPAMax",
      "underProvisionedWorkloads",
      "singlePointOfFailure",
      "deploymentMissingReplicas",
      "missingPDB",
      "missingTopologySpreadConstraint",
      "HPAMinAvailability",
      "missingHPA",
      "priorityClassNotSet",
      "cpuRequestsMissing",
      "cpuLimitsMissing",
      "memoryRequestsMissing",
      "memoryLimitsMissing",
      "livenessProbeMissing",
      "readinessProbeMissing",
      "certificateExpiration",
      "idleGpu",
      "syntheticDegradedService",
      "syntheticNodePressure",
      "syntheticEOLDeprecationOutdated",
      "cascadingFailure",
      "unhealthyService",
      "unhealthyWorkflow",
      "failedJob",
      "failedCronJob",
      "unhealthyNode",
      "unhealthyPVC",
      "externalDNSNotSynced",
      "scaleDownImpact",
    ]
  ] = None,
  param_status: List[Literal["open", "confirmed", "resolved", "dismissed", "ignored", "manually_resolved"]] = None,
  param_cluster_name: Optional[List[str]] = None,
  param_namespace: Optional[List[str]] = None,
  param_short_resource_name_search_term: Optional[str] = None,
  param_short_resource_name: Optional[List[str]] = None,
  param_impact_group_id: List[
    Literal[
      "DegradedService",
      "EOLDeprecationOutdated",
      "NodeTerminations",
      "FlakyServices",
      "NodePressure",
      "Addons",
      "FailedInfrastructureResources",
      "FailedWorkloads",
      "CascadingFailure",
    ]
  ] = None,
  param_severity: List[Literal["high", "medium", "low"]] = None,
  param_komodor_uid: Optional[List[str]] = None,
  param_resource_type: Optional[List[str]] = None,
  param_created_from_epoch: Optional[str] = None,
  param_created_to_epoch: Optional[str] = None,
  param_check_category: List[Literal["workload", "infrastructure"]] = None,
) -> Any:
  """
  Get all the health risks.

  OpenAPI Description:
      Get all the health risks.

  Args:

      param_page_size (int): OpenAPI parameter corresponding to 'param_page_size'

      param_offset (int): OpenAPI parameter corresponding to 'param_offset'

      param_check_type (List[Literal['throttledCPU', 'requestsLimitsRatio', 'deprecatedApis',
          'kubernetesEndOfLife', 'noisyNeighbor', 'kubernetesVersionDeprecated',
          'nodeTerminationAutoScaling', 'nodeTerminationSpotInstance', 'restartingContainers',
          'HPAMax', 'underProvisionedWorkloads', 'singlePointOfFailure',
          'deploymentMissingReplicas', 'missingPDB', 'missingTopologySpreadConstraint',
          'HPAMinAvailability', 'missingHPA', 'priorityClassNotSet', 'cpuRequestsMissing',
          'cpuLimitsMissing', 'memoryRequestsMissing', 'memoryLimitsMissing',
          'livenessProbeMissing', 'readinessProbeMissing', 'certificateExpiration', 'idleGpu',
          'syntheticDegradedService', 'syntheticNodePressure', 'syntheticEOLDeprecationOutdated',
          'cascadingFailure', 'unhealthyService', 'unhealthyWorkflow', 'failedJob', 'failedCronJob',
          'unhealthyNode', 'unhealthyPVC', 'externalDNSNotSynced', 'scaleDownImpact']]):
          OpenAPI parameter corresponding to 'param_check_type'

      param_status (List[Literal['open', 'confirmed', 'resolved', 'dismissed', 'ignored', 'manually_resolved']]): OpenAPI parameter corresponding to 'param_status'

      param_cluster_name (List[str]): OpenAPI parameter corresponding to 'param_cluster_name'

      param_namespace (List[str]): OpenAPI parameter corresponding to 'param_namespace'

      param_short_resource_name_search_term (str): Use in order to search a service name with a "contains" approach

      param_short_resource_name (List[str]): Use in order to search a service names

      param_impact_group_id (List[Literal['DegradedService', 'EOLDeprecationOutdated', 'NodeTerminations', 'FlakyServices', 'NodePressure', 'Addons', 'FailedInfrastructureResources', 'FailedWorkloads', 'CascadingFailure']]): OpenAPI parameter corresponding to 'param_impact_group_id'

      param_impact_group_type (List[Literal['static', 'dynamic', 'realtime']]): OpenAPI parameter corresponding to 'param_impact_group_type'

      param_severity (List[Literal['high', 'medium', 'low']]): OpenAPI parameter corresponding to 'param_severity'

      param_komodor_uid (List[str]): OpenAPI parameter corresponding to 'param_komodor_uid'

      param_resource_type (List[str]): OpenAPI parameter corresponding to 'param_resource_type'

      param_created_from_epoch (str): OpenAPI parameter corresponding to 'param_created_from_epoch'

      param_created_to_epoch (str): OpenAPI parameter corresponding to 'param_created_to_epoch'

      param_check_category (List[Literal['workload', 'infrastructure']]): OpenAPI parameter corresponding to 'param_check_category'


  Returns:
      Any: The JSON response from the API call.

  Raises:
      Exception: If the API request fails or returns an error.
  """
  logger.debug("Making GET request to /api/v2/health/risks")

  params = {}
  data = {}

  if param_page_size is not None:
    params["page_size"] = str(param_page_size).lower() if isinstance(param_page_size, bool) else param_page_size

  if param_offset is not None:
    params["offset"] = str(param_offset).lower() if isinstance(param_offset, bool) else param_offset

  if param_check_type is not None:
    params["check_type"] = str(param_check_type).lower() if isinstance(param_check_type, bool) else param_check_type

  if param_status is not None:
    params["status"] = str(param_status).lower() if isinstance(param_status, bool) else param_status

  if param_cluster_name is not None:
    params["cluster_name"] = str(param_cluster_name).lower() if isinstance(param_cluster_name, bool) else param_cluster_name

  if param_namespace is not None:
    params["namespace"] = str(param_namespace).lower() if isinstance(param_namespace, bool) else param_namespace

  if param_short_resource_name_search_term is not None:
    params["short_resource_name_search_term"] = (
      str(param_short_resource_name_search_term).lower()
      if isinstance(param_short_resource_name_search_term, bool)
      else param_short_resource_name_search_term
    )

  if param_short_resource_name is not None:
    params["short_resource_name"] = (
      str(param_short_resource_name).lower() if isinstance(param_short_resource_name, bool) else param_short_resource_name
    )

  if param_impact_group_id is not None:
    params["impact_group_id"] = str(param_impact_group_id).lower() if isinstance(param_impact_group_id, bool) else param_impact_group_id

  if param_impact_group_type is not None:
    params["impact_group_type"] = (
      str(param_impact_group_type).lower() if isinstance(param_impact_group_type, bool) else param_impact_group_type
    )

  if param_severity is not None:
    params["severity"] = str(param_severity).lower() if isinstance(param_severity, bool) else param_severity

  if param_komodor_uid is not None:
    params["komodor_uid"] = str(param_komodor_uid).lower() if isinstance(param_komodor_uid, bool) else param_komodor_uid

  if param_resource_type is not None:
    params["resource_type"] = str(param_resource_type).lower() if isinstance(param_resource_type, bool) else param_resource_type

  if param_created_from_epoch is not None:
    params["created_from_epoch"] = (
      str(param_created_from_epoch).lower() if isinstance(param_created_from_epoch, bool) else param_created_from_epoch
    )

  if param_created_to_epoch is not None:
    params["created_to_epoch"] = str(param_created_to_epoch).lower() if isinstance(param_created_to_epoch, bool) else param_created_to_epoch

  if param_check_category is not None:
    params["check_category"] = str(param_check_category).lower() if isinstance(param_check_category, bool) else param_check_category

  flat_body = {}
  data = assemble_nested_body(flat_body)

  success, response = await make_api_request("/api/v2/health/risks", method="GET", params=params, data=data)

  if not success:
    logger.error(f"Request failed: {response.get('error')}")
    return {"error": response.get("error", "Request failed")}
  return response
