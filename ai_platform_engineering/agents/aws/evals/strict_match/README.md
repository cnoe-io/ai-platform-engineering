# AWS EKS Agent Evaluation

This directory contains evaluation tests for the AWS EKS Agent.

## Test Structure

- `strict_match_dataset.yaml`: Contains test cases with expected trajectories
- `test_strict_match.py`: Python test runner for evaluation

## Running Tests

```bash
# Run all evaluations
make test

# Run specific provider tests
make test-claude
make test-openai
make test-gemini
```

## Test Categories

### Basic Operations
- Cluster status queries
- Resource listing
- Pod management

### Application Deployment
- Creating deployments
- Scaling applications
- Service configuration

### Monitoring & Troubleshooting
- Log retrieval
- Metrics analysis
- Event monitoring

### Security & IAM
- Role management
- Policy configuration
- Access control
