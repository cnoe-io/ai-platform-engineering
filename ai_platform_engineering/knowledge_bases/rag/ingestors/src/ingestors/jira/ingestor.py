#!/usr/bin/env python3
"""
Jira ticket ingestor for RAG.
Fetches issues from configured Jira projects via JQL and ingests them as documents.
Each project becomes a datasource, and each ticket becomes a document.
Custom fields (e.g. SLO impact), linked issues, and comments are included in the document content.
"""

import os
import json
import time
from datetime import datetime
from typing import Any, Dict, List, Optional
import requests
from requests.auth import HTTPBasicAuth
from langchain_core.documents import Document

from common.ingestor import IngestorBuilder, Client
from common.models.rag import DataSourceInfo, DocumentMetadata
from common.job_manager import JobStatus
from common import utils

logger = utils.get_logger(__name__)

# Sync configuration
sync_interval = int(os.environ.get("SYNC_INTERVAL", "86400"))  # Default 24 hours
init_delay = int(os.environ.get("INIT_DELAY_SECONDS", "0"))

# Jira configuration
JIRA_URL = os.environ.get("JIRA_URL")
if not JIRA_URL:
    raise ValueError("JIRA_URL environment variable is required (e.g. https://your-org.atlassian.net)")

JIRA_EMAIL = os.environ.get("JIRA_EMAIL")
if not JIRA_EMAIL:
    raise ValueError("JIRA_EMAIL environment variable is required")

# Use ATLASSIAN_TOKEN to match the convention used by Jira/Confluence agents, CI, and Helm secrets
JIRA_API_TOKEN = os.environ.get("ATLASSIAN_TOKEN")
if not JIRA_API_TOKEN:
    raise ValueError("ATLASSIAN_TOKEN environment variable is required")

# JSON config for projects and their JQL filters.
# Each project key maps to a list of datasource configs. A single dict is also
# accepted for convenience and is normalised to a one-element list.
#
# Format:
#   {
#     "SDPL": [
#       {"name": "untriaged", "jql": "project = SDPL AND status = Open ORDER BY updated DESC",
#        "custom_fields": {"slo": "customfield_123"}, "include_comments": true},
#       {"name": "user-requests", "jql": "project = SDPL AND type = 'User Request'"}
#     ],
#     "FE": {"name": "Frontend", "jql": "project = FE ORDER BY updated DESC"}
#   }
#
# Required per-datasource fields:
#   jql: JQL query string
# Optional per-datasource fields (defaults):
#   name: project key
#   custom_fields: {}
#   include_comments: true
#   include_links: true
projects_json = os.environ.get("JIRA_PROJECTS", "{}")
_raw_projects: Dict[str, Any] = json.loads(projects_json)
if not _raw_projects:
    raise ValueError("No projects configured. Set JIRA_PROJECTS environment variable.")

# Normalise: ensure every value is a list of datasource configs
projects: Dict[str, List[Dict[str, Any]]] = {}
for _pk, _val in _raw_projects.items():
    if isinstance(_val, dict):
        projects[_pk] = [_val]
    elif isinstance(_val, list):
        projects[_pk] = _val
    else:
        raise ValueError(f"Invalid config for project {_pk}: expected dict or list, got {type(_val).__name__}")
    # Validate that every datasource entry has a jql field
    for _ds in projects[_pk]:
        if not _ds.get("jql"):
            raise ValueError(f"Datasource config for project {_pk} is missing required 'jql' field")

# Max results per page for Jira API pagination
PAGE_SIZE = int(os.environ.get("JIRA_PAGE_SIZE", "100"))


class JiraClient:
    """Thin client for the Jira Cloud REST API v3."""

    def __init__(self, base_url: str, email: str, api_token: str):
        self.base_url = base_url.rstrip("/")
        if not self.base_url.startswith("http"):
            self.base_url = f"https://{self.base_url}"
        self.auth = HTTPBasicAuth(email, api_token)
        self.headers = {"Accept": "application/json", "Content-Type": "application/json"}

    def _get(self, path: str, params: Optional[Dict[str, Any]] = None) -> Any:
        url = f"{self.base_url}{path}"
        response = requests.get(url, auth=self.auth, headers=self.headers, params=params, timeout=30)
        response.raise_for_status()
        return response.json()

    def search_issues(self, jql: str, fields: List[str]) -> List[Dict[str, Any]]:
        """Run a JQL search and return all matching issues, handling pagination internally."""
        all_issues: List[Dict[str, Any]] = []
        next_page_token: Optional[str] = None
        while True:
            params: Dict[str, Any] = {
                "jql": jql,
                "maxResults": PAGE_SIZE,
                "fields": ",".join(fields),
            }
            if next_page_token:
                params["nextPageToken"] = next_page_token
            result = self._get("/rest/api/3/search/jql", params=params)
            batch = result.get("issues", [])
            all_issues.extend(batch)
            if result.get("isLast", True) or not batch:
                break
            next_page_token = result.get("nextPageToken")
        return all_issues

    def get_issue_comments(self, issue_key: str) -> List[Dict[str, Any]]:
        """Fetch all comments for a given issue key."""
        try:
            result = self._get(f"/rest/api/3/issue/{issue_key}/comment", params={"maxResults": 100})
            return result.get("comments", [])
        except requests.HTTPError as e:
            logger.warning(f"Could not fetch comments for {issue_key}: {e}")
            return []


