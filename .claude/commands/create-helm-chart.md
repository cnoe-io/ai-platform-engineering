<!-- caipe-skill: claude/create-helm-chart -->
---
name: create-helm-chart
description: >
  Creates a Helm chart for a service following Outshift conventions. Use when a
  user asks to create a Helm chart, add Kubernetes deployment manifests, or set
  up deploy/charts/ for a new service. Reference implementations:
  cisco-eti/platform-demo (Python), cisco-eti/sre-go-helloworld (Go).
---

# Create Helm Chart

Generate a production-ready Helm chart under `deploy/charts/<service-name>/`
following Outshift conventions. Includes Deployment, Service, Ingress, HPA,
PDB, Namespace, ConfigMap, and ServiceMonitor.

References:
- Python: `cisco-eti/platform-demo/deploy/charts/platform-demo/`
- Go: `cisco-eti/sre-go-helloworld/deploy/charts/sre-go-helloworld/`

---

## Process

### Step 1 — Gather requirements

Ask the user:
1. **Service name**: e.g. `my-service` (used as chart name and release name)
2. **App port**: e.g. `5000` (Python) or `9010` (Go)
3. **Metrics port**: e.g. `5001` (Python) or `9020` (Go), or none
4. **Namespace**: e.g. `my-service-dev` (set in deployment repo, not chart)
5. **Ingress**: Needed? Internal (`nginx-internal`) or external (`nginx`)?
6. **HPA**: Horizontal Pod Autoscaler needed?
7. **PDB**: Pod Disruption Budget? (recommended for prod services)
8. **Image registry**: ECR prefix e.g. `626007623524.dkr.ecr.us-east-2.amazonaws.com/eti-sre`
9. **Health check paths**: liveness/readiness endpoints (e.g. `/healthz`, `/ping`)
10. **ExternalSecrets**: Vault-backed secrets needed?

### Step 2 — Generate the chart

Create the directory structure below and fill each template.

### Step 3 — Verify

```bash
helm lint deploy/charts/<service-name>/
helm template <service-name> deploy/charts/<service-name>/ --debug
```

---

## Directory Structure

```
deploy/charts/<service-name>/
├── Chart.yaml
├── values.yaml
└── templates/
    ├── namespace.yaml
    ├── configmap.yaml
    ├── deployment.yaml
    ├── service.yaml
    ├── ingress.yaml          (if needed)
    ├── hpa.yaml              (if needed)
    ├── poddisruptionbudget.yaml
    ├── servicemonitor.yaml   (Prometheus)
    └── policies.yaml         (image signature verification)
```

---

## `Chart.yaml`

```yaml
apiVersion: v1
appVersion: "1.0.0"
description: <Service description>
name: <service-name>
version: "1.0.0"
```

---

## `values.yaml`

Key fields — all environment-specific values are set to `SET_IN_DEPLOYMENT_REPO`
so the chart is environment-agnostic:

```yaml
imageSignatureVerification: false

deployment:
  annotations:
    reloader.stakater.com/auto: "true"
  imagePullSecrets:
    - name: regcred

ingress:
  apiVersion: networking.k8s.io/v1
  ingressClassName: nginx-internal
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
    cert-manager.io/cluster-issuer: letsencrypt

serviceName: <service-name>
dockerPreamable: 626007623524.dkr.ecr.us-east-2.amazonaws.com/eti-sre
servicePort: "8080"
metricsPort: "8081"

securityContext:
  allowPrivilegeEscalation: false
  runAsUser: 1001
  readOnlyRootFilesystem: true
  runAsNonRoot: true
  capabilities:
    drop: ["ALL"]
  seccompProfile:
    type: "RuntimeDefault"

livenessProbe:
  httpGet:
    path: /healthz
    port: 8080
  initialDelaySeconds: 15
  periodSeconds: 10
  failureThreshold: 1
  successThreshold: 1
  timeoutSeconds: 1

readinessProbe:
  httpGet:
    path: /healthz
    port: 8080
  initialDelaySeconds: 15
  periodSeconds: 5
  timeoutSeconds: 1
  failureThreshold: 1
  successThreshold: 1

startupProbe: {}

configmap:
  LOG_LEVEL: "INFO"
  SERVICE_NAME: "<service-name>"

podDisruptionBudget:
  enabled: true
  minAvailable: 1

grafana:
  folderName: applications
  appInstance: kube-prometheus-stack
  appName: grafana
  sidecar:
    dashboards:
      label: "grafana_dashboard"

# Set in deployment repo — do not hardcode here
namespace: SET_IN_DEPLOYMENT_REPO
tagversion: SET_IN_DEPLOYMENT_REPO
dimage: SET_IN_DEPLOYMENT_REPO
domainName: SET_IN_DEPLOYMENT_REPO
replicas: 2
```

