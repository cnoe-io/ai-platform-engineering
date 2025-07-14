import asyncio
import logging
import os
from typing import Any, List
import boto3
from core import utils
from core.models import Entity
from clients.common import Client


CLIENT_NAME = "aws"

SYNC_INTERVAL = int(os.getenv("SYNC_INTERVAL", 60 * 15))  # sync every 15 minutes by default
LOG_LEVEL = os.environ.get('LOG_LEVEL', 'INFO').upper()
EXIT_AFTER_SYNC = os.environ.get('EXIT_AFTER_SYNC', 'false').lower() == 'true'
default_resource_types = 'iam:user,ec2:instance,ec2:volume,eks:cluster,s3:bucket,elasticloadbalancing:loadbalancer,route53:hostedzone'
resource_types = os.environ.get('RESOURCE_TYPES', default_resource_types).split(',')

logging.basicConfig(level=LOG_LEVEL)

async def get_account_id():
    client = boto3.client("sts", region_name='us-east-2')
    return client.get_caller_identity()["Account"]

async def get_all_regions():
    """
    Fetch all AWS regions using the EC2 client.

    Returns:
        list: A list of all AWS regions.
    """
    ec2_client = boto3.client('ec2', region_name='us-east-2')
    try:
        response = ec2_client.describe_regions()
        regions = [region['RegionName'] for region in response['Regions']]
        return regions
    except Exception as e:
        logging.error(f"Error fetching regions: {e}")
        return []
    
async def fetch_resources(resource_type, region) -> List[str]:
    """
    Fetches the resource inventory for the specified resource types, using tagging APIs
    Parameters:
        resource_type (str): The type of AWS resource to fetch (e.g. 'ec2:instance', 's3:bucket', etc.).
        region (str): The AWS region to fetch resources from.
    Returns:
        List[str]: A list of ARNs for the specified resource type in the given region.
    """
    # Initialize the Resource Tagging API client
    tagging_client = boto3.client('resourcegroupstaggingapi', region_name=region)

    # Use Resource Tagging API to fetch ARNs for resources of the given type
    paginator = tagging_client.get_paginator('get_resources')
    response_iterator = paginator.paginate(ResourceTypeFilters=[resource_type],)

    resource_arns = []
    for page in response_iterator:
        for resource in page.get('ResourceTagMappingList', []):
            resource_arns.append(resource['ResourceARN'])

    return resource_arns

