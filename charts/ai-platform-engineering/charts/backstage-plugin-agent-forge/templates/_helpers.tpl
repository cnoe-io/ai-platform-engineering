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

{{/*
Determine if Gateway API is enabled - global value takes precedence
*/}}
{{- define "backstage-plugin-agent-forge.gatewayApi.enabled" -}}
{{- if hasKey .Values "global" }}
{{- if hasKey .Values.global "gatewayApi" }}
{{- if hasKey .Values.global.gatewayApi "enabled" }}
{{- .Values.global.gatewayApi.enabled }}
{{- else }}
{{- false }}
{{- end }}
{{- else }}
{{- false }}
{{- end }}
{{- else }}
{{- false }}
{{- end }}
{{- end }}

{{/*
Get Gateway name from global configuration
*/}}
{{- define "backstage-plugin-agent-forge.gatewayApi.gatewayName" -}}
{{- $name := "" -}}
{{- with .Values.global -}}
{{- with .gatewayApi -}}
{{- if hasKey . "gatewayName" -}}
{{- $name = .gatewayName -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- $name -}}
{{- end }}

{{/*
Get Gateway namespace from global configuration, default to release namespace
*/}}
{{- define "backstage-plugin-agent-forge.gatewayApi.gatewayNamespace" -}}
{{- $namespace := .Release.Namespace -}}
{{- with .Values.global -}}
{{- with .gatewayApi -}}
{{- if and (hasKey . "gatewayNamespace") .gatewayNamespace -}}
{{- $namespace = .gatewayNamespace -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- $namespace -}}
{{- end }}

{{/*
Map Ingress pathType to Gateway API HTTPRoute path match type
Ingress: Prefix, Exact, ImplementationSpecific
Gateway API: PathPrefix, Exact, RegularExpression
*/}}
{{- define "backstage-plugin-agent-forge.gatewayApi.pathType" -}}
{{- $ingressType := . | default "Prefix" -}}
{{- if eq $ingressType "Prefix" -}}
PathPrefix
{{- else if eq $ingressType "Exact" -}}
Exact
{{- else if eq $ingressType "ImplementationSpecific" -}}
PathPrefix
{{- else -}}
PathPrefix
{{- end -}}
{{- end }}

{{/*
Determine if HTTPRoute should be rendered - enabled when ingress.enabled is true AND gatewayApi IS enabled
*/}}
{{- define "backstage-plugin-agent-forge.httproute.shouldRender" -}}
{{- $ingressEnabled := include "backstage-plugin-agent-forge.ingress.enabled" . | eq "true" -}}
{{- $gatewayEnabled := include "backstage-plugin-agent-forge.gatewayApi.enabled" . | eq "true" -}}
{{- if and $ingressEnabled $gatewayEnabled -}}
{{- true -}}
{{- else -}}
{{- false -}}
{{- end -}}
{{- end }}

{{/*
Determine if ingress should be rendered - enabled when ingress.enabled is true AND gatewayApi is NOT enabled
*/}}
{{- define "backstage-plugin-agent-forge.ingress.shouldRender" -}}
{{- $ingressEnabled := include "backstage-plugin-agent-forge.ingress.enabled" . | eq "true" -}}
{{- $gatewayEnabled := include "backstage-plugin-agent-forge.gatewayApi.enabled" . | eq "true" -}}
{{- if and $ingressEnabled (not $gatewayEnabled) -}}
{{- true -}}
{{- else -}}
{{- false -}}
{{- end -}}
{{- end }}
