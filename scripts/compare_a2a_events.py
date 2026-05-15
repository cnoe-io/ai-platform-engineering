#!/usr/bin/env python3
"""
Compare two A2A event captures side-by-side.

Takes two JSON files produced by capture_a2a_events.py and generates a
markdown comparison report covering timing, artifact counts, metadata
flags, and streaming characteristics.

Usage:
    python3 scripts/compare_a2a_events.py <file_a> <file_b> [--output FILE]

Examples:
    # Compare 0.3.0 vs 0.2.41 captures
    python3 scripts/compare_a2a_events.py /tmp/cap-030.json /tmp/cap-041.json

    # Save report to file
    python3 scripts/compare_a2a_events.py /tmp/cap-030.json /tmp/cap-041.json --output /tmp/comparison.md

Dependencies: Python stdlib only (json, sys, argparse).
"""
import argparse
import json
import sys
from datetime import datetime


# ---------------------------------------------------------------------------
# Helpers for extracting metrics from a single capture file
# ---------------------------------------------------------------------------

def _load_capture(path: str) -> dict:
    """Load a capture JSON file and return its contents."""
    with open(path) as f:
        return json.load(f)


def _extract_metrics(data: dict, label: str) -> dict:
    """Extract comparison-relevant metrics from a capture.

    Supports both capture formats:
      - SSE format:  {"format": "sse", "events": [...]}
      - JSON-RPC format: {"format": "jsonrpc", "artifacts": [...], "elapsed_s": ...}
    """
    fmt = data.get("format", "unknown")
    metrics: dict = {"label": label, "format": fmt}

    if fmt == "sse":
        events = data.get("events", [])
        metrics["total_events"] = len(events)

        # Walk events to compute artifact-level metrics
        artifacts = []
        for evt in events:
            result = evt.get("data", {}).get("result", {}) if isinstance(evt.get("data"), dict) else {}
            artifact = result.get("artifact")
            if artifact:
                artifacts.append({"t": evt.get("t", 0), "artifact": artifact})

        metrics["total_artifacts"] = len(artifacts)
        metrics["elapsed_s"] = events[-1]["t"] if events else 0
        # Time to first artifact with text content
        for a in artifacts:
            parts = a["artifact"].get("parts", [])
            text = "".join(p.get("text", "") for p in parts if p.get("kind") == "text")
            if text.strip():
                metrics["time_to_first_content_s"] = a["t"]
                break
        else:
            metrics["time_to_first_content_s"] = None

        # Build the flat artifact list for detailed analysis
        flat = []
        for a in artifacts:
            art = a["artifact"]
            parts = art.get("parts", [])
            meta = art.get("metadata", {})
            text = "".join(p.get("text", "") for p in parts if p.get("kind") == "text")
            flat.append({
                "name": art.get("name", "unknown"),
                "metadata": meta,
                "parts_count": len(parts),
                "total_chars": len(text),
                "text_preview": text[:120].replace("\n", "\\n"),
            })
        metrics["artifacts_detail"] = flat

    elif fmt == "jsonrpc":
        artifacts = data.get("artifacts", [])
        metrics["total_events"] = 1  # single JSON-RPC response
        metrics["total_artifacts"] = len(artifacts)
        metrics["elapsed_s"] = data.get("elapsed_s", 0)
        # First artifact with text is "first content"
        metrics["time_to_first_content_s"] = data.get("elapsed_s")  # all arrive at once

        flat = []
        for a in artifacts:
            meta = a.get("metadata", {})
            text = a.get("text", "")
            flat.append({
                "name": a.get("artifact_name", "unknown"),
                "metadata": meta,
                "parts_count": a.get("parts_count", 0),
                "total_chars": len(text),
                "text_preview": text[:120].replace("\n", "\\n"),
            })
        metrics["artifacts_detail"] = flat

    else:
        # Best-effort: treat as jsonrpc
        metrics["total_events"] = 0
        metrics["total_artifacts"] = 0
        metrics["elapsed_s"] = 0
        metrics["time_to_first_content_s"] = None
        metrics["artifacts_detail"] = []

    # Derived metrics computed uniformly over artifacts_detail
    detail = metrics["artifacts_detail"]
    metrics["total_chars"] = sum(a["total_chars"] for a in detail)

    # Count metadata flags
    metrics["has_is_final_answer"] = any(
        a["metadata"].get("is_final_answer") for a in detail
    )
    metrics["has_is_narration"] = any(
        a["metadata"].get("is_narration") for a in detail
    )
    metrics["narration_count"] = sum(
        1 for a in detail if a["metadata"].get("is_narration")
    )
    metrics["final_answer_count"] = sum(
        1 for a in detail if a["metadata"].get("is_final_answer")
    )

    # Artifact-name breakdown
    name_counts: dict = {}
    for a in detail:
        name_counts[a["name"]] = name_counts.get(a["name"], 0) + 1
    metrics["artifact_name_breakdown"] = name_counts

    # Check for marker leaks ([FINAL ANSWER] in text)
    marker_leaks = []
    for a in detail:
        preview = a["text_preview"]
        if "[FINAL ANSWER]" in preview or "[FINAL_ANSWER]" in preview:
            marker_leaks.append(a["name"])
    metrics["marker_leaks"] = marker_leaks

    # Check for metadata leaks (is_task_complete= in text)
    metadata_leaks = []
    for a in detail:
        preview = a["text_preview"]
        if "is_task_complete=" in preview or preview.startswith("Returning structured response"):
            metadata_leaks.append(a["name"])
    metrics["metadata_leaks"] = metadata_leaks

    return metrics


