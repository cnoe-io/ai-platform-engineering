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


### GET /api/v1/account
ListAccounts returns the list of accounts


### GET /api/v1/account/can-i/{resource}/{action}/{subresource}
CanI checks if the current account has permission to perform an action


### PUT /api/v1/account/password
UpdatePassword updates an account's password to a new value


### GET /api/v1/account/{name}
GetAccount returns an account


### POST /api/v1/account/{name}/token
CreateToken creates a token


### DELETE /api/v1/account/{name}/token/{id}
DeleteToken deletes a token


### GET /api/v1/applications
List returns list of applications


### POST /api/v1/applications
Create creates an application


### POST /api/v1/applications/manifestsWithFiles
GetManifestsWithFiles returns application manifests using provided files to generate them


### PUT /api/v1/applications/{application.metadata.name}
Update updates an application


### GET /api/v1/applications/{applicationName}/managed-resources
ManagedResources returns list of managed resources


### GET /api/v1/applications/{applicationName}/resource-tree
ResourceTree returns resource tree


### GET /api/v1/applications/{name}
Get returns an application by name


### DELETE /api/v1/applications/{name}
Delete deletes an application


### GET /api/v1/applications/{name}/events
ListResourceEvents returns a list of event resources


### GET /api/v1/applications/{name}/links
ListLinks returns the list of all application deep links


### GET /api/v1/applications/{name}/logs
PodLogs returns stream of log entries for the specified pod. Pod


### GET /api/v1/applications/{name}/manifests
GetManifests returns application manifests


### DELETE /api/v1/applications/{name}/operation
TerminateOperation terminates the currently running operation


### GET /api/v1/applications/{name}/pods/{podName}/logs
PodLogs returns stream of log entries for the specified pod. Pod


### GET /api/v1/applications/{name}/resource
GetResource returns single application resource


### POST /api/v1/applications/{name}/resource
PatchResource patch single application resource


### DELETE /api/v1/applications/{name}/resource
DeleteResource deletes a single application resource


### GET /api/v1/applications/{name}/resource/actions
ListResourceActions returns list of resource actions


### POST /api/v1/applications/{name}/resource/actions
RunResourceAction run resource action


### GET /api/v1/applications/{name}/resource/links
ListResourceLinks returns the list of all resource deep links


### GET /api/v1/applications/{name}/revisions/{revision}/chartdetails
Get the chart metadata (description, maintainers, home) for a specific revision of the application


### GET /api/v1/applications/{name}/revisions/{revision}/metadata
Get the meta-data (author, date, tags, message) for a specific revision of the application


### POST /api/v1/applications/{name}/rollback
Rollback syncs an application to its target state


### PUT /api/v1/applications/{name}/spec
UpdateSpec updates an application spec


### POST /api/v1/applications/{name}/sync
Sync syncs an application to its target state


### GET /api/v1/applications/{name}/syncwindows
Get returns sync windows of the application


### GET /api/v1/applicationsets
List returns list of applicationset


### POST /api/v1/applicationsets
Create creates an applicationset


### POST /api/v1/applicationsets/generate
Generate generates


### GET /api/v1/applicationsets/{name}
Get returns an applicationset by name


### DELETE /api/v1/applicationsets/{name}
Delete deletes an application set


### GET /api/v1/applicationsets/{name}/resource-tree
ResourceTree returns resource tree


### GET /api/v1/certificates
List all available repository certificates


### POST /api/v1/certificates
Creates repository certificates on the server


### DELETE /api/v1/certificates
Delete the certificates that match the RepositoryCertificateQuery


### GET /api/v1/clusters
List returns list of clusters


### POST /api/v1/clusters
Create creates a cluster


### GET /api/v1/clusters/{id.value}
Get returns a cluster by server address


### PUT /api/v1/clusters/{id.value}
Update updates a cluster


### DELETE /api/v1/clusters/{id.value}
Delete deletes a cluster


### POST /api/v1/clusters/{id.value}/invalidate-cache
InvalidateCache invalidates cluster cache


### POST /api/v1/clusters/{id.value}/rotate-auth
RotateAuth rotates the bearer token used for a cluster


### GET /api/v1/gpgkeys
List all available repository certificates


### POST /api/v1/gpgkeys
Create one or more GPG public keys in the server's configuration


