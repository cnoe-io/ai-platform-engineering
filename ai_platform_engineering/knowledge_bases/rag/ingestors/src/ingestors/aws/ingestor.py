import os
import time
import logging
import asyncio
import boto3
from typing import List, Any, Dict, Optional

from common.ingestor import IngestorBuilder, Client
from common.models.graph import Entity
from common.models.rag import DataSourceInfo
from common.job_manager import JobStatus
import common.utils as utils

"""
AWS Ingestor - Ingests AWS resources as graph entities into the RAG system.
Uses the IngestorBuilder pattern for simplified ingestor creation with automatic job management and batching.

Supported resource types:
- iam:user - IAM Users
- ec2:instance - EC2 Instances
- ec2:volume - EBS Volumes
- ec2:natgateway - NAT Gateways
- ec2:vpc - VPCs
- ec2:subnet - Subnets
- ec2:security-group - Security Groups
- eks:cluster - EKS Clusters
- s3:bucket - S3 Buckets
- elasticloadbalancing:loadbalancer - Load Balancers (ALB/NLB/CLB)
- route53:hostedzone - Route53 Hosted Zones
- rds:db - RDS Database Instances
- lambda:function - Lambda Functions
- dynamodb:table - DynamoDB Tables
"""

LOG_LEVEL = os.environ.get('LOG_LEVEL', 'INFO').upper()
logging.basicConfig(level=LOG_LEVEL)

# Configuration
SYNC_INTERVAL = int(os.getenv("SYNC_INTERVAL", 60 * 15))  # sync every 15 minutes by default
default_resource_types = 'iam:user,ec2:instance,ec2:volume,ec2:natgateway,ec2:vpc,ec2:subnet,ec2:security-group,eks:cluster,s3:bucket,elasticloadbalancing:loadbalancer,route53:hostedzone,rds:db,lambda:function,dynamodb:table'
RESOURCE_TYPES = os.environ.get('RESOURCE_TYPES', default_resource_types).split(',')
# AWS Region - check both AWS_REGION and AWS_DEFAULT_REGION (boto3 default)
AWS_REGION = os.environ.get('AWS_REGION') or os.environ.get('AWS_DEFAULT_REGION') or 'us-east-2'

# Resource type configuration - defines how to fetch and process each resource type
RESOURCE_CONFIG = {
    'ec2:instance': {
        'fetch_fn': 'get_ec2_details',
        'primary_key': ['Arn'],
        'additional_keys': [['InstanceId'], ['PrivateDnsName'], ['PrivateIpAddress'], ['PublicDnsName'], ['PublicIpAddress']],
        'regional': True
    },
    'eks:cluster': {
        'fetch_fn': 'get_eks_details',
        'primary_key': ['arn'],
        'additional_keys': [['name'], ['endpoint']],
        'regional': True
    },
    's3:bucket': {
        'fetch_fn': 'get_s3_details',
        'primary_key': ['Arn'],
        'additional_keys': [['BucketName']],
        'regional': True
    },
    'elasticloadbalancing:loadbalancer': {
        'fetch_fn': 'get_elb_details',
        'primary_key': ['LoadBalancerArn'],
        'additional_keys': [['LoadBalancerName'], ['DNSName']],
        'regional': True
    },
    'ec2:volume': {
        'fetch_fn': 'get_ebs_details',
        'primary_key': ['Arn'],
        'additional_keys': [['VolumeId']],
        'regional': True
    },
    'route53:hostedzone': {
        'fetch_fn': 'get_route53_hostedzone_details',
        'primary_key': ['Arn'],
        'additional_keys': [['ZoneId']],
        'regional': False  # Route53 is global
    },
    'iam:user': {
        'fetch_fn': 'list_iam_users',
        'primary_key': ['Arn'],
        'additional_keys': [['UserName'], ['UserId']],
        'regional': False  # IAM is global
    },
    'ec2:natgateway': {
        'fetch_fn': 'get_natgateway_details',
        'primary_key': ['Arn'],
        'additional_keys': [['NatGatewayId']],
        'regional': True
    },
    'ec2:vpc': {
        'fetch_fn': 'get_vpc_details',
        'primary_key': ['Arn'],
        'additional_keys': [['VpcId'], ['CidrBlock']],
        'regional': True
    },
    'ec2:subnet': {
        'fetch_fn': 'get_subnet_details',
        'primary_key': ['Arn'],
        'additional_keys': [['SubnetId'], ['CidrBlock']],
        'regional': True
    },
    'ec2:security-group': {
        'fetch_fn': 'get_security_group_details',
        'primary_key': ['Arn'],
        'additional_keys': [['GroupId'], ['GroupName']],
        'regional': True
    },
    'rds:db': {
        'fetch_fn': 'get_rds_details',
        'primary_key': ['DBInstanceArn'],
        'additional_keys': [['DBInstanceIdentifier'], ['Endpoint.Address']],
        'regional': True
    },
    'lambda:function': {
        'fetch_fn': 'get_lambda_details',
        'primary_key': ['FunctionArn'],
        'additional_keys': [['FunctionName']],
        'regional': True
    },
    'dynamodb:table': {
        'fetch_fn': 'get_dynamodb_details',
        'primary_key': ['TableArn'],
        'additional_keys': [['TableName']],
        'regional': True
    }
}


