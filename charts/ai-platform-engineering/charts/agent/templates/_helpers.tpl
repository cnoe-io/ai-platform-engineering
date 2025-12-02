{{/*
Expand the name of the chart.
*/}}
{{- define "agent.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "agent.fullname" -}}
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
Create chart name and version as used by the chart label.
*/}}
{{- define "agent.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "agent.labels" -}}
helm.sh/chart: {{ include "agent.chart" . }}
{{ include "agent.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "agent.selectorLabels" -}}
app.kubernetes.io/name: {{ include "agent.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "agent.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "agent.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Determine if ingress is enabled - global takes precedence
*/}}
{{- define "agent.ingress.enabled" -}}
    {{- $enabled := (default false .Values.ingress.enabled) -}}
    {{- with .Values.global -}}
        {{- with .ingress -}}
            {{- if hasKey . "enabled" -}}
                {{- $enabled = .enabled -}}
            {{- end -}}
        {{- end -}}
    {{- end -}}
    {{- $enabled -}}
{{- end }}

{{/*
Determine if external secrets are enabled for llmSecrets - prioritize global
*/}}
{{- define "agent.llmSecrets.externalSecrets.enabled" -}}
    {{- $enabled := (default false .Values.llmSecrets.externalSecrets.enabled) -}}
    {{- with .Values.global -}}
        {{- with .externalSecrets -}}
            {{- if and (hasKey . "enabled") .enabled -}}
                {{- $enabled = true -}}
            {{- end -}}
        {{- end -}}
        {{- with .llmSecrets -}}
            {{- with .externalSecrets -}}
                {{- if hasKey . "enabled" -}}
                    {{- $enabled = .enabled -}}
                {{- end -}}
            {{- end -}}
        {{- end -}}
    {{- end -}}
    {{- $enabled -}}
{{- end }}

{{/*
Get llmSecrets.secretName with global fallback
*/}}
{{- define "agent.llmSecrets.secretName" -}}
    {{- $name := .Values.llmSecrets.secretName -}}
    {{- with .Values.global -}}
        {{- with .llmSecrets -}}
            {{- if hasKey . "secretName" -}}
                {{- $name = .secretName -}}
            {{- end -}}
        {{- end -}}
    {{- end -}}
    {{- $name -}}
{{- end -}}

{{/*
Get llmSecrets.create with global fallback
*/}}
{{- define "agent.llmSecrets.create" -}}
    {{- $create := .Values.llmSecrets.create -}}
    {{- with .Values.global -}}
        {{- with .llmSecrets -}}
            {{- if hasKey . "create" -}}
                {{- $create = .create -}}
            {{- end -}}
        {{- end -}}
    {{- end -}}
    {{- $create -}}
{{- end -}}

{{/*
Get llmSecrets.externalSecrets.secretStoreRef with global fallback
*/}}
{{- define "agent.llmSecrets.externalSecrets.secretStoreRef" -}}
    {{- $ref := .Values.llmSecrets.externalSecrets.secretStoreRef -}}
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
    {{- $ref -}}
{{- end -}}

{{/*
Get agentSecrets.create with global fallback
*/}}
{{- define "agent.agentSecrets.create" -}}
    {{- $create := .Values.agentSecrets.create -}}
    {{- with .Values.global -}}
        {{- with .agentSecrets -}}
            {{- if hasKey . "create" -}}
                {{- $create = .create -}}
            {{- end -}}
        {{- end -}}
    {{- end -}}
    {{- $create -}}
{{- end -}}

{{/*
Determine if external secrets are enabled for agentSecrets - prioritize global
*/}}
{{- define "agent.agentSecrets.externalSecrets.enabled" -}}
    {{- $enabled := (default false .Values.agentSecrets.externalSecrets.enabled) -}}
    {{- with .Values.global -}}
        {{- with .externalSecrets -}}
            {{- if and (hasKey . "enabled") .enabled -}}
                {{- $enabled = true -}}
            {{- end -}}
        {{- end -}}
        {{- with .agentSecrets -}}
            {{- with .externalSecrets -}}
                {{- if hasKey . "enabled" -}}
                    {{- $enabled = .enabled -}}
                {{- end -}}
            {{- end -}}
        {{- end -}}
    {{- end -}}
    {{- $enabled -}}
{{- end }}

{{/*
Get agentSecrets.externalSecrets.secretStoreRef with global fallback
*/}}
{{- define "agent.agentSecrets.externalSecrets.secretStoreRef" -}}
    {{- $ref := .Values.agentSecrets.externalSecrets.secretStoreRef -}}
    {{- with .Values.global -}}
        {{- with .externalSecrets -}}
            {{- if hasKey . "secretStoreRef" -}}
                {{- $ref = .secretStoreRef -}}
            {{- end -}}
        {{- end -}}
    {{- end -}}
    {{- toYaml $ref -}}
{{- end -}}

{{/*
Get agentSecrets.secretName - if empty assume no secret, if not append agent.name as prefix
*/}}
{{- define "agent.agentSecrets.secretName" -}}
    {{- if .Values.agentSecrets.requiresSecret -}}
        {{- if .Values.agentSecrets.secretName -}}
            {{- .Values.agentSecrets.secretName -}}
        {{- else -}}
            {{- printf "%s-secret" (include "agent.name" .) -}}
        {{- end -}}
    {{- else -}}
        {{- "" -}}
    {{- end -}}
{{- end -}}

{{/*
Get agentSecrets.externalSecrets.name - if empty assume no secret, if not append agent.name as prefix
*/}}
{{- define "agent.agentSecrets.externalSecrets.name" -}}
    {{- if .Values.agentSecrets.requiresSecret -}}
        {{- if .Values.agentSecrets.externalSecrets.name -}}
            {{- .Values.agentSecrets.externalSecrets.name -}}
        {{- else -}}
            {{- printf "%s-secret" (include "agent.name" .) -}}
        {{- end -}}
    {{- else -}}
        {{- "" -}}
    {{- end -}}
{{- end -}}

{{/*
Determine MCP mode
*/}}
{{- define "agent.createMcpHttpServer" -}}
    {{- if and (eq .Values.mcp.mode "http") (not .Values.mcp.useRemoteMcpServer) }}
        {{- true -}}
    {{- else -}}
        {{- false -}}
    {{- end -}}
{{- end -}}

{{/*
Determine if slim transport is enabled - global takes precedence
*/}}
{{- define "agent.slim.enabled" -}}
    {{- if hasKey .Values "global" }}
        {{- if hasKey .Values.global "slim" }}
            {{- if hasKey .Values.global.slim "enabled" }}
                {{- .Values.global.slim.enabled }}
            {{- else }}
                {{- .Values.slim.enabled | default false }}
            {{- end }}
        {{- else }}
            {{- .Values.slim.enabled | default false }}
        {{- end }}
    {{- else }}
        {{- .Values.slim.enabled | default false }}
    {{- end }}
{{- end }}

{{/*
Get slim endpoint - global takes precedence
*/}}
{{- define "agent.slim.endpoint" -}}
    {{- if hasKey .Values "global" }}
        {{- if hasKey .Values.global "slim" }}
            {{- if hasKey .Values.global.slim "endpoint" }}
                {{- .Values.global.slim.endpoint }}
            {{- else }}
                {{- .Values.slim.endpoint | default "http://ai-platform-engineering-slim:46357" }}
            {{- end }}
        {{- else }}
            {{- .Values.slim.endpoint | default "http://ai-platform-engineering-slim:46357" }}
        {{- end }}
    {{- else }}
        {{- .Values.slim.endpoint | default "http://ai-platform-engineering-slim:46357" }}
    {{- end }}
{{- end }}

{{/*
Get slim transport - global takes precedence
*/}}
{{- define "agent.slim.transport" -}}
    {{- if hasKey .Values "global" }}
        {{- if hasKey .Values.global "slim" }}
            {{- if hasKey .Values.global.slim "transport" }}
                {{- .Values.global.slim.transport }}
            {{- else }}
                {{- .Values.slim.transport | default "slim" }}
            {{- end }}
        {{- else }}
            {{- .Values.slim.transport | default "slim" }}
        {{- end }}
    {{- else }}
        {{- .Values.slim.transport | default "slim" }}
    {{- end }}
{{- end }}

{{/*
Get simple agent name (strips "agent-" prefix from nameOverride)
e.g., "agent-argocd" -> "argocd"
*/}}
{{- define "agent.simpleName" -}}
{{- $name := include "agent.name" . -}}
{{- $name | trimPrefix "agent-" -}}
{{- end }}
