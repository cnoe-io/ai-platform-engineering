#!/usr/bin/env python3
# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
argocd MCP Server

This server provides a Model Context Protocol (MCP) interface to the argocd,
allowing large language models and AI assistants to interact with the service.
"""
import logging
from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP

# Import tools
from agent_argocd.protocol_bindings.mcp_server.mcp_argocd.tools import api_v1_account
from agent_argocd.protocol_bindings.mcp_server.mcp_argocd.tools import api_v1_account_password
from agent_argocd.protocol_bindings.mcp_server.mcp_argocd.tools import api_v1_applications
from agent_argocd.protocol_bindings.mcp_server.mcp_argocd.tools import api_v1_applications_manifestsWithFiles
from agent_argocd.protocol_bindings.mcp_server.mcp_argocd.tools import api_v1_applicationsets
from agent_argocd.protocol_bindings.mcp_server.mcp_argocd.tools import api_v1_applicationsets_generate
from agent_argocd.protocol_bindings.mcp_server.mcp_argocd.tools import api_v1_certificates
from agent_argocd.protocol_bindings.mcp_server.mcp_argocd.tools import api_v1_clusters
from agent_argocd.protocol_bindings.mcp_server.mcp_argocd.tools import api_v1_gpgkeys
from agent_argocd.protocol_bindings.mcp_server.mcp_argocd.tools import api_v1_notifications_services
from agent_argocd.protocol_bindings.mcp_server.mcp_argocd.tools import api_v1_notifications_templates
from agent_argocd.protocol_bindings.mcp_server.mcp_argocd.tools import api_v1_notifications_triggers
from agent_argocd.protocol_bindings.mcp_server.mcp_argocd.tools import api_v1_projects
from agent_argocd.protocol_bindings.mcp_server.mcp_argocd.tools import api_v1_repocreds
from agent_argocd.protocol_bindings.mcp_server.mcp_argocd.tools import api_v1_repositories
from agent_argocd.protocol_bindings.mcp_server.mcp_argocd.tools import api_v1_session
from agent_argocd.protocol_bindings.mcp_server.mcp_argocd.tools import api_v1_session_userinfo
from agent_argocd.protocol_bindings.mcp_server.mcp_argocd.tools import api_v1_settings
from agent_argocd.protocol_bindings.mcp_server.mcp_argocd.tools import api_v1_settings_plugins
from agent_argocd.protocol_bindings.mcp_server.mcp_argocd.tools import api_v1_stream_applications
from agent_argocd.protocol_bindings.mcp_server.mcp_argocd.tools import api_v1_write_repocreds
from agent_argocd.protocol_bindings.mcp_server.mcp_argocd.tools import api_v1_write_repositories
from agent_argocd.protocol_bindings.mcp_server.mcp_argocd.tools import api_version

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.DEBUG)

# Create server instance
mcp = FastMCP("argocd MCP Server")

# Register tools
# Register api_v1_account tools
mcp.tool()(api_v1_account.AccountService_ListAccounts)

# Register api_v1_account_password tools
mcp.tool()(api_v1_account_password.AccountService_UpdatePassword)

# Register api_v1_applications tools
mcp.tool()(api_v1_applications.ApplicationService_List)
mcp.tool()(api_v1_applications.ApplicationService_Create)

# Register api_v1_applications_manifestsWithFiles tools
mcp.tool()(api_v1_applications_manifestsWithFiles.ApplicationService_GetManifestsWithFiles)

# Register api_v1_applicationsets tools
mcp.tool()(api_v1_applicationsets.ApplicationSetService_List)
mcp.tool()(api_v1_applicationsets.ApplicationSetService_Create)

# Register api_v1_applicationsets_generate tools
mcp.tool()(api_v1_applicationsets_generate.ApplicationSetService_Generate)

# Register api_v1_certificates tools
mcp.tool()(api_v1_certificates.CertificateService_DeleteCertificate)
mcp.tool()(api_v1_certificates.CertificateService_CreateCertificate)
mcp.tool()(api_v1_certificates.CertificateService_ListCertificates)

# Register api_v1_clusters tools
mcp.tool()(api_v1_clusters.ClusterService_Create)
mcp.tool()(api_v1_clusters.ClusterService_List)

# Register api_v1_gpgkeys tools
mcp.tool()(api_v1_gpgkeys.GPGKeyService_Create)
mcp.tool()(api_v1_gpgkeys.GPGKeyService_List)
mcp.tool()(api_v1_gpgkeys.GPGKeyService_Delete)

# Register api_v1_notifications_services tools
mcp.tool()(api_v1_notifications_services.NotificationService_ListServices)

# Register api_v1_notifications_templates tools
mcp.tool()(api_v1_notifications_templates.NotificationService_ListTemplates)

# Register api_v1_notifications_triggers tools
mcp.tool()(api_v1_notifications_triggers.NotificationService_ListTriggers)

# Register api_v1_projects tools
mcp.tool()(api_v1_projects.ProjectService_List)
mcp.tool()(api_v1_projects.ProjectService_Create)

# Register api_v1_repocreds tools
mcp.tool()(api_v1_repocreds.RepoCredsService_CreateRepositoryCredentials)
mcp.tool()(api_v1_repocreds.RepoCredsService_ListRepositoryCredentials)

# Register api_v1_repositories tools
mcp.tool()(api_v1_repositories.RepositoryService_CreateRepository)
mcp.tool()(api_v1_repositories.RepositoryService_ListRepositories)

# Register api_v1_session tools
mcp.tool()(api_v1_session.SessionService_Create)
mcp.tool()(api_v1_session.SessionService_Delete)

# Register api_v1_session_userinfo tools
mcp.tool()(api_v1_session_userinfo.SessionService_GetUserInfo)

# Register api_v1_settings tools
mcp.tool()(api_v1_settings.SettingsService_Get)

# Register api_v1_settings_plugins tools
mcp.tool()(api_v1_settings_plugins.SettingsService_GetPlugins)

# Register api_v1_stream_applications tools
mcp.tool()(api_v1_stream_applications.ApplicationService_Watch)

# Register api_v1_write_repocreds tools
mcp.tool()(api_v1_write_repocreds.RepoCredsService_ListWriteRepositoryCredentials)
mcp.tool()(api_v1_write_repocreds.RepoCredsService_CreateWriteRepositoryCredentials)

# Register api_v1_write_repositories tools
mcp.tool()(api_v1_write_repositories.RepositoryService_ListWriteRepositories)
mcp.tool()(api_v1_write_repositories.RepositoryService_CreateWriteRepository)

# Register api_version tools
mcp.tool()(api_version.VersionService_Version)


# Start server when run directly
def main():
    mcp.run()

if __name__ == "__main__":
    main()