async def get_account_id() -> str:
    """Get AWS account ID"""
    client = boto3.client("sts", region_name=AWS_REGION)
    return client.get_caller_identity()["Account"]


async def get_all_regions() -> List[str]:
    """
    Fetch all AWS regions using the EC2 client.
    
    Returns:
        list: A list of all AWS regions.
    """
    ec2_client = boto3.client('ec2', region_name=AWS_REGION)
    try:
        response = ec2_client.describe_regions()
        regions = [region['RegionName'] for region in response['Regions']]
        return regions
    except Exception as e:
        logging.error(f"Error fetching regions: {e}")
        return []


async def fetch_resources(resource_type: str, region: str) -> List[str]:
    """
    Fetches the resource inventory for the specified resource types using tagging APIs.
    
    Parameters:
        resource_type (str): The type of AWS resource to fetch (e.g. 'ec2:instance', 's3:bucket', etc.).
        region (str): The AWS region to fetch resources from.
    
    Returns:
        List[str]: A list of ARNs for the specified resource type in the given region.
    """
    tagging_client = boto3.client('resourcegroupstaggingapi', region_name=region)
    paginator = tagging_client.get_paginator('get_resources')
    response_iterator = paginator.paginate(ResourceTypeFilters=[resource_type])

    resource_arns = []
    for page in response_iterator:
        for resource in page.get('ResourceTagMappingList', []):
            resource_arns.append(resource['ResourceARN'])

    return resource_arns


# ============================================================================
# Resource Detail Fetchers
# ============================================================================

async def get_ec2_details(resource_arns: List[str], region: str) -> List[Dict[str, Any]]:
    """Fetch details for EC2 instances given their ARNs."""
    if not resource_arns:
        return []
    
    ec2_client = boto3.client('ec2', region_name=region)
    instance_id_arn_map = {arn.split('/')[-1]: arn for arn in resource_arns}
    instance_ids = list(instance_id_arn_map.keys())

    try:
        response = ec2_client.describe_instances(InstanceIds=instance_ids)
        ec2_instances = []
        for reservation in response['Reservations']:
            for instance in reservation['Instances']:
                instance_id = instance['InstanceId']
                instance['Arn'] = instance_id_arn_map.get(instance_id, "")
                if not instance['Arn']:
                    logging.warning(f"No ARN found for instance {instance_id}")
                    continue
                ec2_instances.append(instance)
        return ec2_instances
    except Exception as e:
        logging.error(f"Error fetching EC2 instance details: {e}")
        return []


