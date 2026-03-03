{{- define "supervisorAgent.service" -}}
{{- $root := .root -}}
{{- $profileName := .profileName -}}
{{- $isProfile := ne $profileName "" -}}
{{- $fullName := include "supervisorAgent.fullname" $root -}}
{{- $name := ternary (printf "%s-%s" $fullName $profileName) $fullName $isProfile -}}
apiVersion: v1
kind: Service
metadata:
  name: {{ $name }}
  labels:
    {{- include "supervisorAgent.labels" $root | nindent 4 }}
    {{- if $isProfile }}
    app.kubernetes.io/profile: {{ $profileName }}
    {{- end }}
spec:
  type: {{ $root.Values.service.type }}
  ports:
    {{- if $root.Values.service.ports }}
    {{- range $root.Values.service.ports }}
    - port: {{ .port }}
      targetPort: {{ .name }}
      protocol: {{ .protocol | default "TCP" }}
      name: {{ .name }}
    {{- end }}
    {{- else }}
    - port: {{ $root.Values.service.port }}
      targetPort: http
      protocol: TCP
      name: http
    {{- end }}
  selector:
    {{- include "supervisorAgent.selectorLabels" $root | nindent 4 }}
    {{- if $isProfile }}
    app.kubernetes.io/profile: {{ $profileName }}
    {{- end }}
{{- end -}}
