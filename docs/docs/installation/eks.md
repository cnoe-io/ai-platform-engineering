# EKSCTL Installation Guide

## Prerequisites
Before installing `eksctl`, ensure the following:
- **AWS CLI** is installed and configured.
- **kubectl** is installed.
- **Git** is installed.

## Installation Steps

### 1. Install eksctl
#### Using Homebrew (macOS/Linux):
```bash
brew tap weaveworks/tap
brew install weaveworks/tap/eksctl
```

#### Using Binary Download:
1. Download the latest release:
  ```bash
  curl --silent --location "https://github.com/weaveworks/eksctl/releases/latest/download/eksctl_$(uname -s)_amd64.tar.gz" | tar xz -C /tmp
  ```
2. Move the binary to `/usr/local/bin`:
  ```bash
  sudo mv /tmp/eksctl /usr/local/bin
  ```

### 2. Verify Installation
Run the following command to verify:
```bash
eksctl version
```

### 3. Update eksctl (Optional)
To update `eksctl` to the latest version:
```bash
brew upgrade eksctl
```
Or re-download the binary using the steps above.

## Next Steps
- Refer to the [eksctl documentation](https://eksctl.io/) for cluster creation and management.
- Ensure your AWS credentials are properly configured.