async def sync_resource_inventory(c: Client, account_id: str, region: str, resource_type: str):
    """
   Syncs the resources for a specific AWS resource type in a given region.

    Parameters:
        resource_types (list): A list of AWS resource types to fetch (e.g. 'ec2:instance', 's3:bucket' etc.).

    Returns:
        dict: A dictionary where keys are resource types and values are lists of resource details.
    """

    # Fetch details for each resource ARN
    inventory = []
    additional_key_properties = []
    if resource_type == 'ec2:instance':
        resource_arns = await fetch_resources(resource_type, region)
        inventory = await get_ec2_details(resource_arns, region)
        primary_key_properties = ["Arn"]
        additional_key_properties = [["InstanceId"], ["PrivateDnsName"], ["PrivateIpAddress"], ["PublicDnsName"], ["PublicIpAddress"]]
    elif resource_type == 'eks:cluster':
        resource_arns = await fetch_resources(resource_type, region)
        inventory = await get_eks_details(resource_arns, region)
        primary_key_properties = ["arn"]
        additional_key_properties = [["name"], ["endpoint"]]
    elif resource_type == 's3:bucket':
        resource_arns = await fetch_resources(resource_type, region)
        inventory = await get_s3_details(resource_arns, region)
        primary_key_properties = ["Arn"]
        additional_key_properties = [["BucketName"]]
    elif resource_type == 'elasticloadbalancing:loadbalancer':
        resource_arns = await fetch_resources(resource_type, region)
        # filter arns for classic load balancers
        resource_arns_elbv2 = [arn for arn in resource_arns if len(arn.split('loadbalancer/')[-1].split("/")) > 1]
        resource_arns_clb = [arn for arn in resource_arns if len(arn.split('loadbalancer/')[-1].split("/")) == 1]
        inventory_elbv2 = await get_elbv2_details(resource_arns_elbv2, region)
        inventory_clb = await get_clb_details(resource_arns_clb, region)
        inventory = inventory_elbv2 + inventory_clb
        primary_key_properties = ["LoadBalancerArn"]
        additional_key_properties = [["LoadBalancerName"], ["DNSName"]]  
    elif resource_type == 'ec2:volume':
        resource_arns = await fetch_resources(resource_type, region)
        inventory = await get_ebs_details(resource_arns)
        primary_key_properties = ["Arn"]
        additional_key_properties = [["VolumeId"]]
    elif resource_type == 'route53:hostedzone':
        resource_arns = await fetch_resources(resource_type, region)
        inventory = await get_route53_hostedzone_details(resource_arns)
        primary_key_properties = ["Arn"]
        additional_key_properties = [["ZoneId"]]
    elif resource_type == 'iam:user':
        inventory = await list_iam_users()
        primary_key_properties = ["Arn"]
        additional_key_properties = [["UserName"],["UserId"]]
    else:
        logging.warning(f"Details fetching for resource type '{resource_type}' is not implemented.")

    for resource in inventory:
        props = utils.flatten_dict(resource)
        props["account_id"] = account_id
        # only add additional key properties if they exist in the resource
        additional_key_properties_verified = []
        for additional_key_property in additional_key_properties:
            if all(key in props for key in additional_key_property):
                additional_key_properties_verified.append(additional_key_property)

        c.update_entity(entity=Entity(
                        entity_type=await resource_name_to_entity_type(resource_type),
                        primary_key_properties=primary_key_properties,
                        additional_key_properties=additional_key_properties_verified,
                        all_properties=props))

    return inventory


async def get_ec2_details(resource_arns, region) -> List[Any]:
    """
    Fetch details for EC2 instances given their ARNs.

    Parameters:
        resource_arns (list): List of EC2 instance ARNs.

    Returns:
        list: A list of EC2 instance details.
    """
    ec2_client = boto3.client('ec2', region_name=region)
    instance_ids = []
    instance_id_arn_map = {}
    for arn in resource_arns:
        instance_id = arn.split('/')[-1]
        instance_ids.append(instance_id)
        instance_id_arn_map[instance_id] = arn

    if not instance_ids:
        return []

    try:
        response = ec2_client.describe_instances(InstanceIds=instance_ids)
        ec2_instances = []
        for reservation in response['Reservations']:
            for instance in reservation['Instances']:
                instance["Arn"] = instance_id_arn_map.get(instance['InstanceId'], "")
                if instance["Arn"] == "":
                    logging.warning(f"ARN not found for instance {instance['InstanceId']}")
                    continue
                ec2_instances.append(instance)
        return ec2_instances
    except Exception as e:
        logging.error(f"Error fetching EC2 instance details: {e}")
        return []


async def get_eks_details(resource_arns, region)-> List[Any]:
    """
    Fetch details for EKS clusters given their ARNs.

    Parameters:
        resource_arns (list): List of EKS cluster ARNs.

    Returns:
        list: A list of EKS cluster details.
    """
    eks_client = boto3.client('eks', region_name=region)
    cluster_names = [arn.split('/')[-1] for arn in resource_arns]  # Extract cluster names from ARNs

    if not cluster_names:
        return []

    clusters = []
    for cluster_name in cluster_names:
        logging.info(f"Fetching details for EKS cluster: {cluster_name}")
        try:
            response = eks_client.describe_cluster(name=cluster_name)
            cluster = response['cluster']
            clusters.append(cluster)
        except Exception as e:
            logging.error(f"Error fetching details for EKS cluster {cluster_name}: {e}")
    return clusters


