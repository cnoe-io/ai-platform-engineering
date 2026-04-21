#!/usr/bin/env python3
"""
Analyze A2A artifact metadata from a capture file.

Reads a JSON file produced by capture_a2a_events.py and validates
metadata correctness: is_final_answer flags, narration flags, marker
leaks, metadata leaks, and artifact structure.

Prints a per-artifact table and a pass/fail summary.

Usage:
    python3 scripts/analyze_a2a_metadata.py <capture.json>
    python3 scripts/analyze_a2a_metadata.py <capture.json> --verbose
    python3 scripts/analyze_a2a_metadata.py <capture.json> --output /tmp/analysis.md

Dependencies: Python stdlib only (json, sys, argparse).
"""
import argparse
import json
import sys


# ---------------------------------------------------------------------------
# Analysis
# ---------------------------------------------------------------------------

def _load_capture(path: str) -> dict:
    with open(path) as f:
        return json.load(f)


def _extract_artifacts(data: dict) -> list[dict]:
    """Normalize artifacts from either SSE or JSON-RPC capture format.

    Returns a list of dicts with keys:
        name, metadata, parts_count, total_chars, text, t (timestamp)
    """
    fmt = data.get("format", "unknown")
    artifacts: list[dict] = []

    if fmt == "sse":
        for evt in data.get("events", []):
            d = evt.get("data", {})
            result = d.get("result", {}) if isinstance(d, dict) else {}
            art = result.get("artifact")
            if not art:
                continue
            parts = art.get("parts", [])
            text = "".join(p.get("text", "") for p in parts if p.get("kind") == "text")
            artifacts.append({
                "name": art.get("name", "unknown"),
                "metadata": art.get("metadata", {}),
                "parts_count": len(parts),
                "total_chars": len(text),
                "text": text,
                "t": evt.get("t", 0),
            })

    elif fmt == "jsonrpc":
        for a in data.get("artifacts", []):
            artifacts.append({
                "name": a.get("artifact_name", "unknown"),
                "metadata": a.get("metadata", {}),
                "parts_count": a.get("parts_count", 0),
                "total_chars": len(a.get("text", "")),
                "text": a.get("text", ""),
                "t": a.get("t", 0),
            })

    return artifacts


def _run_checks(artifacts: list[dict]) -> list[dict]:
    """Run validation checks and return a list of {name, status, detail} dicts."""
    checks: list[dict] = []

    # 1. At least one artifact has is_final_answer=True
    has_final = any(a["metadata"].get("is_final_answer") for a in artifacts)
    checks.append({
        "name": "is_final_answer present",
        "status": "PASS" if has_final else "WARN",
        "detail": "At least one streaming artifact has is_final_answer=True" if has_final
                  else "No artifact has is_final_answer=True (expected in structured/marker mode)",
    })

    # 2. No [FINAL ANSWER] marker leaked into artifact text
    marker_leaks = [
        a["name"] for a in artifacts
        if "[FINAL ANSWER]" in a["text"] or "[FINAL_ANSWER]" in a["text"]
    ]
    checks.append({
        "name": "No marker leaks",
        "status": "PASS" if not marker_leaks else "FAIL",
        "detail": "No [FINAL ANSWER] text found in artifacts" if not marker_leaks
                  else f"Marker leaked in: {', '.join(marker_leaks)}",
    })

    # 3. No metadata leaks (is_task_complete=, Returning structured response)
    meta_leaks = [
        a["name"] for a in artifacts
        if "is_task_complete=" in a["text"]
        or a["text"].lstrip().startswith("Returning structured response")
    ]
    checks.append({
        "name": "No metadata leaks",
        "status": "PASS" if not meta_leaks else "FAIL",
        "detail": "No internal metadata strings leaked" if not meta_leaks
                  else f"Metadata leaked in: {', '.join(meta_leaks)}",
    })

    # 4. Narration and final_answer are mutually exclusive
    both_flags = [
        a["name"] for a in artifacts
        if a["metadata"].get("is_narration") and a["metadata"].get("is_final_answer")
    ]
    checks.append({
        "name": "Narration/final_answer mutual exclusion",
        "status": "PASS" if not both_flags else "FAIL",
        "detail": "No artifact has both is_narration and is_final_answer" if not both_flags
                  else f"Both flags set on: {', '.join(both_flags)}",
    })

    # 5. final_result artifact exists
    has_final_result = any(a["name"] in ("final_result", "partial_result") for a in artifacts)
    checks.append({
        "name": "Final result artifact present",
        "status": "PASS" if has_final_result else "WARN",
        "detail": "final_result or partial_result artifact found" if has_final_result
                  else "No final_result/partial_result artifact — response may have been empty or errored",
    })

    # 6. Streaming result has content
    streaming = [a for a in artifacts if a["name"] == "streaming_result"]
    streaming_chars = sum(a["total_chars"] for a in streaming)
    checks.append({
        "name": "Streaming content present",
        "status": "PASS" if streaming_chars > 0 else "WARN",
        "detail": f"{len(streaming)} streaming_result artifacts, {streaming_chars} total chars"
                  if streaming_chars > 0
                  else "No streaming_result content found",
    })

    return checks


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

