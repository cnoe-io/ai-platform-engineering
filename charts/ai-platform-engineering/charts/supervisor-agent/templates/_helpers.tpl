{{/*
Expand the name of the chart.
*/}}
{{- define "supervisorAgent.name" -}}
    {{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "supervisorAgent.fullname" -}}
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
{{- define "supervisorAgent.chart" -}}
    {{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "supervisorAgent.labels" -}}
helm.sh/chart: {{ include "supervisorAgent.chart" . }}
{{ include "supervisorAgent.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "supervisorAgent.selectorLabels" -}}
app.kubernetes.io/name: {{ include "supervisorAgent.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "supervisorAgent.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "supervisorAgent.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Determine if ingress is enabled - global takes precedence
*/}}
{{- define "supervisorAgent.ingress.enabled" -}}
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
Determine if slim transport is enabled - global takes precedence
*/}}
{{- define "supervisorAgent.slim.enabled" -}}
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
{{- define "supervisorAgent.slim.endpoint" -}}
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
{{- define "supervisorAgent.slim.transport" -}}
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
Determine if external secrets are enabled for llmSecrets - prioritize global
*/}}
{{- define "supervisorAgent.llmSecrets.externalSecrets.enabled" -}}
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
{{- define "supervisorAgent.llmSecrets.secretName" -}}
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
{{- define "supervisorAgent.llmSecrets.create" -}}
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
{{- define "supervisorAgent.llmSecrets.externalSecrets.secretStoreRef" -}}
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
Determine if metrics are enabled - global takes precedence
*/}}
{{- define "supervisorAgent.metrics.enabled" -}}
    {{- $enabled := (default false .Values.metrics.enabled) -}}
    {{- with .Values.global -}}
        {{- with .metrics -}}
            {{- if hasKey . "enabled" -}}
                {{- $enabled = .enabled -}}
            {{- end -}}
        {{- end -}}
    {{- end -}}
    {{- $enabled -}}
{{- end -}}

{{- define "supervisorAgent.appVersion" -}}
{{- .Values.global.image.tag | default .Chart.AppVersion -}}
{{- end -}}

{/*
Resolve maintained CAIPE image repositories for release vs pre-release channels.

Usage:
  include "supervisorAgent.imageRepository" (dict "root" . "repository" .Values.image.repository)

The default channel is derived from .Chart.AppVersion: rc/hotfix/dev versions use
`ghcr.io/cnoe-io/pre-release/*`, final versions use `ghcr.io/cnoe-io/*`.
Operators may force either channel with global.image.channel=pre-release|release.
Explicit non-CAIPE repositories are left unchanged.
*/}
{{- define "supervisorAgent.imageRepository" -}}
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