# ---------------------------------------------------------------------------
# Report generation
# ---------------------------------------------------------------------------

def _generate_report(metrics_a: dict, metrics_b: dict) -> str:
    """Generate a side-by-side markdown comparison report."""
    a = metrics_a
    b = metrics_b

    lines = [
        "# A2A Streaming Comparison",
        "",
        f"> Generated {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        "",
        "## Summary",
        "",
        f"| Metric | {a['label']} | {b['label']} | Delta |",
        f"|--------|{'---:|' * 3}",
    ]

    def _row(name: str, va, vb, fmt_fn=str, better="lower"):
        """Build a table row with a delta column."""
        sa = fmt_fn(va) if va is not None else "N/A"
        sb = fmt_fn(vb) if vb is not None else "N/A"
        if isinstance(va, (int, float)) and isinstance(vb, (int, float)):
            delta = vb - va
            sign = "+" if delta > 0 else ""
            sd = f"{sign}{fmt_fn(delta)}"
        else:
            sd = "--"
        return f"| {name} | {sa} | {sb} | {sd} |"

    def _fmt_s(v):
        return f"{v:.1f}s" if isinstance(v, float) else str(v)

    lines.append(_row("Total time", a["elapsed_s"], b["elapsed_s"], _fmt_s))
    lines.append(_row("Time to first content", a["time_to_first_content_s"], b["time_to_first_content_s"], _fmt_s))
    lines.append(_row("Total artifacts", a["total_artifacts"], b["total_artifacts"]))
    lines.append(_row("Total chars", a["total_chars"], b["total_chars"]))
    lines.append(_row("Narration events", a["narration_count"], b["narration_count"]))
    lines.append(_row("Final-answer events", a["final_answer_count"], b["final_answer_count"]))

    # Flags
    lines.append(_row("has is_final_answer", a["has_is_final_answer"], b["has_is_final_answer"], str))
    lines.append(_row("has is_narration", a["has_is_narration"], b["has_is_narration"], str))

    # Artifact breakdown
    lines.extend([
        "",
        "## Artifact Breakdown",
        "",
        f"| Artifact Name | {a['label']} | {b['label']} |",
        "|---------------|---:|---:|",
    ])

    all_names = sorted(
        set(a["artifact_name_breakdown"]) | set(b["artifact_name_breakdown"])
    )
    for name in all_names:
        ca = a["artifact_name_breakdown"].get(name, 0)
        cb = b["artifact_name_breakdown"].get(name, 0)
        lines.append(f"| {name} | {ca} | {cb} |")

    # Safety checks
    lines.extend(["", "## Safety Checks", ""])
    for label, m in [(a["label"], a), (b["label"], b)]:
        checks = []
        if m["marker_leaks"]:
            checks.append(f"FAIL: [FINAL ANSWER] marker leaked in: {', '.join(m['marker_leaks'])}")
        else:
            checks.append("PASS: No [FINAL ANSWER] marker leaks")
        if m["metadata_leaks"]:
            checks.append(f"FAIL: Metadata leaked in: {', '.join(m['metadata_leaks'])}")
        else:
            checks.append("PASS: No metadata leaks (is_task_complete=)")

        lines.append(f"### {label}")
        for c in checks:
            icon = "x" if c.startswith("FAIL") else "v"
            lines.append(f"- [{icon}] {c}")
        lines.append("")

    # Per-artifact detail
    lines.extend(["## Artifact Detail", ""])
    for label, m in [(a["label"], a), (b["label"], b)]:
        lines.append(f"### {label}")
        lines.append("")
        lines.append("| # | Name | Parts | Chars | Flags | Preview |")
        lines.append("|---|------|------:|------:|-------|---------|")
        for i, art in enumerate(m["artifacts_detail"]):
            flags = []
            if art["metadata"].get("is_narration"):
                flags.append("narration")
            if art["metadata"].get("is_final_answer"):
                flags.append("final_answer")
            flag_str = ", ".join(flags) if flags else "--"
            preview = art["text_preview"][:80].replace("|", "\\|")
            lines.append(f"| {i} | {art['name']} | {art['parts_count']} | {art['total_chars']} | {flag_str} | {preview} |")
        lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Compare two A2A event captures side-by-side.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("file_a", help="First capture JSON (e.g. 0.3.0)")
    parser.add_argument("file_b", help="Second capture JSON (e.g. 0.2.41)")
    parser.add_argument("--label-a", default="A (file_a)", help="Label for first file")
    parser.add_argument("--label-b", default="B (file_b)", help="Label for second file")
    parser.add_argument("--output", "-o", help="Write report to file (default: stdout)")
    args = parser.parse_args()

    # Use filenames as default labels
    if args.label_a == "A (file_a)":
        args.label_a = args.file_a.split("/")[-1].replace(".json", "")
    if args.label_b == "B (file_b)":
        args.label_b = args.file_b.split("/")[-1].replace(".json", "")

    data_a = _load_capture(args.file_a)
    data_b = _load_capture(args.file_b)

    metrics_a = _extract_metrics(data_a, args.label_a)
    metrics_b = _extract_metrics(data_b, args.label_b)

    report = _generate_report(metrics_a, metrics_b)

    if args.output:
        with open(args.output, "w") as f:
            f.write(report)
        print(f"Report written to {args.output}", file=sys.stderr)
    else:
        print(report)


if __name__ == "__main__":
    main()
