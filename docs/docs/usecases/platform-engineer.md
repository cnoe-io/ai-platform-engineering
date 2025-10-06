---
sidebar_position: 1
---

# Use-case: Platform Engineer

## Overview

Platform Engineers focus on building and maintaining the foundational infrastructure and tools that enable software development teams to deliver applications efficiently. They ensure scalability, reliability, and automation across the platform.

## Key Responsibilities

- **Infrastructure Management**: Design, implement, and manage cloud or on-premises infrastructure.
- **Automation**: Develop CI/CD pipelines and automate repetitive tasks to improve efficiency.
- **Monitoring and Observability**: Implement monitoring tools to ensure system health and performance.
- **Collaboration**: Work closely with developers, SREs, and other stakeholders to align platform capabilities with business needs.

## Tools and Technologies

- **Containerization**: Docker, Kubernetes
- **Cloud Providers**: AWS, Azure, Google Cloud
- **CI/CD**: Jenkins, GitHub Actions, CircleCI
- **Monitoring**: Prometheus, Grafana, ELK Stack

## Benefits of the Role

- Improved developer productivity through streamlined workflows.
- Enhanced system reliability and scalability.
- Faster delivery of features and updates.

## Example Use-case

A Platform Engineer designs a Kubernetes-based infrastructure to support microservices architecture, automates deployments using Helm charts, and integrates monitoring tools like Prometheus and Grafana to ensure system observability.

## Getting Started

CAIPE provides multiple Platform Engineer personas with different agent combinations:

```bash
# Full platform engineer with all agents
cd docker-compose
docker compose -f docker-compose.platform-engineer.yaml --profile a2a-p2p up

# DevOps engineer persona
docker compose -f docker-compose.devops-engineer.yaml --profile a2a-p2p up

# Basic CAIPE setup
docker compose -f docker-compose.caipe-basic.yaml --profile a2a-p2p up

# Generate fresh compose files
make generate-compose PERSONAS="platform-engineer devops-engineer"
```

### Available Personas

- **platform-engineer**: Complete setup with ArgoCD, AWS, Backstage, Confluence, GitHub, Jira, Komodor, PagerDuty, Slack, Splunk, Weather, Webex, and Petstore agents
- **devops-engineer**: DevOps-focused setup with ArgoCD, AWS, GitHub, Jira, Komodor, and PagerDuty agents
- **caipe-basic**: Minimal setup with Weather and Petstore agents for getting started

See the [docker-compose README](../../../docker-compose/README.md) for detailed information about all available personas.