{{/*
Expand the name of the chart.
*/}}
{{- define "audit-service.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "audit-service.fullname" -}}
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
{{- define "audit-service.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "audit-service.labels" -}}
helm.sh/chart: {{ include "audit-service.chart" . }}
{{ include "audit-service.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/component: audit-service
{{- end }}

{{/*
Selector labels.
*/}}
{{- define "audit-service.selectorLabels" -}}
app.kubernetes.io/name: {{ include "audit-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use.
*/}}
{{- define "audit-service.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "audit-service.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Resolve image tag from explicit value, then global override, then appVersion.
*/}}
{{- define "audit-service.appVersion" -}}
{{- if .Values.image.tag -}}
{{- .Values.image.tag -}}
{{- else if and .Values.global .Values.global.image .Values.global.image.tag -}}
{{- .Values.global.image.tag -}}
{{- else -}}
{{- .Chart.AppVersion -}}
{{- end -}}
{{- end -}}

{/*
Resolve maintained CAIPE image repositories for release vs pre-release channels.

Usage:
  include "audit-service.imageRepository" (dict "root" . "repository" .Values.image.repository)

The default channel is derived from .Chart.AppVersion: rc/hotfix/dev versions use
`ghcr.io/cnoe-io/pre-release/*`, final versions use `ghcr.io/cnoe-io/*`.
Operators may force either channel with global.image.channel=pre-release|release.
Explicit non-CAIPE repositories are left unchanged.
*/}
{{- define "audit-service.imageRepository" -}}
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
