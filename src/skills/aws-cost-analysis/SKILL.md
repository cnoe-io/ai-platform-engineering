---
name: aws-cost-analysis
description: Analyze AWS costs by service, account, and time period. Identifies top spenders, cost anomalies, and optimization opportunities. Use when reviewing cloud spend, preparing cost reports, or investigating unexpected charges.
---

# AWS Cost Analysis

Query AWS Cost Explorer data to break down spending by service, identify trends, detect anomalies, and recommend cost optimization actions.

## Instructions

### Phase 1: Cost Breakdown
1. **Fetch cost data** using the AWS agent's Cost Explorer tools:
   - Total spend for the requested period (default: last 30 days)
   - Breakdown by AWS service (EC2, EKS, S3, RDS, Lambda, etc.)
   - Breakdown by account (if multi-account)
   - Daily/weekly cost trends
2. **Calculate key metrics**:
   - Month-over-month change (absolute and percentage)
   - Top 5 most expensive services
   - Top 5 fastest-growing services (by percentage increase)

### Phase 2: Anomaly Detection
1. **Identify cost anomalies**:
   - Services with >20% cost increase vs. previous period
   - Sudden spikes in daily spend
   - New services that appeared this period
   - Unused resources still incurring charges
2. **Flag potential waste**:
   - Idle EC2 instances (low CPU utilization)
   - Unattached EBS volumes
   - Old snapshots and AMIs
   - Underutilized RDS instances
   - NAT Gateway data transfer costs

### Phase 3: Optimization Recommendations
Provide actionable recommendations with estimated savings:
- Reserved Instances or Savings Plans opportunities
- Right-sizing overprovisioned resources
- Storage tier optimization (S3 lifecycle policies)
- Spot Instance candidates for non-critical workloads
- Cleanup of orphaned resources

## Output Format

```markdown
## AWS Cost Analysis Report
**Period**: Feb 1 - Feb 9, 2026 | **Total Spend**: $24,567.89

### Cost Trend
| Week | Spend | Change |
|------|-------|--------|
| Jan 27 - Feb 2 | $5,890 | baseline |
| Feb 3 - Feb 9 | $6,234 | +5.8% |

### Top 5 Services by Cost
| Service | Cost | % of Total | MoM Change |
|---------|------|------------|------------|
| Amazon EKS | $8,234 | 33.5% | +12% |
| Amazon EC2 | $6,789 | 27.6% | -3% |
| Amazon S3 | $3,456 | 14.1% | +2% |
| Amazon RDS | $2,345 | 9.5% | +0% |
| AWS Lambda | $1,234 | 5.0% | +45% |

### Anomalies Detected
1. **Lambda costs up 45%** - New function `data-pipeline-processor` deployed Feb 3
2. **EKS costs up 12%** - Node group scaled from 5 to 8 nodes

### Optimization Opportunities
| Recommendation | Estimated Monthly Savings |
|---------------|--------------------------|
| Right-size 3 oversized EC2 instances | $450/mo |
| Purchase EKS Savings Plan | $1,200/mo |
| Delete 12 unattached EBS volumes | $180/mo |
| **Total Potential Savings** | **$1,830/mo** |
```

## Examples

- "Show me the AWS cost breakdown for the last month"
- "What are our top 5 most expensive AWS services?"
- "Are there any cost anomalies this month?"
- "How can we reduce our AWS spend?"
- "Compare this month's AWS costs to last month"

## Guidelines

- Default to last 30 days if no time period is specified
- Always show both absolute costs and percentage of total
- Include month-over-month comparison for context
- Round costs to 2 decimal places for totals, whole dollars for individual services
- When costs exceed expectations, investigate the root cause before recommending action
- Be specific in optimization recommendations (name the resource, not just the category)
- Distinguish between one-time spikes and sustained cost increases