async def get_eks_details(resource_arns: List[str], region: str) -> List[Dict[str, Any]]:
    """Fetch details for EKS clusters given their ARNs."""
    if not resource_arns:
        return []
    
    eks_client = boto3.client('eks', region_name=region)
    cluster_names = [arn.split('/')[-1] for arn in resource_arns]

    clusters = []
    for cluster_name in cluster_names:
        logging.debug(f"Fetching details for EKS cluster: {cluster_name}")
        try:
            response = eks_client.describe_cluster(name=cluster_name)
            clusters.append(response['cluster'])
        except Exception as e:
            logging.error(f"Error fetching details for EKS cluster {cluster_name}: {e}")
    return clusters


async def get_s3_details(resource_arns: List[str], region: str) -> List[Dict[str, Any]]:
    """Fetch details for S3 buckets given their ARNs."""
    if not resource_arns:
        return []
    
    s3_client = boto3.client('s3', region_name=region)
    buckets = []
    
    for arn in resource_arns:
        bucket_name = arn.split(':::')[-1]
        if not bucket_name:
            continue
        
        logging.debug(f"Fetching details for S3 bucket: {bucket_name}")
        try:
            bucket_data = {
                "Arn": arn,
                "BucketName": bucket_name,
            }
            
            # Try to fetch encryption config
            try:
                bucket_data["Encryption"] = s3_client.get_bucket_encryption(
                    Bucket=bucket_name
                ).get('ServerSideEncryptionConfiguration', {})
            except s3_client.exceptions.ServerSideEncryptionConfigurationNotFoundError:
                bucket_data["Encryption"] = {}
            except Exception as e:
                logging.warning(f"Could not fetch encryption for bucket {bucket_name}: {e}")
            
            # Try to fetch tags
            try:
                bucket_data["Tagging"] = s3_client.get_bucket_tagging(
                    Bucket=bucket_name
                ).get('TagSet', [])
            except s3_client.exceptions.NoSuchTagSet:
                bucket_data["Tagging"] = []
            except Exception as e:
                logging.warning(f"Could not fetch tags for bucket {bucket_name}: {e}")
            
            buckets.append(bucket_data)
        except Exception as e:
            logging.error(f"Error fetching details for S3 bucket {bucket_name}: {e}")
    
    return buckets


async def get_elb_details(resource_arns: List[str], region: str) -> List[Dict[str, Any]]:
    """Fetch details for all Load Balancers (ALB/NLB/CLB) given their ARNs."""
    if not resource_arns:
        return []
    
    # Split ARNs into ELBv2 (ALB/NLB) and Classic Load Balancers
    elbv2_arns = [arn for arn in resource_arns if len(arn.split('loadbalancer/')[-1].split("/")) > 1]
    clb_arns = [arn for arn in resource_arns if len(arn.split('loadbalancer/')[-1].split("/")) == 1]
    
    elbs = []
    
    # Fetch ELBv2 details (ALB/NLB)
    if elbv2_arns:
        logging.debug(f"Fetching {len(elbv2_arns)} ALB/NLB in region {region}")
        try:
            elbv2_client = boto3.client('elbv2', region_name=region)
            response = elbv2_client.describe_load_balancers(LoadBalancerArns=elbv2_arns)
            for lb in response['LoadBalancers']:
                # Ensure LoadBalancerArn is present for consistency
                if 'LoadBalancerArn' not in lb:
                    lb['LoadBalancerArn'] = lb.get('Arn', '')
                elbs.append(lb)
        except Exception as e:
            logging.error(f"Error fetching ELBv2 details: {e}")
    
    # Fetch Classic Load Balancer details
    if clb_arns:
        logging.debug(f"Fetching {len(clb_arns)} Classic ELB in region {region}")
        try:
            elb_client = boto3.client('elb', region_name=region)
            lb_names = [arn.split('/')[-1] for arn in clb_arns]
            lb_name_arn_map = {name: arn for name, arn in zip(lb_names, clb_arns)}
            
            response = elb_client.describe_load_balancers(LoadBalancerNames=lb_names)
            for lb in response['LoadBalancerDescriptions']:
                lb_name = lb.get('LoadBalancerName', '')
                # Add ARN for consistency
                lb['LoadBalancerArn'] = lb_name_arn_map.get(lb_name, '')
                elbs.append(lb)
        except Exception as e:
            logging.error(f"Error fetching Classic Load Balancer details: {e}")
    
    return elbs


