# Use the official Python image
FROM ubuntu:latest

# Set the working directory
WORKDIR /usr/src/app

# Install wfsm
RUN curl -L https://raw.githubusercontent.com/agntcy/workflow-srv-mgr/refs/heads/main/install.sh | bash

# Copy agent_pagerduty to /usr/src/app/agent_pagerduty
COPY agent_pagerduty /usr/src/app/agent_pagerduty

# Build Poetry agent_pagerduty package
WORKDIR /usr/src/app/agent_pagerduty
RUN poetry build

# Install Poetry agent_pagerduty package
RUN pip install dist/*.whl

# Copy deploy/acp/agent.json to /usr/src/app/data
WORKDIR /usr/src/app
RUN mkdir -p ./data
COPY deploy/acp/agent.json ./data/

# Set wfsm as the entry point
ENTRYPOINT ["wfsm", "deploy", "-m", "./data/agent.json", "-e", "./data/agent-env.yaml"] 