def _extract_text_from_adf(node: Any, depth: int = 0) -> str:
    """
    Recursively extract plain text from Atlassian Document Format (ADF) nodes.
    ADF is the structured rich-text format used in Jira Cloud description/comment fields.
    """
    if node is None:
        return ""
    if isinstance(node, str):
        return node

    node_type = node.get("type", "")
    text_parts: List[str] = []

    # Leaf node — return the text directly
    if node_type == "text":
        return node.get("text", "")

    # Hard line break
    if node_type == "hardBreak":
        return "\n"

    # Recurse into content children
    for child in node.get("content", []):
        text_parts.append(_extract_text_from_adf(child, depth + 1))

    joined = "".join(text_parts)

    # Add appropriate whitespace/newlines for block-level nodes
    block_types = {"paragraph", "heading", "bulletList", "orderedList", "listItem", "blockquote", "codeBlock", "rule"}
    if node_type in block_types:
        return joined.strip() + "\n"

    return joined


def _format_adf_field(value: Any) -> str:
    """Convert an ADF field value to plain text. Falls back to str() for non-ADF values."""
    if isinstance(value, dict) and value.get("type") == "doc":
        return _extract_text_from_adf(value).strip()
    if isinstance(value, str):
        return value
    if value is None:
        return ""
    return str(value)


def _format_date(date_str: Optional[str]) -> str:
    """Format an ISO 8601 date string to a human-readable form."""
    if not date_str:
        return "Unknown"
    try:
        dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
        return dt.strftime("%Y-%m-%d %H:%M UTC")
    except (ValueError, AttributeError):
        return date_str


