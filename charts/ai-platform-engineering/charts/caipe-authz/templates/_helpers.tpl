{{- define "caipe-authz.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "caipe-authz.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}{{ .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}{{ printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}{{- end }}
{{- end }}
{{- end }}

{{- define "caipe-authz.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{ include "caipe-authz.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "caipe-authz.selectorLabels" -}}
app.kubernetes.io/name: {{ include "caipe-authz.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "caipe-authz.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "caipe-authz.fullname" .) .Values.serviceAccount.name }}
{{- else }}{{ default "default" .Values.serviceAccount.name }}{{- end }}
{{- end }}

{{- define "caipe-authz.image" -}}
{{- $tag := .Values.image.tag | default .Chart.AppVersion -}}
{{- printf "%s:%s" .Values.image.repository $tag -}}
{{- end }}
