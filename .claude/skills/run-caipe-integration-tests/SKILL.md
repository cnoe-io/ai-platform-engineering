---
description: Run CAIPE integration tests — streaming comparison, metadata validation, and optionally full agent routing tests.
---

## User Input

```text
$ARGUMENTS
```

## Goal

Run integration tests against the local Docker Compose dev environment. This command orchestrates the streaming testing skill and optionally the full agent integration tests.

## Execution Steps

### 1. Parse arguments

Interpret the user's input to determine which test suites to run:

- **No arguments** or `"all"`: Run streaming comparison + agent validation
- `"streaming"` or `"stream"`: Run only the streaming comparison
- `"agents"` or `"agent"`: Run only agent checkpoint validation
- `"metadata"` or `"analyze"`: Run metadata analysis on an existing capture
- A quoted query string (e.g. `"what is caipe?"`): Run streaming comparison with that query

### 2. Pre-flight checks

Verify the environment is ready:

```bash
# Check Docker is running
docker info > /dev/null 2>&1

# Check supervisors
curl -sf http://localhost:8000/.well-known/agent.json > /dev/null 2>&1 && echo "0.3.0 OK" || echo "0.3.0 NOT RUNNING"
curl -sf http://localhost:8041/.well-known/agent.json > /dev/null 2>&1 && echo "0.2.41 OK" || echo "0.2.41 NOT RUNNING"
```

If a supervisor is not running, tell the user and suggest:
```
docker restart caipe-supervisor caipe-supervisor-041
```

### 3. Run streaming comparison (if applicable)

Use the streaming testing skill:

```bash
./skills/streaming-testing/run_comparison.sh "${QUERY:-what can you do?}"
```

This runs: health check -> capture from both supervisors -> metadata analysis -> side-by-side comparison.

Report the key findings:
- Time to first content (both versions)
- Any safety check failures (marker leaks, metadata leaks)
- Artifact breakdown differences

### 4. Run agent validation (if applicable)

```bash
./skills/persistence/validate_agent_checkpoints.sh
```

Report pass/fail summary.

### 5. Run Python unit tests (always)

```bash
PYTHONPATH=. uv run pytest tests/test_slack_narration_typing_status.py tests/test_streaming_e2e.py -v -m "not integration" --tb=short
```

Report pass/fail count.

### 6. Summary

Present a consolidated summary:
- Streaming comparison: pass/fail with key metrics
- Agent validation: pass/fail
- Unit tests: X passed, Y failed
- Any action items or issues found

## Notes

- The streaming comparison requires both supervisors (ports 8000 and 8041) to be running
- Agent validation requires MongoDB and agent containers
- Unit tests run without external dependencies
- All output files are saved to `/tmp/` with timestamps
- For detailed docs, see `skills/streaming-testing/SKILL.md` and `skills/integration-testing/SKILL.md`