def _build_issue_document(
    issue: Dict[str, Any],
    comments: List[Dict[str, Any]],
    jira_url: str,
    datasource_id: str,
    ingestor_id: str,
    custom_fields: Optional[Dict[str, str]] = None,
    include_comments: bool = True,
    include_links: bool = True,
) -> Document:
    """
    Build a RAG Document from a Jira issue dict.

    The document content includes:
    - Issue key, summary, type, status, priority
    - Description (ADF rendered to plain text)
    - Custom fields (e.g. per-product SLOs, affected systems)
    - Linked issues (for action items, related tickets)
    - Comments
    """
    fields = issue.get("fields", {})
    key = issue.get("key", "UNKNOWN")
    issue_url = f"{jira_url}/browse/{key}"

    summary = fields.get("summary", "")
    issue_type = (fields.get("issuetype") or {}).get("name", "Unknown")
    status = (fields.get("status") or {}).get("name", "Unknown")
    priority = (fields.get("priority") or {}).get("name", "Unknown")
    assignee_obj = fields.get("assignee") or {}
    assignee = assignee_obj.get("displayName", "Unassigned")
    reporter_obj = fields.get("reporter") or {}
    reporter = reporter_obj.get("displayName", "Unknown")
    created = _format_date(fields.get("created"))
    updated = _format_date(fields.get("updated"))
    resolved = _format_date(fields.get("resolutiondate"))
    labels = ", ".join(fields.get("labels") or []) or "None"
    components = ", ".join(c.get("name", "") for c in (fields.get("components") or [])) or "None"

    description_text = _format_adf_field(fields.get("description"))

    # Build content lines
    lines: List[str] = [
        f"# [{key}] {summary}",
        "",
        f"**URL:** {issue_url}",
        f"**Type:** {issue_type}",
        f"**Status:** {status}",
        f"**Priority:** {priority}",
        f"**Assignee:** {assignee}",
        f"**Reporter:** {reporter}",
        f"**Created:** {created}",
        f"**Updated:** {updated}",
    ]

    if resolved and resolved != "Unknown":
        lines.append(f"**Resolved:** {resolved}")

    if labels != "None":
        lines.append(f"**Labels:** {labels}")

    if components != "None":
        lines.append(f"**Components:** {components}")

    # Custom fields
    for friendly_name, field_id in (custom_fields or {}).items():
        value = fields.get(field_id)
        if value is not None:
            text = _format_adf_field(value)
            if text:
                lines.append(f"**{friendly_name.replace('_', ' ').title()}:** {text}")

    # Description
    if description_text:
        lines.append("")
        lines.append("## Description")
        lines.append(description_text)

    # Linked issues (action items, related incidents, etc.)
    issue_links = fields.get("issuelinks") or []
    if include_links and issue_links:
        lines.append("")
        lines.append("## Linked Issues")
        for link in issue_links:
            link_type = (link.get("type") or {}).get("name", "")
            inward = link.get("inwardIssue")
            outward = link.get("outwardIssue")
            if inward:
                inward_key = inward.get("key", "")
                inward_summary = (inward.get("fields") or {}).get("summary", "")
                inward_status = ((inward.get("fields") or {}).get("status") or {}).get("name", "")
                lines.append(f"- **{link_type} (inward):** [{inward_key}] {inward_summary} ({inward_status})")
            if outward:
                outward_key = outward.get("key", "")
                outward_summary = (outward.get("fields") or {}).get("summary", "")
                outward_status = ((outward.get("fields") or {}).get("status") or {}).get("name", "")
                lines.append(f"- **{link_type} (outward):** [{outward_key}] {outward_summary} ({outward_status})")

    # Comments
    if include_comments and comments:
        lines.append("")
        lines.append("## Comments")
        for comment in comments:
            author = (comment.get("author") or {}).get("displayName", "Unknown")
            created_at = _format_date(comment.get("created"))
            body = _format_adf_field(comment.get("body"))
            if body:
                lines.append(f"**[{created_at}] {author}:**")
                lines.append(body)
                lines.append("")

    content = "\n".join(lines)

    metadata = DocumentMetadata(
        datasource_id=datasource_id,
        ingestor_id=ingestor_id,
        document_type="jira_issue",
        document_ingested_at=int(time.time()),
        document_id=f"jira-issue-{key}",
        # sync_interval=0 is valid (single-run mode) but get_fresh_until requires >0
        fresh_until=utils.get_fresh_until(sync_interval or 86400),
        title=f"[{key}] {summary}",
        metadata={
            "issue_key": key,
            "issue_type": issue_type,
            "status": status,
            "priority": priority,
            "assignee": assignee,
            "reporter": reporter,
            "created": fields.get("created", ""),
            "updated": fields.get("updated", ""),
            "source_uri": issue_url,
            "last_modified": int(
                datetime.fromisoformat((fields.get("updated") or "1970-01-01T00:00:00+00:00").replace("Z", "+00:00")).timestamp()
            ),
        },
    )

    return Document(page_content=content, metadata=metadata.model_dump())


