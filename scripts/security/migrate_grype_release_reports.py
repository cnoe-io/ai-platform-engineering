#!/usr/bin/env python3
"""Archive and retire release-container analyses incorrectly uploaded to a branch."""

import argparse
import base64
import copy
import gzip
import hashlib
import json
import re
import subprocess
import time
from collections import defaultdict
from pathlib import Path
from typing import Any


CONTAINER_ANALYSIS = ".github/workflows/security-scan.yml:scan-containers"


def api(repo: str, resource: str, *, sarif: bool = False, delete: bool = False) -> Any:
    command = ["gh", "api", "--method", "DELETE" if delete else "GET",
               f"repos/{repo}/code-scanning/{resource}"]
    if sarif:
        command.extend(["-H", "Accept: application/sarif+json"])
    try:
        output = subprocess.check_output(command, text=True)
    except subprocess.CalledProcessError as error:
        raise RuntimeError(f"GitHub request failed for {resource}") from error
    return json.loads(output) if output.strip() else None


def analyses(repo: str, ref: str) -> list[dict[str, Any]]:
    command = ["gh", "api", "--method", "GET", f"repos/{repo}/code-scanning/analyses",
               "-f", f"ref={ref}", "-f", "tool_name=Grype", "-f", "per_page=100", "--paginate"]
    return json.loads(subprocess.check_output(command, text=True))


