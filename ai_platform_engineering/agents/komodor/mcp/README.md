# Generated MCP Server

This is an automatically generated Model Context Protocol (MCP) server based on an OpenAPI specification.

---

## Setup MCP Server in Streamable HTTP Mode
- Setup UV

```bash
# On macOS and Linux.
curl -LsSf https://astral.sh/uv/install.sh | sh
```
- uv venv
```bash
uv venv && source .venv/bin/activate
```
- uv sync
```bash
uv sync
```
- Copy .env.example to .env
- Setup .env
```bash
KOMODOR_API_TOKEN=
KOMODOR_URL=
MCP_MODE=http
MCP_HOST=0.0.0.0
MCP_PORT=18000
```

```bash
set -a; source .env; set +a && uv run python mcp_komodor/server.py
```

## MCP Inspector Tool

The **MCP Inspector** is a utility for inspecting and debugging MCP servers. It provides a visual interface to explore generated tools, models, and APIs.

### Installation

To install the MCP Inspector, use the following command:

```bash
npx @modelcontextprotocol/inspector
```

### Usage

Run the inspector in your project directory to analyze the generated MCP server:

```bash
npx @modelcontextprotocol/inspector
```

This will launch a web-based interface where you can:

- Explore available tools and their operations
- Inspect generated models and their schemas
- Test API endpoints directly from the interface