async def sync_jira_projects(client: Client) -> None:
    """Sync function that processes all configured Jira projects."""
    jira = JiraClient(JIRA_URL, JIRA_EMAIL, JIRA_API_TOKEN)

    # Fetch existing datasources so we can skip recently-synced ones
    existing_datasources: Dict[str, DataSourceInfo] = {}
    try:
        for ds in await client.list_datasources(ingestor_id=client.ingestor_id):
            existing_datasources[ds.datasource_id] = ds
    except Exception as e:
        logger.warning(f"Could not fetch existing datasources, will sync all: {e}")

    standard_fields = [
        "summary",
        "issuetype",
        "status",
        "priority",
        "assignee",
        "reporter",
        "created",
        "updated",
        "resolutiondate",
        "description",
        "labels",
        "components",
        "issuelinks",
    ]

    now = int(time.time())

    for project_key, datasource_configs in projects.items():
        for ds_config in datasource_configs:
            ds_name = ds_config.get("name", project_key)
            jql = ds_config["jql"]
            ds_custom_fields: Dict[str, str] = ds_config.get("custom_fields", {})
            ds_include_comments: bool = ds_config.get("include_comments", True)
            ds_include_links: bool = ds_config.get("include_links", True)

            logger.info(f"Processing Jira datasource: {ds_name} ({project_key})")

            # Build a datasource ID that is unique per project + datasource name
            ds_slug = ds_name.lower().replace(" ", "-")
            datasource_id = f"jira-{project_key.lower()}-{ds_slug}"

            # Skip if this datasource was recently synced (within sync_interval)
            existing = existing_datasources.get(datasource_id)
            if existing and existing.last_updated and (now - existing.last_updated) < sync_interval:
                logger.info(
                    f"Skipping {project_key}/{ds_name}: last synced {now - existing.last_updated}s ago "
                    f"(interval: {sync_interval}s)"
                )
                continue

            # Build the list of fields to request (standard + this datasource's custom fields)
            all_fields = standard_fields + list(ds_custom_fields.values())

            logger.info(f"JQL: {jql}")

            try:
                all_issues = jira.search_issues(jql, all_fields)
            except requests.HTTPError as e:
                logger.error(f"Jira search failed for {project_key}/{ds_name}: {e}")
                continue

            logger.info(f"Fetched {len(all_issues)} issues for {project_key}/{ds_name}")

            if not all_issues:
                logger.info(f"No issues found for {project_key}/{ds_name}, updating datasource timestamp")
                datasource = DataSourceInfo(
                    datasource_id=datasource_id,
                    name=f"Jira: {ds_name} ({project_key})",
                    ingestor_id=client.ingestor_id or "",
                    description=f"Jira issues: {ds_name} ({project_key})",
                    source_type="jira",
                    last_updated=int(time.time()),
                    metadata={
                        "project_key": project_key,
                        "datasource_name": ds_name,
                        "jira_url": JIRA_URL,
                        "jql": jql,
                        "reload_interval": sync_interval,
                    },
                )
                await client.upsert_datasource(datasource)
                continue

            # Build documents (fetch comments per issue if enabled)
            documents: List[Document] = []
            for issue in all_issues:
                key = issue.get("key", "UNKNOWN")
                comments: List[Dict[str, Any]] = []
                if ds_include_comments:
                    comments = jira.get_issue_comments(key)

                try:
                    doc = _build_issue_document(
                        issue=issue,
                        comments=comments,
                        jira_url=JIRA_URL,
                        datasource_id=datasource_id,
                        ingestor_id=client.ingestor_id or "",
                        custom_fields=ds_custom_fields,
                        include_comments=ds_include_comments,
                        include_links=ds_include_links,
                    )
                    documents.append(doc)
                except Exception as e:
                    logger.warning(f"Failed to build document for {key}: {e}")

            logger.info(f"Built {len(documents)} documents for {project_key}/{ds_name}")

            # Upsert datasource
            datasource = DataSourceInfo(
                datasource_id=datasource_id,
                name=f"Jira: {ds_name} ({project_key})",
                ingestor_id=client.ingestor_id or "",
                description=f"Jira issues: {ds_name} ({project_key})",
                source_type="jira",
                last_updated=int(time.time()),
                metadata={
                    "project_key": project_key,
                    "datasource_name": ds_name,
                    "jira_url": JIRA_URL,
                    "jql": jql,
                    "issue_count": len(documents),
                    "reload_interval": sync_interval,
                },
            )
            await client.upsert_datasource(datasource)

            # Create ingestion job
            job_response = await client.create_job(
                datasource_id=datasource_id,
                job_status=JobStatus.IN_PROGRESS,
                message=f"Ingesting {len(documents)} issues from {ds_name}",
                total=len(documents),
            )
            job_id = job_response["job_id"]

            try:
                await client.ingest_documents(
                    job_id=job_id,
                    datasource_id=datasource_id,
                    documents=documents,
                    fresh_until=utils.get_fresh_until(sync_interval or 86400),
                )
                await client.update_job(
                    job_id=job_id,
                    job_status=JobStatus.COMPLETED,
                    message=f"Successfully ingested {len(documents)} issues from {ds_name}",
                )
                logger.info(f"✓ Ingested {len(documents)} issues from {project_key}/{ds_name}")
            except Exception as e:
                logger.error(f"Ingestion failed for {project_key}/{ds_name}: {e}")
                await client.add_job_error(job_id, [str(e)])
                await client.update_job(
                    job_id=job_id,
                    job_status=JobStatus.FAILED,
                    message=f"Failed to ingest issues: {e}",
                )


def main() -> None:
    """Main entry point for the Jira ingestor."""
    IngestorBuilder() \
        .name("default_jira") \
        .type("jira") \
        .description(f"Jira issue ingestor for {JIRA_URL}") \
        .metadata({
            "jira_url": JIRA_URL,
            "projects": list(projects.keys()),
            "sync_interval": sync_interval,
            "init_delay": init_delay,
        }) \
        .sync_with_fn(sync_jira_projects) \
        .every(sync_interval) \
        .with_init_delay(init_delay) \
        .run()


if __name__ == "__main__":
    main()
