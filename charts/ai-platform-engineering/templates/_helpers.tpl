{{/*
Expand the name of the chart.
*/}}
{{- define "ai-platform-engineering.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "ai-platform-engineering.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "ai-platform-engineering.labels" -}}
helm.sh/chart: {{ include "ai-platform-engineering.chart" . }}
{{ include "ai-platform-engineering.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "ai-platform-engineering.selectorLabels" -}}
app.kubernetes.io/name: {{ include "ai-platform-engineering.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "ai-platform-engineering.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "ai-platform-engineering.externalSecrets.enabled" -}}
    {{- if and (hasKey .Values "global") (hasKey .Values.global "externalSecrets") (hasKey .Values.global.externalSecrets "enabled") }}
        {{- .Values.global.externalSecrets.enabled }}
    {{- else if and (hasKey .Values "global") (hasKey .Values.global "llmSecrets") (hasKey .Values.global.llmSecrets "externalSecrets") (hasKey .Values.global.llmSecrets.externalSecrets "enabled") }}
        {{- .Values.global.llmSecrets.externalSecrets.enabled }}
    {{- else }}
        {{- false }}
    {{- end }}
{{- end }}

{{/*
Get externalSecrets API version with fallback to v1 (most clusters have v1 installed)
*/}}
{{- define "ai-platform-engineering.externalSecrets.apiVersion" -}}
    {{- if and (hasKey .Values "global") (hasKey .Values.global "externalSecrets") (hasKey .Values.global.externalSecrets "apiVersion") }}
        {{- .Values.global.externalSecrets.apiVersion }}
    {{- else if and (hasKey .Values "global") (hasKey .Values.global "llmSecrets") (hasKey .Values.global.llmSecrets "externalSecrets") (hasKey .Values.global.llmSecrets.externalSecrets "apiVersion") }}
        {{- .Values.global.llmSecrets.externalSecrets.apiVersion }}
    {{- else }}
        {{- "v1" }}
    {{- end }}
{{- end }}

{{/*
Get llmSecrets.externalSecrets.secretStoreRef with global fallback
*/}}
{{- define "ai-platform-engineering.externalSecrets.secretStoreRef" -}}
    {{- $ref := dict -}}
    {{- with .Values.global -}}
        {{- with .externalSecrets -}}
            {{- if hasKey . "secretStoreRef" -}}
                {{- $ref = .secretStoreRef -}}
            {{- end -}}
        {{- end -}}
        {{- with .llmSecrets -}}
            {{- with .externalSecrets -}}
                {{- if hasKey . "secretStoreRef" -}}
                    {{- $ref = .secretStoreRef -}}
                {{- end -}}
            {{- end -}}
        {{- end -}}
    {{- end -}}
    {{- toYaml $ref -}}
{{- end -}}

{{- define "ai-platform-engineering.llmSecrets.secretName" -}}
    {{- if and (hasKey .Values "global") (hasKey .Values.global "llmSecrets") (hasKey .Values.global.llmSecrets "secretName") }}
        {{- .Values.global.llmSecrets.secretName }}
    {{- else }}
        {{- "llm-secret" }}
    {{- end }}
{{- end }}

{{- define "ai-platform-engineering.llmSecrets.externalSecrets.name" -}}
    {{- if and (hasKey .Values "global") (hasKey .Values.global "llmSecrets") (hasKey .Values.global.llmSecrets "externalSecrets") (hasKey .Values.global.llmSecrets.externalSecrets "name") }}
        {{- .Values.global.llmSecrets.externalSecrets.name }}
    {{- else if include "ai-platform-engineering.llmSecrets.secretName" .  }}
        {{- include "ai-platform-engineering.llmSecrets.secretName" . }}
    {{- else }}
        {{- "llm-secret" }}
    {{- end }}
{{- end }}

{{/*
Returns the enabledSubAgents dict as YAML.
In single-node mode reads from supervisor-agent.singleNode.enabledSubAgents.
In multi-node mode reads from global.enabledSubAgents (populated by Chart.yaml import-values e.g. global.enabledSubAgents.backstage.enabled: true).
*/}}
{{- define "ai-platform-engineering.enabledSubAgents" -}}
{{- if eq .Values.global.deploymentMode "single-node" -}}
{{- (index .Values "supervisor-agent").singleNode.enabledSubAgents | default dict | toYaml -}}
{{- else -}}
{{- .Values.global.enabledSubAgents | default dict | toYaml -}}
{{- end -}}
{{- end -}}

{{/*
Prefix for single-node in-cluster MCP Kubernetes names: {prefix}-agent-<name>[-mcp].
When global.singleNode.mcpResourcePrefix is non-empty, use it (e.g. "single-node" for readable kubectl).
When empty, use .Release.Name so legacy DNS like <release>-agent-jira-mcp stays stable.
*/}}
{{- define "ai-platform-engineering.singleNodeMcpResourcePrefix" -}}
{{- $g := .Values.global | default dict }}
{{- $sn := index $g "singleNode" | default dict }}
{{- $p := index $sn "mcpResourcePrefix" | default "" }}
{{- if ne $p "" -}}
{{- $p -}}
{{- else -}}
{{- .Release.Name -}}
{{- end -}}
{{- end -}}

{{- define "ai-platform-engineering.appVersion" -}}
{{- .Values.global.image.tag | default .Chart.AppVersion -}}
{{- end -}}
