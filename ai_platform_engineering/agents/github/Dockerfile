# Use the official Python image
# Use the official Python image
FROM ubuntu:latest

# Install Python, pip, and Poetry (bypass Debian restrictions)
RUN apt-get update && \
    apt-get install -y python3 python3-pip curl wget && \
    pip3 install --break-system-packages poetry


# Set the working directory
WORKDIR /usr/src/app

# Install wfsm
RUN wget https://github.com/agntcy/workflow-srv-mgr/releases/download/v0.1.2/wfsm0.1.2_linux_amd64.tar.gz && \
    mkdir -p /usr/local/bin && \
    tar -xzf wfsm0.1.2_linux_amd64.tar.gz -C /usr/local/bin && \
    chmod +x /usr/local/bin/wfsm && \
    wfsm --version

# Copy agent_argocd to /usr/src/app/agent_argocd
COPY . /usr/src/app


# Build Poetry agent_argocd package
WORKDIR /usr/src/app
RUN poetry build

# Install Poetry agent_argocd package
RUN pip install --break-system-packages dist/*.whl

# Copy deploy/acp/agent.json to /usr/src/app/data
WORKDIR /usr/src/app
RUN mkdir -p ./data
COPY deploy/acp/agent.json ./data/
COPY deploy/acp/agent-env.yaml ./data/

# Set wfsm as the entry point
ENTRYPOINT ["wfsm", "deploy", "-m", "./data/agent.json", "-e", "./data/agent-env.yaml"]