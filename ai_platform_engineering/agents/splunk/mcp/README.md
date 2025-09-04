# Splunk MCP Server

This directory contains the MCP (Model Context Protocol) server for Splunk integration.

## Overview

The Splunk MCP server provides a standardized interface for AI agents to interact with Splunk APIs. It exposes Splunk functionality as MCP tools that can be used by LangChain agents and other MCP-compatible systems.

## Features

The MCP server provides access to:

- **Log Search & Analytics**: Search logs, run queries, and analyze data
- **Alert Management**: Create, update, and manage alerts and detectors
- **Incident Management**: Handle incidents and track their status
- **Team Management**: Manage teams and team members
- **System Monitoring**: Monitor system health and performance metrics
- **Data Ingestion**: Manage data sources and ingestion pipelines

## Configuration

The server requires the following environment variables:

- `SPLUNK_TOKEN`: Your Splunk API token
- `SPLUNK_API_URL`: The Splunk API endpoint URL

## Running the Server

### Using UV (Recommended)

```bash
# Install dependencies
uv sync

# Run the server
uv run python mcp_splunk/server.py
```

### Using Docker

```bash
# Build the image
docker build -f ../build/Dockerfile.mcp -t mcp-splunk .

# Run the container
docker run -p 8000:8000 \
  -e SPLUNK_TOKEN=your_token \
  -e SPLUNK_API_URL=https://your-splunk-instance.com/api \
  mcp-splunk
```

## Development

### Setup

```bash
# Create virtual environment and install dependencies
make setup-venv

# Install development dependencies
uv sync --dev
```

### Available Make Targets

- `make setup-venv` - Set up Python virtual environment
- `make run` - Run the MCP server
- `make lint` - Run code linting
- `make test` - Run tests
- `make clean` - Clean build artifacts

## Integration

This MCP server is designed to be used by the Splunk AI Agent. The agent automatically launches and manages this server to provide Splunk functionality to LLM-powered workflows.

## API Reference

The server exposes Splunk APIs as MCP tools. Refer to the main MCP server implementation at `ai_platform_engineering.mcp.mcp_splunk` for detailed tool documentation. 