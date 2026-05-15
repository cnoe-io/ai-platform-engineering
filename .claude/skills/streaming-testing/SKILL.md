---
name: streaming-testing
description: Compare A2A streaming behaviour across supervisor versions. Captures SSE events, analyzes metadata flags (is_narration, is_final_answer), and produces side-by-side comparison reports.
---

# Streaming Testing

Compare A2A streaming behaviour across supervisor versions (e.g. 0.3.0 vs 0.2.41). Captures SSE events, analyzes metadata correctness, and generates side-by-side markdown reports.

## Prerequisites

- Docker Compose dev stack running (`docker-compose.dev.yaml`)
- **0.3.0 supervisor** on port 8000 (`caipe-supervisor`)
- **0.2.41 supervisor** on port 8041 (`caipe-supervisor-041`)
- Python 3.10+ (scripts use stdlib only — no pip install needed)

## Quick Start

```bash
# One command — captures from both supervisors, analyzes, compares
./skills/streaming-testing/run_comparison.sh "what can you do?"

# Output lands in /tmp/streaming-comparison-<timestamp>.md
```

## Individual Scripts

All scripts live in `scripts/` and use **Python stdlib only**.

| Script | Purpose | Usage |
|--------|---------|-------|
| `trace_a2a_streaming.py` | SSE timeline with summary stats | `python3 scripts/trace_a2a_streaming.py 8000 "query"` |
| `capture_a2a_events.py` | Save raw A2A events to JSON | `python3 scripts/capture_a2a_events.py http://localhost:8000/ "query" /tmp/out.json` |
| `analyze_a2a_metadata.py` | Validate metadata flags in a capture | `python3 scripts/analyze_a2a_metadata.py /tmp/out.json` |
| `compare_a2a_events.py` | Side-by-side comparison of two captures | `python3 scripts/compare_a2a_events.py /tmp/a.json /tmp/b.json` |
| `analyze_accumulation_flow.py` | Content accumulation + duplicate detection | `python3 scripts/analyze_accumulation_flow.py "query" --port 8000` |
| `validate_artifacts.py` | Parse/validate artifact reports | `python3 scripts/validate_artifacts.py --query "query" --port 8000` |

## Workflow

### Step 1: Capture events from both supervisors

```bash
python3 scripts/capture_a2a_events.py http://localhost:8000/ "what can you do?" /tmp/cap-030.json
python3 scripts/capture_a2a_events.py http://localhost:8041/ "what can you do?" /tmp/cap-041.json
```

### Step 2: Analyze metadata on each capture

```bash
python3 scripts/analyze_a2a_metadata.py /tmp/cap-030.json
python3 scripts/analyze_a2a_metadata.py /tmp/cap-041.json
```

This validates:
- `is_final_answer` is present on streaming_result artifacts
- No `[FINAL ANSWER]` marker leaked into text
- No internal metadata leaked (`is_task_complete=`, `Returning structured response`)
- `is_narration` and `is_final_answer` are mutually exclusive
- `final_result` or `partial_result` artifact exists
- Streaming content is non-empty

### Step 3: Compare side-by-side

```bash
python3 scripts/compare_a2a_events.py /tmp/cap-030.json /tmp/cap-041.json --output /tmp/comparison.md
```

Generates a markdown report with:
- Summary table (total time, time to first content, artifact counts, char counts)
- Artifact name breakdown
- Safety checks (marker leaks, metadata leaks)
- Per-artifact detail table with metadata flags

### Step 4 (optional): Deep-dive traces

For a live timeline view of each SSE event as it arrives:

```bash
python3 scripts/trace_a2a_streaming.py 8000 "what can you do?"
python3 scripts/trace_a2a_streaming.py 8041 "what can you do?"
```

## Interpreting Results

### Key Metrics

| Metric | What it means | Good value |
|--------|--------------|------------|
| Time to first content | How long until the user sees text | < 5s |
| Total time | End-to-end response time | < 20s (simple), < 120s (RAG) |
| has is_final_answer | Supervisor correctly tags the final answer | True |
| Narration events | Narration chunks for typing-status display | 0 for simple queries, > 0 for RAG |
| Marker leaks | `[FINAL ANSWER]` leaked to client | Must be 0 |
| Metadata leaks | Internal state leaked to client | Must be 0 |

### What to look for

- **0.3.0 has a "dead gap" before content**: The `generate_structured_response` node builds JSON preamble before the `content` key. Time to first content will be higher than 0.2.41.
- **0.2.41 may leak narration text**: Pre-marker buffer flush sends LLM thinking text (e.g. "Excellent! I now have comprehensive information...") to the client.
- **Narration events should NOT appear in 0.2.41**: The `is_narration` flag was added in 0.3.0.
- **Both versions should have 0 marker leaks**: The Slack bot and agent_executor both strip markers.

## Troubleshooting

### Supervisor not reachable

```bash
# Check containers
docker ps | grep supervisor

# Restart
docker restart caipe-supervisor
docker restart caipe-supervisor-041
```

### Script hangs

The scripts have a default 120s (trace) or 300s (capture) timeout. For RAG queries, increase the timeout:

```bash
# capture_a2a_events.py reads timeout from the URL (not a CLI arg).
# For trace, it's hardcoded at 120s in http.client timeout.
# If queries consistently time out, check supervisor logs:
docker logs caipe-supervisor 2>&1 | tail -20
```

### Empty captures

If `capture_a2a_events.py` produces 0 artifacts:
1. Verify the supervisor is healthy: `curl http://localhost:8000/.well-known/agent.json`
2. Check if the supervisor uses SSE or JSON-RPC (the script handles both)
3. Look at supervisor logs for errors: `docker logs caipe-supervisor 2>&1 | tail -50`

## Examples

```bash
# Simple query comparison
./skills/streaming-testing/run_comparison.sh "what can you do?"

# RAG query comparison (takes longer)
./skills/streaming-testing/run_comparison.sh "what is caipe?"

# Just analyze a single capture
python3 scripts/analyze_a2a_metadata.py /tmp/cap-030.json --verbose

# Custom labels in comparison report
python3 scripts/compare_a2a_events.py /tmp/cap-030.json /tmp/cap-041.json \
    --label-a "0.3.0 (post-fix)" --label-b "0.2.41 (golden)"
```
