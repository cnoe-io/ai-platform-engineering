# PagerDuty MCP Server

This directory contains the Model Context Protocol (MCP) server implementation for the PagerDuty agent.

## Overview

The MCP server provides a protocol interface for large language models and AI assistants to manage PagerDuty resources. It acts as a bridge between the agent and the PagerDuty API, exposing a set of structured tools that the agent can use to perform operations on PagerDuty.

## Directory Structure

- `pagerduty_mcp/`: The main MCP server implementation for PagerDuty
  - `api/`: API client and utility functions for interacting with the PagerDuty API
  - `models/`: Pydantic models defining the data structures used by the API
  - `tools/`: Tool implementations for various PagerDuty operations (incidents, services, users, etc.)
  - `utils/`: Utility functions used by the MCP server
  - `server.py`: The main MCP server entry point

## Running the MCP Server

The MCP server can be run directly or through the agent. To run it directly:

```bash
python -m agent_pagerduty.protocol_bindings.mcp_server.pagerduty_mcp.server
```

## Environment Variables

The MCP server requires the following environment variables:

- `PAGERDUTY_API_KEY`: Your PagerDuty API key
- `PAGERDUTY_API_URL`: The PagerDuty API URL

## Available Tools

The MCP server provides tools for managing the following PagerDuty resources:

- Incidents: Create, list, update, acknowledge, and resolve incidents
- Services: List, create, and update services
- Users: List users
- Schedules: List schedules
- On-calls: List on-call information 