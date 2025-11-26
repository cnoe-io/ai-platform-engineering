#!/usr/bin/env python3
"""
 MCP Server

This server provides a Model Context Protocol (MCP) interface to the ,
allowing large language models and AI assistants to interact with the service.
"""

import logging
import os
from dotenv import load_dotenv
from fastmcp import FastMCP


from mcp_komodor.tools import api_v2_services_search

from mcp_komodor.tools import api_v2_jobs_search

from mcp_komodor.tools import api_v2_service_yaml

from mcp_komodor.tools import api_v2_services_issues_search

from mcp_komodor.tools import api_v2_clusters_issues_search

from mcp_komodor.tools import api_v2_services_k8s_events_search

from mcp_komodor.tools import api_v2_services_k8s_events

from mcp_komodor.tools import api_v2_clusters_k8s_events_search

from mcp_komodor.tools import api_v2_rbac_kubeconfig

from mcp_komodor.tools import api_v2_clusters

from mcp_komodor.tools import api_v2_realtime_monitors_config

from mcp_komodor.tools import api_v2_realtime_monitors_config_id

from mcp_komodor.tools import api_v2_audit_log

from mcp_komodor.tools import api_v2_audit_log_filters

from mcp_komodor.tools import api_v2_health_risks

from mcp_komodor.tools import api_v2_health_risks_id

from mcp_komodor.tools import api_v2_users

from mcp_komodor.tools import api_v2_users_id_or_email

from mcp_komodor.tools import api_v2_users_effective_permissions

from mcp_komodor.tools import api_v2_rbac_roles

from mcp_komodor.tools import api_v2_rbac_roles_id_or_name

from mcp_komodor.tools import api_v2_rbac_roles_policies

from mcp_komodor.tools import api_v2_rbac_users_roles

from mcp_komodor.tools import api_v2_rbac_policies

from mcp_komodor.tools import api_v2_rbac_policies_id_or_name

from mcp_komodor.tools import api_v2_rbac_actions

from mcp_komodor.tools import api_v2_rbac_actions_action

from mcp_komodor.tools import api_v2_rbac_actions_id

from mcp_komodor.tools import api_v2_integrations_kubernetes

from mcp_komodor.tools import api_v2_integrations_kubernetes_clustername

from mcp_komodor.tools import api_v2_integrations_kubernetes_id

from mcp_komodor.tools import api_v2_apikey_validate

from mcp_komodor.tools import api_v2_cost_allocation

from mcp_komodor.tools import api_v2_cost_right_sizing_service

from mcp_komodor.tools import api_v2_cost_right_sizing_container

from mcp_komodor.tools import api_v2_klaudia_rca_sessions

from mcp_komodor.tools import api_v2_klaudia_rca_sessions_id

from mcp_komodor.tools import mgmt_v1_apikey_validate

from mcp_komodor.tools import mgmt_v1_events

from mcp_komodor.tools import mgmt_v1_monitors_config

from mcp_komodor.tools import mgmt_v1_monitors_config_id

from mcp_komodor.tools import mgmt_v1_rbac_roles

from mcp_komodor.tools import mgmt_v1_rbac_roles_id

from mcp_komodor.tools import mgmt_v1_rbac_roles_id_policies

from mcp_komodor.tools import mgmt_v1_rbac_roles_policies

from mcp_komodor.tools import mgmt_v1_rbac_policies

from mcp_komodor.tools import mgmt_v1_rbac_policies_id

from mcp_komodor.tools import mgmt_v1_rbac_users

from mcp_komodor.tools import mgmt_v1_rbac_users_id

from mcp_komodor.tools import mgmt_v1_rbac_users_id_roles

from mcp_komodor.tools import mgmt_v1_rbac_users_roles

from mcp_komodor.tools import mgmt_v1_integrations_kubernetes

from mcp_komodor.tools import mgmt_v1_integrations_kubernetes_id

from mcp_komodor.tools import mgmt_v1_integrations_kubernetes_clustername

from mcp_komodor.tools import mgmt_v1_rbac_actions

from mcp_komodor.tools import mgmt_v1_rbac_actions_action

