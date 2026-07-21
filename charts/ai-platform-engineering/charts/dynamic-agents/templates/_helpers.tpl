{{/*
Expand the name of the chart.
*/}}
{{- define "dynamic-agents.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "dynamic-agents.fullname" -}}
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
{{- define "dynamic-agents.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "dynamic-agents.labels" -}}
helm.sh/chart: {{ include "dynamic-agents.chart" . }}
{{ include "dynamic-agents.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "dynamic-agents.selectorLabels" -}}
app.kubernetes.io/name: {{ include "dynamic-agents.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "dynamic-agents.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "dynamic-agents.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Determine if ingress is enabled - global takes precedence
*/}}
{{- define "dynamic-agents.ingress.enabled" -}}
    {{- $global := (default dict .Values.global) -}}
    {{- if hasKey $global "ingress" -}}
        {{- $globalIngress := (default dict $global.ingress) -}}
        {{- if hasKey $globalIngress "enabled" -}}
            {{- $globalIngress.enabled -}}
        {{- else -}}
            {{- .Values.ingress.enabled | default false -}}
        {{- end -}}
    {{- else -}}
        {{- .Values.ingress.enabled | default false -}}
    {{- end -}}
{{- end }}

{{- define "dynamic-agents.appVersion" -}}
{{- .Values.global.image.tag | default .Chart.AppVersion -}}
{{- end -}}

{{/*
Effective metrics port. 0 (default) means metrics are served on the main
service port, so this resolves to service.port in that case.
*/}}
{{- define "dynamic-agents.metricsPort" -}}
{{- if and .Values.service.metricsPort (ne (int .Values.service.metricsPort) 0) -}}
{{- .Values.service.metricsPort -}}
{{- else -}}
{{- .Values.service.port -}}
{{- end -}}
{{- end -}}

{{/*
True when metrics run on a port different from the main service port.
*/}}
{{- define "dynamic-agents.metricsPortSeparate" -}}
{{- and .Values.service.metricsPort (ne (int .Values.service.metricsPort) (int .Values.service.port)) -}}
{{- end -}}

{{/*
AgentGateway MCP URL — mirrors caipe-ui deployment defaults (#2252).
*/}}
{{- define "dynamic-agents.agentgateway.enabled" -}}
{{- dig "agentgateway" "enabled" false (.Values.global | default dict) -}}
{{- end -}}

{{- define "dynamic-agents.agentgateway.mcpUrl" -}}
{{- $agwStatic := eq (dig "agentgateway" "routingMode" "static" (.Values.global | default dict)) "static" -}}
{{- $host := ternary (printf "%s-agentgateway" .Release.Name) (printf "%s-agentgateway-proxy" .Release.Name) $agwStatic -}}
{{- $port := ternary 4000 (int (dig "agentgateway" "proxyPort" 8080 (.Values.global | default dict))) $agwStatic -}}
{{- printf "http://%s:%v" $host $port -}}
{{- end -}}

{/*
Resolve maintained CAIPE image repositories for release vs pre-release channels.

Usage:
  include "dynamic-agents.imageRepository" (dict "root" . "repository" .Values.image.repository)

The default channel is derived from .Chart.AppVersion: rc/hotfix/dev versions use
`ghcr.io/cnoe-io/pre-release/*`, final versions use `ghcr.io/cnoe-io/*`.
Operators may force either channel with global.image.channel=pre-release|release.
Explicit non-CAIPE repositories are left unchanged.
*/}
{{- define "dynamic-agents.imageRepository" -}}
{{- $root := index . "root" -}}
{{- $repository := index . "repository" | default "" -}}
{{- $global := $root.Values.global | default dict -}}
{{- $image := $global.image | default dict -}}
{{- $channel := $image.channel | default "" -}}
{{- $appVersion := $root.Chart.AppVersion | default "" -}}
{{- if or (eq $channel "") (eq $channel "auto") -}}
{{- if or (contains "-rc." $appVersion) (contains "-hotfix." $appVersion) (contains "-dev." $appVersion) -}}
{{- $channel = "pre-release" -}}
{{- else -}}
{{- $channel = "release" -}}
{{- end -}}
{{- end -}}
{{- if and (eq $channel "pre-release") (hasPrefix "ghcr.io/cnoe-io/" $repository) (not (hasPrefix "ghcr.io/cnoe-io/pre-release/" $repository)) -}}
{{- printf "ghcr.io/cnoe-io/pre-release/%s" (trimPrefix "ghcr.io/cnoe-io/" $repository) -}}
{{- else if and (eq $channel "release") (hasPrefix "ghcr.io/cnoe-io/pre-release/" $repository) -}}
{{- printf "ghcr.io/cnoe-io/%s" (trimPrefix "ghcr.io/cnoe-io/pre-release/" $repository) -}}
{{- else -}}
{{- $repository -}}
{{- end -}}
{{- end -}}