async def get_s3_details(resource_arns, region) -> List[Any]:
    """
    Fetch details for S3 buckets given their ARNs.

    Parameters:
        resource_arns (list): List of S3 bucket ARNs.

    Returns:
        dict: A dictionary of S3 bucket details.
    """
    s3_client = boto3.client('s3', region_name=region)

    buckets = []
    for arn in resource_arns:
        bucket_name = arn.split(':::')[-1]
        if not bucket_name:
            continue
        # Fetch bucket details
        logging.info(f"Fetching details for S3 bucket: {bucket_name}")
        try:
            bucket_encryption = s3_client.get_bucket_encryption(Bucket=bucket_name).get('ServerSideEncryptionConfiguration', {})
            bucket_tagging = s3_client.get_bucket_tagging(Bucket=bucket_name).get('TagSet', [])
            buckets.append({
                "Arn": arn,
                "BucketName": bucket_name,
                "Encryption": bucket_encryption,
                "Tagging": bucket_tagging,
            })
        except Exception as e:
            logging.error(f"Error fetching details for S3 bucket {bucket_name}: {e}")
    return buckets

async def get_elbv2_details(resource_arns, region) -> List[Any]:
    elbs = []
    if len(resource_arns) > 0:
        logging.info(f"Found {len(resource_arns)} ALBv2 in region {region}")
        # Initialize the ELB
        elb_client = boto3.client('elbv2', region_name=region)  # For Application/Network Load Balancers
        
        load_balancer_arns = resource_arns
        if load_balancer_arns:
            try:
                response = elb_client.describe_load_balancers(LoadBalancerArns=load_balancer_arns)
                for lb in response['LoadBalancers']:
                    logging.info(f"Fetching details for ELB: {lb['LoadBalancerName']}")
                    elbs.append(lb)
            except Exception as e:
                logging.error(f"Error fetching details for ELBs: {e}")
    return elbs
    
async def get_clb_details(resource_arns, region) -> List[Any]:
    """
    Fetch details for Classic Load Balancers given their ARNs.

    Parameters:
        resource_arns (list): List of ELB ARNs.

    Returns:
        dict: A dictionary of ELB details.
    """
    elbs = []
    if len(resource_arns) > 0:
        logging.info(f"Found {len(resource_arns)} classic ELB in region {region}")
        # Create a map of load balancer names from ARNs
        lb_names_dict = {arn.split('/')[-1]: arn for arn in resource_arns}  # Map of load balancer names to ARNs

        elb_client = boto3.client('elb', region_name=region)  # For Classic Load Balancers
        if len(lb_names_dict) > 0:
            try:
                response = elb_client.describe_load_balancers(LoadBalancerNames=list(lb_names_dict.keys()))
                for lb in response['LoadBalancerDescriptions']:
                    lb["LoadBalancerArn"] = lb_names_dict[lb["LoadBalancerName"]] # Add ARN to the load balancer details
                    elbs.append(lb)
            except Exception as e:
                print(f"Error fetching details for Classic Load Balancers: {e}")
                logging.error(f"Error fetching details for Classic Load Balancers: {e}")

    return elbs

async def get_ebs_details(resource_arns) -> List[Any]:
    """
    Fetch details for EC2 Volumes given their ARNs.

    Parameters:
        resource_arns (list): List of Volume ARNs.

    Returns:
        list: A list of EC2 Volume details.
    """
    ec2_client = boto3.client('ec2')
    volume_ids = [arn.split('/')[-1] for arn in resource_arns]  # Extract Volume IDs from ARNs
    volume_id_arn_map = {volume_id: arn for arn, volume_id in zip(resource_arns, volume_ids)}  # Map Volume IDs to ARNs

    if not volume_ids:
        return []

    volumes = []
    try:
        response = ec2_client.describe_volumes(VolumeIds=volume_ids)
        for volume in response['Volumes']:
            volume['Arn'] = volume_id_arn_map[volume['VolumeId']]
            volumes.append(volume)
        return volumes
    except Exception as e:
        print(f"Error fetching details for Volumes: {e}")
        return []