---

## `templates/namespace.yaml`

```yaml
{{- if .Values.namespace }}
apiVersion: v1
kind: Namespace
metadata:
  name: {{ .Values.namespace }}
  labels:
    {{- if .Values.imageSignatureVerification }}
    policy.sigstore.dev/include: "true"
    {{- end }}
    pod-security.kubernetes.io/enforce: "restricted"
{{- end }}
```

---

## `templates/configmap.yaml`

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ .Release.Name }}-configmap
data:
  APPLICATION_VERSION: {{ .Values.tagversion }}
  {{- range $key, $value := .Values.configmap }}
  {{ $key }}: {{ $value | quote }}
  {{- end }}
```

---

## `templates/deployment.yaml`

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ .Release.Name }}
  namespace: {{ .Values.namespace }}
  {{- with .Values.deployment.annotations }}
  annotations: {{ toYaml . | nindent 4 }}
  {{- end }}
spec:
  {{- if not .Values.autoscaling }}
  replicas: {{ .Values.replicas }}
  {{- end }}
  selector:
    matchLabels:
      app: {{ .Release.Name }}
  template:
    metadata:
      labels:
        app: {{ .Release.Name }}
      annotations:
        checksum/config: {{ include (print $.Template.BasePath "/configmap.yaml") . | sha256sum }}
        prometheus.io/scrape: "true"
        prometheus.io/port: "{{ .Values.metricsPort }}"
        prometheus.io/path: "/metrics"
    spec:
      containers:
      - name: {{ .Release.Name }}
        image: "{{ .Values.dockerPreamable }}/{{ .Values.dimage }}:{{ .Values.tagversion }}"
        {{- with .Values.securityContext }}
        securityContext: {{ toYaml . | nindent 10 }}
        {{- end }}
        ports:
        - containerPort: {{ .Values.servicePort }}
        {{- with .Values.livenessProbe }}
        livenessProbe: {{ toYaml . | nindent 10 }}
        {{- end }}
        {{- with .Values.readinessProbe }}
        readinessProbe: {{ toYaml . | nindent 10 }}
        {{- end }}
        {{- with .Values.startupProbe }}
        startupProbe: {{ toYaml . | nindent 10 }}
        {{- end }}
        envFrom:
        - configMapRef:
            name: {{ .Release.Name }}-configmap
        resources:
          {{- toYaml .Values.resources | nindent 12 }}
      {{- with .Values.deployment.imagePullSecrets }}
      imagePullSecrets: {{- toYaml . | nindent 8 }}
      {{- end }}
```

---

## `templates/service.yaml`

```yaml
apiVersion: v1
kind: Service
metadata:
  name: {{ .Release.Name }}
  namespace: {{ .Values.namespace }}
  labels:
    app.kubernetes.io/name: {{ .Release.Name }}
    tier: backend
spec:
  ports:
  - name: http
    protocol: TCP
    port: {{ .Values.servicePort }}
    targetPort: {{ .Values.servicePort }}
  {{- if .Values.metricsPort }}
  - name: metrics
    protocol: TCP
    port: {{ .Values.metricsPort }}
    targetPort: {{ .Values.metricsPort }}
  {{- end }}
  type: ClusterIP
  selector:
    app: {{ .Release.Name }}
```

---

## `templates/ingress.yaml`