from mcp_komodor.tools import mgmt_v1_rbac_actions_id


def main():
  # Load environment variables
  load_dotenv()

  # Configure logging
  logging.basicConfig(level=logging.INFO)

  # Get MCP configuration from environment variables
  MCP_MODE = os.getenv("MCP_MODE", "stdio").lower()

  # Get host and port for server
  MCP_HOST = os.getenv("MCP_HOST", "localhost")
  MCP_PORT = int(os.getenv("MCP_PORT", "8000"))

  logging.info(f"Starting MCP server in {MCP_MODE} mode on {MCP_HOST}:{MCP_PORT}")

  # Get agent name from environment variables
  SERVER_NAME = os.getenv("SERVER_NAME") or os.getenv("AGENT_NAME") or "KOMODOR"
  logging.info(f"MCP Server name: {SERVER_NAME}")

  # Create server instance
  if MCP_MODE.lower() in ["sse", "http"]:
    mcp = FastMCP(f"{SERVER_NAME} MCP Server", host=MCP_HOST, port=MCP_PORT)
  else:
    mcp = FastMCP(f"{SERVER_NAME} MCP Server")

  # Register api_v2_services_search tools

  mcp.tool()(api_v2_services_search.post_api_v2_svcs_search)

  # Register api_v2_jobs_search tools

  mcp.tool()(api_v2_jobs_search.post_api_v2_jobs_search)

  # Register api_v2_service_yaml tools

  mcp.tool()(api_v2_service_yaml.get_api_v2_svc_yaml)

  # Register api_v2_services_issues_search tools

  mcp.tool()(api_v2_services_issues_search.post_api_v2_svcs_issues_search)

  # Register api_v2_clusters_issues_search tools

  mcp.tool()(api_v2_clusters_issues_search.post_api_search)

  # Register api_v2_services_k8s_events_search tools

  mcp.tool()(api_v2_services_k8s_events_search.post_post_api_search)

  # Register api_v2_services_k8s_events tools

  mcp.tool()(api_v2_services_k8s_events.post_api_v2_svcs_k8s_events)

  # Register api_v2_clusters_k8s_events_search tools

  mcp.tool()(api_v2_clusters_k8s_events_search.post_post_api_search)

  # Register api_v2_rbac_kubeconfig tools

  mcp.tool()(api_v2_rbac_kubeconfig.get_api_v2_rbac_kubeconfig)

  # Register api_v2_clusters tools

  mcp.tool()(api_v2_clusters.get_api_v2_clusts)

  # Register api_v2_realtime_monitors_config tools

  mcp.tool()(api_v2_realtime_monitors_config.get_api_config)

  mcp.tool()(api_v2_realtime_monitors_config.post_api_config)

  # Register api_v2_realtime_monitors_config_id tools

  mcp.tool()(api_v2_realtime_monitors_config_id.get_api_id)

  mcp.tool()(api_v2_realtime_monitors_config_id.put_api_id)

  mcp.tool()(api_v2_realtime_monitors_config_id.del_api_id)

  # Register api_v2_audit_log tools

  mcp.tool()(api_v2_audit_log.get_api_v2_audit_log)

  # Register api_v2_audit_log_filters tools

  mcp.tool()(api_v2_audit_log_filters.get_api_v2_audit_log_filters)

  # Register api_v2_health_risks tools

  mcp.tool()(api_v2_health_risks.get_health_risks)

  # Register api_v2_health_risks_id tools

  mcp.tool()(api_v2_health_risks_id.get_health_risk_data)

  mcp.tool()(api_v2_health_risks_id.put_upd_health_risk_status)

  # Register api_v2_users tools

  mcp.tool()(api_v2_users.get_api_v2_users)

  mcp.tool()(api_v2_users.post_api_v2_users)

  # Register api_v2_users_id_or_email tools

  mcp.tool()(api_v2_users_id_or_email.get_api_v2_users_id_or_email)

  mcp.tool()(api_v2_users_id_or_email.put_api_v2_users_id_or_email)

  mcp.tool()(api_v2_users_id_or_email.del_api_v2_users_id_or_email)

  # Register api_v2_users_effective_permissions tools

  mcp.tool()(api_v2_users_effective_permissions.get_api_perms)

  # Register api_v2_rbac_roles tools

  mcp.tool()(api_v2_rbac_roles.get_api_v2_rbac_roles)

  mcp.tool()(api_v2_rbac_roles.post_api_v2_rbac_roles)

  # Register api_v2_rbac_roles_id_or_name tools

  mcp.tool()(api_v2_rbac_roles_id_or_name.get_api_name)

  mcp.tool()(api_v2_rbac_roles_id_or_name.put_api_name)

  mcp.tool()(api_v2_rbac_roles_id_or_name.del_api_name)

  # Register api_v2_rbac_roles_policies tools

  mcp.tool()(api_v2_rbac_roles_policies.post_api_policies)

  mcp.tool()(api_v2_rbac_roles_policies.del_api_v2_rbac_roles_policies)

  # Register api_v2_rbac_users_roles tools

  mcp.tool()(api_v2_rbac_users_roles.post_api_v2_rbac_users_roles)

  mcp.tool()(api_v2_rbac_users_roles.put_api_v2_rbac_users_roles)

  mcp.tool()(api_v2_rbac_users_roles.del_api_v2_rbac_users_roles)

  # Register api_v2_rbac_policies tools

  mcp.tool()(api_v2_rbac_policies.get_api_v2_rbac_policies)

  mcp.tool()(api_v2_rbac_policies.post_api_v2_rbac_policies)

  # Register api_v2_rbac_policies_id_or_name tools

  mcp.tool()(api_v2_rbac_policies_id_or_name.get_get_api_name)

  mcp.tool()(api_v2_rbac_policies_id_or_name.put_put_api_name)

  mcp.tool()(api_v2_rbac_policies_id_or_name.del_del_api_name)

  # Register api_v2_rbac_actions tools

  mcp.tool()(api_v2_rbac_actions.get_api_v2_rbac_actions)

  mcp.tool()(api_v2_rbac_actions.post_api_v2_rbac_actions)

  # Register api_v2_rbac_actions_action tools

  mcp.tool()(api_v2_rbac_actions_action.get_api_v2_rbac_actions_action)

  # Register api_v2_rbac_actions_id tools

  mcp.tool()(api_v2_rbac_actions_id.put_api_v2_rbac_actions_id)

  mcp.tool()(api_v2_rbac_actions_id.del_api_v2_rbac_actions_id)

  # Register api_v2_integrations_kubernetes tools

  mcp.tool()(api_v2_integrations_kubernetes.post_api_kubernetes)

  # Register api_v2_integrations_kubernetes_clustername tools

  mcp.tool()(api_v2_integrations_kubernetes_clustername.get_get_api_name)

  # Register api_v2_integrations_kubernetes_id tools

  mcp.tool()(api_v2_integrations_kubernetes_id.del_del_api_id)

  # Register api_v2_apikey_validate tools

  mcp.tool()(api_v2_apikey_validate.get_api_v2_apikey_validate)

  # Register api_v2_cost_allocation tools

  mcp.tool()(api_v2_cost_allocation.get_cost_allocation)

  # Register api_v2_cost_right_sizing_service tools

  mcp.tool()(api_v2_cost_right_sizing_service.get_cost_right_sizing_per_svc)

  # Register api_v2_cost_right_sizing_container tools

  mcp.tool()(api_v2_cost_right_sizing_container.get_cost_container)

  # Register api_v2_klaudia_rca_sessions tools

  mcp.tool()(api_v2_klaudia_rca_sessions.post_trigger_klaudia_rca)

  # Register api_v2_klaudia_rca_sessions_id tools

  mcp.tool()(api_v2_klaudia_rca_sessions_id.get_klaudia_rca_results)

  # Register mgmt_v1_apikey_validate tools

  mcp.tool()(mgmt_v1_apikey_validate.get_api_keys_controller_validate)

  # Register mgmt_v1_events tools

  mcp.tool()(mgmt_v1_events.post_events_controller_event)

  # Register mgmt_v1_monitors_config tools

  mcp.tool()(mgmt_v1_monitors_config.get_monitors_controller_v1_get_all)

  mcp.tool()(mgmt_v1_monitors_config.post_monitors_controller_v1_post)

  # Register mgmt_v1_monitors_config_id tools

  mcp.tool()(mgmt_v1_monitors_config_id.get_monitors_controller_v1_get)

  mcp.tool()(mgmt_v1_monitors_config_id.put_monitors_controller_v1_put)

  mcp.tool()(mgmt_v1_monitors_config_id.del_monitors_controller_v1_del)

  # Register mgmt_v1_rbac_roles tools

  mcp.tool()(mgmt_v1_rbac_roles.get_roles_controller_v1_get_all)

  mcp.tool()(mgmt_v1_rbac_roles.post_roles_controller_v1_post)

  mcp.tool()(mgmt_v1_rbac_roles.del_roles_controller_v1_del)

  # Register mgmt_v1_rbac_roles_id tools

  mcp.tool()(mgmt_v1_rbac_roles_id.get_roles_controller_v1_get)

  # Register mgmt_v1_rbac_roles_id_policies tools

  mcp.tool()(mgmt_v1_rbac_roles_id_policies.get_rbac_role_get)

  # Register mgmt_v1_rbac_roles_policies tools

  mcp.tool()(mgmt_v1_rbac_roles_policies.post_rbac_role_post)

  mcp.tool()(mgmt_v1_rbac_roles_policies.del_rbac_role_del)

  # Register mgmt_v1_rbac_policies tools

  mcp.tool()(mgmt_v1_rbac_policies.get_policies_controller_v1_get_all)

  mcp.tool()(mgmt_v1_rbac_policies.post_policies_controller_v1_post)

  mcp.tool()(mgmt_v1_rbac_policies.del_policies_controller_v1_del)

  # Register mgmt_v1_rbac_policies_id tools

  mcp.tool()(mgmt_v1_rbac_policies_id.get_policies_controller_v1_get)

  mcp.tool()(mgmt_v1_rbac_policies_id.put_policies_controller_policy)

  # Register mgmt_v1_rbac_users tools

  mcp.tool()(mgmt_v1_rbac_users.get_rbac_user_all)

  # Register mgmt_v1_rbac_users_id tools

  mcp.tool()(mgmt_v1_rbac_users_id.get_rbac_user_controller_v1_get)

  # Register mgmt_v1_rbac_users_id_roles tools

  mcp.tool()(mgmt_v1_rbac_users_id_roles.get_rbac_user_get)

  # Register mgmt_v1_rbac_users_roles tools

  mcp.tool()(mgmt_v1_rbac_users_roles.post_rbac_user_post)

  mcp.tool()(mgmt_v1_rbac_users_roles.del_rbac_user_del)

  # Register mgmt_v1_integrations_kubernetes tools

  mcp.tool()(mgmt_v1_integrations_kubernetes.post_clust_controller_post)

  # Register mgmt_v1_integrations_kubernetes_id tools

  mcp.tool()(mgmt_v1_integrations_kubernetes_id.del_clust_controller_del)

  # Register mgmt_v1_integrations_kubernetes_clustername tools

  mcp.tool()(mgmt_v1_integrations_kubernetes_clustername.get_clust_controller_name)

  # Register mgmt_v1_rbac_actions tools

  mcp.tool()(mgmt_v1_rbac_actions.get_actions_controller_v1_get_all)

  mcp.tool()(mgmt_v1_rbac_actions.post_actions_controller_v1_post)

  # Register mgmt_v1_rbac_actions_action tools

  mcp.tool()(mgmt_v1_rbac_actions_action.get_actions_controller_v1_get)

  # Register mgmt_v1_rbac_actions_id tools

  mcp.tool()(mgmt_v1_rbac_actions_id.del_actions_controller_v1_del)

  mcp.tool()(mgmt_v1_rbac_actions_id.put_actions_controller_v1_upd)

  # Run the MCP server
  mcp.run(transport=MCP_MODE.lower())


if __name__ == "__main__":
  main()
