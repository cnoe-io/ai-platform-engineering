{{/*
R3: Production-safety gate for `auth.rootPassword`.

Mirrors `keycloak.strictClientSecrets` semantically: when
`strictPasswords=true` AND `externalSecrets.enabled=false`, fail the
chart render at template time with a loud, actionable error if
`auth.rootPassword` is in the known-placeholder set.

This MUST be a render-time check (not an init-Job assertion like
keycloak.strictClientSecrets) because the K8s Secret is built directly
from `auth.rootPassword` in `templates/secret.yaml` — by the time
anything else runs, the placeholder is already on disk in etcd.

The placeholder list is intentionally narrow — common single-word
secrets that an operator would recognise on sight. We deliberately
DON'T include user-chosen-but-weak passwords (e.g. "Password1!") because
that's policy territory; this gate's job is to catch the specific
shipped-default-from-our-chart leak, not to enforce strength.

When `externalSecrets.enabled=true`, the in-cluster Secret comes from
the external store (Vault, AWS Secrets Manager, etc.) and the
`auth.rootPassword` value in the chart is irrelevant — so we skip the
check unconditionally in that case. An operator who points ESO at a
secret that itself contains "changeme" is already a different class
of problem.

The error message includes the exact value found so the operator can
immediately verify which override file they need to fix; we accept the
small leak because `helm template` output is local and the value is by
definition a well-known placeholder, not a secret.

assisted-by Claude:claude-opus-4-7
*/}}
{{- define "mongodb.assertStrictPasswords" -}}
  {{- if and .Values.strictPasswords (not .Values.externalSecrets.enabled) -}}
    {{- $password := toString .Values.auth.rootPassword -}}
    {{- /* The placeholder set. Adding to this is a one-way ratchet —
           never remove entries even if you think nobody used them. */ -}}
    {{- $placeholders := list
        "changeme"
        "change-me"
        "please-change-me"
        "admin"
        "password"
        "password123"
        "mongo"
        "mongodb"
        "root"
        "test"
        "dev"
        "development"
        "secret"
        "your-password-here"
        "replace-me"
    -}}
    {{- if has (lower $password) $placeholders -}}
      {{- fail (printf "\n\n  Chart-render REFUSED: caipe-ui-mongodb.auth.rootPassword is a known placeholder (%q).\n\n  R3 strict mode is enabled (strictPasswords=true) and externalSecrets.enabled=false,\n  so the in-cluster Secret would be built directly from this value.\n\n  Fix: either\n    (1) set `caipe-ui-mongodb.auth.rootPassword` to a CSPRNG value\n        (e.g. `openssl rand -base64 24`), OR\n    (2) set `caipe-ui-mongodb.externalSecrets.enabled=true` and point\n        ESO at your secret store.\n\n  Override to bypass for a throwaway dev cluster:\n    set `caipe-ui-mongodb.strictPasswords=false` (chart default)\n\n  See docs/docs/security/rbac/secrets-bootstrap.md section\n    \"R3: MongoDB rootPassword strict mode\".\n" $password) -}}
    {{- end -}}
    {{- /* Length floor — same 8-char minimum we use everywhere else;
           intentionally generous so we don't break legitimate-but-short
           rotation secrets, but catches `mongo` and similar typos. */ -}}
    {{- if lt (len $password) 8 -}}
      {{- fail (printf "\n\n  Chart-render REFUSED: caipe-ui-mongodb.auth.rootPassword is too short (%d chars; minimum 8 in strict mode).\n\n  Generate a real secret with `openssl rand -base64 24` and re-render.\n  See docs/docs/security/rbac/secrets-bootstrap.md section \"R3: MongoDB rootPassword strict mode\".\n" (len $password)) -}}
    {{- end -}}
  {{- end -}}
{{- end -}}
