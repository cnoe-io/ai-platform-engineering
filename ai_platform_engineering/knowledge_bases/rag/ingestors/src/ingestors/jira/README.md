# Jira Ingestor

Ingests issues from Jira Cloud projects as documents into the RAG system. Each project becomes a datasource, and each issue becomes a document containing the full ticket context: description, linked issues (action items), custom fields (e.g. service), and comments.

## Supported Features

- JQL-based filtering — ingest any set of issues expressible as a JQL query
- ADF (Atlassian Document Format) rendering — description and comment fields are converted to plain text
- Custom field extraction — map arbitrary Jira custom field IDs to friendly names included in document content
- Linked issue support — outward/inward links are included so action item tickets appear in the document
- Comment ingestion — all issue comments are included (configurable)
- Incremental-friendly — `updated >= -Nd` JQL keeps syncs fast after initial load

## Required Environment Variables

| Variable | Description |
|---|---|
| `JIRA_URL` | Jira Cloud base URL, e.g. `https://your-org.atlassian.net` |
| `JIRA_EMAIL` | Email of the service account used for API access |
| `JIRA_API_TOKEN` or `ATLASSIAN_TOKEN` | Atlassian API token for the service account |
| `JIRA_PROJECTS` | JSON object mapping project keys to config (see below) |
| `RAG_SERVER_URL` | URL of the RAG server (default: `http://localhost:9446`) |

## JIRA_PROJECTS Format

```json
{
  "FE": {
    "name": "Frontend",
    "jql": "project = FE AND issuetype = 'frontend' ORDER BY updated DESC",
    "lookback_days": 730
  },
  "INFRA": {
    "name": "Infrastructure",
    "lookback_days": 365
  }
}
```

If `jql` is omitted, the ingestor defaults to:
```
project = "<KEY>" AND updated >= -<lookback_days>d ORDER BY updated DESC
```

## Optional Environment Variables

| Variable | Default | Description |
|---|---|---|
| `JIRA_CUSTOM_FIELDS` | `{}` | JSON map of friendly name → Jira field ID |
| `JIRA_INCLUDE_COMMENTS` | `true` | Include issue comments in document content |
| `JIRA_INCLUDE_LINKS` | `true` | Include linked issues in document content |
| `JIRA_PAGE_SIZE` | `100` | Number of issues per API request (max 100) |
| `SYNC_INTERVAL` | `86400` | Sync interval in seconds (default 24h) |
| `INIT_DELAY_SECONDS` | `0` | Delay before first sync in seconds |
| `LOG_LEVEL` | `INFO` | Logging level |

## JIRA_CUSTOM_FIELDS Format

Map friendly names (used as document headings) to Jira custom field IDs:

```json
{
  "affected_services": "customfield_10200",
  "affected_products": "customfield_10201",
  "severity": "customfield_10202"
}
```

To find custom field IDs, browse to:
`https://your-org.atlassian.net/rest/api/3/field`

## Document Structure

- **Document ID:** `jira-issue-{KEY}` (e.g. `jira-issue-FE-1047`)
- **Title:** `[KEY] Summary text`
- **Content:** Markdown-formatted document with all ticket fields
- **Datasource ID:** `jira-project-{key}` (e.g. `jira-project-fe`)
- **Metadata:** `issue_key`, `issue_type`, `status`, `priority`, `assignee`, `created`, `updated`, `source_uri`

## Running with Docker Compose

```bash
export RAG_SERVER_URL=http://host.docker.internal:9446
export JIRA_URL=https://your-org.atlassian.net
export JIRA_EMAIL=svc-account@your-org.com
export ATLASSIAN_TOKEN=your-api-token
export JIRA_PROJECTS='{"FE":{"name":"Frontend","lookback_days":730}}'
docker compose --profile jira up --build jira_ingestor
```

## Deployment Notes

- The service account (`JIRA_EMAIL`) must have **Browse Projects** permission for each configured project
- API tokens can be created at: https://id.atlassian.com/manage-profile/security/api-tokens
- For large projects, increase `JIRA_PAGE_SIZE` to 100 (Jira Cloud maximum) and set a longer `INIT_DELAY_SECONDS` to avoid overwhelming the RAG server during initial ingest