```yaml
apiVersion: {{ .Values.ingress.apiVersion }}
kind: Ingress
metadata:
  name: {{ .Release.Name }}
  namespace: {{ .Values.namespace }}
  {{- if .Values.ingress.annotations }}
  annotations:
    {{- range $key, $value := .Values.ingress.annotations }}
    {{ $key }}: {{ tpl $value $ | quote }}
    {{- end }}
  {{- end }}
spec:
  ingressClassName: {{ .Values.ingress.ingressClassName }}
  tls:
  - hosts:
    - {{ .Values.serviceName }}.{{ .Values.domainName }}
    secretName: "{{ .Release.Name }}-tls"
  rules:
  - host: {{ .Values.serviceName }}.{{ .Values.domainName }}
    http:
      paths:
      - backend:
          service:
            name: {{ .Release.Name }}
            port:
              number: {{ .Values.servicePort }}
        pathType: Prefix
        path: /
```

---

## `templates/hpa.yaml`

```yaml
{{- if .Values.autoscaling }}
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: {{ .Release.Name }}
  namespace: {{ .Values.namespace }}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: {{ .Release.Name }}
  minReplicas: {{ .Values.autoscaling.minReplicas }}
  maxReplicas: {{ .Values.autoscaling.maxReplicas }}
  metrics:
    {{- if .Values.autoscaling.targetCPUUtilizationPercentage }}
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: {{ .Values.autoscaling.targetCPUUtilizationPercentage }}
    {{- end }}
{{- end }}
```

---

## `templates/poddisruptionbudget.yaml`

```yaml
{{- if .Values.podDisruptionBudget.enabled }}
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: {{ .Release.Name }}
  namespace: {{ .Values.namespace }}
spec:
  minAvailable: {{ .Values.podDisruptionBudget.minAvailable }}
  selector:
    matchLabels:
      app: {{ .Release.Name }}
{{- end }}
```

---

## `templates/servicemonitor.yaml`

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  labels:
    app: {{ .Release.Name }}
  name: {{ .Release.Name }}
  namespace: {{ .Values.namespace }}
spec:
  endpoints:
    - port: metrics
  namespaceSelector:
    matchNames:
      - {{ .Values.namespace }}
  selector:
    matchLabels:
      app.kubernetes.io/name: {{ .Release.Name }}
```

---

## Key Conventions

| Rule | Detail |
|------|--------|
| Environment-specific values | Always `SET_IN_DEPLOYMENT_REPO` in chart `values.yaml` |
| `tagversion` | Set by CI via `deploy.yaml` in the deployment repo |
| `namespace` | Set per-env in deployment repo `values.yaml` |
| `dimage` | Image name without registry prefix |
| `dockerPreamable` | ECR registry prefix — set per-env in deployment repo |
| Security context | Always `runAsNonRoot: true`, `allowPrivilegeEscalation: false` |
| Pod security label | `pod-security.kubernetes.io/enforce: "restricted"` on namespace |
| PDB | Always enable for production services (`minAvailable: 1`) |
| Checksum annotation | Include on deployment to trigger rolling restarts on configmap changes |
| Helm chart path | `deploy/charts/<service-name>/` |

---

## CI/Helm Publish wiring

After generating the chart, ensure CI publishes it:

```yaml
  call-helm-publish:
    uses: cisco-eti/gh-reusable-workflows/.github/workflows/helm-publish.yaml@production
    with:
      runner-group: arc-runner-set
      enable-chartmuseum: true   # or enable-private-ecr: true
      chart-path: "deploy/charts/<service-name>"
```

---

## Checklist

- [ ] `Chart.yaml` with correct name and version
- [ ] `values.yaml` with all env-specific fields set to `SET_IN_DEPLOYMENT_REPO`
- [ ] All required templates created
- [ ] `securityContext` enforces non-root, no privilege escalation
- [ ] `podDisruptionBudget` enabled
- [ ] `serviceMonitor` for Prometheus scraping
- [ ] `helm lint deploy/charts/<service-name>/` passes
- [ ] `helm template` dry-run produces valid YAML
- [ ] CI `call-helm-publish` points at this chart path
