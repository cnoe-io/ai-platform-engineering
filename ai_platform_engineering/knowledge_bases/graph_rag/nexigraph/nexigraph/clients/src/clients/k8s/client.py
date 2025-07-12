import asyncio
import logging
import os

from core import utils
from core.models import Entity
from clients.common import Client
from kubernetes import dynamic
from kubernetes import config as kconfig
from kubernetes.dynamic.exceptions import NotFoundError
from kubernetes.dynamic import Resource

CLIENT_NAME = "k8s"

SYNC_INTERVAL = int(os.getenv("SYNC_INTERVAL", 60 * 15))  # sync every 15 minutes by default
cluster_name = os.environ.get('CLUSTER_NAME')
EXIT_AFTER_SYNC = os.getenv("EXIT_AFTER_SYNC", "false").lower() == "true"

# default_ignore_resource_list = (
#     "CustomResourceDefinition,ComponentStatus,ConfigMap,ControllerRevision,"
#     "ClusterRoleBinding,RoleBinding,Event,Lease,MutatingWebhookConfiguration,"
#     "NodeMetrics,Pod,PodMetrics,Secret,SelfSubjectAccessReview,SelfSubjectReview,"
#     "SelfSubjectRulesReview,ServiceAccount,SubjectAccessReview,TokenReview,"
#     "ValidatingWebhookConfiguration"
# )
# ignore_resource_list = [
#     c.lower() for c in os.environ.get('IGNORE_RESOURCE_LIST', default_ignore_resource_list).split(",")
# ]

default_resource_list = "Certificate,ClusterIssuer,CronJob,DaemonSet,Deployment,Ingress,IngressClass,Issuer,Job,Namespace,Node,Service,StatefulSet,StorageClass"
resource_list = os.environ.get('RESOURCE_LIST', default_resource_list).split(",") # ignore resources - uses prefix matching
resource_list = set([r.lower() for r in resource_list])

default_ignore_field_list = "metadata.annotations.kubectl.kubernetes.io,metadata.labels.app.kubernetes.io,metadata.managedFields,metadata.selfLink"
ignore_field_list = os.environ.get('IGNORE_FIELD_LIST', default_ignore_field_list).split(",") # ignore fields - uses prefix matching

LOG_LEVEL = os.environ.get('LOG_LEVEL', 'INFO').upper()
logging.basicConfig(level=LOG_LEVEL)


def sync_all_k8s_resources(c: Client):
    """
    Uses the dynamic client to list all Kubernetes resources (both standard and custom resources)
    dynamically without hardcoding types.
    """
    # Load kubeconfig from the default location (~/.kube/config)
    logging.info("Loading Kubernetes configuration...")
    kconfig.load_kube_config()
    logging.info("Kubernetes configuration loaded successfully.")

    # Check if the cluster name is set
    if not cluster_name:
        logging.error("CLUSTER_NAME environment variable is not set. Please set it to the name of your Kubernetes cluster.")
        return

    # Check if the cluster exists in the database
    clusters = c.find_entity(entity_type="K8sCluster", props={"name": cluster_name})
    if len(clusters) == 0:
        c.update_entity(entity=Entity(
            entity_type="K8sCluster",
            primary_key_properties=["name"],
            all_properties={
                "name": cluster_name,
            }
        ))

    # Initialize the dynamic client
    dyn_client = dynamic.DynamicClient(kconfig.new_client_from_config())

    # try:
    # Discover all available API resources
    api_resources = dyn_client.resources

    # Iterate through all resources and fetch their details
    for resource in api_resources:
        # print(resource)
        # continue
        try:
            # List all objects for the resource
            resource: Resource = resource[0]
            if type(resource) != Resource:
                logging.info("Skipping non-resource")
                continue
            if resource.kind is None:
                logging.info("Skipping resource with no kind")
                continue
            # Skip ignored resources
            if resource.kind.lower() not in resource_list:
                logging.info(f"Skipping ignored resource: {resource.kind}")
                continue
            logging.info(f"Resource: {resource.kind} (API Group/Version: {resource.group}/{resource.api_version})")
            resource_name = resource.kind
            resource_group_version = f"{resource.group}/{resource.api_version}" if resource.group else resource.api_version
            logging.info(f"Fetching {resource_name} (API Group/Version: {resource_group_version})")

            # Fetch the resources for the current type
            objects = resource.get()
            # print(type(objects))

            for obj in objects.items:
                id_val =  str(cluster_name) + "/" + str(resource_group_version) +"/"+ str(resource.kind) + "/" + obj.metadata.get("namespace", "") + "/"+ obj.metadata.name
                logging.debug(f"Processing {resource_name} object: {id_val}")
                all_properties = utils.flatten_dict(obj.to_dict())
                all_properties_clean = {}
                # remove any ignored fields
                for field in all_properties.keys():
                    ignore = False
                    for ig_field in ignore_field_list:
                        if field.startswith(ig_field):
                            ignore = True
                            logging.debug(f"Ignoring field: {field} (prefix: {ig_field})")
                            break
                    if not ignore:
                        all_properties_clean[field] = all_properties[field]


                all_properties_clean["cluster_name"] = cluster_name

                if "metadata.namespace" in all_properties_clean:
                    primary_key_properties = ["cluster_name", "metadata.namespace", "metadata.name"]
                else:
                    primary_key_properties = ["cluster_name", "metadata.name"]

                c.update_entity(entity=Entity(
                    entity_type="K8s"+str(resource.kind),
                    primary_key_properties=primary_key_properties,
                    all_properties=all_properties_clean
                ))

            logging.info(f"  Found {len(objects.items)} {resource_name} resources.")
        except NotFoundError:
            # Ignore resources that may not be accessible
            logging.info(f"  Resource {resource.kind} not found or not accessible.")


def sync(c: Client):
    """
    Periodically sync entities
    """
    # Fetch all Kubernetes objects
    # get_cluster_metadata()
    logging.info("Syncing Kubernetes resources...")
    sync_all_k8s_resources(c)

async def run():
    #  create a plugin object
    c = Client(CLIENT_NAME)

    # sync periodically
    async def periodic_sync():
        while True:
            logging.info("syncing...")
            sync(c)
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