def _format_report(path: str, artifacts: list[dict], checks: list[dict], verbose: bool) -> str:
    """Format the analysis as a markdown report."""
    lines = [
        "# A2A Metadata Analysis",
        "",
        f"> File: `{path}`",
        f"> Artifacts: {len(artifacts)}",
        "",
        "## Checks",
        "",
    ]

    pass_count = sum(1 for c in checks if c["status"] == "PASS")
    warn_count = sum(1 for c in checks if c["status"] == "WARN")
    fail_count = sum(1 for c in checks if c["status"] == "FAIL")

    for c in checks:
        icon = {"PASS": "v", "WARN": "~", "FAIL": "x"}[c["status"]]
        lines.append(f"- [{icon}] **{c['name']}**: {c['detail']}")

    lines.extend([
        "",
        f"**Result: {pass_count} pass, {warn_count} warn, {fail_count} fail**",
        "",
    ])

    # Artifact table
    lines.extend([
        "## Artifacts",
        "",
        "| # | Name | Parts | Chars | is_narration | is_final_answer | Preview |",
        "|---|------|------:|------:|:---:|:---:|---------|",
    ])

    for i, a in enumerate(artifacts):
        narr = "Y" if a["metadata"].get("is_narration") else ""
        final = "Y" if a["metadata"].get("is_final_answer") else ""
        preview = a["text"][:80].replace("\n", "\\n").replace("|", "\\|")
        lines.append(f"| {i} | {a['name']} | {a['parts_count']} | {a['total_chars']} | {narr} | {final} | {preview} |")

    lines.append("")

    if verbose:
        lines.extend(["## Full Text Dump", ""])
        for i, a in enumerate(artifacts):
            lines.append(f"### Artifact {i}: {a['name']} ({a['total_chars']} chars)")
            lines.append("```")
            lines.append(a["text"][:2000])
            if len(a["text"]) > 2000:
                lines.append(f"... ({len(a['text']) - 2000} more chars)")
            lines.append("```")
            lines.append("")

    return "\n".join(lines)


def _print_summary(checks: list[dict]):
    """Print a colored summary to stderr."""
    for c in checks:
        icon = {"PASS": "+", "WARN": "~", "FAIL": "!"}[c["status"]]
        print(f"  [{icon}] {c['status']}: {c['name']}", file=sys.stderr)

    pass_count = sum(1 for c in checks if c["status"] == "PASS")
    warn_count = sum(1 for c in checks if c["status"] == "WARN")
    fail_count = sum(1 for c in checks if c["status"] == "FAIL")
    print(f"\n  {pass_count} pass, {warn_count} warn, {fail_count} fail", file=sys.stderr)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Analyze A2A artifact metadata from a capture file.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("capture_file", help="JSON file from capture_a2a_events.py")
    parser.add_argument("--verbose", "-v", action="store_true", help="Include full text dump")
    parser.add_argument("--output", "-o", help="Write markdown report to file (default: stdout)")
    args = parser.parse_args()

    data = _load_capture(args.capture_file)
    artifacts = _extract_artifacts(data)
    checks = _run_checks(artifacts)

    report = _format_report(args.capture_file, artifacts, checks, args.verbose)

    if args.output:
        with open(args.output, "w") as f:
            f.write(report)
        print(f"Report written to {args.output}", file=sys.stderr)
    else:
        print(report)

    # Always print summary to stderr so it's visible even when piped
    _print_summary(checks)

    # Exit 1 if any FAIL
    if any(c["status"] == "FAIL" for c in checks):
        sys.exit(1)


if __name__ == "__main__":
    main()
