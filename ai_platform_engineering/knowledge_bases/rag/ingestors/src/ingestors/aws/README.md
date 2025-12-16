# AWS Ingestor

Ingests AWS resources as graph entities into the RAG system. Discovers and fetches resources across all regions using AWS APIs and the Resource Groups Tagging API.

## Supported Entity Types

- `AwsAccount` - AWS Account
- `AwsIamUser` - IAM Users
- `AwsEc2Instance` - EC2 Instances
- `AwsEc2Volume` - EBS Volumes
- `AwsEc2Natgateway` - NAT Gateways
- `AwsEc2Vpc` - VPCs
- `AwsEc2Subnet` - Subnets
- `AwsEc2SecurityGroup` - Security Groups
- `AwsEksCluster` - EKS Clusters
- `AwsS3Bucket` - S3 Buckets
- `AwsElasticloadbalancingLoadbalancer` - Load Balancers (ALB/NLB/CLB)
- `AwsRoute53Hostedzone` - Route53 Hosted Zones
- `AwsRdsDb` - RDS Database Instances
- `AwsLambdaFunction` - Lambda Functions
- `AwsDynamodbTable` - DynamoDB Tables

## Required Environment Variables

- `RAG_SERVER_URL` - URL of the RAG server (default: `http://localhost:9446`)
- AWS credentials must be configured via one of the following:
  - `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` environment variables
  - AWS credentials file (`~/.aws/credentials`)
  - IAM role (when running on EC2/ECS/EKS)

## Optional Environment Variables

- `AWS_REGION` or `AWS_DEFAULT_REGION` - AWS region for API calls (default: `us-east-2`)
- `RESOURCE_TYPES` - Comma-separated list of resource types to ingest (default: all supported types)
- `SYNC_INTERVAL` - Sync interval in seconds (default: `86400` = 24 hours)
- `INIT_DELAY_SECONDS` - Delay before first sync in seconds (default: `0`)
- `LOG_LEVEL` - Logging level (default: `INFO`)

## AWS Permissions Required

The AWS credentials must have the following IAM permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "tag:GetResources",
        "ec2:DescribeInstances",
        "ec2:DescribeVolumes",
        "ec2:DescribeNatGateways",
        "ec2:DescribeVpcs",
        "ec2:DescribeSubnets",
        "ec2:DescribeSecurityGroups",
        "ec2:DescribeRegions",
        "eks:DescribeCluster",
        "eks:ListClusters",
        "s3:ListAllMyBuckets",
        "s3:GetBucketEncryption",
        "s3:GetBucketTagging",
        "elasticloadbalancing:DescribeLoadBalancers",
        "route53:ListHostedZones",
        "route53:GetHostedZone",
        "rds:DescribeDBInstances",
        "lambda:ListFunctions",
        "lambda:GetFunction",
        "dynamodb:ListTables",
        "dynamodb:DescribeTable",
        "iam:ListUsers",
        "sts:GetCallerIdentity"
      ],
      "Resource": "*"
    }
  ]
}
```

## Running with Docker Compose

Make sure the RAG server is up and running before starting the ingestor.

### Basic usage

```bash
export RAG_SERVER_URL=http://host.docker.internal:9446 # Adjust based on your setup
export AWS_ACCESS_KEY_ID=<your-access-key>
export AWS_SECRET_ACCESS_KEY=<your-secret-key>
export AWS_REGION=us-east-1
docker compose --profile aws up --build aws_ingestor
```

### With resource type filtering

```bash
export RAG_SERVER_URL=http://host.docker.internal:9446
export AWS_ACCESS_KEY_ID=<your-access-key>
export AWS_SECRET_ACCESS_KEY=<your-secret-key>
export RESOURCE_TYPES=ec2:instance,s3:bucket,eks:cluster
docker compose --profile aws up --build aws_ingestor
```

## Resource Discovery

The ingestor uses two methods to discover AWS resources:

1. **AWS Resource Groups Tagging API**: For most resource types, uses the tagging API to efficiently discover resources across regions
2. **Service-Specific APIs**: For IAM users and some other resources, uses service-specific list APIs

### Regional vs Global Resources

- **Regional resources**: Fetched from all AWS regions (EC2, EKS, S3, RDS, Lambda, DynamoDB, etc.)
- **Global resources**: Fetched once from a single region (IAM users, Route53 hosted zones)

## Notes

The AWS ingestor:
- Automatically discovers all AWS regions and scans them for resources
- Creates an `AwsAccount` entity representing the AWS account
- Supports filtering by resource types to reduce data volume
- Handles both regional and global AWS services appropriately
- Uses the Resource Groups Tagging API for efficient resource discovery
- Includes resource metadata such as tags, encryption settings, and configurations
- Does not extract sensitive information (access keys, passwords, etc.)

## Supported Resource Types

You can filter which resources to ingest using the `RESOURCE_TYPES` environment variable. Available types:

- `iam:user` - IAM Users (global)
- `ec2:instance` - EC2 Instances (regional)
- `ec2:volume` - EBS Volumes (regional)
- `ec2:natgateway` - NAT Gateways (regional)
- `ec2:vpc` - VPCs (regional)
- `ec2:subnet` - Subnets (regional)
- `ec2:security-group` - Security Groups (regional)
- `eks:cluster` - EKS Clusters (regional)
- `s3:bucket` - S3 Buckets (regional)
- `elasticloadbalancing:loadbalancer` - Load Balancers (regional)
- `route53:hostedzone` - Route53 Hosted Zones (global)
- `rds:db` - RDS Instances (regional)
- `lambda:function` - Lambda Functions (regional)
- `dynamodb:table` - DynamoDB Tables (regional)

Example: `RESOURCE_TYPES=ec2:instance,s3:bucket,eks:cluster`

