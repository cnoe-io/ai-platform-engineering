{{/*
Expand the name of the chart.
*/}}
{{- define "backstage-plugin-agent-forge.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "backstage-plugin-agent-forge.fullname" -}}
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
{{- define "backstage-plugin-agent-forge.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "backstage-plugin-agent-forge.labels" -}}
helm.sh/chart: {{ include "backstage-plugin-agent-forge.chart" . }}
{{ include "backstage-plugin-agent-forge.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "backstage-plugin-agent-forge.selectorLabels" -}}
app.kubernetes.io/name: {{ include "backstage-plugin-agent-forge.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "backstage-plugin-agent-forge.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "backstage-plugin-agent-forge.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Determine if ingress is enabled - global takes precedence
*/}}
{{- define "backstage-plugin-agent-forge.ingress.enabled" -}}
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
