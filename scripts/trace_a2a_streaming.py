#!/usr/bin/env python3
"""
Trace A2A streaming events from a supervisor via message/stream SSE.

Captures every SSE event (tool notifications, streaming text, artifacts, task state)
and produces a timeline with summary stats.

Usage:
    python3 scripts/trace_a2a_streaming.py [port] [query]

Examples:
    python3 scripts/trace_a2a_streaming.py 8000 "what can you do?"
    python3 scripts/trace_a2a_streaming.py 8041 "show caipe deployment options"
"""
import json
import sys
import time
import uuid
import http.client

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
QUERY = sys.argv[2] if len(sys.argv) > 2 else "what can you do?"


def main():
    events = []
    t0 = time.monotonic()
    context_id = str(uuid.uuid4())

    rpc_request = {
        "jsonrpc": "2.0",
        "method": "message/stream",
        "params": {
            "message": {
                "role": "user",
                "parts": [{"kind": "text", "text": QUERY}],
                "messageId": str(uuid.uuid4()),
                "contextId": context_id,
            }
        },
        "id": "trace-1",
    }

    body = json.dumps(rpc_request).encode()
    conn = http.client.HTTPConnection("localhost", PORT, timeout=120)
    conn.request(
        "POST",
        "/",
        body=body,
        headers={
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        },
    )
    resp = conn.getresponse()
    if resp.status != 200:
        print(f"HTTP {resp.status}: {resp.read().decode()[:500]}")
        return

    content_chunks = 0
    total_chars = 0
    first_content_t = None
    tool_events = []
    streaming_events = []
    artifact_events = []

    buffer = ""
    event_data_buffer = ""

    while True:
        chunk = resp.read(4096)
        if not chunk:
            break
        buffer += chunk.decode("utf-8", errors="replace")

        while "\n" in buffer:
            line_end = buffer.index("\n")
            line = buffer[:line_end].strip()
            buffer = buffer[line_end + 1 :]

            if line == "":
                if event_data_buffer:
                    try:
                        evt = json.loads(event_data_buffer)
                    except json.JSONDecodeError:
                        event_data_buffer = ""
                        continue
                    event_data_buffer = ""

                    result = evt.get("result", evt)
                    elapsed = time.monotonic() - t0

                    status = result.get("status", {})
                    artifact = result.get("artifact", {})

                    if artifact:
                        parts = artifact.get("parts", [])
                        art_type = artifact.get("metadata", {}).get(
                            "artifact_type", "unknown"
                        )
                        text = "".join(
                            p.get("text", "")
                            for p in parts
                            if isinstance(p, dict)
                        )
                        evt_record = {
                            "t": round(elapsed, 2),
                            "type": f"artifact:{art_type}",
                            "chars": len(text),
                            "preview": text[:100],
                        }
                        artifact_events.append(evt_record)
                        events.append(evt_record)
                    elif status:
                        state = status.get("state", "")
                        msg = status.get("message", {})
                        parts = msg.get("parts", []) if msg else []
                        meta = msg.get("metadata", {}) if msg else {}
                        text = "".join(
                            p.get("text", "")
                            for p in parts
                            if isinstance(p, dict)
                        )

                        if meta.get("tool_call"):
                            tc = meta["tool_call"]
                            evt_record = {
                                "t": round(elapsed, 2),
                                "type": "tool",
                                "tool": tc.get("name", "?"),
                                "status": tc.get("status", "?"),
                                "text": text[:100],
                            }
                            tool_events.append(evt_record)
                            events.append(evt_record)
                        elif text:
                            content_chunks += 1
                            total_chars += len(text)
                            if first_content_t is None:
                                first_content_t = elapsed
                            evt_record = {
                                "t": round(elapsed, 2),
                                "type": "streaming_text",
                                "chars": len(text),
                                "preview": text[:100],
                            }
                            streaming_events.append(evt_record)
                            events.append(evt_record)

                        if state in ("completed", "failed"):
                            events.append(
                                {
                                    "t": round(elapsed, 2),
                                    "type": f"task_{state}",
                                }
                            )

            elif line.startswith("data:"):
                event_data_buffer += line[5:].strip()

    # Print full timeline
    print(f"\n{'=' * 90}")
    print(f'TRACE: port={PORT} query="{QUERY}"')
    print(f"{'=' * 90}")
    print(f"{'Time':>7} | {'Event Type':<25} | Details")
    print(f"{'-' * 7}-+-{'-' * 25}-+-{'-' * 60}")

    shown_streaming = 0
    for e in events:
        t = e["t"]
        etype = e["type"]
        if etype == "streaming_text":
            shown_streaming += 1
            if (
                shown_streaming <= 5
                or shown_streaming % 50 == 0
                or (streaming_events and e == streaming_events[-1])
            ):
                print(
                    f"{t:7.2f} | {etype:<25} | chars={e['chars']} {e['preview']!r}"
                )
            elif shown_streaming == 6:
                print(f"        | {'... (streaming chunks)':<25} |")
        elif etype == "tool":
            print(
                f"{t:7.2f} | {etype:<25} | {e['tool']} [{e['status']}] {e.get('text', '')!r}"
            )
        elif etype.startswith("artifact:"):
            shown_streaming += 1
            if (
                shown_streaming <= 5
                or shown_streaming % 50 == 0
                or (artifact_events and e == artifact_events[-1])
            ):
                print(
                    f"{t:7.2f} | {etype:<25} | chars={e['chars']} {e['preview']!r}"
                )
            elif shown_streaming == 6:
                print(f"        | {'... (artifact chunks)':<25} |")
        else:
            print(f"{t:7.2f} | {etype:<25} |")

    print("\n--- Summary ---")
    print(f"Total time: {events[-1]['t'] if events else 0:.1f}s")
    print(f"Tool events: {len(tool_events)}")
    print(f"Content chunks: {content_chunks}")
    print(f"Total chars streamed: {total_chars}")
    if first_content_t:
        print(f"Time to first content: {first_content_t:.1f}s")
    print(f"Artifact events: {len(artifact_events)}")


if __name__ == "__main__":
    main()