def newest(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for row in sorted(rows, key=lambda item: (item["created_at"], item["id"]), reverse=True):
        result.setdefault(row["category"], row)
    return result


def result_keys(sarif: dict[str, Any]) -> set[tuple[str, str]]:
    keys: set[tuple[str, str]] = set()
    for run in sarif["runs"]:
        if run["tool"]["driver"]["name"] != "Grype":
            raise ValueError("Archive contains another scanning tool")
        for result in run.get("results", []):
            for location in result.get("locations", []):
                path = location["physicalLocation"]["artifactLocation"]["uri"]
                keys.add((result["ruleId"], path))
    return keys


def save_archive(directory: Path, row: dict[str, Any], sarif: dict[str, Any]) -> dict[str, Any]:
    name = f"{row['id']}.sarif.json"
    content = (json.dumps(sarif, indent=2) + "\n").encode()
    (directory / name).write_bytes(content)
    return {"analysis": row, "file": name, "sha256": hashlib.sha256(content).hexdigest()}


def prepare(repo: str, source_ref: str, release_ref: str, directory: Path) -> Path:
    if not source_ref.startswith("refs/heads/") or not release_ref.startswith("refs/tags/"):
        raise ValueError("Migration must move reporting from a branch to a release tag")
    directory.mkdir(parents=True, exist_ok=False)
    source = [row for row in analyses(repo, source_ref)
              if row["analysis_key"] == CONTAINER_ANALYSIS]
    target = [row for row in analyses(repo, release_ref)
              if row["analysis_key"] == CONTAINER_ANALYSIS and not row.get("error")]
    protected = newest(target)
    candidates = [row for row in source if row["category"] in protected]
    if not candidates:
        raise ValueError("No matching legacy container analyses found")
    latest = newest(candidates)
    archives: list[dict[str, Any]] = []
    release_archives: list[dict[str, Any]] = []
    coverage: dict[str, Any] = {}
    release_tag = release_ref.removeprefix("refs/tags/")
    for category, row in latest.items():
        environment = json.loads(row["environment"])
        image = environment.get("image")
        if not image or category != f"grype-{image}":
            raise ValueError(f"Unexpected container configuration: {category}")
        old_sarif = api(repo, f"analyses/{row['id']}", sarif=True)
        target_row = protected[category]
        release_sarif = api(repo, f"analyses/{target_row['id']}", sarif=True)
        for document in (old_sarif, release_sarif):
            messages = [result["message"]["text"] for run in document["runs"]
                        for result in run.get("results", [])]
            expected = f"/{image}:{release_tag} "
            if not messages or not all(expected in message for message in messages):
                raise ValueError(f"Scan does not describe {image}:{release_tag}")
        missing = result_keys(old_sarif) - result_keys(release_sarif)
        coverage[category] = {"legacy_results": len(result_keys(old_sarif)),
                              "release_results": len(result_keys(release_sarif)),
                              "legacy_analysis_id": row["id"],
                              "release_analysis_id": target_row["id"],
                              "missing_keys": sorted(missing)}
        release_archives.append(save_archive(directory, target_row, release_sarif))
        print(f"Preservation checked: {category}; {len(missing)} results need an archival release report", flush=True)
    for index, row in enumerate(candidates, 1):
        document = api(repo, f"analyses/{row['id']}", sarif=True)
        archives.append(save_archive(directory, row, document))
        if index % 10 == 0:
            print(f"Archived {index}/{len(candidates)} legacy analyses", flush=True)
    plan = {"version": 1, "repo": repo, "source_ref": source_ref, "release_ref": release_ref,
            "coverage": coverage, "retire": archives, "preserve": release_archives}
    path = directory / "migration-plan.json"
    path.write_text(json.dumps(plan, indent=2) + "\n")
    print(f"Plan ready: {len(archives)} legacy analyses, {len(release_archives)} preserved reports")
    return path


def archive_missing(repo: str, release_ref: str, directory: Path, plan: dict[str, Any]) -> set[int]:
    """Preserve old-database findings separately from the fresh release scan."""
    preserved: set[int] = set()
    for category, coverage in plan["coverage"].items():
        if not coverage["missing_keys"]:
            continue
        source_id = coverage["legacy_analysis_id"]
        document = copy.deepcopy(json.loads((directory / f"{source_id}.sarif.json").read_text()))
        archive_category = category.replace("grype-", "grype-legacy-", 1)
        for run in document["runs"]:
            run["automationDetails"] = {"id": f"{archive_category}/"}
            for result in run.get("results", []):
                properties = result.get("properties", {})
                result["properties"] = {key: value for key, value in properties.items()
                                        if not key.startswith("github/")}
        release_row = next(record["analysis"] for record in plan["preserve"]
                           if record["analysis"]["id"] == coverage["release_analysis_id"])
        payload = {"ref": release_ref, "commit_sha": release_row["commit_sha"],
                   "sarif": base64.b64encode(gzip.compress(json.dumps(document).encode())).decode()}
        upload = json.loads(subprocess.check_output(
            ["gh", "api", "--method", "POST", f"repos/{repo}/code-scanning/sarifs", "--input", "-"],
            input=json.dumps(payload), text=True))
        for _ in range(60):
            status = api(repo, f"sarifs/{upload['id']}")
            if status["processing_status"] == "complete":
                break
            if status["processing_status"] == "failed":
                raise RuntimeError(f"Archival upload failed: {status.get('errors')}")
            time.sleep(2)
        else:
            raise RuntimeError("Archival upload has not finished; branch analyses were not deleted")
        row = newest([item for item in analyses(repo, release_ref)
                      if item["category"] == archive_category])[archive_category]
        archived = api(repo, f"analyses/{row['id']}", sarif=True)
        if result_keys(document) - result_keys(archived):
            raise RuntimeError("Archival upload did not preserve all source findings")
        record = save_archive(directory, row, archived)
        with (directory / "release-archive-audit.jsonl").open("a") as output:
            output.write(json.dumps({"source_analysis_id": source_id, "preserved": record}) + "\n")
        preserved.add(row["id"])
        print(f"Historical findings preserved on release tag: {archive_category}", flush=True)
    return preserved


def apply(path: Path) -> None:
    plan = json.loads(path.read_text())
    if plan["version"] != 1:
        raise ValueError("Unsupported migration plan")
    repo = plan["repo"]
    validate_repo(repo)
    source_ref, release_ref = plan["source_ref"], plan["release_ref"]
    if not source_ref.startswith("refs/heads/") or not release_ref.startswith("refs/tags/"):
        raise ValueError("Invalid source or preserved release reference")
    for record in plan["retire"] + plan["preserve"]:
        filename = record["file"]
        if filename != f"{record['analysis']['id']}.sarif.json":
            raise ValueError("Invalid archive filename")
        content = (path.parent / filename).read_bytes()
        if hashlib.sha256(content).hexdigest() != record["sha256"]:
            raise ValueError(f"Archive integrity mismatch: {filename}")
    categories = set(plan["coverage"])
    live = [row for row in analyses(repo, source_ref)
            if row["analysis_key"] == CONTAINER_ANALYSIS and row["category"] in categories]
    expected_ids = {record["analysis"]["id"] for record in plan["retire"]}
    if {row["id"] for row in live} != expected_ids:
        raise ValueError("Branch analyses changed; prepare a fresh migration plan")
    release = {row["id"]: row for row in analyses(repo, release_ref)}
    for record in plan["preserve"]:
        original = record["analysis"]
        if original["id"] not in release or release[original["id"]] != original:
            raise ValueError("Preserved release analysis changed")
    extra_preserved = archive_missing(repo, release_ref, path.parent, plan)
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in plan["retire"]:
        row = record["analysis"]
        if row["ref"] != source_ref or row["tool"]["name"] != "Grype" or row["category"] not in categories:
            raise ValueError("Plan includes a non-legacy analysis")
        groups[row["category"]].append(row)
    audit = path.parent / "deletion-audit.jsonl"
    with audit.open("a") as output:
        for category, rows in groups.items():
            for row in sorted(rows, key=lambda item: (item["created_at"], item["id"]), reverse=True):
                current = api(repo, f"analyses/{row['id']}")
                for field in ("ref", "category", "analysis_key", "commit_sha", "tool"):
                    if current[field] != row[field]:
                        raise ValueError("Analysis identity changed during migration")
                if not current["deletable"]:
                    raise ValueError("Analysis is not the latest of its configuration")
                result = api(repo, f"analyses/{row['id']}?confirm_delete=true", delete=True)
                output.write(json.dumps({"retired": row, "response": result}) + "\n")
                output.flush()
            print(f"Retired branch configuration: {category}", flush=True)
    remaining = [row for row in analyses(repo, source_ref)
                 if row["analysis_key"] == CONTAINER_ANALYSIS and row["category"] in categories]
    release_ids = {row["id"] for row in analyses(repo, release_ref)}
    if (remaining or not extra_preserved.issubset(release_ids) or
            not all(record["analysis"]["id"] in release_ids for record in plan["preserve"])):
        raise RuntimeError("Migration postcondition failed")
    print("Migration complete; preserved release analyses remain available")


def validate_repo(repo: str) -> None:
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
        raise ValueError("Repository must be owner/name")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo")
    parser.add_argument("--source-ref", default="refs/heads/main")
    parser.add_argument("--release-ref")
    parser.add_argument("--backup-dir", type=Path)
    parser.add_argument("--apply-plan", type=Path)
    args = parser.parse_args()
    if args.apply_plan:
        apply(args.apply_plan)
    else:
        if not args.repo or not args.release_ref or not args.backup_dir:
            parser.error("Preparation requires --repo, --release-ref and --backup-dir")
        validate_repo(args.repo)
        print(prepare(args.repo, args.source_ref, args.release_ref, args.backup_dir))


if __name__ == "__main__":
    main()
