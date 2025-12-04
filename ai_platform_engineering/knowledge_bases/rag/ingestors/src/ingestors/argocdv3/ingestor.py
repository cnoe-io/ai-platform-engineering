import os
import time
import logging
import requests
from typing import List, Dict, Any, Optional
from urllib.parse import urljoin

from common.ingestor import IngestorBuilder, Client
from common.models.graph import Entity
from common.models.rag import DataSourceInfo
from common.job_manager import JobStatus
import common.utils as utils

"""
ArgoCD v3 Ingestor - Ingests entities from ArgoCD into the RAG system.
Uses the IngestorBuilder pattern for simplified ingestor creation with automatic job management and batching.
Conforms to ArgoCD API v1 specification.
"""

LOG_LEVEL = os.environ.get('LOG_LEVEL', 'INFO').upper()
logging.basicConfig(level=LOG_LEVEL)

# ArgoCD configuration
SERVER_URL = os.getenv("SERVER_URL")
ARGOCD_AUTH_TOKEN = os.getenv("ARGOCD_AUTH_TOKEN")
ARGOCD_VERIFY_SSL = os.getenv("ARGOCD_VERIFY_SSL", "true").lower() == "true"
ARGOCD_FILTER_PROJECTS = os.getenv("ARGOCD_FILTER_PROJECTS", "").strip()
SYNC_INTERVAL = int(os.getenv("SYNC_INTERVAL", 900))  # sync every 15 minutes by default

if SERVER_URL is None or ARGOCD_AUTH_TOKEN is None:
    raise ValueError("SERVER_URL and ARGOCD_AUTH_TOKEN environment variables must be set")

# Create instance name from server URL
argocd_instance_name = "argocdv3_" + SERVER_URL.replace("://", "_").replace("/", "_").replace(":", "_").replace(".", "_")

# Filter projects if specified
FILTER_PROJECTS = [p.strip() for p in ARGOCD_FILTER_PROJECTS.split(",") if p.strip()] if ARGOCD_FILTER_PROJECTS else []