async def get_route53_hostedzone_details(resource_arns) -> List[Any]:
    """
    Fetch details for Route 53 hosted zones given their ARNs.
    Parameters:
        resource_arns (list): List of Route 53 hosted zone ARNs.
    Returns:
        dict: A dictionary of Route 53 hosted zone details.
    """
    route53_client = boto3.client('route53', region_name='us-east-1')

    zones = []
    for arn in resource_arns:
        hosted_zone_id = arn.split('/')[-1]  # Extract hosted zone ID from ARN
        if not hosted_zone_id:
            continue
        try:
            response = route53_client.get_hosted_zone(Id=hosted_zone_id)
            zone = response['HostedZone']
            zone["Arn"] = arn
            zone["ZoneId"] = hosted_zone_id
            zones.append(zone)
        except Exception as e:
            logging.error(f"Error fetching details for Route 53 hosted zone {hosted_zone_id}: {e}")
    return zones


async def list_iam_users() -> List[Any]:
    """
    List IAM users in the AWS account.
    Returns:
        dict: A dictionary of IAM user details.
    """
    # Create an IAM client using boto3
    iam_client = boto3.client('iam')
    
    # Use the list_users API to retrieve the list of users
    response = iam_client.list_users()

    # Extract users from the response
    users = response.get('Users', [])

    if not users:
        logging.warning("No IAM users found in your AWS account.")
        return []
    else:
        return users

async def resource_name_to_entity_type(resource_type):
    """
    Convert the resource type (e.g. iam:user) to a database-friendly entity type.
    """
    # Make it database friendly
    return "AWS"+"".join([t.capitalize() for t in resource_type.split(":")])

async def sync(c: Client):
    """
    Periodically sync entities
    """
    # Get account id
    account_id = await get_account_id()
    logging.info(f"Account ID: {account_id}")

    if not account_id:
        logging.error("Failed to retrieve AWS account ID. Please check your AWS credentials.")
        return

    # Check if the account exists in the database, if not create it
    accounts = c.find_entity(entity_type="AwsAccount", props={"account_id": account_id})
    if len(accounts) == 0:
        c.update_entity(entity=Entity(
            entity_type="AwsAccount",
            primary_key_properties=["account_id"],
            all_properties={
                "account_id": account_id,
            }
        ))

    # Get all AWS regions
    regions = await get_all_regions()
    logging.info(f"Found {len(regions)} regions: {regions}")

    resource_types_set = set(resource_types)

    # Iterate through each region and fetch resource inventory
    for resource_type in resource_types_set:
        logging.info(f"Fetching resource type {resource_type}")
        if resource_type == "iam:user":
            # IAM users are global, so we can fetch them once
            await sync_resource_inventory(c, account_id, "us-east-1", resource_type)
            continue
        elif resource_type == "route53:hostedzone":
            # Route53 hosted zones are also global, so we can fetch them once
            await sync_resource_inventory(c, account_id, "us-east-1", resource_type)
            continue

        # For other resource types, iterate through all regions
        for region in regions:
            await sync_resource_inventory(c, account_id, region, resource_type)
        

async def run():
    #  create a plugin object
    c = Client(CLIENT_NAME)

    # sync periodically
    async def periodic_sync():
        while True:
            logging.info("syncing...")
            await sync(c)
            logging.info("syncing... done")
            if EXIT_AFTER_SYNC:
                logging.info("Exiting after sync as per configuration.")
                exit(0)
            logging.info(f"Next sync in {SYNC_INTERVAL} seconds")
            await asyncio.sleep(SYNC_INTERVAL)

    # run the plugin in asyncio loop
    await asyncio.gather(
        periodic_sync(),
    )

if __name__ == "__main__":
    try:
        logging.info(f"Running client {CLIENT_NAME}...")
        asyncio.run(run())
    except KeyboardInterrupt:
        logging.info("Client execution interrupted")
