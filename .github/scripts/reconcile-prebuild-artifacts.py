#!/usr/bin/env python3
"""Render the managed PR prebuild comment from status artifacts."""

from __future__ import annotations

import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import zipfile
from datetime import datetime, timezone
from typing import Any


API_ROOT = "https://api.github.com"
STATUS_LABELS = {
    "building": "Build in process",
    "published": "Published",
    "failed": "Failed",
}
DOWNLOAD_ATTEMPTS = 5
DOWNLOAD_RETRY_SECONDS = 2
LOAD_ATTEMPTS = 3
LOAD_RETRY_SECONDS = 2
USER_AGENT = "prebuild-artifact-comment-reconciler"


class ApiError(RuntimeError):
    def __init__(self, method: str, url: str, status: int, details: str):
        self.method = method
        self.url = url
        self.status = status
        self.details = details
        super().__init__(f"GitHub API {method} {url} failed: {status} {details}")


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(
        self,
        req: urllib.request.Request,
        fp: Any,
        code: int,
        msg: str,
        headers: Any,
        newurl: str,
    ) -> urllib.request.Request | None:
        return None


def env(name: str) -> str:
    value = os.environ.get(name, "")
    if not value:
        raise SystemExit(f"Missing required environment variable: {name}")
    return value


REPO = env("GITHUB_REPOSITORY")
TOKEN = env("GITHUB_TOKEN")
PR_NUMBER = env("PR_NUMBER")
HEAD_SHA = env("HEAD_SHA")
MARKER = f"<!-- prebuild-artifacts pr={PR_NUMBER} sha={HEAD_SHA} -->"
MARKER_PREFIX = f"<!-- prebuild-artifacts pr={PR_NUMBER} sha="


def api(
    method: str,
    path_or_url: str,
    payload: dict[str, Any] | None = None,
    binary: bool = False,
) -> Any:
    url = path_or_url if path_or_url.startswith("http") else f"{API_ROOT}{path_or_url}"
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {TOKEN}",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": USER_AGENT,
    }
    if payload is not None:
        headers["Content-Type"] = "application/json"

    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request) as response:
            body = response.read()
    except urllib.error.HTTPError as error:
        details = error.read().decode("utf-8", errors="replace")
        raise ApiError(method, url, error.code, details) from error
    except urllib.error.URLError as error:
        raise ApiError(method, url, 0, str(error.reason)) from error

    if binary:
        return body
    if not body:
        return None
    return json.loads(body.decode("utf-8"))


def download_artifact_archive(artifact_id: Any) -> bytes:
    url = f"{API_ROOT}/repos/{REPO}/actions/artifacts/{artifact_id}/zip"
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {TOKEN}",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": USER_AGENT,
        },
        method="GET",
    )
    opener = urllib.request.build_opener(NoRedirectHandler)

    try:
        with opener.open(request) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        if error.code not in {301, 302, 303, 307, 308}:
            details = error.read().decode("utf-8", errors="replace")
            raise ApiError("GET", url, error.code, details) from error

        location = error.headers.get("Location")
        if not location:
            raise ApiError("GET", url, error.code, "Redirect did not include a Location header") from error
    except urllib.error.URLError as error:
        raise ApiError("GET", url, 0, str(error.reason)) from error

    blob_request = urllib.request.Request(
        location,
        headers={"User-Agent": USER_AGENT},
        method="GET",
    )
    try:
        with urllib.request.urlopen(blob_request) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        details = error.read().decode("utf-8", errors="replace")
        raise ApiError("GET", location, error.code, details) from error
    except urllib.error.URLError as error:
        raise ApiError("GET", location, 0, str(error.reason)) from error


def parse_time(value: str | None) -> datetime:
    if not value:
        return datetime.min.replace(tzinfo=timezone.utc)
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return datetime.min.replace(tzinfo=timezone.utc)


def list_artifacts() -> list[dict[str, Any]]:
    artifacts: list[dict[str, Any]] = []
    page = 1
    while True:
        data = api("GET", f"/repos/{REPO}/actions/artifacts?per_page=100&page={page}")
        page_artifacts = data.get("artifacts", [])
        artifacts.extend(page_artifacts)
        if len(page_artifacts) < 100:
            return artifacts
        page += 1