async def get_ebs_details(resource_arns: List[str], region: str) -> List[Dict[str, Any]]:
    """Fetch details for EBS volumes given their ARNs."""
    if not resource_arns:
        return []
    
    ec2_client = boto3.client('ec2', region_name=region)
    volume_id_arn_map = {arn.split('/')[-1]: arn for arn in resource_arns}
    volume_ids = list(volume_id_arn_map.keys())

    try:
        response = ec2_client.describe_volumes(VolumeIds=volume_ids)
        volumes = []
        for volume in response['Volumes']:
            volume['Arn'] = volume_id_arn_map[volume['VolumeId']]
            volumes.append(volume)
        return volumes
    except Exception as e:
        logging.error(f"Error fetching EBS volume details: {e}")
        return []


async def get_route53_hostedzone_details(resource_arns: List[str], region: str) -> List[Dict[str, Any]]:
    """Fetch details for Route 53 hosted zones given their ARNs."""
    if not resource_arns:
        return []
    
    route53_client = boto3.client('route53', region_name='us-east-1')  # Route53 is global
    zones = []
    
    for arn in resource_arns:
        hosted_zone_id = arn.split('/')[-1]
        if not hosted_zone_id:
            continue
        
        try:
            response = route53_client.get_hosted_zone(Id=hosted_zone_id)
            zone = response['HostedZone']
            zone['Arn'] = arn
            zone['ZoneId'] = hosted_zone_id
            zones.append(zone)
        except Exception as e:
            logging.error(f"Error fetching Route53 hosted zone {hosted_zone_id}: {e}")
    
    return zones


async def list_iam_users(resource_arns: Optional[List[str]] = None, region: Optional[str] = None) -> List[Dict[str, Any]]:
    """List all IAM users in the AWS account."""
    iam_client = boto3.client('iam')
    
    try:
        response = iam_client.list_users()
        users = response.get('Users', [])
        
        if not users:
            logging.info("No IAM users found in AWS account")
            return []
        
        return users
    except Exception as e:
        logging.error(f"Error listing IAM users: {e}")
        return []


async def get_natgateway_details(resource_arns: List[str], region: str) -> List[Dict[str, Any]]:
    """Fetch details for NAT Gateways given their ARNs."""
    if not resource_arns:
        return []
    
    ec2_client = boto3.client('ec2', region_name=region)
    natgateway_id_arn_map = {arn.split('/')[-1]: arn for arn in resource_arns}
    natgateway_ids = list(natgateway_id_arn_map.keys())

    try:
        response = ec2_client.describe_nat_gateways(NatGatewayIds=natgateway_ids)
        natgateways = []
        for natgateway in response['NatGateways']:
            natgateway['Arn'] = natgateway_id_arn_map[natgateway['NatGatewayId']]
            natgateways.append(natgateway)
        return natgateways
    except Exception as e:
        logging.error(f"Error fetching NAT Gateway details: {e}")
        return []


async def get_vpc_details(resource_arns: List[str], region: str) -> List[Dict[str, Any]]:
    """Fetch details for VPCs given their ARNs."""
    if not resource_arns:
        return []
    
    ec2_client = boto3.client('ec2', region_name=region)
    vpc_id_arn_map = {arn.split('/')[-1]: arn for arn in resource_arns}
    vpc_ids = list(vpc_id_arn_map.keys())

    try:
        response = ec2_client.describe_vpcs(VpcIds=vpc_ids)
        vpcs = []
        for vpc in response['Vpcs']:
            vpc['Arn'] = vpc_id_arn_map[vpc['VpcId']]
            vpcs.append(vpc)
        return vpcs
    except Exception as e:
        logging.error(f"Error fetching VPC details: {e}")
        return []


