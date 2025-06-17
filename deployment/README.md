# 🚀 Install AI Platform Engineer in Local Kind Cluster

This guide walks you through deploying the **AI Platform Engineer** multi-agent system to a **local Kubernetes cluster using [Kind](https://kind.sigs.k8s.io/)**. It mounts `.env` configuration files as Kubernetes Secrets in each agent container.

---

## 🧰 Prerequisites

### ✅ Install Kind (Kubernetes IN Docker)

```bash
brew install kind
```

### ✅ Create a Local Kubernetes Cluster

```bash
kind create cluster --name ai-platform-engineering
```

To verify:

```bash
kubectl cluster-info --context kind-ai-platform-engineering
```

---

## ✅ 1. Convert `.env` Files into Kubernetes Secrets

From your project directory, run:

```bash
kubectl create secret generic ai-platform-engineer-secret --from-file=.env=.env
kubectl create secret generic agent-argocd-secret --from-file=.env=.env.argocd
kubectl create secret generic agent-atlassian-secret --from-file=.env=.env.atlassian
kubectl create secret generic agent-github-secret --from-file=.env=.env.github
kubectl create secret generic agent-pagerduty-secret --from-file=.env=.env.pagerduty
kubectl create secret generic agent-slack-secret --from-file=.env=.env.slack
```

---

## ✅ 2. Mount Secrets as `.env` in Each Deployment

For every service deployment, include:

```yaml
      containers:
        - name: <container-name>
          image: <image-name>
          volumeMounts:
            - name: env-secret
              mountPath: /app/.env
              subPath: .env
      volumes:
        - name: env-secret
          secret:
            secretName: <corresponding-k8s-secret-name>
            items:
              - key: .env
                path: .env
```

---

## 🔧 Example: `ai-platform-engineer`

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ai-platform-engineer
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ai-platform-engineer
  template:
    metadata:
      labels:
        app: ai-platform-engineer
    spec:
      containers:
        - name: ai-platform-engineer
          image: ghcr.io/cnoe-io/ai-platform-engineering:latest
          command: ["platform-engineer"]
          ports:
            - containerPort: 5001
          env:
            - name: AGENT_PROTOCOL
              value: "fastapi"
          volumeMounts:
            - name: env-secret
              mountPath: /app/.env
              subPath: .env
      volumes:
        - name: env-secret
          secret:
            secretName: ai-platform-engineer-secret
            items:
              - key: .env
                path: .env
```

---

## ✅ 3. (Optional) Expose AI Platform Engineer with a Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: ai-platform-engineer
spec:
  selector:
    app: ai-platform-engineer
  ports:
    - protocol: TCP
      port: 8000
      targetPort: 5001
```

---

## ✅ 4. Apply All Manifests

```bash
kubectl apply -f kubernetes-stack-secrets.yaml
```

---

## ✅ 5. Access the Agent Locally

Port-forward the exposed service:

```bash
kubectl port-forward svc/ai-platform-engineer 8000:8000
```

Then open: [http://localhost:8000](http://localhost:8000)

---

## 🧠 Pro Tips

* Use `kubectl delete secret <name>` if you need to regenerate them.
* Use `kubectl get all` to confirm all agents are running.
* Avoid committing `.env` files to Git. Prefer `.gitignore` for security.