def newest_matching_artifacts() -> list[dict[str, Any]]:
    prefix = f"prebuild-status-pr-{PR_NUMBER}-sha-{HEAD_SHA}-"
    by_name: dict[str, dict[str, Any]] = {}

    for artifact in list_artifacts():
        name = artifact.get("name", "")
        if artifact.get("expired") or not name.startswith(prefix):
            continue

        existing = by_name.get(name)
        if existing is None:
            by_name[name] = artifact
            continue

        artifact_time = parse_time(artifact.get("created_at") or artifact.get("updated_at"))
        existing_time = parse_time(existing.get("created_at") or existing.get("updated_at"))
        if artifact_time > existing_time:
            by_name[name] = artifact

    return list(by_name.values())


def download_status(artifact: dict[str, Any]) -> dict[str, Any] | None:
    artifact_id = artifact["id"]
    name = artifact.get("name")

    for attempt in range(1, DOWNLOAD_ATTEMPTS + 1):
        try:
            archive = download_artifact_archive(artifact_id)

            with zipfile.ZipFile(io.BytesIO(archive)) as zip_file:
                status_names = [path for path in zip_file.namelist() if path.endswith("status.json")]
                if not status_names:
                    print(f"Skipping artifact {name}: no status.json", file=sys.stderr)
                    return None

                with zip_file.open(status_names[0]) as status_file:
                    status = json.load(status_file)
            break
        except (ApiError, json.JSONDecodeError, zipfile.BadZipFile) as error:
            if attempt == DOWNLOAD_ATTEMPTS:
                print(f"Skipping artifact {name}: could not read status.json: {error}", file=sys.stderr)
                return None
            print(
                f"Artifact {name} was not readable yet; retrying in {DOWNLOAD_RETRY_SECONDS}s",
                file=sys.stderr,
            )
            time.sleep(DOWNLOAD_RETRY_SECONDS)

    if str(status.get("pr_number")) != str(PR_NUMBER) or status.get("head_sha") != HEAD_SHA:
        print(f"Skipping artifact {name}: PR/SHA mismatch", file=sys.stderr)
        return None

    status["_artifact_name"] = name or ""
    status["_artifact_created_at"] = artifact.get("created_at", "")
    return status


def load_rows() -> tuple[list[dict[str, Any]], int, int]:
    rows_by_key: dict[tuple[str, str], dict[str, Any]] = {}
    artifacts = newest_matching_artifacts()
    skipped = 0

    for artifact in artifacts:
        status = download_status(artifact)
        if not status:
            skipped += 1
            continue

        row_type = normalize_type(status.get("type"))
        name = clean(status.get("name"))
        if not row_type or not name:
            print(f"Skipping artifact {artifact.get('name')}: missing type or name", file=sys.stderr)
            skipped += 1
            continue

        status["type"] = row_type
        status["name"] = name
        status["status"] = normalize_status(status.get("status"))
        status["_sort_time"] = parse_time(
            status.get("created_at") or status.get("_artifact_created_at")
        )
        key = (row_type, name.lower())
        current = rows_by_key.get(key)
        if current is None or status["_sort_time"] >= current["_sort_time"]:
            rows_by_key[key] = status

    return (
        sorted(
            rows_by_key.values(),
            key=lambda row: (0 if row.get("type") == "docker" else 1, row.get("name", "")),
        ),
        skipped,
        len(artifacts),
    )


def clean(value: Any) -> str:
    return str(value or "").replace("\n", " ").replace("|", "\\|")


def code(value: Any) -> str:
    text = clean(value)
    return f"`{text}`" if text else "-"


def table_row(cells: list[str]) -> str:
    return f"| {' | '.join(cells)} |"


def ci_link(row: dict[str, Any]) -> str:
    run_url = clean(row.get("run_url"))
    return f"[CI]({run_url})" if run_url else "-"


def normalize_type(value: Any) -> str:
    artifact_type = clean(value).lower()
    if artifact_type in {"docker", "image"}:
        return "docker"
    if artifact_type in {"helm", "helm-chart"}:
        return "helm"
    return artifact_type


