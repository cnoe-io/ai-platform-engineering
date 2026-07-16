export interface GridProdScenario {
  id: string;
  area: "workflow" | "deployment-validation" | "integration";
  name: string;
  prompt: string;
  expectedResponse: string[];
  liveExpected?: string[];
}

export const gridProdWorkflowScenarios: GridProdScenario[] = [
  {
    id: "basic-outshift-sre-debug",
    area: "workflow",
    name: "Basic Outshift SRE triage",
    prompt: "Run basic Outshift SRE triage across GitHub, ArgoCD, AWS, PagerDuty, and Splunk for GRID prod 0.5.x",
    expectedResponse: ["Outshift SRE Debug Summary", "ArgoCD applications are synced"],
    liveExpected: ["Outshift", "SRE"],
  },
  {
    id: "create-llm-key",
    area: "workflow",
    name: "Create LLM key",
    prompt: "Create a GRID prod LiteLLM key and validate gateway access",
    expectedResponse: ["LiteLLM Key Validation", "Smoke test completed"],
    liveExpected: ["LiteLLM", "key"],
  },
  {
    id: "create-ec2-instance",
    area: "workflow",
    name: "Create EC2/AWS instance",
    prompt: "Create an EC2 instance for GRID prod 0.5.x deployment testing and verify AWS health checks",
    expectedResponse: ["EC2 Instance Provisioning", "instance health checks"],
    liveExpected: ["EC2", "AWS"],
  },
  {
    id: "create-s3-bucket",
    area: "workflow",
    name: "Create S3 bucket",
    prompt: "Create an S3 bucket for GRID prod validation with encryption and public access block enabled",
    expectedResponse: ["S3 Bucket Provisioning", "public access block"],
    liveExpected: ["S3", "bucket"],
  },
  {
    id: "create-github-repo",
    area: "workflow",
    name: "Create GitHub repo",
    prompt: "Create a GitHub repository for GRID prod 0.5.x validation with branch protection and workflow checks",
    expectedResponse: ["GitHub Repository Creation", "branch protection"],
    liveExpected: ["GitHub", "repository"],
  },
  {
    id: "deploy-application",
    area: "workflow",
    name: "Deploy app",
    prompt: "Deploy app for GRID prod 0.5.x and capture any MCP Agent Gateway failure",
    expectedResponse: ["Application Deployment Check", "MCP Agent Gateway"],
    liveExpected: ["deployment", "Agent Gateway"],
  },
  {
    id: "debug-aws-k8s",
    area: "workflow",
    name: "Debug AWS/K8s",
    prompt: "Debug AWS and K8s signals for the GRID prod 0.5.x deployment issue",
    expectedResponse: ["AWS/K8s Debug Summary", "EKS events"],
    liveExpected: ["AWS", "Kubernetes"],
  },
  {
    id: "create-jira-ticket",
    area: "workflow",
    name: "Create Jira ticket",
    prompt: "Create a Jira ticket for the GRID prod 0.5.x deployment follow-up and ask for project key and epic",
    expectedResponse: ["Jira Ticket Creation", "project key and epic"],
    liveExpected: ["Jira", "ticket"],
  },
  {
    id: "test-knowledge-base",
    area: "workflow",
    name: "Test knowledge base",
    prompt: "Test Knowledge Base retrieval for the GRID prod 0.5.x deployment testing page",
    expectedResponse: ["Knowledge Base / RAG Validation", "deployment knowledge base"],
    liveExpected: ["knowledge base", "deployment"],
  },
];

export const gridProdDeploymentValidationScenarios: GridProdScenario[] = [
  {
    id: "config-secret-injection",
    area: "deployment-validation",
    name: "Config/Secret Injection Validation",
    prompt: "Validate config and secret injection for GRID prod 0.5.x workloads",
    expectedResponse: ["Config/Secret Injection Validation", "secret values were printed"],
    liveExpected: ["config", "secret"],
  },
  {
    id: "rolling-update-zero-downtime",
    area: "deployment-validation",
    name: "Rolling Update / Zero-Downtime Deploy",
    prompt: "Validate rolling update and zero-downtime deployment behavior for GRID prod 0.5.x",
    expectedResponse: ["Rolling Update Validation", "Zero-downtime deployment criteria passed"],
    liveExpected: ["rolling", "zero"],
  },
  {
    id: "argocd-rollback",
    area: "deployment-validation",
    name: "Rollback via ArgoCD",
    prompt: "Validate rollback via ArgoCD for GRID prod 0.5.x after a bad deployment",
    expectedResponse: ["ArgoCD Rollback Validation", "previous healthy revision"],
    liveExpected: ["ArgoCD", "rollback"],
  },
  {
    id: "agent-tool-availability",
    area: "deployment-validation",
    name: "Agent Tool Availability Check",
    prompt: "Run an agent tool availability check for GitHub, ArgoCD, AWS, PagerDuty, Splunk, Webex, Jira, and Knowledge Base",
    expectedResponse: ["Agent Tool Availability Check", "Tool inventory check passed"],
    liveExpected: ["tool", "available"],
  },
  {
    id: "llm-gateway-connectivity",
    area: "deployment-validation",
    name: "LLM Gateway Connectivity",
    prompt: "Validate LLM Gateway connectivity for GRID prod 0.5.x",
    expectedResponse: ["LLM Gateway Connectivity", "Gateway connectivity check passed"],
    liveExpected: ["LLM", "gateway"],
  },
  {
    id: "rag-pipeline",
    area: "deployment-validation",
    name: "Knowledge Base / RAG Pipeline",
    prompt: "Validate Knowledge Base and RAG pipeline access for GRID prod 0.5.x deployment testing",
    expectedResponse: ["Knowledge Base / RAG Validation", "RAG pipeline check passed"],
    liveExpected: ["RAG", "knowledge"],
  },
  {
    id: "session-persistence",
    area: "deployment-validation",
    name: "Multi-turn Conversation / Session Persistence",
    prompt: "Validate multi-turn session persistence for GRID prod 0.5.x deployment testing",
    expectedResponse: ["Multi-turn Session Context", "Session context preserved"],
    liveExpected: ["session", "context"],
  },
  {
    id: "graceful-degradation",
    area: "deployment-validation",
    name: "Error Handling / Graceful Degradation",
    prompt: "Validate error handling and graceful degradation when a GRID prod integration is unavailable",
    expectedResponse: ["Graceful Degradation Drill", "No raw stack trace"],
    liveExpected: ["error", "graceful"],
  },
];

export const gridProdIntegrationScenarios: GridProdScenario[] = [
  {
    id: "webex-team-space-update",
    area: "integration",
    name: "Webex team-space update",
    prompt: "Post a GRID prod 0.5.x deployment testing summary to the SRE Webex team space",
    expectedResponse: ["Webex Update", "team space"],
    liveExpected: ["Webex", "space"],
  },
];

export const allGridProdScenarios: GridProdScenario[] = [
  ...gridProdWorkflowScenarios,
  ...gridProdDeploymentValidationScenarios,
  ...gridProdIntegrationScenarios,
];
