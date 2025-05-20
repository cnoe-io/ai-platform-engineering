# Use the official Python image
FROM ubuntu:latest

# Set the working directory
WORKDIR /usr/src/app

# Install wfsm
RUN curl -L https://raw.githubusercontent.com/agntcy/workflow-srv-mgr/refs/heads/main/install.sh | bash

# Copy agent_argocd to /usr/src/app/agent_argocd
COPY agent_argocd /user/src/app/agent_argocd

# Build Poetry agent_argocd package
WORKDIR /user/src/app/agent_argocd
RUN poetry build

# Install Poetry agent_argocd package
RUN pip install dist/*.whl

# Copy deploy/acp/agent.json to /usr/src/app/data
WORKDIR /usr/src/app
RUN mkdir -p ./data
COPY deploy/acp/agent.json ./data/

# Set wfsm as the entry point
ENTRYPOINT ["wfsm", "deploy", "-m", "./data/agent.json", "-e", "./data/agent-env.yaml"]