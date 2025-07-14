# Run with EKS ⎈ ⛅

[Amazon EKS (Elastic Kubernetes Service)](https://aws.amazon.com/eks/) is a managed Kubernetes service that runs on AWS. Using `eksctl` makes it easy to create and manage EKS clusters with best practices built-in.

## Prerequisites

- [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) installed and configured
- [eksctl](https://eksctl.io/installation/) installed
- [kubectl](https://kubernetes.io/docs/tasks/tools/) installed
- [Helm](https://helm.sh/docs/intro/install/) installed
- AWS account with appropriate permissions

### Required AWS Permissions

Your AWS user/role needs permissions for:
- EC2 (instances, VPC, security groups)
- EKS (cluster management)
- CloudFormation (stack creation)
- IAM (service roles)

## Section Outline

1. Create an EKS Cluster
2. Deploy local ArgoCD
3. Deploy AI Platform Engineering Agents

## Create an EKS Cluster
### Step 1: Configure AWS Credentials

```bash
# Configure AWS CLI
aws configure

# Verify credentials
aws sts get-caller-identity

# Set your preferred region (optional)
export AWS_DEFAULT_REGION=us-east-2
```

### Step 2: Prepare EKS Cluster Configuration

Create your cluster configuration file:

```bash
cp deploy/eks/dev-eks-cluster-config.yaml.example dev-eks-cluster-config.yaml
```
and modify any fields as needed.

### Step 3: Create the EKS Cluster using `eksctl`

```bash
# Create the cluster (this takes 10-15 minutes)
eksctl create cluster -f dev-eks-cluster-config.yaml
```
This command will:
* Create VPC and subnets
* Set up EKS control plane
* Launch EC2 worker nodes
* Configure kubectl context
* Install essential add-ons

### Step 4: Verify Cluster

```bash
# Check cluster status
eksctl get cluster

# Verify nodes are ready
kubectl get nodes

# Check cluster info
kubectl cluster-info

# Verify add-ons are installed
eksctl get addons --cluster dev-eks-cluster

# Check system pods
kubectl get pods -n kube-system
```

## Deploy local ArgoCD

Deploy a local ArgoCD instance in your EKS cluster to manage the installation of the `ai-platform-engineering` Helm chart. ArgoCD enables automated synchronization of your application manifests, making it easy to keep your cluster state in sync with your configuration. By leveraging ArgoCD’s auto-sync feature, you can streamline future updates and ensure continuous delivery for your platform components.

First, install ArgoCD on your cluster:
```bash
# Create a new namespace for ArgoCD
kubectl create namespace argocd
# Download the ArgoCD manifest and install on the cluster
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
```

Now you can port-forward the deployed ArgoCD server:
```bash
kubectl port-forward svc/argocd-server -n argocd 8080:443
```
View it on http://localhost:8080.

## Install AWS Load Balancer Controller (Recommended)

```bash
# Install AWS Load Balancer Controller for better ingress support
eksctl create iamserviceaccount \
  --cluster=dev-eks-cluster \
  --namespace=kube-system \
  --name=aws-load-balancer-controller \
  --role-name AmazonEKSLoadBalancerControllerRole \
  --attach-policy-arn=arn:aws:iam::aws:policy/ElasticLoadBalancingFullAccess \
  --approve

# Add the EKS chart repo
helm repo add eks https://aws.github.io/eks-charts
helm repo update

# Install the controller
helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system \
  --set clusterName=dev-eks-cluster \
  --set serviceAccount.create=false \
  --set serviceAccount.name=aws-load-balancer-controller

# Verify installation
kubectl get deployment -n kube-system aws-load-balancer-controller
```

## Troubleshooting

### Common Issues

**Insufficient permissions:**
```bash
# Check your AWS permissions
aws iam get-user
aws iam list-attached-user-policies --user-name YOUR_USERNAME
```

**Region mismatch:**
```bash
# Ensure AWS CLI region matches config file
aws configure get region
# Should match the region in dev-eks-cluster-config.yaml
```

**Node group creation fails:**
```bash
# Check CloudFormation events
aws cloudformation describe-stack-events --stack-name eksctl-dev-cluster-nodegroup-worker-nodes

# Check EC2 limits
aws ec2 describe-account-attributes --attribute-names supported-platforms
```

**kubectl context issues:**
```bash
# Update kubeconfig
aws eks update-kubeconfig --region us-east-2 --name dev-cluster

# Check current context
kubectl config current-context
```

## Cleanup

When you're done with the cluster:

```bash
# Delete the cluster (this will delete all resources)
eksctl delete cluster -f dev-eks-cluster-config.yaml

# Verify cleanup
aws cloudformation list-stacks --query 'StackSummaries[?contains(StackName, `eksctl-dev-cluster`)].{Name:StackName,Status:StackStatus}'
```

> **⚠️ Important**: Always clean up your EKS cluster when not in use to avoid unexpected AWS charges!
