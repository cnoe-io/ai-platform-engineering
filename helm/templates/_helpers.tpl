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

{{/*
Determine if we should create traditional secrets (when external secrets are not available or disabled)
*/}}
{{- define "ai-platform-engineering.createTraditionalSecrets" -}}
{{- if not (hasKey .Values "global") -}}
true
{{- else if not (hasKey .Values.global "externalSecrets") -}}
true
{{- else if not .Values.global.externalSecrets.enabled -}}
true
{{- else -}}
false
{{- end -}}
{{- end -}}

{{/*
Determine if we should use a custom secret name
*/}}
{{- define "ai-platform-engineering.useCustomSecretName" -}}
{{- $hasCustomSecret := false -}}
{{- if hasKey .Values "global" -}}
  {{- if hasKey .Values.global "secrets" -}}
    {{- if kindIs "map" .Values.global.secrets -}}
      {{- if hasKey .Values.global.secrets "secretName" -}}
        {{- if .Values.global.secrets.secretName -}}
          {{- $hasCustomSecret = true -}}
        {{- end -}}
      {{- end -}}
    {{- end -}}
  {{- end -}}
{{- end -}}
{{- $hasCustomSecret -}}
{{- end -}}