For more details, visit the [MCP Inspector Documentation](https://modelcontextprotocol.io/legacy/tools/inspector).

## Available Tools

The following tools are available through the MCP server:

| **Endpoint**                                      | **Description**                                                                                     |
|---------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| **POST /api/v2/services/search**                 | Search for services based on the provided criteria. Default is to return all services.             |
| **POST /api/v2/jobs/search**                     | Search for jobs and cron jobs based on the provided criteria. Default is to return all jobs.       |
| **GET /api/v2/service/yaml**                     | Get the YAML for a service.                                                                        |
| **POST /api/v2/services/issues/search**          | Search for issues in service scope. Max time range: 2 days. Default: last 24 hours.               |
| **POST /api/v2/clusters/issues/search**          | Search for issues in cluster scope. Max time range: 2 days. Default: last 24 hours.               |
| **POST /api/v2/services/k8s-events/search**      | Search for k8s events in service scope. Max time range: 2 days. Default: last 24 hours.           |
| **POST /api/v2/clusters/k8s-events/search**      | Search for k8s events in cluster scope. Max time range: 2 days. Default: last 24 hours.           |
| **GET /api/v2/rbac/kubeconfig**                  | Download a kubeconfig file for specified clusters or all available clusters.                      |
| **GET /api/v2/clusters**                         | Fetch a list of all clusters, optionally filtered by name or tags.                                |
| **GET /api/v2/realtime-monitors/config**         | Retrieve real-time monitor configurations.                                                        |
| **POST /api/v2/realtime-monitors/config**        | Create a new real-time monitor configuration.                                                     |
| **GET /api/v2/realtime-monitors/config/{id}**    | Retrieve a specific real-time monitor configuration by ID.                                        |
| **PUT /api/v2/realtime-monitors/config/{id}**    | Update a specific real-time monitor configuration by ID.                                          |
| **DELETE /api/v2/realtime-monitors/config/{id}** | Delete a specific real-time monitor configuration by ID.                                          |
| **GET /api/v2/audit-log**                        | Query audit logs with filters, sort, and pagination. Use `Accept: text/csv` for CSV response.     |
| **GET /api/v2/audit-log/filters**                | Get available filter values for querying audit logs.                                              |
| **GET /api/v2/health/risks**                     | Get all health risks.                                                                              |
| **GET /api/v2/health/risks/{id}**                | Get health risk data by ID.                                                                       |
| **PUT /api/v2/health/risks/{id}**                | Update the status of a health risk by ID.                                                         |
| **GET /api/v2/users**                            | Get a list of users.                                                                              |
| **POST /api/v2/users**                           | Create a new user.                                                                                |
| **GET /api/v2/users/{id_or_email}**              | Get a user by ID or email.                                                                        |
| **PUT /api/v2/users/{id_or_email}**              | Update a user by ID or email.                                                                     |
| **DELETE /api/v2/users/{id_or_email}**           | Delete a user by ID or email.                                                                     |
| **GET /api/v2/users/effective-permissions**      | Get a user's effective permissions by ID or email.                                                |
| **GET /api/v2/rbac/roles/{id_or_name}**          | Get a role by ID or name.                                                                         |
| **PUT /api/v2/rbac/roles/{id_or_name}**          | Update a role by ID or name.                                                                      |
| **DELETE /api/v2/rbac/roles/{id_or_name}**       | Delete a role by ID or name.                                                                      |
| **POST /api/v2/rbac/policies**                   | Create a new policy.                                                                              |
| **GET /api/v2/rbac/policies/{id_or_name}**       | Get a policy by ID or name.                                                                       |
| **PUT /api/v2/rbac/policies/{id_or_name}**       | Update a policy by ID or name.                                                                    |
| **DELETE /api/v2/rbac/policies/{id_or_name}**    | Delete a policy by ID or name.                                                                    |
| **GET /api/v2/cost/allocation**                  | Retrieve a breakdown of cost allocation across clusters, workspaces, or user-defined groupings.   |
| **GET /api/v2/cost/right-sizing/service**        | Get cost right-sizing recommendations per service.                                                |
| **GET /api/v2/cost/right-sizing/container**      | Get cost right-sizing summary per container.                                                     |
| **POST /api/v2/klaudia/rca/sessions**            | Trigger a new RCA investigation.                                                                 |
| **GET /api/v2/klaudia/rca/sessions/{id}**        | Retrieve RCA investigation results by session ID.                                                |
| **GET /mgmt/v1/apikey/validate**                 | Validate an API key.                                                                              |
| **POST /mgmt/v1/events**                         | Post a new event.                                                                                 |
| **GET /mgmt/v1/monitors/config**                 | Deprecated: Use `/api/v2/realtime-monitors/config` instead.                                       |
| **POST /mgmt/v1/monitors/config**                | Deprecated: Use `/api/v2/realtime-monitors/config` instead.                                       |
| **GET /mgmt/v1/monitors/config/{id}**            | Deprecated: Use `/api/v2/realtime-monitors/config` instead.                                       |
| **PUT /mgmt/v1/monitors/config/{id}**            | Deprecated: Use `/api/v2/realtime-monitors/config` instead.                                       |
| **DELETE /mgmt/v1/monitors/config/{id}**         | Deprecated: Use `/api/v2/realtime-monitors/config` instead.                                       |
| **GET /mgmt/v1/rbac/roles**                      | Retrieve a list of RBAC roles.                                                                   |
| **POST /mgmt/v1/rbac/roles**                     | Create a new RBAC role.                                                                          |
| **DELETE /mgmt/v1/rbac/roles**                   | Delete an RBAC role.                                                                             |
| **GET /mgmt/v1/rbac/roles/{id}**                 | Retrieve an RBAC role by ID.                                                                     |
| **GET /mgmt/v1/rbac/roles/{id}/policies**        | Retrieve policies associated with an RBAC role by ID.                                            |
| **POST /mgmt/v1/rbac/roles/policies**            | Associate policies with an RBAC role.                                                            |
| **DELETE /mgmt/v1/rbac/roles/policies**          | Remove policies from an RBAC role.                                                               |
| **GET /mgmt/v1/rbac/policies**                   | Retrieve a list of RBAC policies.                                                                |
| **POST /mgmt/v1/rbac/policies**                  | Create a new RBAC policy.                                                                        |
| **DELETE /mgmt/v1/rbac/policies**                | Delete an RBAC policy.                                                                           |
| **GET /mgmt/v1/rbac/policies/{id}**              | Retrieve an RBAC policy by ID.                                                                   |
| **PUT /mgmt/v1/rbac/policies/{id}**              | Update an RBAC policy by ID.                                                                     |
| **GET /mgmt/v1/rbac/users**                      | Retrieve a list of RBAC users.                                                                   |
| **GET /mgmt/v1/rbac/users/{id}**                 | Retrieve an RBAC user by ID.                                                                     |
| **GET /mgmt/v1/rbac/users/{id}/roles**           | Retrieve roles associated with an RBAC user by ID.                                               |
| **POST /mgmt/v1/rbac/users/roles**               | Associate roles with an RBAC user.                                                               |
| **DELETE /mgmt/v1/rbac/users/roles**             | Remove roles from an RBAC user.                                                                  |
| **POST /mgmt/v1/integrations/kubernetes**        | Integrate Kubernetes with the system.                                                            |
| **DELETE /mgmt/v1/integrations/kubernetes/{id}** | Remove a Kubernetes integration by ID.                                                           |
| **GET /mgmt/v1/integrations/kubernetes/{clusterName}** | Retrieve Kubernetes integration details by cluster name.                                         |
| **GET /mgmt/v1/rbac/actions**                    | Retrieve a list of RBAC actions.                                                                 |
| **POST /mgmt/v1/rbac/actions**                   | Create a new RBAC action.                                                                        |
| **GET /mgmt/v1/rbac/actions/{action}**           | Retrieve an RBAC action by name.                                                                 |
| **DELETE /mgmt/v1/rbac/actions/{id}**            | Delete an RBAC action by ID.                                                                     |
| **PUT /mgmt/v1/rbac/actions/{id}**               | Update an RBAC action by ID.                                                                     |

## 📚 Additional References

- [OpenAPI MCP Codegen](https://github.com/cnoe-io/openapi-mcp-codegen)

