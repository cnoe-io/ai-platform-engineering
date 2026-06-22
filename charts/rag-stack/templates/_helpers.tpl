{{/*
Expand the name of the chart.
*/}}
{{- define "rag-stack.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "rag-stack.fullname" -}}
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
{{- define "rag-stack.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "rag-stack.labels" -}}
helm.sh/chart: {{ include "rag-stack.chart" . }}
{{ include "rag-stack.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "rag-stack.selectorLabels" -}}
app.kubernetes.io/name: {{ include "rag-stack.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "rag-stack.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "rag-stack.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{/*
Resolve maintained CAIPE image repositories for release vs pre-release channels.

Usage:
  include "rag-stack.imageRepository" (dict "root" . "repository" .Values.image.repository)

The default channel is derived from .Chart.AppVersion: rc/hotfix/dev versions use
`ghcr.io/cnoe-io/pre-release/*`, final versions use `ghcr.io/cnoe-io/*`.
Operators may force either channel with global.image.channel=pre-release|release.
Explicit non-CAIPE repositories are left unchanged.
*/}
{{- define "rag-stack.imageRepository" -}}
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

