# ai-platform-engineering

![Version: 0.2.38-rc.helm.2](https://img.shields.io/badge/Version-0.2.38--rc.helm.2-informational?style=flat-square) ![AppVersion: 0.2.38](https://img.shields.io/badge/AppVersion-0.2.38-informational?style=flat-square)

Parent chart to deploy multiple agent subcharts as different platform agents

## Source Code

* <https://github.com/cnoe-io/ai-platform-engineering/charts>

## Requirements

| Repository | Name | Version |
|------------|------|---------|
|  | agent-victorops(agent) | 0.2.38 |
|  | agent-pagerduty(agent) | 0.2.38 |
|  | agent-aws(agent) | 0.2.38 |
|  | agent-backstage(agent) | 0.2.38 |
|  | agent-confluence(agent) | 0.2.38 |
|  | agent-github(agent) | 0.2.38 |
|  | agent-gitlab(agent) | 0.2.38 |
|  | agent-jira(agent) | 0.2.38 |
|  | agent-komodor(agent) | 0.2.38 |
|  | agent-petstore(agent) | 0.2.38 |
|  | agent-slack(agent) | 0.2.38 |
|  | agent-splunk(agent) | 0.2.38 |
|  | agent-argocd(agent) | 0.2.38 |
|  | agent-netutils(agent) | 0.2.38 |
|  | agent-webex(agent) | 0.2.38 |
|  | agent-weather(agent) | 0.2.38 |
|  | backstage-plugin-agent-forge | 0.2.38 |
|  | caipe-ui | 0.2.38-rc.helm.1 |
|  | mongodb(caipe-ui-mongodb) | 0.2.38 |
|  | dynamic-agents | 0.2.38 |
|  | slack-bot | 0.2.38-rc.helm.1 |
|  | supervisor-agent | 0.2.38 |
| file://../rag-stack | rag-stack | 0.2.38 |
| oci://ghcr.io/agntcy/slim/helm | slim | v0.1.8 |
| oci://ghcr.io/agntcy/slim/helm | slim-control-plane | v0.1.3 |

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| agent-aigateway.agentSecrets.secretName | string | `"agent-aigateway-secret"` |  |
| agent-argocd.image.pullPolicy | string | `"Always"` |  |
| agent-argocd.image.repository | string | `"ghcr.io/cnoe-io/agent-argocd"` |  |
| agent-argocd.mcp.image.pullPolicy | string | `"Always"` |  |
| agent-argocd.mcp.image.repository | string | `"ghcr.io/cnoe-io/mcp-argocd"` |  |
| agent-argocd.mcp.image.tag | string | `""` |  |
| agent-argocd.mcp.mode | string | `"http"` |  |
| agent-argocd.mcp.port | int | `8000` |  |
| agent-argocd.nameOverride | string | `"agent-argocd"` |  |
| agent-aws.env.RESTRICT_KUBECTL_ATTACH | string | `"false"` | Block kubectl attach (attach to a running process inside a pod). Defaults to false (off). |
| agent-aws.env.RESTRICT_KUBECTL_CP | string | `"false"` | Block kubectl cp (copy files out of pods). Defaults to false (off). |
| agent-aws.env.RESTRICT_KUBECTL_EXEC | string | `"false"` | Block kubectl exec (shell access inside pods). Defaults to false (off); enable for stricter environments. |
| agent-aws.env.RESTRICT_KUBECTL_PORT_FORWARD | string | `"false"` | Block kubectl port-forward (tunnel internal services). Defaults to false (off). |
| agent-aws.env.RESTRICT_KUBECTL_PROXY | string | `"true"` | Block kubectl proxy, which exposes the entire Kubernetes API server. Defaults to true (on). |
| agent-aws.env.RESTRICT_KUBECTL_SECRETS | string | `"true"` | Block kubectl get/describe secret(s) and redact Secret data from output. Defaults to true (on). |
| agent-aws.image.pullPolicy | string | `"Always"` |  |
| agent-aws.image.repository | string | `"ghcr.io/cnoe-io/agent-aws"` |  |
| agent-aws.mcp.image.pullPolicy | string | `"Always"` |  |
| agent-aws.mcp.image.repository | string | `"ghcr.io/cnoe-io/mcp-aws"` |  |
| agent-aws.mcp.image.tag | string | `""` |  |
| agent-aws.mcp.mode | string | `"http"` |  |
| agent-aws.mcp.port | int | `8000` |  |
| agent-aws.nameOverride | string | `"agent-aws"` |  |
| agent-backstage.image.pullPolicy | string | `"Always"` |  |
| agent-backstage.image.repository | string | `"ghcr.io/cnoe-io/agent-backstage"` |  |
| agent-backstage.mcp.image.pullPolicy | string | `"Always"` |  |
| agent-backstage.mcp.image.repository | string | `"ghcr.io/cnoe-io/mcp-backstage"` |  |
| agent-backstage.mcp.image.tag | string | `""` |  |
| agent-backstage.mcp.mode | string | `"http"` |  |
| agent-backstage.mcp.port | int | `8000` |  |
| agent-backstage.nameOverride | string | `"agent-backstage"` |  |
| agent-confluence.image.pullPolicy | string | `"Always"` |  |
| agent-confluence.image.repository | string | `"ghcr.io/cnoe-io/agent-confluence"` |  |
| agent-confluence.mcp.env.TRANSPORT | string | `"streamable-http"` |  |
| agent-confluence.mcp.image.pullPolicy | string | `"Always"` |  |
| agent-confluence.mcp.image.repository | string | `"ghcr.io/sooperset/mcp-atlassian"` |  |
| agent-confluence.mcp.image.tag | string | `"latest"` |  |
| agent-confluence.mcp.mode | string | `"http"` |  |
| agent-confluence.mcp.port | int | `8000` |  |
| agent-confluence.nameOverride | string | `"agent-confluence"` |  |
| agent-github.image.pullPolicy | string | `"Always"` |  |
| agent-github.image.repository | string | `"ghcr.io/cnoe-io/agent-github"` |  |
| agent-github.mcp.useRemoteMcpServer | bool | `true` |  |
| agent-github.nameOverride | string | `"agent-github"` |  |
| agent-gitlab.env.GIT_AUTHOR_EMAIL | string | `"ai-agent@cnoe.io"` |  |
| agent-gitlab.env.GIT_AUTHOR_NAME | string | `"AI Agent"` |  |
| agent-gitlab.env.GIT_COMMITTER_EMAIL | string | `"ai-agent@cnoe.io"` |  |
| agent-gitlab.env.GIT_COMMITTER_NAME | string | `"AI Agent"` |  |
| agent-gitlab.image.pullPolicy | string | `"Always"` |  |
| agent-gitlab.image.repository | string | `"ghcr.io/cnoe-io/agent-gitlab"` |  |
| agent-gitlab.mcp.env.GITLAB_READ_ONLY_MODE | string | `"true"` |  |
| agent-gitlab.mcp.env.HOST | string | `"0.0.0.0"` |  |
| agent-gitlab.mcp.env.MAX_REQUESTS_PER_MINUTE | string | `"60"` |  |
| agent-gitlab.mcp.env.MAX_SESSIONS | string | `"1000"` |  |
| agent-gitlab.mcp.env.PORT | string | `"8000"` |  |
| agent-gitlab.mcp.env.STREAMABLE_HTTP | string | `"true"` |  |
| agent-gitlab.mcp.env.USE_PIPELINE | string | `"true"` |  |
| agent-gitlab.mcp.image.pullPolicy | string | `"Always"` |  |
| agent-gitlab.mcp.image.repository | string | `"zereight050/gitlab-mcp"` |  |
| agent-gitlab.mcp.image.tag | string | `"latest"` |  |
| agent-gitlab.mcp.mode | string | `"http"` |  |
| agent-gitlab.mcp.port | int | `8000` |  |
| agent-gitlab.nameOverride | string | `"agent-gitlab"` |  |
| agent-jira.image.pullPolicy | string | `"Always"` |  |
| agent-jira.image.repository | string | `"ghcr.io/cnoe-io/agent-jira"` |  |
| agent-jira.mcp.image.pullPolicy | string | `"Always"` |  |
| agent-jira.mcp.image.repository | string | `"ghcr.io/cnoe-io/mcp-jira"` |  |
| agent-jira.mcp.image.tag | string | `""` |  |
| agent-jira.mcp.mode | string | `"http"` |  |
| agent-jira.mcp.port | int | `8000` |  |
| agent-jira.nameOverride | string | `"agent-jira"` |  |
| agent-komodor.image.pullPolicy | string | `"Always"` |  |
| agent-komodor.image.repository | string | `"ghcr.io/cnoe-io/agent-komodor"` |  |
| agent-komodor.mcp.image.pullPolicy | string | `"Always"` |  |
| agent-komodor.mcp.image.repository | string | `"ghcr.io/cnoe-io/mcp-komodor"` |  |
| agent-komodor.mcp.image.tag | string | `""` |  |
| agent-komodor.mcp.mode | string | `"http"` |  |
| agent-komodor.mcp.port | int | `8000` |  |
| agent-komodor.nameOverride | string | `"agent-komodor"` |  |
| agent-netutils.agentSecrets.requiresSecret | bool | `false` |  |
| agent-netutils.image.pullPolicy | string | `"Always"` |  |
| agent-netutils.image.repository | string | `"ghcr.io/cnoe-io/agent-netutils"` |  |
| agent-netutils.mcp.image.pullPolicy | string | `"Always"` |  |
| agent-netutils.mcp.image.repository | string | `"ghcr.io/cnoe-io/mcp-netutils"` |  |
| agent-netutils.mcp.image.tag | string | `""` |  |
| agent-netutils.mcp.mode | string | `"http"` |  |
| agent-netutils.mcp.port | int | `8000` |  |
| agent-netutils.nameOverride | string | `"agent-netutils"` |  |
| agent-pagerduty.image.pullPolicy | string | `"Always"` |  |
| agent-pagerduty.image.repository | string | `"ghcr.io/cnoe-io/agent-pagerduty"` |  |
| agent-pagerduty.mcp.image.pullPolicy | string | `"Always"` |  |
| agent-pagerduty.mcp.image.repository | string | `"ghcr.io/cnoe-io/mcp-pagerduty"` |  |
| agent-pagerduty.mcp.image.tag | string | `""` |  |
| agent-pagerduty.mcp.mode | string | `"http"` |  |
| agent-pagerduty.mcp.port | int | `8000` |  |
| agent-pagerduty.nameOverride | string | `"agent-pagerduty"` |  |
| agent-petstore.agentSecrets.requiresSecret | bool | `false` |  |
| agent-petstore.image.pullPolicy | string | `"Always"` |  |
| agent-petstore.image.repository | string | `"ghcr.io/cnoe-io/agent-petstore"` |  |
| agent-petstore.mcp.useRemoteMcpServer | bool | `true` |  |
| agent-petstore.nameOverride | string | `"agent-petstore"` |  |
| agent-slack.image.pullPolicy | string | `"Always"` |  |
| agent-slack.image.repository | string | `"ghcr.io/cnoe-io/agent-slack"` |  |
| agent-slack.mcp.image.pullPolicy | string | `"Always"` |  |
| agent-slack.mcp.image.repository | string | `"ghcr.io/cnoe-io/mcp-slack"` |  |
| agent-slack.mcp.image.tag | string | `""` |  |
| agent-slack.mcp.mode | string | `"http"` |  |
| agent-slack.mcp.port | int | `8000` |  |
| agent-slack.nameOverride | string | `"agent-slack"` |  |
| agent-splunk.image.pullPolicy | string | `"Always"` |  |
| agent-splunk.image.repository | string | `"ghcr.io/cnoe-io/agent-splunk"` |  |
| agent-splunk.mcp.image.pullPolicy | string | `"Always"` |  |
| agent-splunk.mcp.image.repository | string | `"ghcr.io/cnoe-io/mcp-splunk"` |  |
| agent-splunk.mcp.image.tag | string | `""` |  |
| agent-splunk.mcp.mode | string | `"http"` |  |
| agent-splunk.mcp.port | int | `8000` |  |
| agent-splunk.nameOverride | string | `"agent-splunk"` |  |
| agent-victorops.image.pullPolicy | string | `"Always"` |  |
| agent-victorops.image.repository | string | `"ghcr.io/cnoe-io/agent-victorops"` |  |
| agent-victorops.mcp.image.pullPolicy | string | `"Always"` |  |
| agent-victorops.mcp.image.repository | string | `"ghcr.io/cnoe-io/mcp-victorops"` |  |
| agent-victorops.mcp.image.tag | string | `""` |  |
| agent-victorops.mcp.mode | string | `"http"` |  |
| agent-victorops.mcp.port | int | `8000` |  |
| agent-victorops.nameOverride | string | `"agent-victorops"` |  |
| agent-weather.agentSecrets.requiresSecret | bool | `false` |  |
| agent-weather.image.pullPolicy | string | `"Always"` |  |
| agent-weather.image.pullPolicy | string | `"Always"` |  |
| agent-weather.image.repository | string | `"ghcr.io/cnoe-io/agent-weather"` |  |
| agent-weather.image.repository | string | `"ghcr.io/cnoe-io/agent-weather"` |  |
| agent-weather.mcp.image.pullPolicy | string | `"Always"` |  |
| agent-weather.mcp.image.repository | string | `"ghcr.io/cnoe-io/mcp-weather"` |  |
| agent-weather.mcp.image.tag | string | `""` |  |
| agent-weather.mcp.mode | string | `"http"` |  |
| agent-weather.mcp.port | int | `8000` |  |
| agent-weather.mcp.useRemoteMcpServer | bool | `true` |  |
| agent-weather.nameOverride | string | `"agent-weather"` |  |
| agent-weather.nameOverride | string | `"agent-weather"` |  |
| agent-weather.remoteAgent | bool | `true` |  |
| agent-webex.image.pullPolicy | string | `"Always"` |  |
| agent-webex.image.repository | string | `"ghcr.io/cnoe-io/agent-webex"` |  |
| agent-webex.mcp.image.pullPolicy | string | `"Always"` |  |
| agent-webex.mcp.image.repository | string | `"ghcr.io/cnoe-io/mcp-webex"` |  |
| agent-webex.mcp.image.tag | string | `""` |  |
| agent-webex.mcp.mode | string | `"http"` |  |
| agent-webex.mcp.port | int | `8000` |  |
| agent-webex.nameOverride | string | `"agent-webex"` |  |
| backstage-plugin-agent-forge.image.pullPolicy | string | `"Always"` |  |
| backstage-plugin-agent-forge.image.repository | string | `"ghcr.io/cnoe-io/backstage-plugin-agent-forge"` |  |
| backstage-plugin-agent-forge.image.tag | string | `""` |  |
| backstage-plugin-agent-forge.nameOverride | string | `"backstage-plugin-agent-forge"` |  |
| backstage-plugin-agent-forge.service.ports[0].name | string | `"http"` |  |
| backstage-plugin-agent-forge.service.ports[0].port | int | `3000` |  |
| backstage-plugin-agent-forge.service.ports[0].protocol | string | `"TCP"` |  |
| backstage-plugin-agent-forge.service.ports[1].name | string | `"backend"` |  |
| backstage-plugin-agent-forge.service.ports[1].port | int | `7007` |  |
| backstage-plugin-agent-forge.service.ports[1].protocol | string | `"TCP"` |  |
| caipe-ui.config.APP_NAME | string | `"CAIPE"` |  |
| caipe-ui.config.DESCRIPTION | string | `"Where Humans and AI agents collaborate to deliver high quality outcomes."` |  |
| caipe-ui.config.DYNAMIC_AGENTS_ENABLED | string | `"false"` |  |
| caipe-ui.config.ENABLE_SUBAGENT_CARDS | string | `"true"` |  |
| caipe-ui.config.ENV_BADGE | string | `""` |  |
| caipe-ui.config.LOGO_STYLE | string | `"default"` |  |
| caipe-ui.config.LOGO_URL | string | `"/logo.svg"` |  |
| caipe-ui.config.MONGODB_DATABASE | string | `"caipe"` |  |
| caipe-ui.config.NEXTAUTH_URL | string | `"http://localhost:3000"` |  |
| caipe-ui.config.NODE_ENV | string | `"production"` |  |
| caipe-ui.config.SHOW_POWERED_BY | string | `"false"` |  |
| caipe-ui.config.SSO_ENABLED | string | `"false"` |  |
| caipe-ui.config.TAGLINE | string | `"Multi-Agent Workflow Automation"` |  |
| caipe-ui.env.A2A_BASE_URL | string | `"http://ai-platform-engineering-supervisor-agent:8000"` |  |
| caipe-ui.env.SKILLS_DIR | string | `"/app/data/skills"` |  |
| caipe-ui.existingSecret | string | `""` |  |
| caipe-ui.externalSecrets.apiVersion | string | `"v1beta1"` |  |
| caipe-ui.externalSecrets.data | list | `[]` |  |
| caipe-ui.externalSecrets.enabled | bool | `false` |  |
| caipe-ui.externalSecrets.secretStoreRef.kind | string | `"ClusterSecretStore"` |  |
| caipe-ui.externalSecrets.secretStoreRef.name | string | `"vault"` |  |
| caipe-ui.image.pullPolicy | string | `"Always"` |  |
| caipe-ui.image.repository | string | `"ghcr.io/cnoe-io/caipe-ui"` |  |
| caipe-ui.image.tag | string | `""` |  |
| caipe-ui.ingress.annotations | object | `{}` |  |
| caipe-ui.ingress.className | string | `"nginx"` |  |
| caipe-ui.ingress.enabled | bool | `false` |  |
| caipe-ui.ingress.hosts[0].host | string | `"caipe-ui.local"` |  |
| caipe-ui.ingress.hosts[0].paths[0].path | string | `"/"` |  |
| caipe-ui.ingress.hosts[0].paths[0].pathType | string | `"Prefix"` |  |
| caipe-ui.ingress.tls | list | `[]` |  |
| caipe-ui.mongodb.auth.database | string | `"caipe"` |  |
| caipe-ui.mongodb.auth.rootPassword | string | `"changeme"` |  |
| caipe-ui.mongodb.auth.rootUsername | string | `"admin"` |  |
| caipe-ui.mongodb.enabled | bool | `false` |  |
| caipe-ui.mongodb.externalSecrets.apiVersion | string | `"v1beta1"` |  |
| caipe-ui.mongodb.externalSecrets.data | list | `[]` |  |
| caipe-ui.mongodb.externalSecrets.enabled | bool | `false` |  |
| caipe-ui.mongodb.externalSecrets.secretStoreRef.kind | string | `"ClusterSecretStore"` |  |
| caipe-ui.mongodb.externalSecrets.secretStoreRef.name | string | `"vault"` |  |
| caipe-ui.mongodb.image.pullPolicy | string | `"IfNotPresent"` |  |
| caipe-ui.mongodb.image.repository | string | `"mongo"` |  |
| caipe-ui.mongodb.image.tag | string | `"7.0"` |  |
| caipe-ui.mongodb.nameOverride | string | `"mongodb"` |  |
| caipe-ui.mongodb.persistence.enabled | bool | `true` |  |
| caipe-ui.mongodb.persistence.size | string | `"10Gi"` |  |
| caipe-ui.mongodb.persistence.storageClass | string | `""` |  |
| caipe-ui.mongodb.service.port | int | `27017` |  |
| caipe-ui.nameOverride | string | `"caipe-ui"` |  |
| caipe-ui.service.port | int | `3000` |  |
| caipe-ui.skills.enabled | bool | `true` |  |
| caipe-ui.volumeMounts[0].mountPath | string | `"/app/data/skills"` |  |
| caipe-ui.volumeMounts[0].name | string | `"skill-templates"` |  |
| caipe-ui.volumeMounts[0].readOnly | bool | `true` |  |
| caipe-ui.volumes[0].configMap.name | string | `"skill-templates"` |  |
| caipe-ui.volumes[0].name | string | `"skill-templates"` |  |
| dynamic-agents.config.MONGODB_DATABASE | string | `"caipe"` |  |
| dynamic-agents.externalSecrets.apiVersion | string | `"v1beta1"` |  |
| dynamic-agents.externalSecrets.data | list | `[]` |  |
| dynamic-agents.externalSecrets.enabled | bool | `false` |  |
| dynamic-agents.externalSecrets.secretStoreRef.kind | string | `"ClusterSecretStore"` |  |
| dynamic-agents.externalSecrets.secretStoreRef.name | string | `"vault"` |  |
| dynamic-agents.image.pullPolicy | string | `"Always"` |  |
| dynamic-agents.image.repository | string | `"ghcr.io/cnoe-io/caipe-dynamic-agents"` |  |
| dynamic-agents.image.tag | string | `""` |  |
| dynamic-agents.nameOverride | string | `"dynamic-agents"` |  |
| dynamic-agents.service.port | int | `8001` |  |
| extraDeploy | list | `[]` |  |
| global.agentgateway.enabled | bool | `false` |  |
| global.createLlmSecret | bool | `false` |  |
| global.deploymentMode | string | `"multi-node"` |  |
| global.externalSecrets.apiVersion | string | `"v1beta1"` |  |
| global.externalSecrets.enabled | bool | `false` |  |
| global.llmSecrets.create | bool | `false` |  |
| global.llmSecrets.secretName | string | `"llm-secret"` |  |
| global.metrics.enabled | bool | `false` |  |
| global.rag.enableGraphRag | bool | `true` |  |
| global.slim.enabled | bool | `false` |  |
| global.slim.endpoint | string | `"http://ai-platform-engineering-slim:46357"` |  |
| global.slim.transport | string | `"slim"` |  |
| metrics.grafanaDashboard.enabled | bool | `true` |  |
| metrics.grafanaDashboard.labels.grafana_dashboard | string | `"1"` |  |
| metrics.path | string | `"/metrics"` |  |
| metrics.serviceMonitor.annotations | object | `{}` |  |
| metrics.serviceMonitor.enabled | bool | `false` |  |
| metrics.serviceMonitor.interval | string | `"30s"` |  |
| metrics.serviceMonitor.labels | object | `{}` |  |
| metrics.serviceMonitor.metricRelabelings | list | `[]` |  |
| metrics.serviceMonitor.relabelings | list | `[]` |  |
| metrics.serviceMonitor.scrapeTimeout | string | `"10s"` |  |
| promptConfig | string | `""` |  |
| promptConfigType | string | `"default"` |  |
| rag-stack | string | `nil` |  |
| rag-stack.agent-ontology.enabled | bool | `true` |  |
| rag-stack.agent-rag.enabled | bool | `true` |  |
| rag-stack.agent-rag.image.pullPolicy | string | `"Always"` |  |
| rag-stack.agent-rag.image.repository | string | `"ghcr.io/cnoe-io/caipe-rag-agent-rag"` |  |
| rag-stack.agent-rag.image.tag | string | `""` |  |
| rag-stack.milvus.enabled | bool | `true` |  |
| rag-stack.neo4j.enabled | bool | `true` |  |
| rag-stack.rag-redis.enabled | bool | `true` |  |
| rag-stack.rag-redis.image.pullPolicy | string | `"IfNotPresent"` |  |
| rag-stack.rag-redis.image.repository | string | `"redis"` |  |
| rag-stack.rag-redis.image.tag | string | `"7.2-alpine"` |  |
| rag-stack.rag-redis.persistence.enabled | bool | `false` |  |
| rag-stack.rag-server.enabled | bool | `true` |  |
| rag-stack.rag-server.image.pullPolicy | string | `"Always"` |  |
| rag-stack.rag-server.image.repository | string | `"ghcr.io/cnoe-io/caipe-rag-server"` |  |
| rag-stack.rag-server.image.tag | string | `""` |  |
| rag-stack.rag-webui.enabled | bool | `true` |  |
| rag-stack.rag-webui.image.pullPolicy | string | `"Always"` |  |
| rag-stack.rag-webui.image.repository | string | `"ghcr.io/cnoe-io/caipe-rag-webui"` |  |
| rag-stack.rag-webui.image.tag | string | `""` |  |
| ragPromptConfig | string | `""` |  |
| slack-bot.appName | string | `"CAIPE"` |  |
| slack-bot.auth.audience | string | `""` |  |
| slack-bot.auth.clientId | string | `""` |  |
| slack-bot.auth.enabled | bool | `false` |  |
| slack-bot.auth.scope | string | `""` |  |
| slack-bot.auth.tokenUrl | string | `""` |  |
| slack-bot.botConfig | object | `{}` |  |
| slack-bot.botMode | string | `"socket"` |  |
| slack-bot.env.CAIPE_URL | string | `"http://ai-platform-engineering-supervisor-agent:8000"` |  |
| slack-bot.externalSecrets.apiVersion | string | `"v1beta1"` |  |
| slack-bot.externalSecrets.data | list | `[]` |  |
| slack-bot.externalSecrets.enabled | bool | `false` |  |
| slack-bot.externalSecrets.secretStoreRef.kind | string | `"ClusterSecretStore"` |  |
| slack-bot.externalSecrets.secretStoreRef.name | string | `"vault"` |  |
| slack-bot.image.pullPolicy | string | `"Always"` |  |
| slack-bot.image.repository | string | `"ghcr.io/cnoe-io/caipe-slack-bot"` |  |
| slack-bot.image.tag | string | `""` |  |
| slack-bot.mongodb.database | string | `"caipe"` |  |
| slack-bot.mongodb.uri | string | `""` |  |
| slack-bot.resources.limits.cpu | string | `"500m"` |  |
| slack-bot.resources.limits.memory | string | `"512Mi"` |  |
| slack-bot.resources.requests.cpu | string | `"100m"` |  |
| slack-bot.resources.requests.memory | string | `"256Mi"` |  |
| slack-bot.silenceEnv | string | `"false"` |  |
| slack-bot.slack.tokenSecretRef | string | `"slack-bot-secrets"` |  |
| supervisor-agent.env.AGENT_CONNECTIVITY_ENABLE_BACKGROUND | string | `"true"` |  |
| supervisor-agent.env.EXTERNAL_URL | string | `"http://localhost:8000"` |  |
| supervisor-agent.env.SKIP_AGENT_CONNECTIVITY_CHECK | string | `"false"` |  |
| supervisor-agent.env.TASK_CONFIG_PATH | string | `"/app/task_config.yaml"` |  |
| supervisor-agent.env.USE_STRUCTURED_RESPONSE | string | `"true"` |  |
| supervisor-agent.image.args[0] | string | `"platform-engineer"` |  |
| supervisor-agent.image.pullPolicy | string | `"Always"` |  |
| supervisor-agent.image.repository | string | `"ghcr.io/cnoe-io/ai-platform-engineering"` |  |
| supervisor-agent.image.tag | string | `""` |  |
| supervisor-agent.memoryPersistence.enableFactExtraction | bool | `false` |  |
| supervisor-agent.memoryPersistence.postgres.dsn | string | `""` |  |
| supervisor-agent.memoryPersistence.postgres.existingSecret | object | `{}` |  |
| supervisor-agent.memoryPersistence.redis.existingSecret | object | `{}` |  |
| supervisor-agent.memoryPersistence.redis.keyPrefix | string | `""` |  |
| supervisor-agent.memoryPersistence.redis.url | string | `""` |  |
| supervisor-agent.memoryPersistence.ttlMinutes | int | `10080` |  |
| supervisor-agent.memoryPersistence.type | string | `"memory"` |  |
| supervisor-agent.multiAgentConfig.port | string | `"8000"` |  |
| supervisor-agent.multiAgentConfig.protocol | string | `"a2a"` |  |
| supervisor-agent.nameOverride | string | `"supervisor-agent"` |  |
| supervisor-agent.singleNode.enabledSubAgents.aigateway | bool | `true` |  |
| supervisor-agent.singleNode.enabledSubAgents.argocd | bool | `true` |  |
| supervisor-agent.singleNode.enabledSubAgents.aws | bool | `true` |  |
| supervisor-agent.singleNode.enabledSubAgents.backstage | bool | `true` |  |
| supervisor-agent.singleNode.enabledSubAgents.confluence | bool | `true` |  |
| supervisor-agent.singleNode.enabledSubAgents.github | bool | `true` |  |
| supervisor-agent.singleNode.enabledSubAgents.jira | bool | `true` |  |
| supervisor-agent.singleNode.enabledSubAgents.komodor | bool | `true` |  |
| supervisor-agent.singleNode.enabledSubAgents.pagerduty | bool | `true` |  |
| supervisor-agent.singleNode.enabledSubAgents.rag | bool | `false` |  |
| supervisor-agent.singleNode.enabledSubAgents.slack | bool | `true` |  |
| supervisor-agent.singleNode.enabledSubAgents.splunk | bool | `true` |  |
| supervisor-agent.singleNode.enabledSubAgents.weather | bool | `false` |  |
| supervisor-agent.singleNode.enabledSubAgents.webex | bool | `true` |  |
| supervisor-agent.singleNode.subagentModels | object | `{}` |  |
| supervisor-agent.singleNode.supervisorModel | string | `""` |  |
| tags.agent-argocd | bool | `false` |  |
| tags.agent-aws | bool | `false` |  |
| tags.agent-backstage | bool | `false` |  |
| tags.agent-confluence | bool | `false` |  |
| tags.agent-github | bool | `false` |  |
| tags.agent-gitlab | bool | `false` |  |
| tags.agent-jira | bool | `false` |  |
| tags.agent-komodor | bool | `false` |  |
| tags.agent-netutils | bool | `false` |  |
| tags.agent-pagerduty | bool | `false` |  |
| tags.agent-petstore | bool | `false` |  |
| tags.agent-slack | bool | `false` |  |
| tags.agent-splunk | bool | `false` |  |
| tags.agent-victorops | bool | `false` |  |
| tags.agent-weather | bool | `false` |  |
| tags.agent-weather | bool | `false` |  |
| tags.agent-webex | bool | `false` |  |
| tags.backstage-agent-forge | bool | `false` |  |
| tags.basic | bool | `false` |  |
| tags.caipe-ui | bool | `false` |  |
| tags.complete | bool | `false` |  |
| tags.dynamic-agents | bool | `false` |  |
| tags.rag-stack | bool | `false` |  |
| tags.slack-bot | bool | `false` |  |
| taskConfig | string | `""` |  |

----------------------------------------------
Autogenerated from chart metadata using [helm-docs v1.14.2](https://github.com/norwoodj/helm-docs/releases/v1.14.2)
