# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Dump A2A SSE streaming chunks into a TSV table.

Usage:
  python integration/scripts/dump_a2a_stream_chunks.py --input /tmp/capture.jsonl --output integration/artifacts/capture.tsv
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def _infer_agent(text: str) -> str:
    # Intentionally avoid content-based heuristics in this repo.
    # Keep this column blank/unknown for now.
    return ""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    inp = Path(args.input)
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)

    rows = []
    idx = 0
    for line in inp.read_text().splitlines():
        if not line.strip():
            continue
        obj = json.loads(line)
        res = obj.get("result", {}) or {}
        if res.get("kind") != "artifact-update":
            continue
        art = res.get("artifact", {}) or {}
        name = str(art.get("name", "") or "")
        parts = art.get("parts") or []
        text = "".join(p.get("text", "") for p in parts if isinstance(p, dict) and p.get("text"))
        if not text:
            continue
        idx += 1
        rows.append((idx, _infer_agent(text), name, text.replace("\t", "    ").replace("\r", "")))

    out.write_text(
        "idx\tagent\tartifact_name\ttext\n"
        + "\n".join(f"{i}\t{a}\t{n}\t{t}" for i, a, n, t in rows)
        + "\n"
    )
    print(f"Wrote {len(rows)} rows to {out}")


if __name__ == "__main__":
    main()

# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Dump A2A SSE streaming chunks into a TSV table.

This script is intended for debugging duplicate/garbled streaming output by turning an
SSE capture (json-lines of `data: {...}` payloads) into a row-per-chunk table:

  idx, inferred_agent, artifact_name, text

Typical usage:

  # After capturing SSE into /tmp/dup-supervisor-*.jsonl
  python integration/scripts/dump_a2a_stream_chunks.py \
    --input /tmp/dup-supervisor-profile-1765677193.jsonl \
    --output integration/artifacts/dup-supervisor-profile-1765677193-chunks.tsv

Notes:
  - We only emit rows for `result.kind == "artifact-update"` with non-empty text parts.
  - "inferred_agent" is best-effort (derived from notification prefixes like "🔧 Github: ...").
"""

from __future__ import annotations

# Standard library
import argparse
import json
import re
from pathlib import Path


def _infer_agent(text: str) -> str:
    """Infer which agent produced the text (best-effort heuristic)."""
    # Common tool notification formats:
    #   "🔧 Supervisor: ..."
    #   "✅ Github: ..."
    m = re.match(r"^\s*🔧\s*([^:]+):", text)
    if m:
        return m.group(1).strip()
    m = re.match(r"^\s*✅\s*([^:]+):", text)
    if m:
        return m.group(1).strip()

    # If the agent embeds a source footer in the content.
    if "Source: GitHub Agent" in text or "GitHub Agent" in text:
        return "Github"

    return "Supervisor/LLM"


def dump_chunks_to_tsv(input_path: Path, output_path: Path) -> int:
    """Parse A2A jsonl capture and write TSV rows.

    Args:
        input_path: Path to jsonl file (each line is a JSON object)
        output_path: Path to TSV file to write

    Returns:
        Number of rows written
    """
    rows: list[tuple[int, str, str, str]] = []
    idx = 0

    for raw_line in input_path.read_text().splitlines():
        line = raw_line.strip()
        if not line:
            continue

        obj = json.loads(line)
        result = obj.get("result", {}) or {}
        if result.get("kind") != "artifact-update":
            continue

        artifact = result.get("artifact", {}) or {}
        artifact_name = str(artifact.get("name", "") or "")

        parts = artifact.get("parts") or []
        text = "".join(
            (p.get("text", "") for p in parts if isinstance(p, dict) and p.get("text"))
        )
        if not text:
            continue

        idx += 1
        rows.append(
            (
                idx,
                _infer_agent(text),
                artifact_name,
                text.replace("\t", "    ").replace("\r", ""),
            )
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        "idx\tagent\tartifact_name\ttext\n"
        + "\n".join(f"{i}\t{agent}\t{name}\t{text}" for i, agent, name, text in rows)
        + "\n"
    )
    return len(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="Dump A2A SSE capture into TSV chunks table.")
    parser.add_argument(
        "--input",
        required=True,
        help="Path to jsonl capture file (each line should be the JSON from an SSE data: event).",
    )
    parser.add_argument(
        "--output",
        required=True,
        help="Path to output TSV file.",
    )
    parser.add_argument(
        "--preview",
        type=int,
        default=20,
        help="How many rows to print for head and tail preview (default: 20).",
    )
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)

    rows_written = dump_chunks_to_tsv(input_path=input_path, output_path=output_path)

    # Optional preview for quick terminal inspection
    preview_n = max(0, int(args.preview))
    if preview_n:
        lines = output_path.read_text().splitlines()
        # TSV has a header row at index 0
        header, body = lines[0], lines[1:]
        print(str(output_path))
        print(f"rows={rows_written}")
        print("---preview-head---")
        print(header)
        for row in body[:preview_n]:
            # truncate long text column for preview
            parts = row.split("\t", 3)
            if len(parts) == 4 and len(parts[3]) > 140:
                parts[3] = parts[3][:140] + "…"
            print("\t".join(parts))
        print("---preview-tail---")
        print(header)
        for row in body[-preview_n:]:
            parts = row.split("\t", 3)
            if len(parts) == 4 and len(parts[3]) > 140:
                parts[3] = parts[3][:140] + "…"
            print("\t".join(parts))


if __name__ == "__main__":
    main()