async def get_subnet_details(resource_arns: List[str], region: str) -> List[Dict[str, Any]]:
    """Fetch details for Subnets given their ARNs."""
    if not resource_arns:
        return []
    
    ec2_client = boto3.client('ec2', region_name=region)
    subnet_id_arn_map = {arn.split('/')[-1]: arn for arn in resource_arns}
    subnet_ids = list(subnet_id_arn_map.keys())

    try:
        response = ec2_client.describe_subnets(SubnetIds=subnet_ids)
        subnets = []
        for subnet in response['Subnets']:
            subnet['Arn'] = subnet_id_arn_map[subnet['SubnetId']]
            subnets.append(subnet)
        return subnets
    except Exception as e:
        logging.error(f"Error fetching Subnet details: {e}")
        return []


async def get_security_group_details(resource_arns: List[str], region: str) -> List[Dict[str, Any]]:
    """Fetch details for Security Groups given their ARNs."""
    if not resource_arns:
        return []
    
    ec2_client = boto3.client('ec2', region_name=region)
    sg_id_arn_map = {arn.split('/')[-1]: arn for arn in resource_arns}
    sg_ids = list(sg_id_arn_map.keys())

    try:
        response = ec2_client.describe_security_groups(GroupIds=sg_ids)
        security_groups = []
        for sg in response['SecurityGroups']:
            sg['Arn'] = sg_id_arn_map[sg['GroupId']]
            security_groups.append(sg)
        return security_groups
    except Exception as e:
        logging.error(f"Error fetching Security Group details: {e}")
        return []


async def get_rds_details(resource_arns: List[str], region: str) -> List[Dict[str, Any]]:
    """Fetch details for RDS Database Instances given their ARNs."""
    if not resource_arns:
        return []
    
    rds_client = boto3.client('rds', region_name=region)
    db_instance_ids = [arn.split(':')[-1] for arn in resource_arns]

    try:
        response = rds_client.describe_db_instances()
        db_instances = []
        for db in response['DBInstances']:
            if db['DBInstanceIdentifier'] in db_instance_ids:
                db_instances.append(db)
        return db_instances
    except Exception as e:
        logging.error(f"Error fetching RDS instance details: {e}")
        return []


async def get_lambda_details(resource_arns: List[str], region: str) -> List[Dict[str, Any]]:
    """Fetch details for Lambda functions given their ARNs."""
    if not resource_arns:
        return []
    
    lambda_client = boto3.client('lambda', region_name=region)
    function_names = [arn.split(':')[-1] for arn in resource_arns]

    functions = []
    for function_name in function_names:
        logging.debug(f"Fetching details for Lambda function: {function_name}")
        try:
            response = lambda_client.get_function(FunctionName=function_name)
            function_config = response.get('Configuration', {})
            if function_config:
                functions.append(function_config)
        except Exception as e:
            logging.error(f"Error fetching Lambda function {function_name}: {e}")
    
    return functions


async def get_dynamodb_details(resource_arns: List[str], region: str) -> List[Dict[str, Any]]:
    """Fetch details for DynamoDB tables given their ARNs."""
    if not resource_arns:
        return []
    
    dynamodb_client = boto3.client('dynamodb', region_name=region)
    table_names = [arn.split('/')[-1] for arn in resource_arns]

    tables = []
    for table_name in table_names:
        logging.debug(f"Fetching details for DynamoDB table: {table_name}")
        try:
            response = dynamodb_client.describe_table(TableName=table_name)
            table = response.get('Table', {})
            if table:
                tables.append(table)
        except Exception as e:
            logging.error(f"Error fetching DynamoDB table {table_name}: {e}")
    
    return tables


def resource_type_to_entity_type(resource_type: str) -> str:
    """
    Convert AWS resource type to Neo4j-friendly entity type in Pascal case.
    
    Examples:
        iam:user -> AwsIamUser
        ec2:instance -> AwsEc2Instance
        ec2:security-group -> AwsEc2SecurityGroup
        elasticloadbalancing:loadbalancer -> AwsElasticloadbalancingLoadbalancer
    """
    # Split by colons and hyphens, capitalize each part, then join
    parts = resource_type.replace(':', '-').split('-')
    pascal_parts = [part.capitalize() for part in parts]
    return "Aws" + "".join(pascal_parts)


