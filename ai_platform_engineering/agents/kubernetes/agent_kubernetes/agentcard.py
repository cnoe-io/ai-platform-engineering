# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from dotenv import load_dotenv

from a2a.types import (
  AgentCapabilities,
  AgentCard,
  AgentSkill
)

load_dotenv()

AGENT_NAME = 'kubernetes'
AGENT_DESCRIPTION = 'An AI agent that provides capabilities to manage Kubernetes cluster resources including pods, deployments, services, nodes, and other core workloads.'

agent_skill = AgentSkill(
  id="kubernetes_agent_skill",
  name="Kubernetes Cluster Management Agent Skill",
  description="Provides capabilities to manage Kubernetes cluster resources, inspect workloads, and troubleshoot cluster issues.",
  tags=[
    "kubernetes",
    "k8s",
    "cluster",
    "pods",
    "deployments",
    "services",
    "nodes"],
  examples=[
      # Namespaces
      "List all namespaces in the cluster.",
      "Get namespace 'production' details.",

      # Pods
      "List all pods in namespace 'default'.",
      "Get pod 'my-app-abc123' in namespace 'default'.",
      "Show logs for pod 'my-app-abc123'.",
      "Get previous logs for crashed pod 'failed-app'.",
      "List all pods with label 'app=nginx'.",

      # Deployments
      "List all deployments in namespace 'production'.",
      "Get deployment 'web-api' details.",
      "Scale deployment 'web-api' to 5 replicas.",
      "Restart deployment 'web-api' to pick up new config.",

      # Services
      "List all services in namespace 'default'.",
      "Get service 'web-api-svc' configuration.",
      "Find all LoadBalancer services in the cluster.",

      # Nodes
      "List all nodes in the cluster.",
      "Show node 'worker-1' details and conditions.",
      "How many nodes are in Ready state?",

      # Events
      "List recent events in namespace 'default'.",
      "Show warning events for pod 'my-app-abc123'.",
      "What events happened in the last hour?",

      # ConfigMaps and Secrets
      "List all ConfigMaps in namespace 'default'.",
      "Get ConfigMap 'app-config' data.",
      "List all Secrets in namespace 'default'.",
      "Get Secret 'db-credentials' metadata.",

      # StatefulSets and DaemonSets
      "List all StatefulSets in namespace 'default'.",
      "Get StatefulSet 'mongodb' details.",
      "List all DaemonSets in namespace 'kube-system'.",

      # Jobs and CronJobs
      "List all Jobs in namespace 'batch'.",
      "Get Job 'data-migration' status.",
      "List all CronJobs in the cluster.",
      "Get CronJob 'nightly-backup' schedule.",

      # Cluster Overview
      "Give me a cluster health summary.",
      "What's the status of namespace 'production'?",
      "How many pods are running in each namespace?",
  ])

SUPPORTED_CONTENT_TYPES = ['text', 'text/plain']

capabilities = AgentCapabilities(streaming=True, pushNotifications=True)

def create_agent_card(agent_url):
  print("===================================")
  print(f"       {AGENT_NAME.upper()} AGENT CONFIG      ")
  print("===================================")
  print(f"AGENT_URL: {agent_url}")
  print("===================================")

  return AgentCard(
    name=AGENT_NAME,
    id=f'{AGENT_NAME.lower()}-tools-agent',
    description=AGENT_DESCRIPTION,
    url=agent_url,
    version='0.1.0',
    defaultInputModes=SUPPORTED_CONTENT_TYPES,
    defaultOutputModes=SUPPORTED_CONTENT_TYPES,
    capabilities=capabilities,
    skills=[agent_skill],
    security=[{"public": []}],
  )