def normalize_status(value: Any) -> str:
    status = clean(value).lower()
    if status in {"building", "in_progress", "pending", "queued"}:
        return "building"
    if status in {"failed", "failure", "cancelled", "canceled", "timed_out"}:
        return "failed"
    return "published"


def status_label(row: dict[str, Any]) -> str:
    return STATUS_LABELS.get(row.get("status", ""), "Unknown")


def artifact_value(row: dict[str, Any], value: Any) -> str:
    if row.get("status") != "published":
        return "-"
    return code(value)


def published_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [row for row in rows if row.get("status") == "published"]


def command_rows(rows: list[dict[str, Any]], *fields: str) -> list[dict[str, Any]]:
    return [
        row
        for row in published_rows(rows)
        if all(clean(row.get(field)) for field in fields)
    ]


def release_name_for(row: dict[str, Any]) -> str:
    release_name = clean(row.get("releaseName") or row.get("release_name"))
    if release_name:
        return release_name
    if row.get("name") == "rag-stack":
        return "rag"
    if row.get("name") == "ai-platform-engineering":
        return "ai-platform"
    return clean(row.get("name"))


def render_comment(rows: list[dict[str, Any]]) -> str:
    docker_rows = [row for row in rows if row.get("type") == "docker"]
    helm_rows = [row for row in rows if row.get("type") == "helm"]
    short_sha = HEAD_SHA[:7]
    head_ref = next((clean(row.get("head_ref")) for row in rows if row.get("head_ref")), "")

    lines = [
        MARKER,
        f"## Prebuild Artifacts for `{short_sha}`",
        "",
    ]
    if head_ref:
        lines.extend([f"**Branch:** `{head_ref}`", f"**Commit:** `{short_sha}`", ""])
    else:
        lines.extend([f"**Commit:** `{short_sha}`", ""])

    if docker_rows:
        lines.extend(
            [
                "### Docker Images",
                "",
                "| Artifact | Image | Tag | Status | CI |",
                "| --- | --- | --- | --- | --- |",
            ]
        )
        for row in docker_rows:
            lines.append(
                table_row(
                    [
                        clean(row.get("name")),
                        artifact_value(row, row.get("repository")),
                        artifact_value(row, row.get("tag")),
                        status_label(row),
                        ci_link(row),
                    ]
                )
            )
        lines.append("")

        pullable = command_rows(docker_rows, "ref")
        if pullable:
            lines.extend(
                [
                    "<details>",
                    "<summary>Docker pull commands</summary>",
                    "",
                    "```bash",
                    *[f"docker pull {clean(row.get('ref'))}" for row in pullable],
                    "```",
                    "",
                    "</details>",
                    "",
                ]
            )

    if helm_rows:
        lines.extend(
            [
                "### Helm Charts",
                "",
                "| Chart | Registry | Version | Status | CI |",
                "| --- | --- | --- | --- | --- |",
            ]
        )
        for row in helm_rows:
            lines.append(
                table_row(
                    [
                        clean(row.get("name")),
                        artifact_value(row, row.get("repository")),
                        artifact_value(row, row.get("version")),
                        status_label(row),
                        ci_link(row),
                    ]
                )
            )
        lines.append("")

        installable = command_rows(helm_rows, "ref", "version")
        if installable:
            lines.extend(
                [
                    "<details>",
                    "<summary>Helm install commands</summary>",
                    "",
                    "```bash",
                    *[
                        (
                            f"helm upgrade --install {release_name_for(row)} "
                            f"{clean(row.get('ref'))} --version {clean(row.get('version'))}"
                        )
                        for row in installable
                    ],
                    "```",
                    "",
                    "</details>",
                    "",
                ]
            )

    if not docker_rows and not helm_rows:
        lines.extend(["No prebuild artifacts have been reported yet.", ""])

    lines.append("> These prebuild artifacts will be automatically cleaned up when the PR is closed or merged.")
    return "\n".join(lines).rstrip() + "\n"