async def ensure_account_entity_exists(client: Client, account_id: str, datasource_id: str, job_id: str):
    """
    Ensure the AWS account entity exists in the graph database.
    The graph database will handle deduplication if the entity already exists.
    
    Args:
        client: RAG client instance
        account_id: AWS account ID
        datasource_id: Datasource ID
        job_id: Current job ID for error tracking
    """
    try:
        logging.info(f"Ingesting AwsAccount entity for account: {account_id}")
        
        account_entity = Entity(
            entity_type="AwsAccount",
            primary_key_properties=["account_id"],
            all_properties={"account_id": account_id}
        )
        
        await client.ingest_entities(
            job_id=job_id,
            datasource_id=datasource_id,
            entities=[account_entity],
            fresh_until=utils.get_default_fresh_until()
        )
        logging.info(f"Ingested AwsAccount entity: {account_id}")
            
    except Exception as e:
        logging.warning(f"Could not ingest account entity: {e}")
        # Non-fatal error - continue with resource ingestion


async def sync_resource_type(
    client: Client,
    account_id: str,
    resource_type: str,
    region: str,
    job_id: str,
    datasource_id: str
) -> int:
    """
    Sync a specific resource type in a specific region.
    
    Returns:
        int: Number of entities successfully ingested
    """
    config = RESOURCE_CONFIG.get(resource_type)
    if not config:
        logging.warning(f"No configuration found for resource type '{resource_type}'")
        return 0
    
    try:
        # Fetch resource ARNs
        if config['fetch_fn'] in ['list_iam_users', 'get_rds_details', 'get_lambda_details', 'get_dynamodb_details']:
            # Some services don't need ARN fetching via tagging API
            resource_arns = []
        else:
            resource_arns = await fetch_resources(resource_type, region)
        
        if not resource_arns and config['fetch_fn'] not in ['list_iam_users', 'get_rds_details', 'get_lambda_details', 'get_dynamodb_details']:
            logging.debug(f"No {resource_type} resources found in region {region}")
            return 0
        
        # Fetch resource details using the configured function
        fetch_fn_name = config['fetch_fn']
        fetch_fn = globals()[fetch_fn_name]
        
        if fetch_fn_name in ['list_iam_users', 'get_rds_details', 'get_lambda_details', 'get_dynamodb_details']:
            # These functions handle their own resource discovery
            inventory = await fetch_fn(resource_arns, region) if fetch_fn_name != 'list_iam_users' else await fetch_fn()
        else:
            inventory = await fetch_fn(resource_arns, region)
        
        if not inventory:
            logging.debug(f"No details fetched for {resource_type} in region {region}")
            return 0
        
        logging.info(f"Fetched {len(inventory)} {resource_type} resources in region {region}")
        
        # Convert to entities
        entities = []
        for resource in inventory:
            props = utils.flatten_dict(resource)
            props["account_id"] = account_id
            props["region"] = region
            
            # Verify additional key properties exist
            additional_key_properties_verified = []
            for additional_key_property in config['additional_keys']:
                if all(key in props for key in additional_key_property):
                    additional_key_properties_verified.append(additional_key_property)
            
            entity = Entity(
                entity_type=resource_type_to_entity_type(resource_type),
                primary_key_properties=config['primary_key'],
                additional_key_properties=additional_key_properties_verified,
                all_properties=props
            )
            entities.append(entity)
        
        # Ingest entities
        if entities:
            await client.ingest_entities(
                job_id=job_id,
                datasource_id=datasource_id,
                entities=entities,
                fresh_until=utils.get_default_fresh_until()
            )
            await client.increment_job_progress(job_id, len(entities))
            logging.info(f"Ingested {len(entities)} {resource_type} entities from region {region}")
        
        return len(entities)
        
    except Exception as e:
        error_msg = f"Error syncing {resource_type} in region {region}: {str(e)}"
        logging.error(error_msg, exc_info=True)
        await client.add_job_error(job_id, [error_msg])
        await client.increment_job_failure(job_id, 1)
        return 0


