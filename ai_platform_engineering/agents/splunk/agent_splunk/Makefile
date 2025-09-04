# Makefile for Splunk agent
.PHONY: run-a2a run-a2a-client reset

# Starts the A2A server (expects SPLUNK_API_URL + SPLUNK_TOKEN in env)
run-a2a:  ## Install deps (via uv) and run the A2A server
	uv pip install -e . --upgrade
	uv run python -m protocol_bindings.a2a_server --host 0.0.0.0 --port $${PORT:-8000}

# Opens an interactive chat CLI wired to the locally-running A2A server
run-a2a-client:
	docker run -it --network=host ghcr.io/cnoe-io/agent-chat-cli:stable

# Convenience: clean Python cache/dist artefacts
reset:
	find . -type d \( -name '__pycache__' -o -name '*.egg-info' \) -print0 | xargs -0 rm -rf