### DELETE /api/v1/gpgkeys
Delete specified GPG public key from the server's configuration


### GET /api/v1/gpgkeys/{keyID}
Get information about specified GPG public key from the server


### GET /api/v1/notifications/services
List returns list of services


### GET /api/v1/notifications/templates
List returns list of templates


### GET /api/v1/notifications/triggers
List returns list of triggers


### GET /api/v1/projects
List returns list of projects


### POST /api/v1/projects
Create a new project


### GET /api/v1/projects/{name}
Get returns a project by name


### DELETE /api/v1/projects/{name}
Delete deletes a project


### GET /api/v1/projects/{name}/detailed
GetDetailedProject returns a project that include project, global project and scoped resources by name


### GET /api/v1/projects/{name}/events
ListEvents returns a list of project events


### GET /api/v1/projects/{name}/globalprojects
Get returns a virtual project by name


### GET /api/v1/projects/{name}/links
ListLinks returns all deep links for the particular project


### GET /api/v1/projects/{name}/syncwindows
GetSchedulesState returns true if there are any active sync syncWindows


### PUT /api/v1/projects/{project.metadata.name}
Update updates a project


### POST /api/v1/projects/{project}/roles/{role}/token
Create a new project token


### DELETE /api/v1/projects/{project}/roles/{role}/token/{iat}
Delete a new project token


### GET /api/v1/repocreds
ListRepositoryCredentials gets a list of all configured repository credential sets


### POST /api/v1/repocreds
CreateRepositoryCredentials creates a new repository credential set


### PUT /api/v1/repocreds/{creds.url}
UpdateRepositoryCredentials updates a repository credential set


### DELETE /api/v1/repocreds/{url}
DeleteRepositoryCredentials deletes a repository credential set from the configuration


### GET /api/v1/repositories
ListRepositories gets a list of all configured repositories


### POST /api/v1/repositories
CreateRepository creates a new repository configuration


### PUT /api/v1/repositories/{repo.repo}
UpdateRepository updates a repository configuration


### GET /api/v1/repositories/{repo}
Get returns a repository or its credentials


### DELETE /api/v1/repositories/{repo}
DeleteRepository deletes a repository from the configuration


### GET /api/v1/repositories/{repo}/apps
ListApps returns list of apps in the repo


### GET /api/v1/repositories/{repo}/helmcharts
GetHelmCharts returns list of helm charts in the specified repository


### GET /api/v1/repositories/{repo}/refs



### POST /api/v1/repositories/{repo}/validate
ValidateAccess validates access to a repository with given parameters


### POST /api/v1/repositories/{source.repoURL}/appdetails
GetAppDetails returns application details by given path


### POST /api/v1/session
Create a new JWT for authentication and set a cookie if using HTTP


### DELETE /api/v1/session
Delete an existing JWT cookie if using HTTP


### GET /api/v1/session/userinfo
Get the current user's info


### GET /api/v1/settings
Get returns Argo CD settings


### GET /api/v1/settings/plugins
Get returns Argo CD plugins


### GET /api/v1/stream/applications
Watch returns stream of application change events


### GET /api/v1/stream/applications/{applicationName}/resource-tree
Watch returns stream of application resource tree


### GET /api/v1/write-repocreds
ListWriteRepositoryCredentials gets a list of all configured repository credential sets that have write access


### POST /api/v1/write-repocreds
CreateWriteRepositoryCredentials creates a new repository credential set with write access


### PUT /api/v1/write-repocreds/{creds.url}
UpdateWriteRepositoryCredentials updates a repository credential set with write access


### DELETE /api/v1/write-repocreds/{url}
DeleteWriteRepositoryCredentials deletes a repository credential set with write access from the configuration


### GET /api/v1/write-repositories
ListWriteRepositories gets a list of all configured write repositories


### POST /api/v1/write-repositories
CreateWriteRepository creates a new write repository configuration


### PUT /api/v1/write-repositories/{repo.repo}
UpdateWriteRepository updates a write repository configuration


### GET /api/v1/write-repositories/{repo}
GetWrite returns a repository or its write credentials


### DELETE /api/v1/write-repositories/{repo}
DeleteWriteRepository deletes a write repository from the configuration


### POST /api/v1/write-repositories/{repo}/validate
ValidateWriteAccess validates write access to a repository with given parameters


### GET /api/version
Version returns version information of the API server