def list_issue_comments() -> list[dict[str, Any]]:
    comments: list[dict[str, Any]] = []
    page = 1
    while True:
        data = api(
            "GET",
            f"/repos/{REPO}/issues/{PR_NUMBER}/comments?per_page=100&page={page}",
        )
        comments.extend(data)
        if len(data) < 100:
            return comments
        page += 1


def artifact_comments_for_head(comments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    managed = [
        comment
        for comment in comments
        if comment.get("user", {}).get("type") == "Bot" and MARKER in (comment.get("body") or "")
    ]
    return sorted(managed, key=lambda comment: comment.get("id", 0))


def reconcile_comment(body: str) -> None:
    managed = artifact_comments_for_head(list_issue_comments())

    if managed:
        target = managed[0]
        try:
            if target.get("body") != body:
                api(
                    "PATCH",
                    f"/repos/{REPO}/issues/comments/{target['id']}",
                    {"body": body},
                )
                print(f"Updated managed prebuild comment {target['id']}.")
            else:
                print(f"Managed prebuild comment {target['id']} is already current.")
        except ApiError as error:
            if error.status != 404:
                raise
            print(f"Managed prebuild comment {target['id']} disappeared; retrying.")
            reconcile_comment(body)
            return

        for duplicate in managed[1:]:
            try:
                api("DELETE", f"/repos/{REPO}/issues/comments/{duplicate['id']}")
                print(f"Deleted duplicate managed prebuild comment {duplicate['id']}.")
            except ApiError as error:
                if error.status != 404:
                    raise
        return

    created = api(
        "POST",
        f"/repos/{REPO}/issues/{PR_NUMBER}/comments",
        {"body": body},
    )
    print(f"Created managed prebuild comment {created['id']}.")


def current_pr_head_sha() -> str:
    pull = api("GET", f"/repos/{REPO}/pulls/{PR_NUMBER}")
    return str(pull.get("head", {}).get("sha", ""))


def archived_body(body: str) -> str | None:
    if "(archived)</summary>" in body:
        return None

    old_marker = re.search(r"<!-- prebuild-artifacts pr=\d+ sha=([^ ]+) -->", body)
    if not old_marker:
        return None

    old_short_sha = old_marker.group(1)[:7] or "previous"
    return "\n".join(
        [
            old_marker.group(0),
            "<details>",
            f"<summary>Prebuild Artifacts for `{old_short_sha}` (archived)</summary>",
            "",
            body.replace(old_marker.group(0), "", 1).strip(),
            "",
            "</details>",
        ]
    )


def archive_older_comments() -> None:
    for comment in list_issue_comments():
        body = comment.get("body") or ""
        if comment.get("user", {}).get("type") != "Bot":
            continue
        if MARKER_PREFIX not in body or MARKER in body:
            continue

        body = archived_body(body)
        if not body:
            continue

        api(
            "PATCH",
            f"/repos/{REPO}/issues/comments/{comment['id']}",
            {"body": body},
        )
        print(f"Archived older prebuild artifact comment {comment['id']}.")


def load_rows_with_retries() -> tuple[list[dict[str, Any]], int, int]:
    result: tuple[list[dict[str, Any]], int, int] = ([], 0, 0)
    for attempt in range(1, LOAD_ATTEMPTS + 1):
        result = load_rows()
        _, skipped, matching = result
        if not matching or not skipped:
            return result
        if attempt < LOAD_ATTEMPTS:
            print(
                f"{skipped} matching artifact(s) were not readable yet; retrying in {LOAD_RETRY_SECONDS}s",
                file=sys.stderr,
            )
            time.sleep(LOAD_RETRY_SECONDS)
    return result


def main() -> None:
    try:
        rows, skipped, matching = load_rows_with_retries()
        print(f"Reconciling {len(rows)} prebuild artifact row(s).")
        if matching and skipped == matching and not rows:
            print("No readable matching artifacts yet; leaving the PR comment unchanged.")
            return

        reconcile_comment(render_comment(rows))

        if current_pr_head_sha() == HEAD_SHA:
            archive_older_comments()
        else:
            print("PR head moved since this dispatch; leaving older comments unchanged.")
    except ApiError as error:
        raise SystemExit(str(error)) from error


if __name__ == "__main__":
    main()