class ArgoCDClient:
    """Client for interacting with ArgoCD API v1"""
    
    def __init__(self, base_url: str, auth_token: str, verify_ssl: bool = True):
        self.base_url = base_url.rstrip("/")
        self.auth_token = auth_token
        self.verify_ssl = verify_ssl
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {auth_token}",
            "Content-Type": "application/json"
        })
    
    def _make_request(self, endpoint: str, method: str = "GET", params: Optional[Dict[str, Any]] = None, **kwargs) -> Any:
        """Make a request to the ArgoCD API"""
        url = urljoin(self.base_url, endpoint)
        try:
            response = self.session.request(
                method=method,
                url=url,
                params=params,
                verify=self.verify_ssl,
                **kwargs
            )
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            logging.error(f"Error making request to {url}: {e}")
            raise
    
    def get_applications(self, projects: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        """
        Fetch all applications, optionally filtered by projects.
        Uses GET /api/v1/applications endpoint with 'projects' query parameter.
        Returns items from v1alpha1ApplicationList.
        """
        logging.info("Fetching applications from ArgoCD...")
        params = {}
        if projects:
            # ArgoCD API accepts multiple projects as repeated query parameters
            params["projects"] = projects
        
        try:
            response = self._make_request("/api/v1/applications", params=params)
            # Response is v1alpha1ApplicationList with 'items' array
            apps = response.get("items", []) if isinstance(response, dict) else []
            logging.info(f"Fetched {len(apps)} applications")
            return apps
        except Exception as e:
            logging.error(f"Error fetching applications: {e}")
            return []
    
    def get_projects(self) -> List[Dict[str, Any]]:
        """
        Fetch all projects.
        Uses GET /api/v1/projects endpoint.
        Returns items from v1alpha1AppProjectList.
        """
        logging.info("Fetching projects from ArgoCD...")
        try:
            response = self._make_request("/api/v1/projects")
            # Response is v1alpha1AppProjectList with 'items' array
            projects = response.get("items", []) if isinstance(response, dict) else []
            logging.info(f"Fetched {len(projects)} projects")
            return projects
        except Exception as e:
            logging.error(f"Error fetching projects: {e}")
            return []
    
    def get_clusters(self) -> List[Dict[str, Any]]:
        """
        Fetch all clusters.
        Uses GET /api/v1/clusters endpoint.
        Returns items from v1alpha1ClusterList.
        """
        logging.info("Fetching clusters from ArgoCD...")
        try:
            response = self._make_request("/api/v1/clusters")
            # Response is v1alpha1ClusterList with 'items' array
            clusters = response.get("items", []) if isinstance(response, dict) else []
            logging.info(f"Fetched {len(clusters)} clusters")
            return clusters
        except Exception as e:
            logging.error(f"Error fetching clusters: {e}")
            return []
    
    def get_repositories(self) -> List[Dict[str, Any]]:
        """
        Fetch all repositories.
        Uses GET /api/v1/repositories endpoint.
        Returns items from v1alpha1RepositoryList.
        """
        logging.info("Fetching repositories from ArgoCD...")
        try:
            response = self._make_request("/api/v1/repositories")
            # Response is v1alpha1RepositoryList with 'items' array
            repos = response.get("items", []) if isinstance(response, dict) else []
            logging.info(f"Fetched {len(repos)} repositories")
            return repos
        except Exception as e:
            logging.error(f"Error fetching repositories: {e}")
            return []
    
    def get_applicationsets(self, projects: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        """
        Fetch all applicationsets.
        Uses GET /api/v1/applicationsets endpoint with optional 'projects' query parameter.
        Returns items from v1alpha1ApplicationSetList.
        """
        logging.info("Fetching applicationsets from ArgoCD...")
        params = {}
        if projects:
            # ArgoCD API accepts multiple projects as repeated query parameters
            params["projects"] = projects
        
        try:
            response = self._make_request("/api/v1/applicationsets", params=params)
            # Response is v1alpha1ApplicationSetList with 'items' array
            appsets = response.get("items", []) if isinstance(response, dict) else []
            logging.info(f"Fetched {len(appsets)} applicationsets")
            return appsets
        except Exception as e:
            logging.error(f"Error fetching applicationsets: {e}")
            return []


def extract_project_roles(project: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Extract RBAC roles from a project"""
    roles = []
    project_name = project.get("metadata", {}).get("name", "unknown")
    
    for role in project.get("spec", {}).get("roles", []):
        role_data = {
            "project_name": project_name,
            "role_name": role.get("name"),
            "description": role.get("description", ""),
            "policies": role.get("policies", []),
            "groups": role.get("groups", []),
            "jwt_tokens": len(role.get("jwtTokens", [])),  # Don't include actual tokens
        }
        roles.append(role_data)
    
    return roles


async def sync_argocd_entities(client: Client):
    """
    Sync function that fetches ArgoCD entities and ingests them with job tracking.
    This function is called periodically by the IngestorBuilder.
    """
    logging.info("Starting ArgoCD v3 entity sync...")
    
    # Initialize ArgoCD client
    argocd_client = ArgoCDClient(SERVER_URL, ARGOCD_AUTH_TOKEN, ARGOCD_VERIFY_SSL)
    
    datasource_id = argocd_instance_name
    
    # 1. Create/Update the datasource
    datasource_info = DataSourceInfo(
        datasource_id=datasource_id,
        ingestor_id=client.ingestor_id or "",
        description=f"ArgoCD v3 entities from {SERVER_URL}",
        source_type="argocdv3",
        last_updated=int(time.time()),
        default_chunk_size=0,  # Skip chunking for graph entities
        default_chunk_overlap=0,
        metadata={
            "argocd_url": SERVER_URL,
            "filter_projects": FILTER_PROJECTS,
            "verify_ssl": ARGOCD_VERIFY_SSL,
        }
    )
    await client.upsert_datasource(datasource_info)
    logging.info(f"Created/updated datasource: {datasource_id}")
    
    # 2. Fetch all entities from ArgoCD
    all_entities: List[Entity] = []
    
    # Fetch projects first (needed for filtering)
    projects_data = argocd_client.get_projects()
    
    # Apply project filter if specified
    if FILTER_PROJECTS:
        projects_data = [p for p in projects_data if p.get("metadata", {}).get("name") in FILTER_PROJECTS]
        logging.info(f"Filtered to {len(projects_data)} projects: {FILTER_PROJECTS}")
    
    project_names = [p.get("metadata", {}).get("name") for p in projects_data]
    
    # Fetch all other entities
    applications_data = argocd_client.get_applications(projects=project_names if FILTER_PROJECTS else None)
    clusters_data = argocd_client.get_clusters()
    repositories_data = argocd_client.get_repositories()
    applicationsets_data = argocd_client.get_applicationsets(projects=project_names if FILTER_PROJECTS else None)
    
    # Extract roles from projects
    all_roles = []
    for project in projects_data:
        roles = extract_project_roles(project)
        all_roles.extend(roles)
    
    # Count total items
    total_items = (
        1 +  # ArgoCDInstance
        len(applications_data) +
        len(projects_data) +
        len(clusters_data) +
        len(repositories_data) +
        len(applicationsets_data) +
        len(all_roles)
    )
    
    logging.info(f"Total entities to process: {total_items}")
    
    if total_items <= 1:  # Only the instance entity
        logging.info("No entities to process from ArgoCD")
        return
    
    # 3. Create a job for this ingestion
    job_response = await client.create_job(
        datasource_id=datasource_id,
        job_status=JobStatus.IN_PROGRESS,
        message="Starting ArgoCD v3 entity ingestion",
        total=total_items
    )
    job_id = job_response["job_id"]
    logging.info(f"Created job {job_id} for datasource={datasource_id} with {total_items} entities")
    
    # 4. Convert ArgoCD items to Entity objects
    
    try:
        # Create ArgoCDInstance entity
        instance_entity = Entity(
            entity_type="ArgoCDInstance",
            all_properties={
                "server_url": SERVER_URL,
                "instance_name": argocd_instance_name,
                "verify_ssl": ARGOCD_VERIFY_SSL,
                "filtered_projects": FILTER_PROJECTS,
                "api_version": "v1",
            },
            primary_key_properties=["server_url"],
            additional_key_properties=[["instance_name"]]
        )
        all_entities.append(instance_entity)
        
        # Convert Applications
        for app in applications_data:
            try:
                entity = Entity(
                    entity_type="ArgoCDApplication",
                    all_properties=app,
                    primary_key_properties=["metadata.uid"],
                    additional_key_properties=[
                        ["metadata.name"],
                        ["metadata.namespace", "metadata.name"]
                    ]
                )
                all_entities.append(entity)
            except Exception as e:
                logging.error(f"Error converting application to Entity: {e}", exc_info=True)
                await client.add_job_error(job_id, [f"Error converting application: {str(e)}"])
                await client.increment_job_failure(job_id, 1)
        
        # Convert Projects
        for project in projects_data:
            try:
                entity = Entity(
                    entity_type="ArgoCDProject",
                    all_properties=project,
                    primary_key_properties=["metadata.uid"],
                    additional_key_properties=[["metadata.name"]]
                )
                all_entities.append(entity)
            except Exception as e:
                logging.error(f"Error converting project to Entity: {e}", exc_info=True)
                await client.add_job_error(job_id, [f"Error converting project: {str(e)}"])
                await client.increment_job_failure(job_id, 1)
        
        # Convert Clusters
        for cluster in clusters_data:
            try:
                entity = Entity(
                    entity_type="ArgoCDCluster",
                    all_properties=cluster,
                    primary_key_properties=["server"],
                    additional_key_properties=[["name"]]
                )
                all_entities.append(entity)
            except Exception as e:
                logging.error(f"Error converting cluster to Entity: {e}", exc_info=True)
                await client.add_job_error(job_id, [f"Error converting cluster: {str(e)}"])
                await client.increment_job_failure(job_id, 1)
        
        # Convert Repositories
        for repo in repositories_data:
            try:
                entity = Entity(
                    entity_type="ArgoCDRepository",
                    all_properties=repo,
                    primary_key_properties=["repo"],
                    additional_key_properties=[["name"]]
                )
                all_entities.append(entity)
            except Exception as e:
                logging.error(f"Error converting repository to Entity: {e}", exc_info=True)
                await client.add_job_error(job_id, [f"Error converting repository: {str(e)}"])
                await client.increment_job_failure(job_id, 1)
        
        # Convert ApplicationSets
        for appset in applicationsets_data:
            try:
                entity = Entity(
                    entity_type="ArgoCDApplicationSet",
                    all_properties=appset,
                    primary_key_properties=["metadata.uid"],
                    additional_key_properties=[
                        ["metadata.name"],
                        ["metadata.namespace", "metadata.name"]
                    ]
                )
                all_entities.append(entity)
            except Exception as e:
                logging.error(f"Error converting applicationset to Entity: {e}", exc_info=True)
                await client.add_job_error(job_id, [f"Error converting applicationset: {str(e)}"])
                await client.increment_job_failure(job_id, 1)
        
        # Convert Project Roles
        for role in all_roles:
            try:
                entity = Entity(
                    entity_type="ArgoCDProjectRole",
                    all_properties=role,
                    primary_key_properties=["project_name", "role_name"],
                    additional_key_properties=[["role_name"]]
                )
                all_entities.append(entity)
            except Exception as e:
                logging.error(f"Error converting project role to Entity: {e}", exc_info=True)
                await client.add_job_error(job_id, [f"Error converting project role: {str(e)}"])
                await client.increment_job_failure(job_id, 1)
        
        logging.info(f"Converted {len(all_entities)} ArgoCD items to Entity objects")
        
    except Exception as e:
        error_msg = f"Error during entity conversion: {str(e)}"
        await client.add_job_error(job_id, [error_msg])
        await client.update_job(
            job_id=job_id,
            job_status=JobStatus.FAILED,
            message=error_msg
        )
        logging.error(error_msg, exc_info=True)
        raise
    
    # 5. Ingest entities using automatic batching
    try:
        if all_entities:
            logging.info(f"Ingesting {len(all_entities)} entities with automatic batching")
            
            # Use the client's ingest_entities method which handles batching automatically
            await client.ingest_entities(
                job_id=job_id,
                datasource_id=datasource_id,
                entities=all_entities,
                fresh_until=utils.get_default_fresh_until()
            )
            
            # Update job progress to reflect all entities processed
            await client.increment_job_progress(job_id, len(all_entities))
            
            # Mark job as complete
            await client.update_job(
                job_id=job_id,
                job_status=JobStatus.COMPLETED,
                message=f"Successfully ingested {len(all_entities)} entities"
            )
            logging.info(f"Successfully completed ingestion of {len(all_entities)} entities")
        else:
            # No entities to ingest
            await client.update_job(
                job_id=job_id,
                job_status=JobStatus.COMPLETED,
                message="No entities to ingest"
            )
            logging.info("No entities to ingest")
        
    except Exception as e:
        # Mark job as failed
        error_msg = f"Entity ingestion failed: {str(e)}"
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
        logging.info("Starting ArgoCD v3 ingestor using IngestorBuilder...")
        
        # Use IngestorBuilder for simplified ingestor creation
        IngestorBuilder()\
            .name(argocd_instance_name)\
            .type("argocdv3")\
            .description(f"Ingestor for ArgoCD v3 entities from {SERVER_URL}")\
            .metadata({
                "argocd_url": SERVER_URL,
                "filter_projects": FILTER_PROJECTS,
                "verify_ssl": ARGOCD_VERIFY_SSL,
                "sync_interval": SYNC_INTERVAL,
                "api_version": "v1"
            })\
            .sync_with_fn(sync_argocd_entities)\
            .every(SYNC_INTERVAL)\
            .with_init_delay(int(os.getenv("INIT_DELAY_SECONDS", "0")))\
            .run()
            
    except KeyboardInterrupt:
        logging.info("ArgoCD v3 ingestor execution interrupted by user")
    except Exception as e:
        logging.error(f"ArgoCD v3 ingestor failed: {e}", exc_info=True)

