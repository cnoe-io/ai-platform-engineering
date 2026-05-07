{{/*
Expand the name of the chart.
*/}}
{{- define "scheduler.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "scheduler.fullname" -}}
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

{{- define "scheduler.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "scheduler.labels" -}}
helm.sh/chart: {{ include "scheduler.chart" . }}
{{ include "scheduler.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "scheduler.selectorLabels" -}}
app.kubernetes.io/name: {{ include "scheduler.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "scheduler.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "scheduler.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{- define "scheduler.cronRunnerServiceAccountName" -}}
{{- default "caipe-cron-runner" .Values.cronRunnerServiceAccount.name }}
{{- end }}

{{- define "scheduler.appVersion" -}}
{{- (default dict .Values.global).image | default dict | dig "tag" "" | default .Chart.AppVersion -}}
{{- end -}}

{{/*
Name of the Secret holding the shared X-Scheduler-Token.
*/}}
{{- define "scheduler.serviceTokenSecretName" -}}
{{- if .Values.serviceToken.existingSecret -}}
{{- .Values.serviceToken.existingSecret -}}
{{- else -}}
{{- printf "%s-service-token" (include "scheduler.fullname" .) -}}
{{- end -}}
{{- end -}}
