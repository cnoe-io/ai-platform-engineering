# Generated MCP Server

This is an automatically generated Model Context Protocol (MCP) server based on an OpenAPI specification.

## Prerequisites

- Python 3.8 or higher
- [Install Poetry](https://python-poetry.org/docs/#installation)
- Setup a virtual environment
```
poetry config virtualenvs.in-project true
poetry install
```


## Setup

1. Copy `.env.example` to `.env` and fill in your API credentials:

```bash
cp .env.example .env
```

2. Install dependencies:

```bash
poetry install
```

3. Run the server:

```bash
poetry run python -m server
```

## Available Tools

The following tools are available through the MCP server:


### POST /api/v2/services/search
Search for services

Search for services based on the provided criteria. If no criteria is provided, the default is to return all services.


### POST /api/v2/jobs/search
Search for jobs and cron jobs

Search for jobs based on the provided criteria. If no criteria is provided, the default is to return all jobs.


### GET /api/v2/service/yaml
Get service YAML

Get the YAML for a service


### POST /api/v2/services/issues/search
Search for issues in service scope

Search for issues based on the provided criteria. Maximum time range is 2 days. If no time range is provided, the default is the last 24 hours. Maximum time back is 7 days.


### POST /api/v2/clusters/issues/search
Search for issues in cluster scope

Search for issues based on the provided criteria. Maximum time range is 2 days. If no time range is provided, the default is the last 24 hours. Maximum time back is 7 days.


### POST /api/v2/services/k8s-events/search
Search for k8s events in service scope

Search for events based on the provided criteria. Maximum time range is 2 days. If no time range is provided, the default is the last 24 hours. Maximum time back is 7 days.


### POST /api/v2/clusters/k8s-events/search
Search for k8s events in cluster scope

Search for events based on the provided criteria. Maximum time range is 2 days. If no time range is provided, the default is the last 24 hours. Maximum time back is 7 days.


### GET /api/v2/rbac/kubeconfig
Download Kubeconfig File

Download a kubeconfig file for the specified cluster names. If no cluster names are specified, the kubeconfig file for all available clusters will be returned.


### GET /api/v2/clusters
Get list of clusters

Fetch a list of all clusters, optionally filtered by name or tags.


### GET /api/v2/realtime-monitors/config



### POST /api/v2/realtime-monitors/config



### GET /api/v2/realtime-monitors/config/{id}



### PUT /api/v2/realtime-monitors/config/{id}



### DELETE /api/v2/realtime-monitors/config/{id}



### GET /api/v2/audit-log
Query Audit Logs

Query audit logs with filters, sort and pagination. Use `Accept: text/csv` header to get the response as CSV file.



### GET /api/v2/audit-log/filters
Get available filter values for Query Audit Logs


### GET /api/v2/health/risks
Get all the health risks.

Get all the health risks.


### GET /api/v2/health/risks/{id}
Get health risk data.

Get health risk data.


### PUT /api/v2/health/risks/{id}
Update the status of a health risk.

Update the status of a health risk.


### GET /api/v2/users
Get Users


### POST /api/v2/users
Create a User


### GET /api/v2/users/{id_or_email}
Get a User by id or email


### PUT /api/v2/users/{id_or_email}
Update a User by id or email


### DELETE /api/v2/users/{id_or_email}
Delete a User by id or email


### GET /api/v2/users/effective-permissions
Get User's Effective Permissions

Get user's effective permissions by either user id or email.


### GET /api/v2/rbac/roles/{id_or_name}
Get Role by ID or Name

Get Role by ID or Name


### PUT /api/v2/rbac/roles/{id_or_name}
Update Role by ID or Name

Update Role by ID or Name


### DELETE /api/v2/rbac/roles/{id_or_name}
Delete Role by ID or Name

Delete Role by ID or Name


### POST /api/v2/rbac/policies
Create Policy

Create Policy


### GET /api/v2/rbac/policies/{id_or_name}
Get Policy by ID or Name

Get Policy by ID or Name


### PUT /api/v2/rbac/policies/{id_or_name}
Update Policy by Id or Name

Update Policy by Id or Name


### DELETE /api/v2/rbac/policies/{id_or_name}
Delete Policy by Id or Name

Delete Policy by Id or Name


### GET /api/v2/cost/allocation
Get cost allocation breakdown.

Retrieve a breakdown of cost allocation across clusters, workspaces, or any user-defined grouping.


### GET /api/v2/cost/right-sizing/service
Get cost right-sizing recommendations per service.

Get recommended CPU and memory request adjustments per service to optimize cost.


### GET /api/v2/cost/right-sizing/container
Get cost right-sizing summary per container.

Get cost right-sizing summary per container.


### POST /api/v2/klaudia/rca/sessions
Trigger a new RCA investigation


### GET /api/v2/klaudia/rca/sessions/{id}
Retrieve RCA investigation results


### GET /mgmt/v1/apikey/validate



### POST /mgmt/v1/events



### GET /mgmt/v1/monitors/config
Deprecated: Use `/api/v2/realtime-monitors/config` instead.

This API is deprecated. Please use `/api/v2/realtime-monitors/config` API instead for new implementations and better validation and error handling.


### POST /mgmt/v1/monitors/config
Deprecated: Use `/api/v2/realtime-monitors/config` instead.

This API is deprecated. Please use `/api/v2/realtime-monitors/config` API instead for new implementations and better validation and error handling.


### GET /mgmt/v1/monitors/config/{id}
Deprecated: Use `/api/v2/realtime-monitors/config` instead.

This API is deprecated. Please use `/api/v2/realtime-monitors/config` API instead for new implementations and better validation and error handling.


### PUT /mgmt/v1/monitors/config/{id}
Deprecated: Use `/api/v2/realtime-monitors/config` instead.

This API is deprecated. Please use `/api/v2/realtime-monitors/config` API instead for new implementations and better validation and error handling.


### DELETE /mgmt/v1/monitors/config/{id}
Deprecated: Use `/api/v2/realtime-monitors/config` instead.

This API is deprecated. Please use `/api/v2/realtime-monitors/config` API instead for new implementations and better validation and error handling.


### GET /mgmt/v1/rbac/roles



### POST /mgmt/v1/rbac/roles



### DELETE /mgmt/v1/rbac/roles



### GET /mgmt/v1/rbac/roles/{id}



### GET /mgmt/v1/rbac/roles/{id}/policies



### POST /mgmt/v1/rbac/roles/policies



### DELETE /mgmt/v1/rbac/roles/policies



### GET /mgmt/v1/rbac/policies



### POST /mgmt/v1/rbac/policies



### DELETE /mgmt/v1/rbac/policies



### GET /mgmt/v1/rbac/policies/{id}



### PUT /mgmt/v1/rbac/policies/{id}



### GET /mgmt/v1/rbac/users



### GET /mgmt/v1/rbac/users/{id}



### GET /mgmt/v1/rbac/users/{id}/roles



### POST /mgmt/v1/rbac/users/roles



### DELETE /mgmt/v1/rbac/users/roles



### POST /mgmt/v1/integrations/kubernetes



### DELETE /mgmt/v1/integrations/kubernetes/{id}



### GET /mgmt/v1/integrations/kubernetes/{clusterName}



### GET /mgmt/v1/rbac/actions



### POST /mgmt/v1/rbac/actions



### GET /mgmt/v1/rbac/actions/{action}



### DELETE /mgmt/v1/rbac/actions/{id}



### PUT /mgmt/v1/rbac/actions/{id}


