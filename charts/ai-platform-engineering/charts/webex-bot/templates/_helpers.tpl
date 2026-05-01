{{/*
Expand the name of the chart.
*/}}
{{- define "webex-bot.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "webex-bot.fullname" -}}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{- define "webex-bot.labels" -}}
helm.sh/chart: {{ include "webex-bot.name" . }}
app.kubernetes.io/name: {{ include "webex-bot.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "webex-bot.selectorLabels" -}}
app.kubernetes.io/name: {{ include "webex-bot.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
