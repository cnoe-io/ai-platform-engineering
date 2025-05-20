# Use the official Python image
FROM ubuntu:latest

# Set the working directory
WORKDIR /usr/src/app

# Install wfsm
RUN curl -L https://raw.githubusercontent.com/agntcy/workflow-srv-mgr/refs/heads/main/install.sh | bash

# Copy agent_atlassian to /usr/src/app/agent_atlassian
COPY agent_atlassian /user/src/app/agent_atlassian

# Build Poetry agent_atlassian package
WORKDIR /user/src/app/agent_atlassian
RUN poetry build

# Install Poetry agent_atlassian package
RUN pip install dist/*.whl

# Copy deploy/acp/agent.json to /usr/src/app/data
WORKDIR /usr/src/app
RUN mkdir -p ./data
COPY deploy/acp/agent.json ./data/

# Set wfsm as the entry point
ENTRYPOINT ["wfsm", "deploy", "-m", "./data/agent.json", "-e", "./data/agent-env.yaml"]