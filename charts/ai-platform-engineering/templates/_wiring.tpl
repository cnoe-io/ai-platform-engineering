{{/*
Release-scoped internal service URLs and feature gates for OpenFGA / RBAC stack.
See cnoe-io/ai-platform-engineering#2252.
*/}}

{{- define "ai-platform-engineering.openfga.enabled" -}}
{{- if hasKey .Values "openfga" -}}
{{- .Values.openfga.enabled | default false -}}
{{- else -}}
false
{{- end -}}
{{- end -}}

{{- define "ai-platform-engineering.agentgateway.enabled" -}}
{{- $top := .Values.agentgateway.enabled | default false -}}
{{- $global := dig "agentgateway" "enabled" false (.Values.global | default dict) -}}
{{- or $top $global -}}
{{- end -}}

{{- define "ai-platform-engineering.openfga.httpUrl" -}}
{{- printf "http://%s-openfga:8080" .Release.Name -}}
{{- end -}}

{{- define "ai-platform-engineering.caipeUi.clusterUrl" -}}
{{- printf "http://%s-caipe-ui:3000" .Release.Name -}}
{{- end -}}

{{- define "ai-platform-engineering.agentgateway.mcpUrl" -}}
{{- $agwStatic := eq (dig "agentgateway" "routingMode" "static" (.Values.global | default dict)) "static" -}}
{{- $host := ternary (printf "%s-agentgateway" .Release.Name) (printf "%s-agentgateway-proxy" .Release.Name) $agwStatic -}}
{{- $port := ternary 4000 (int (dig "agentgateway" "proxyPort" 8080 (.Values.global | default dict))) $agwStatic -}}
{{- printf "http://%s:%v" $host $port -}}
{{- end -}}

{{- define "ai-platform-engineering.openfga.storeName" -}}
{{- dig "openfga" "init" "storeName" "caipe-openfga" .Values -}}
{{- end -}}

{{/*
Fail helm template when RBAC/login bootstrap is enabled without OpenFGA.
Evaluated from the parent chart release context only.
*/}}
{{- define "ai-platform-engineering.validate.openfgaDependencies" -}}
{{- $openfgaOn := eq (include "ai-platform-engineering.openfga.enabled" .) "true" -}}
{{- $uiCfg := index .Values "caipe-ui" "config" | default dict -}}
{{- $identityOn := or (eq (toString (index $uiCfg "IDENTITY_SYNC_LOGIN_CLAIMS_ENABLED" | default "")) "true") (index $uiCfg "BOOTSTRAP_ADMIN_EMAILS" | default "") -}}
{{- if and (not $openfgaOn) $identityOn -}}
{{- fail "openfga.enabled must be true when caipe-ui.config sets BOOTSTRAP_ADMIN_EMAILS or IDENTITY_SYNC_LOGIN_CLAIMS_ENABLED=true (login-time OpenFGA reconcile required)" -}}
{{- end -}}
{{- $agwOn := eq (include "ai-platform-engineering.agentgateway.enabled" .) "true" -}}
{{- if and $agwOn (not $openfgaOn) -}}
{{- fail "agentgateway.enabled requires openfga.enabled (AgentGateway ext_authz uses OpenFGA PDP)" -}}
{{- end -}}
{{- end -}}
