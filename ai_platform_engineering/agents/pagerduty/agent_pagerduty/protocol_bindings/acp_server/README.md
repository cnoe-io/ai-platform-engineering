# PagerDuty ACP Server

This directory contains the Agent Control Protocol (ACP) server definition for the PagerDuty agent.

## Overview

The ACP server allows the PagerDuty agent to be deployed using the Agent Control Protocol, which is a protocol for managing and interacting with AI agents.

## Files

- `agent.json`: The ACP agent definition file. This file defines the metadata, input/output specifications, and deployment options for the agent.

## Deployment

To deploy the agent using ACP, use the following command:

```bash
make run-acp
```

This will use the Workflow Server Manager (WFSM) to deploy the agent with the configuration defined in `agent.json`.

## Environment Variables

The following environment variables should be set before deploying the agent:

- `LLM_PROVIDER`: The LLM provider to use (one of: "azure-openai", "openai", "anthropic-claude", "google-gemini")
- `PAGERDUTY_TOKEN`: Your PagerDuty API token
- `PAGERDUTY_API_URL`: The PagerDuty API URL
- `AGENT_NAME`: The name of the agent
- `AGENT_ID`: The unique identifier for the agent
- `PAGERDUTY_API_KEY`: Your PagerDuty API key
- `WFSM_PORT`: The port for the Workflow Server Manager

Additional environment variables might be required depending on the chosen LLM provider. 