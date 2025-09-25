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