async def sync_aws_resources(client: Client):
    """
    Main sync function that orchestrates AWS resource ingestion.
    This function is called periodically by the IngestorBuilder.
    """
    logging.info("Starting AWS resource sync...")
    
    # Get AWS account ID
    account_id = await get_account_id()
    logging.info(f"AWS Account ID: {account_id}")
    
    if not account_id:
        raise ValueError("Failed to retrieve AWS account ID. Check AWS credentials.")
    
    # Create datasource
    datasource_id = f"aws-account-{account_id}"
    datasource_info = DataSourceInfo(
        datasource_id=datasource_id,
        ingestor_id=client.ingestor_id or "",
        description=f"AWS resources for account {account_id}",
        source_type="aws",
        last_updated=int(time.time()),
        default_chunk_size=0,  # Skip chunking for graph entities
        default_chunk_overlap=0,
        metadata={
            "account_id": account_id,
            "resource_types": RESOURCE_TYPES,
        }
    )
    await client.upsert_datasource(datasource_info)
    logging.info(f"Created/updated datasource: {datasource_id}")
    
    # Get all AWS regions
    regions = await get_all_regions()
    logging.info(f"Found {len(regions)} AWS regions")
    
    # Calculate total work for job tracking
    regional_resource_types = [rt for rt in RESOURCE_TYPES if RESOURCE_CONFIG.get(rt, {}).get('regional', True)]
    global_resource_types = [rt for rt in RESOURCE_TYPES if not RESOURCE_CONFIG.get(rt, {}).get('regional', True)]
    total_work_items = len(regional_resource_types) * len(regions) + len(global_resource_types)
    
    # Create job
    job_response = await client.create_job(
        datasource_id=datasource_id,
        job_status=JobStatus.IN_PROGRESS,
        message=f"Syncing AWS resources across {len(regions)} regions",
        total=total_work_items
    )
    job_id = job_response["job_id"]
    logging.info(f"Created job {job_id} with {total_work_items} work items")
    
    try:
        # Ensure account entity exists
        await ensure_account_entity_exists(client, account_id, datasource_id, job_id)
        
        total_entities = 0
        
        # Process global resources (IAM, Route53)
        for resource_type in global_resource_types:
            logging.info(f"Processing global resource type: {resource_type}")
            count = await sync_resource_type(
                client, account_id, resource_type, 'us-east-1', job_id, datasource_id
            )
            total_entities += count
        
        # Process regional resources
        for resource_type in regional_resource_types:
            logging.info(f"Processing regional resource type: {resource_type}")
            for region in regions:
                count = await sync_resource_type(
                    client, account_id, resource_type, region, job_id, datasource_id
                )
                total_entities += count
        
        # Mark job as completed
        await client.update_job(
            job_id=job_id,
            job_status=JobStatus.COMPLETED,
            message=f"Successfully synced {total_entities} AWS resources"
        )
        logging.info(f"AWS sync completed successfully. Total entities ingested: {total_entities}")
        
    except Exception as e:
        error_msg = f"AWS resource sync failed: {str(e)}"
        await client.add_job_error(job_id, [error_msg])
        await client.update_job(
            job_id=job_id,
            job_status=JobStatus.FAILED,
            message=error_msg
        )
        logging.error(error_msg, exc_info=True)
        raise


if __name__ == "__main__":
    try:
        logging.info("Starting AWS ingestor using IngestorBuilder...")

        account_id = asyncio.run(get_account_id())
        
        # Use IngestorBuilder for simplified ingestor creation
        IngestorBuilder()\
            .name(f"aws_ingestor_{account_id}")\
            .type("aws")\
            .description("Ingestor for AWS resources (EC2, S3, EKS, IAM, etc.)")\
            .metadata({
                "resource_types": RESOURCE_TYPES,
                "sync_interval": SYNC_INTERVAL,
            })\
            .sync_with_fn(sync_aws_resources)\
            .every(SYNC_INTERVAL)\
            .with_init_delay(int(os.getenv("INIT_DELAY_SECONDS", "0")))\
            .run()
            
    except KeyboardInterrupt:
        logging.info("AWS ingestor execution interrupted by user")
    except Exception as e:
        logging.error(f"AWS ingestor failed: {e}", exc_info=True)
