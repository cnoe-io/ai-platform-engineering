#!/usr/bin/env python3
"""
 MCP Server

This server provides a Model Context Protocol (MCP) interface to the ,
allowing large language models and AI assistants to interact with the service.
"""

import logging
import os
from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP


from mcp_komodor.tools import api_v2_services_search

from mcp_komodor.tools import api_v2_jobs_search

from mcp_komodor.tools import api_v2_service_yaml

from mcp_komodor.tools import api_v2_services_issues_search

from mcp_komodor.tools import api_v2_clusters_issues_search

from mcp_komodor.tools import api_v2_services_k8s_events_search

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

from mcp_komodor.tools import api_v2_rbac_roles_id_or_name

from mcp_komodor.tools import api_v2_rbac_policies

from mcp_komodor.tools import api_v2_rbac_policies_id_or_name

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
    logging.basicConfig(level=logging.DEBUG)

    # Get MCP configuration from environment variables
    MCP_MODE = os.getenv("MCP_MODE", "STDIO")

    # Get host and port for server
    MCP_HOST = os.getenv("MCP_HOST", "localhost")
    MCP_PORT = int(os.getenv("MCP_PORT", "8000"))

    logging.info(f"Starting MCP server in {MCP_MODE} mode on {MCP_HOST}:{MCP_PORT}")

    # Get agent name from environment variables
    AGENT_NAME = os.getenv("AGENT_NAME", "KOMODOR Agent")
    logging.info(f"Agent name: {AGENT_NAME}")

    # Create server instance
    if MCP_MODE == "SSE":
        mcp = FastMCP(f"{AGENT_NAME} MCP Server", host=MCP_HOST, port=MCP_PORT)
    else:
        mcp = FastMCP("KOMODOR MCP Server")

    # Register api_v2_services_search tools

    mcp.tool()(api_v2_services_search.post_api_v2_services_search)

    # Register api_v2_jobs_search tools

    mcp.tool()(api_v2_jobs_search.post_api_v2_jobs_search)

    # Register api_v2_service_yaml tools

    mcp.tool()(api_v2_service_yaml.get_api_v2_service_yaml)

    # Register api_v2_services_issues_search tools

    mcp.tool()(api_v2_services_issues_search.post_api_v2_services_issues_search)

    # Register api_v2_clusters_issues_search tools

    mcp.tool()(api_v2_clusters_issues_search.post_api_v2_clusters_issues_search)

    # Register api_v2_services_k8s_events_search tools

    mcp.tool()(api_v2_services_k8s_events_search.post_api_v2_services_k8s_events_search)

    # Register api_v2_clusters_k8s_events_search tools

    mcp.tool()(api_v2_clusters_k8s_events_search.post_api_v2_clusters_k8s_events_search)

    # Register api_v2_rbac_kubeconfig tools

    mcp.tool()(api_v2_rbac_kubeconfig.get_api_v2_rbac_kubeconfig)

    # Register api_v2_clusters tools

    mcp.tool()(api_v2_clusters.get_api_v2_clusters)

    # Register api_v2_realtime_monitors_config tools

    mcp.tool()(api_v2_realtime_monitors_config.get_api_v2_realtime_monitors_config)

    mcp.tool()(api_v2_realtime_monitors_config.post_api_v2_realtime_monitors_config)

    # Register api_v2_realtime_monitors_config_id tools

    mcp.tool()(api_v2_realtime_monitors_config_id.get_api_v2_realtime_monitors_config_id)

    mcp.tool()(api_v2_realtime_monitors_config_id.put_api_v2_realtime_monitors_config_id)

    mcp.tool()(api_v2_realtime_monitors_config_id.delete_api_v2_realtime_monitors_config_id)

    # Register api_v2_audit_log tools

    mcp.tool()(api_v2_audit_log.get_api_v2_audit_log)

    # Register api_v2_audit_log_filters tools

    mcp.tool()(api_v2_audit_log_filters.get_api_v2_audit_log_filters)

    # Register api_v2_health_risks tools

    mcp.tool()(api_v2_health_risks.get_health_risks)

    # Register api_v2_health_risks_id tools

    mcp.tool()(api_v2_health_risks_id.get_health_risk_data)

    mcp.tool()(api_v2_health_risks_id.update_health_risk_status)

    # Register api_v2_users tools

    mcp.tool()(api_v2_users.get_api_v2_users)

    mcp.tool()(api_v2_users.post_api_v2_users)

    # Register api_v2_users_id_or_email tools

    mcp.tool()(api_v2_users_id_or_email.get_api_v2_users_id_or_email)

    mcp.tool()(api_v2_users_id_or_email.put_api_v2_users_id_or_email)

    mcp.tool()(api_v2_users_id_or_email.delete_api_v2_users_id_or_email)

    # Register api_v2_users_effective_permissions tools

    mcp.tool()(api_v2_users_effective_permissions.get_api_v2_users_effective_permissions)

    # Register api_v2_rbac_roles_id_or_name tools

    mcp.tool()(api_v2_rbac_roles_id_or_name.get_api_v2_rbac_roles_id_or_name)

    mcp.tool()(api_v2_rbac_roles_id_or_name.put_api_v2_rbac_roles_id_or_name)

    mcp.tool()(api_v2_rbac_roles_id_or_name.delete_api_v2_rbac_roles_id_or_name)

    # Register api_v2_rbac_policies tools

    mcp.tool()(api_v2_rbac_policies.post_api_v2_rbac_policies)

    # Register api_v2_rbac_policies_id_or_name tools

    mcp.tool()(api_v2_rbac_policies_id_or_name.get_api_v2_rbac_policies_id_or_name)

    mcp.tool()(api_v2_rbac_policies_id_or_name.put_api_v2_rbac_policies_id_or_name)

    mcp.tool()(api_v2_rbac_policies_id_or_name.delete_api_v2_rbac_policies_id_or_name)

    # Register api_v2_cost_allocation tools

    mcp.tool()(api_v2_cost_allocation.get_cost_allocation)

    # Register api_v2_cost_right_sizing_service tools

    mcp.tool()(api_v2_cost_right_sizing_service.get_cost_right_sizing_per_service)

    # Register api_v2_cost_right_sizing_container tools

    mcp.tool()(api_v2_cost_right_sizing_container.get_cost_right_sizing_per_container)

    # Register api_v2_klaudia_rca_sessions tools

    mcp.tool()(api_v2_klaudia_rca_sessions.trigger_klaudia_rca)

    # Register api_v2_klaudia_rca_sessions_id tools

    mcp.tool()(api_v2_klaudia_rca_sessions_id.get_klaudia_rca_results)

    # Register mgmt_v1_apikey_validate tools

    mcp.tool()(mgmt_v1_apikey_validate.api_keys_controller_validate)

    # Register mgmt_v1_events tools

    mcp.tool()(mgmt_v1_events.events_controller_create_custom_event)

    # Register mgmt_v1_monitors_config tools

    mcp.tool()(mgmt_v1_monitors_config.monitors_controller_v1_get_all)

    mcp.tool()(mgmt_v1_monitors_config.monitors_controller_v1_post)

    # Register mgmt_v1_monitors_config_id tools

    mcp.tool()(mgmt_v1_monitors_config_id.monitors_controller_v1_get)

    mcp.tool()(mgmt_v1_monitors_config_id.monitors_controller_v1_put)

    mcp.tool()(mgmt_v1_monitors_config_id.monitors_controller_v1_delete)

    # Register mgmt_v1_rbac_roles tools

    mcp.tool()(mgmt_v1_rbac_roles.roles_controller_v1_get_all)

    mcp.tool()(mgmt_v1_rbac_roles.roles_controller_v1_post)

    mcp.tool()(mgmt_v1_rbac_roles.roles_controller_v1_delete)

    # Register mgmt_v1_rbac_roles_id tools

    mcp.tool()(mgmt_v1_rbac_roles_id.roles_controller_v1_get)

    # Register mgmt_v1_rbac_roles_id_policies tools

    mcp.tool()(mgmt_v1_rbac_roles_id_policies.rbac_role_policies_controller_v1_get)

    # Register mgmt_v1_rbac_roles_policies tools

    mcp.tool()(mgmt_v1_rbac_roles_policies.rbac_role_policies_controller_v1_post)

    mcp.tool()(mgmt_v1_rbac_roles_policies.rbac_role_policies_controller_v1_delete)

    # Register mgmt_v1_rbac_policies tools

    mcp.tool()(mgmt_v1_rbac_policies.policies_controller_v1_get_all)

    mcp.tool()(mgmt_v1_rbac_policies.policies_controller_v1_post)

    mcp.tool()(mgmt_v1_rbac_policies.policies_controller_v1_delete)

    # Register mgmt_v1_rbac_policies_id tools

    mcp.tool()(mgmt_v1_rbac_policies_id.policies_controller_v1_get)

    mcp.tool()(mgmt_v1_rbac_policies_id.policies_controller_v1_update_policy)

    # Register mgmt_v1_rbac_users tools

    mcp.tool()(mgmt_v1_rbac_users.rbac_user_controller_v1_get_all)

    # Register mgmt_v1_rbac_users_id tools

    mcp.tool()(mgmt_v1_rbac_users_id.rbac_user_controller_v1_get)

    # Register mgmt_v1_rbac_users_id_roles tools

    mcp.tool()(mgmt_v1_rbac_users_id_roles.rbac_user_roles_controller_v1_get)

    # Register mgmt_v1_rbac_users_roles tools

    mcp.tool()(mgmt_v1_rbac_users_roles.rbac_user_roles_controller_v1_post)

    mcp.tool()(mgmt_v1_rbac_users_roles.rbac_user_roles_controller_v1_delete)

    # Register mgmt_v1_integrations_kubernetes tools

    mcp.tool()(mgmt_v1_integrations_kubernetes.cluster_controller_post)

    # Register mgmt_v1_integrations_kubernetes_id tools

    mcp.tool()(mgmt_v1_integrations_kubernetes_id.cluster_controller_delete)

    # Register mgmt_v1_integrations_kubernetes_clustername tools

    mcp.tool()(mgmt_v1_integrations_kubernetes_clustername.cluster_controller_get_by_cluster_name)

    # Register mgmt_v1_rbac_actions tools

    mcp.tool()(mgmt_v1_rbac_actions.actions_controller_v1_get_all)

    mcp.tool()(mgmt_v1_rbac_actions.actions_controller_v1_post)

    # Register mgmt_v1_rbac_actions_action tools

    mcp.tool()(mgmt_v1_rbac_actions_action.actions_controller_v1_get)

    # Register mgmt_v1_rbac_actions_id tools

    mcp.tool()(mgmt_v1_rbac_actions_id.actions_controller_v1_delete)

    mcp.tool()(mgmt_v1_rbac_actions_id.actions_controller_v1_update)

    # Run the MCP server
    mcp.run()


if __name__ == "__main__":
    main()
