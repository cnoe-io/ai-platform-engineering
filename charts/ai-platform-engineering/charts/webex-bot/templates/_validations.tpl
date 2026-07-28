{{/* Validate deployment-managed Webex bot identities and per-bot policies. */}}
{{- define "webex-bot.validate.bots" -}}
{{- $ids := dict -}}
{{- range $index, $bot := .Values.bots | default list -}}
{{- if not (kindIs "map" $bot) -}}
{{- fail (printf "webex-bot.bots[%d] must be an object" $index) -}}
{{- end -}}
{{- if or (hasKey $bot "token") (hasKey $bot "accessToken") -}}
{{- fail (printf "webex-bot.bots[%d] must use tokenEnv; inline tokens are forbidden" $index) -}}
{{- end -}}
{{- $id := required (printf "webex-bot.bots[%d].id is required" $index) $bot.id -}}
{{- if not (regexMatch "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" $id) -}}
{{- fail (printf "webex-bot.bots[%d].id is invalid" $index) -}}
{{- end -}}
{{- if hasKey $ids $id -}}
{{- fail (printf "duplicate webex-bot bot id: %s" $id) -}}
{{- end -}}
{{- $_ := set $ids $id true -}}
{{- $_ := required (printf "webex-bot.bots[%d].name is required" $index) $bot.name -}}
{{- $tokenEnv := required (printf "webex-bot.bots[%d].tokenEnv is required" $index) $bot.tokenEnv -}}
{{- if not (regexMatch "^[A-Za-z_][A-Za-z0-9_]*$" $tokenEnv) -}}
{{- fail (printf "webex-bot.bots[%d].tokenEnv is invalid" $index) -}}
{{- end -}}

{{- if not (kindIs "map" $bot.spaces) -}}
{{- fail (printf "webex-bot.bots[%d].spaces must be an object" $index) -}}
{{- end -}}
{{- $spaceMode := required (printf "webex-bot.bots[%d].spaces.accessMode is required" $index) $bot.spaces.accessMode -}}
{{- if not (has $spaceMode (list "disabled" "allowlist" "all_spaces")) -}}
{{- fail (printf "webex-bot.bots[%d].spaces.accessMode must be disabled, allowlist, or all_spaces" $index) -}}
{{- end -}}
{{- if hasKey $bot.spaces "defaultTeamSlug" -}}
{{- if not (regexMatch "^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$" (toString $bot.spaces.defaultTeamSlug)) -}}
{{- fail (printf "webex-bot.bots[%d].spaces.defaultTeamSlug is invalid" $index) -}}
{{- end -}}
{{- end -}}
{{- if hasKey $bot.spaces "defaultAgentId" -}}
{{- if not (regexMatch "^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$" (toString $bot.spaces.defaultAgentId)) -}}
{{- fail (printf "webex-bot.bots[%d].spaces.defaultAgentId is invalid" $index) -}}
{{- end -}}
{{- end -}}
{{- if eq $spaceMode "all_spaces" -}}
{{- $_ := required (printf "webex-bot.bots[%d].spaces.defaultTeamSlug is required for all_spaces" $index) $bot.spaces.defaultTeamSlug -}}
{{- $_ := required (printf "webex-bot.bots[%d].spaces.defaultAgentId is required for all_spaces" $index) $bot.spaces.defaultAgentId -}}
{{- end -}}

{{- if not (kindIs "map" $bot.directMessages) -}}
{{- fail (printf "webex-bot.bots[%d].directMessages must be an object" $index) -}}
{{- end -}}
{{- $dmMode := required (printf "webex-bot.bots[%d].directMessages.accessMode is required" $index) $bot.directMessages.accessMode -}}
{{- if not (has $dmMode (list "disabled" "allowlist" "all_users")) -}}
{{- fail (printf "webex-bot.bots[%d].directMessages.accessMode must be disabled, allowlist, or all_users" $index) -}}
{{- end -}}
{{- if hasKey $bot.directMessages "defaultAgentId" -}}
{{- if not (regexMatch "^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$" (toString $bot.directMessages.defaultAgentId)) -}}
{{- fail (printf "webex-bot.bots[%d].directMessages.defaultAgentId is invalid" $index) -}}
{{- end -}}
{{- end -}}
{{- if eq $dmMode "all_users" -}}
{{- $_ := required (printf "webex-bot.bots[%d].directMessages.defaultAgentId is required for all_users" $index) $bot.directMessages.defaultAgentId -}}
{{- end -}}
{{- end -}}
{{- end -}}
