{{- define "supervisorAgent.deployment" -}}
{{- $root := .root -}}
{{- $profileName := .profileName -}}
{{- $profile := .profile -}}
{{- $isProfile := ne $profileName "" -}}
{{- $fullName := include "supervisorAgent.fullname" $root -}}
{{- $name := ternary (printf "%s-%s" $fullName $profileName) $fullName $isProfile -}}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ $name }}
  labels:
    {{- include "supervisorAgent.labels" $root | nindent 4 }}
    {{- if $isProfile }}
    app.kubernetes.io/profile: {{ $profileName }}
    {{- end }}
spec:
  {{- if not $root.Values.autoscaling.enabled }}
  replicas: {{ if and $isProfile $profile }}{{ default $root.Values.replicaCount $profile.replicaCount }}{{ else }}{{ $root.Values.replicaCount }}{{ end }}
  {{- end }}
  revisionHistoryLimit: {{ $root.Values.revisionHistoryLimit }}
  selector:
    matchLabels:
      {{- include "supervisorAgent.selectorLabels" $root | nindent 6 }}
      {{- if $isProfile }}
      app.kubernetes.io/profile: {{ $profileName }}
      {{- end }}
  template:
    metadata:
      {{- with $root.Values.podAnnotations }}
      annotations:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      labels:
        {{- include "supervisorAgent.labels" $root | nindent 8 }}
        {{- if $isProfile }}
        app.kubernetes.io/profile: {{ $profileName }}
        {{- end }}
        {{- with $root.Values.podLabels }}
        {{- toYaml . | nindent 8 }}
        {{- end }}
    spec:
      {{- with $root.Values.imagePullSecrets }}
      imagePullSecrets:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      serviceAccountName: {{ include "supervisorAgent.serviceAccountName" $root }}
      {{- with $root.Values.podSecurityContext }}
      securityContext:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      containers:
        - name: {{ $root.Chart.Name }}
          {{- with $root.Values.securityContext }}
          securityContext:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          image: "{{ $root.Values.image.repository }}:{{ $root.Values.image.tag | default $root.Chart.AppVersion }}"
          imagePullPolicy: {{ $root.Values.image.pullPolicy }}
          {{- if $root.Values.image.command }}
          command:
            {{- range $root.Values.image.command }}
            - {{ . | quote }}
            {{- end }}
          {{- end }}
          {{- if $root.Values.image.args }}
          args:
            {{- range $root.Values.image.args }}
            - {{ . | quote }}
            {{- end }}
          {{- end }}
          ports:
            {{- if $root.Values.service.ports }}
            {{- range $root.Values.service.ports }}
            - name: {{ .name }}
              containerPort: {{ .port }}
              protocol: {{ .protocol | default "TCP" }}
            {{- end }}
            {{- else }}
            - name: http
              containerPort: {{ $root.Values.service.port }}
              protocol: TCP
            {{- end }}
          envFrom:
            {{- $llmSecretName := include "supervisorAgent.llmSecrets.secretName" $root | trim -}}
            {{- if $llmSecretName }}
            - secretRef:
                name: {{ $llmSecretName }}
            {{- end }}
            {{- $deploymentMode := "single-node" }}
            {{- if and $root.Values.global $root.Values.global.deploymentMode }}
            {{- $deploymentMode = $root.Values.global.deploymentMode }}
            {{- end }}
            {{- if eq $deploymentMode "multi-agent" }}
            - configMapRef:
                name: {{ printf "%s-supervisor-agent-env" $root.Release.Name }}
            {{- end }}
          env:
            - name: AGENT_PROTOCOL
              value: {{ $root.Values.multiAgentConfig.protocol | quote }}
            - name: METRICS_ENABLED
              value: {{ include "supervisorAgent.metrics.enabled" $root | quote }}
            {{- if $isProfile }}
            {{- /* Profile: inherit base env EXCEPT OAUTH2_CLIENT_ID and DISABLED_AGENTS */ -}}
            {{- range $key, $value := $root.Values.env }}
            {{- if and (ne $key "OAUTH2_CLIENT_ID") (ne $key "DISABLED_AGENTS") }}
            - name: {{ $key }}
              value: {{ $value | quote }}
            {{- end }}
            {{- end }}
            - name: OAUTH2_CLIENT_ID
              value: {{ $profile.clientId | quote }}
            {{- if $profile.disabledAgents }}
            - name: DISABLED_AGENTS
              value: {{ $profile.disabledAgents | quote }}
            {{- end }}
            {{- range $key, $value := $profile.env }}
            - name: {{ $key }}
              value: {{ $value | quote }}
            {{- end }}
            {{- else }}
            {{- /* Default: use env as-is */ -}}
            {{- if $root.Values.env }}
            {{- range $key, $value := $root.Values.env }}
            - name: {{ $key }}
              value: {{ $value | quote }}
            {{- end }}
            {{- end }}
            {{- end }}
            {{- if eq (include "supervisorAgent.slim.enabled" $root) "true" }}
            - name: A2A_TRANSPORT
              value: {{ include "supervisorAgent.slim.transport" $root | quote }}
            - name: SLIM_ENDPOINT
              value: {{ include "supervisorAgent.slim.endpoint" $root | quote }}
            {{- end }}
          {{- if not (eq (include "supervisorAgent.slim.enabled" $root) "true") }}
          {{- with $root.Values.livenessProbe }}
          livenessProbe:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          {{- with $root.Values.readinessProbe }}
          readinessProbe:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          {{- end }}
          {{- $resources := $root.Values.resources }}
          {{- if and $isProfile $profile $profile.resources }}
          {{- $resources = $profile.resources }}
          {{- end }}
          {{- with $resources }}
          resources:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          volumeMounts:
            - name: prompt-config
              mountPath: /app/prompt_config.yaml
              subPath: prompt_config.yaml
              readOnly: true
            - name: prompt-config-rag
              mountPath: /app/prompt_config.rag.yaml
              subPath: prompt_config.rag.yaml
              readOnly: true
            - name: task-config
              mountPath: /app/task_config.yaml
              subPath: task_config.yaml
              readOnly: true
            {{- with $root.Values.volumeMounts }}
            {{- toYaml . | nindent 12 }}
            {{- end }}
      volumes:
        - name: prompt-config
          configMap:
            name: {{ if and $isProfile $profile $profile.promptConfigName }}{{ $profile.promptConfigName }}{{ else }}prompt-config{{ end }}
        - name: prompt-config-rag
          configMap:
            name: prompt-config-rag
        - name: task-config
          configMap:
            name: task-config
        {{- with $root.Values.volumes }}
        {{- toYaml . | nindent 8 }}
        {{- end }}
      {{- with $root.Values.nodeSelector }}
      nodeSelector:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with $root.Values.affinity }}
      affinity:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with $root.Values.tolerations }}
      tolerations:
        {{- toYaml . | nindent 8 }}
      {{- end }}
{{- end -}}
