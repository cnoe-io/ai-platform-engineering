# GitLab Agent Strict Match Evaluation

This directory contains evaluation tests for the GitLab agent using strict trajectory matching.

## Overview

The strict match evaluation verifies that the agent follows expected execution paths when handling GitLab-related requests.

## Running Evaluations

```bash
# Run all evaluations
uv run evals/strict_match/strict_match.py

# Run specific test IDs
uv run evals/strict_match/strict_match.py --test_ids gitlab_agent_1,gitlab_agent_2
```

## Test Dataset

The test cases are defined in `strict_match_dataset.yaml` and cover common GitLab operations such as:
- Project management
- Merge request operations
- Issue management
- CI/CD pipeline status
