FROM ubuntu:latest

# Set working dir
WORKDIR /usr/src/app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    python3-pip \
    python3-venv \
    curl \
    git \
 && rm -rf /var/lib/apt/lists/*

# Install wfsm
RUN curl -L https://raw.githubusercontent.com/agntcy/workflow-srv-mgr/refs/heads/main/install.sh | bash

# Install Poetry
RUN pip install poetry

# Copy project files
COPY . /usr/src/app/

# Build and install agent package
WORKDIR /usr/src/app
RUN poetry build
RUN pip install dist/*.whl

# Setup config
RUN mkdir -p ./data
COPY ./agent_slack/protocol_bindings/acp_server/agent.json ./data/

# Create an empty agent-env.yaml file if needed
RUN touch ./data/agent-env.yaml

# Run the agent
ENTRYPOINT ["wfsm", "deploy", "-m", "./data/agent.json", "-e", "./data/agent-env.yaml"]
