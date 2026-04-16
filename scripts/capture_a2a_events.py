#!/usr/bin/env python3
"""
Capture all A2A events from a supervisor and save to JSON.

Usage:
  python scripts/capture_a2a_events.py <url> <message> <output_file>

Examples:
  # Capture from 0.3.0 supervisor
  python scripts/capture_a2a_events.py http://localhost:8000/ "show caipe setup options" /tmp/events-030.json

  # Capture from 0.2.41 supervisor
  python scripts/capture_a2a_events.py http://localhost:8041/ "show caipe setup options" /tmp/events-041.json

  # Compare both
  python scripts/compare_a2a_events.py /tmp/events-030.json /tmp/events-041.json /tmp/comparison.md
"""
import sys
import json
import time
import uuid
import urllib.request


def capture(url: str, message: str, output_file: str, timeout: int = 300):
    msg_id = f"capture-{uuid.uuid4().hex[:8]}"

    request_body = json.dumps({
        "jsonrpc": "2.0",
        "id": msg_id,
        "method": "message/send",
        "params": {
            "message": {
                "role": "user",
                "parts": [{"kind": "text", "text": message}],
                "messageId": msg_id,
            }
        },
    }).encode()

    start = time.time()

    req = urllib.request.Request(
        url,
        data=request_body,
        headers={
            "Content-Type": "application/json",
            "Accept": "text/event-stream, application/json",
        },
    )

    with urllib.request.urlopen(req, timeout=timeout) as resp:
        content_type = resp.headers.get("Content-Type", "")

        if "event-stream" in content_type:
            # SSE streaming response
            events = []
            event_type = None
            data_lines = []
            for raw_line in resp:
                line = raw_line.decode("utf-8").rstrip("\n").rstrip("\r")
                elapsed = round(time.time() - start, 3)
                if line.startswith("event:"):
                    event_type = line[len("event:"):].strip()
                elif line.startswith("data:"):
                    data_lines.append(line[len("data:"):].strip())
                elif line == "" and event_type:
                    data_str = "\n".join(data_lines)
                    try:
                        data = json.loads(data_str)
                    except json.JSONDecodeError:
                        data = data_str
                    events.append({
                        "t": elapsed,
                        "event": event_type,
                        "data": data,
                    })
                    # Check for completion
                    if isinstance(data, dict):
                        status = data.get("result", {}).get("status", {}).get("state", "")
                        if status == "completed":
                            break
                    event_type = None
                    data_lines = []

            result = {"format": "sse", "events": events}
            with open(output_file, "w") as f:
                json.dump(result, f, indent=2)
            print(f"SSE: Captured {len(events)} events in {time.time() - start:.1f}s -> {output_file}")

        else:
            # JSON-RPC single response
            raw = resp.read()
            data = json.loads(raw)
            elapsed = round(time.time() - start, 3)

            artifacts = data.get("result", {}).get("artifacts", [])
            events = []
            for i, art in enumerate(artifacts):
                events.append({
                    "t": elapsed,
                    "seq": i,
                    "artifact_name": art.get("name", ""),
                    "description": art.get("description", ""),
                    "metadata": art.get("metadata", {}),
                    "parts_count": len(art.get("parts", [])),
                    "text": "".join(
                        p.get("text", "") for p in art.get("parts", []) if p.get("kind") == "text"
                    ),
                    "parts": art.get("parts", []),
                })

            result = {
                "format": "jsonrpc",
                "url": url,
                "message": message,
                "elapsed_s": elapsed,
                "artifacts": events,
                "raw_status": data.get("result", {}).get("status", {}),
            }
            with open(output_file, "w") as f:
                json.dump(result, f, indent=2)
            print(f"JSON-RPC: Captured {len(events)} artifacts in {elapsed:.1f}s -> {output_file}")


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print(__doc__)
        sys.exit(1)
    capture(sys.argv[1], sys.argv[2], sys.argv[3])
