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
{{- if hasKey .Values.global "ingress" }}
{{- if hasKey .Values.global.ingress "enabled" }}
{{- .Values.global.ingress.enabled }}
{{- else }}
{{- .Values.ingress.enabled | default false }}
{{- end }}
{{- else }}
{{- .Values.ingress.enabled | default false }}
{{- end }}
{{- end }}

{{/*
Determine if external secrets are enabled - global takes precedence
*/}}
{{- define "agent.externalSecrets.enabled" -}}
    {{- if hasKey .Values.global "externalSecrets" }}
        {{- if hasKey .Values.global.externalSecrets "enabled" }}
            {{- .Values.global.externalSecrets.enabled }}
        {{- else }}
            {{- .Values.externalSecrets.enabled | default false }}
        {{- end }}
    {{- else }}
        {{- .Values.externalSecrets.enabled | default false }}
    {{- end }}
{{- end }}

{{/*
Determine external secret names - global takes precedence
*/}}
{{- define "agent.externalSecrets.secretNames" -}}
    {{- if eq (include "agent.externalSecrets.enabled" .) "true" -}}
        {{- if .Values.externalSecrets.secretNames -}}
            {{- .Values.externalSecrets.secretNames | join "," -}}
        {{- else -}}
            {{- if .Values.isMultiAgent -}}
                {{- printf "llm-secret" -}}
            {{- else if .Values.isBackstagePlugin -}}
                {{- "" -}}
            {{- else -}}
                {{- printf "llm-secret,%s-secret" (include "agent.name" .) -}}
            {{- end -}}
        {{- end -}}
    {{- end -}}
{{- end -}}

{{/*
Determine MCP mode
*/}}
{{- define "agent.createMcpHttpServer" -}}
    {{- if and (not .Values.isMultiAgent) (not .Values.isBackstagePlugin) }}
        {{- if and (eq .Values.mcp.mode "http") (not .Values.mcp.useRemoteMcpServer) }}
            {{- true -}}
        {{- else -}}
            {{- false -}}
        {{- end -}}
    {{- else -}}
        {{- false -}}
    {{- end -}}
{{- end -}}