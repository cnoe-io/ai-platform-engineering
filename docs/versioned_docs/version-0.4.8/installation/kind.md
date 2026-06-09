# Kind (Kubernetes in Docker)

To set up a Kubernetes cluster using Kind:

1. Install Kind:
  ```bash
  curl -Lo ./kind https://kind.sigs.k8s.io/dl/latest/kind-linux-amd64
  chmod +x ./kind
  mv ./kind /usr/local/bin/kind
  ```

2. Create a cluster:
  ```bash
  kind create cluster --name my-cluster
  ```

3. Verify the cluster is running:
  ```bash
  kubectl cluster-info --context kind-my-cluster
  ```