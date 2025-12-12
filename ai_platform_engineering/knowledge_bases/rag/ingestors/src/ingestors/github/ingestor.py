import os
import re
import time
import logging
import requests
import jwt
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional

from common.ingestor import IngestorBuilder, Client
from common.models.graph import Entity
from common.models.rag import DataSourceInfo
from common.job_manager import JobStatus
import common.utils as utils

"""
GitHub Ingestor - Ingests entities from GitHub using GraphQL API into the RAG system.
Uses the IngestorBuilder pattern for simplified ingestor creation with automatic job management and batching.

Extracts:
- Organizations (metadata) - as graph entities
- Repositories (metadata + security settings) - as graph entities
- Users (profiles, bio, email, memberships, repos owned) - as graph entities
- Teams (details, memberships, permissions) - as graph entities

Dependencies:
- PyJWT: Required for GitHub App authentication (pip install PyJWT)
"""

LOG_LEVEL = os.environ.get('LOG_LEVEL', 'INFO').upper()
logging.basicConfig(level=LOG_LEVEL)

# GitHub configuration - supports both PAT and GitHub App authentication

# Authentication Method 1: Personal Access Token (PAT)
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")

# Authentication Method 2: GitHub App
GITHUB_APP_ID = os.getenv("GITHUB_APP_ID")
GITHUB_APP_PRIVATE_KEY = os.getenv("GITHUB_APP_PRIVATE_KEY")  # Can be base64 encoded or file path
GITHUB_APP_INSTALLATION_ID = os.getenv("GITHUB_APP_INSTALLATION_ID")

# Validate authentication configuration
if not GITHUB_TOKEN and not (GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY and GITHUB_APP_INSTALLATION_ID):
    raise ValueError(
        "Authentication required: Either set GITHUB_TOKEN (for PAT) or "
        "GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY + GITHUB_APP_INSTALLATION_ID (for GitHub App)"
    )

GITHUB_API_URL = os.getenv("GITHUB_API_URL", "https://api.github.com/graphql")
GITHUB_REST_API_URL = os.getenv("GITHUB_REST_API_URL", "https://api.github.com")
GITHUB_ORG = os.getenv("GITHUB_ORG")  # Optional: If set, only fetch data for this org
SYNC_INTERVAL = int(os.getenv("SYNC_INTERVAL", 86400))  # sync every day by default
FETCH_TEAM_DETAILS = os.getenv("FETCH_TEAM_DETAILS", "true").lower() == "true"  # Fetch detailed team members/repos (adds ~400 API calls)
FETCH_ORG_EMAILS = os.getenv("FETCH_ORG_EMAILS", "false").lower() == "true"  # Fetch organization verified domain emails for users

# Create instance name
def sanitize_instance_name(name: str) -> str:
    """Replace all non-alphanumeric characters with underscores"""
    return re.sub(r'[^a-zA-Z0-9]', '_', name)

github_instance_name = "github_" + sanitize_instance_name(GITHUB_ORG if GITHUB_ORG else "default")


class GitHubAppAuth:
    """Handles GitHub App authentication and token management"""
    
    def __init__(self, app_id: str, private_key: str, installation_id: str, rest_api_url: str = "https://api.github.com"):
        self.app_id = app_id
        self.installation_id = installation_id
        self.rest_api_url = rest_api_url
        
        # Decode private key if it's base64 encoded
        try:
            import base64
            if not private_key.startswith("-----BEGIN"):
                private_key = base64.b64decode(private_key).decode("utf-8")
        except Exception:
            pass  # Assume it's already in PEM format
        
        # If private_key looks like a file path, read it
        if private_key.startswith("/") or private_key.startswith("./"):
            try:
                with open(private_key, "r") as f:
                    private_key = f.read()
            except Exception as e:
                logging.warning(f"Could not read private key from file {private_key}: {e}")
        
        self.private_key = private_key
        self.installation_token: Optional[str] = None
        self.token_expires_at: Optional[datetime] = None
    
    def _generate_jwt(self) -> str:
        """Generate a JWT for GitHub App authentication"""
        now = datetime.utcnow()
        payload = {
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(minutes=10)).timestamp()),
            "iss": self.app_id
        }
        
        try:
            token = jwt.encode(payload, self.private_key, algorithm="RS256")
            return token
        except Exception as e:
            logging.error(f"Error generating JWT: {e}")
            raise
    
    def get_installation_token(self) -> str:
        """Get or refresh the installation access token"""
        # Check if we have a valid token
        if self.installation_token and self.token_expires_at:
            if datetime.utcnow() < self.token_expires_at - timedelta(minutes=5):
                return self.installation_token
        
        # Generate new token
        logging.info("Generating new GitHub App installation token...")
        jwt_token = self._generate_jwt()
        
        url = f"{self.rest_api_url}/app/installations/{self.installation_id}/access_tokens"
        headers = {
            "Authorization": f"Bearer {jwt_token}",
            "Accept": "application/vnd.github.v3+json"
        }
        
        try:
            response = requests.post(url, headers=headers)
            response.raise_for_status()
            data = response.json()
            
            self.installation_token = data["token"]
            expires_at_str = data["expires_at"]
            # Parse ISO format: 2024-12-09T12:00:00Z
            self.token_expires_at = datetime.strptime(expires_at_str, "%Y-%m-%dT%H:%M:%SZ")
            
            logging.info(f"Successfully generated installation token, expires at {self.token_expires_at}")
            
            if not self.installation_token:
                raise ValueError("Failed to get installation token from GitHub API")
            
            return self.installation_token
        except Exception as e:
            logging.error(f"Error getting installation token: {e}")
            raise


class GitHubClient:
    """Client for interacting with GitHub GraphQL API - supports both PAT and GitHub App auth"""
    
    def __init__(
        self,
        api_url: str = "https://api.github.com/graphql",
        token: Optional[str] = None,
        github_app_auth: Optional[GitHubAppAuth] = None
    ):
        if not token and not github_app_auth:
            raise ValueError("Either token or github_app_auth must be provided")
        
        self.api_url = api_url
        self.token = token
        self.github_app_auth = github_app_auth
        self.session = requests.Session()
        self.session.headers.update({
            "Content-Type": "application/json"
        })
        
        # Set initial auth header if using PAT
        if self.token:
            self.session.headers.update({
                "Authorization": f"Bearer {self.token}"
            })
            logging.info("Initialized GitHub client with Personal Access Token")
        else:
            logging.info("Initialized GitHub client with GitHub App authentication")
    
    def _get_auth_header(self) -> Dict[str, str]:
        """Get the current authorization header"""
        if self.token:
            return {"Authorization": f"Bearer {self.token}"}
        elif self.github_app_auth:
            token = self.github_app_auth.get_installation_token()
            return {"Authorization": f"Bearer {token}"}
        else:
            raise ValueError("No authentication method available")
    
    def _make_graphql_request(self, query: str, variables: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Make a GraphQL request to GitHub API"""
        try:
            # Get fresh auth header (handles token refresh for GitHub App)
            headers = self._get_auth_header()
            headers["Content-Type"] = "application/json"
            
            # Use the session for connection reuse
            response = self.session.post(
                url=self.api_url,
                headers=headers,
                json={
                    "query": query,
                    "variables": variables or {}
                }
            )
            response.raise_for_status()
            result = response.json()
            
            if "errors" in result:
                logging.error(f"GraphQL errors: {result['errors']}")
                raise Exception(f"GraphQL errors: {result['errors']}")
            
            return result.get("data", {})
        except requests.exceptions.RequestException as e:
            logging.error(f"Error making GraphQL request: {e}")
            raise
    
    def get_viewer(self) -> Dict[str, Any]:
        """Get the authenticated user info"""
        query = """
        query {
            viewer {
                login
                name
                email
                bio
                company
                location
            }
        }
        """
        data = self._make_graphql_request(query)
        return data.get("viewer", {})
    
    def get_organization(self, org_login: str) -> Optional[Dict[str, Any]]:
        """Fetch organization details"""
        query = """
        query($login: String!) {
            organization(login: $login) {
                id
                login
                name
                description
                email
                url
                websiteUrl
                location
                createdAt
                isVerified
                twitterUsername
            }
        }
        """
        try:
            data = self._make_graphql_request(query, {"login": org_login})
            return data.get("organization")
        except Exception as e:
            logging.error(f"Error fetching organization {org_login}: {e}")
            return None
    
    def get_organization_repositories(self, org_login: str, cursor: Optional[str] = None) -> Dict[str, Any]:
        """Fetch repositories for an organization with pagination"""
        query = """
        query($login: String!, $cursor: String) {
            organization(login: $login) {
                repositories(first: 50, after: $cursor) {
                    pageInfo {
                        hasNextPage
                        endCursor
                    }
                    nodes {
                        id
                        name
                        nameWithOwner
                        description
                        url
                        createdAt
                        updatedAt
                        pushedAt
                        isPrivate
                        isFork
                        isArchived
                        isLocked
                        isTemplate
                        isEmpty
                        defaultBranchRef {
                            name
                        }
                        languages(first: 5) {
                            nodes {
                                name
                            }
                        }
                        primaryLanguage {
                            name
                        }
                        stargazerCount
                        forkCount
                        diskUsage
                        licenseInfo {
                            name
                            spdxId
                        }
                        visibility
                        hasProjectsEnabled
                        hasWikiEnabled
                        vulnerabilityAlerts {
                            totalCount
                        }
                        securityPolicyUrl
                    }
                }
            }
        }
        """
        data = self._make_graphql_request(query, {"login": org_login, "cursor": cursor})
        return data.get("organization", {}).get("repositories", {})
    
    def get_organization_teams(self, org_login: str, cursor: Optional[str] = None) -> Dict[str, Any]:
        """Fetch teams for an organization with pagination"""
        query = """
        query($login: String!, $cursor: String) {
            organization(login: $login) {
                teams(first: 50, after: $cursor) {
                    pageInfo {
                        hasNextPage
                        endCursor
                    }
                    nodes {
                        id
                        name
                        slug
                        description
                        privacy
                        url
                        createdAt
                        updatedAt
                        members {
                            totalCount
                        }
                        repositories {
                            totalCount
                        }
                    }
                }
            }
        }
        """
        data = self._make_graphql_request(query, {"login": org_login, "cursor": cursor})
        return data.get("organization", {}).get("teams", {})
    
    def get_team_members(self, org_login: str, team_slug: str, cursor: Optional[str] = None) -> Dict[str, Any]:
        """Fetch members of a specific team with pagination"""
        query = """
        query($login: String!, $teamSlug: String!, $cursor: String) {
            organization(login: $login) {
                team(slug: $teamSlug) {
                    members(first: 50, after: $cursor) {
                        pageInfo {
                            hasNextPage
                            endCursor
                        }
                        edges {
                            role
                            node {
                                id
                                login
                                name
                                email
                            }
                        }
                    }
                }
            }
        }
        """
        data = self._make_graphql_request(query, {"login": org_login, "teamSlug": team_slug, "cursor": cursor})
        return data.get("organization", {}).get("team", {}).get("members", {})
    
    def get_team_repositories(self, org_login: str, team_slug: str, cursor: Optional[str] = None) -> Dict[str, Any]:
        """Fetch repositories accessible by a team with pagination"""
        query = """
        query($login: String!, $teamSlug: String!, $cursor: String) {
            organization(login: $login) {
                team(slug: $teamSlug) {
                    repositories(first: 50, after: $cursor) {
                        pageInfo {
                            hasNextPage
                            endCursor
                        }
                        edges {
                            permission
                            node {
                                id
                                nameWithOwner
                            }
                        }
                    }
                }
            }
        }
        """
        data = self._make_graphql_request(query, {"login": org_login, "teamSlug": team_slug, "cursor": cursor})
        return data.get("organization", {}).get("team", {}).get("repositories", {})
    
    def get_organization_members(self, org_login: str, cursor: Optional[str] = None, include_org_emails: bool = False) -> Dict[str, Any]:
        """Fetch members of an organization with pagination
        
        Args:
            org_login: Organization login name
            cursor: Pagination cursor
            include_org_emails: If True, fetch organizationVerifiedDomainEmails (requires org membership)
        """
        # Build the query dynamically based on whether we need org emails
        org_emails_field = ""
        if include_org_emails:
            org_emails_field = """
                            organizationVerifiedDomainEmails(login: $login)
            """
        
        query = f"""
        query($login: String!, $cursor: String) {{
            organization(login: $login) {{
                membersWithRole(first: 50, after: $cursor) {{
                    pageInfo {{
                        hasNextPage
                        endCursor
                    }}
                    edges {{
                        role
                        node {{
                            id
                            login
                            name
                            email
                            bio
                            company
                            location
                            websiteUrl
                            twitterUsername
                            createdAt
                            updatedAt
                            isHireable{org_emails_field}
                        }}
                    }}
                }}
            }}
        }}
        """
        data = self._make_graphql_request(query, {"login": org_login, "cursor": cursor})
        return data.get("organization", {}).get("membersWithRole", {})


def fetch_all_paginated(fetch_func, *args, **kwargs) -> List[Any]:
    """Helper to fetch all pages of a paginated GraphQL query with retry logic"""
    all_items = []
    cursor = None
    has_next_page = True
    max_retries = 3
    retry_delay = 5  # seconds
    
    while has_next_page:
        retries = 0
        while retries < max_retries:
            try:
                result = fetch_func(*args, cursor=cursor, **kwargs)
                
                # Handle different response structures
                if "nodes" in result:
                    items = result["nodes"]
                elif "edges" in result:
                    items = result["edges"]
                else:
                    break
                
                all_items.extend(items)
                
                page_info = result.get("pageInfo", {})
                has_next_page = page_info.get("hasNextPage", False)
                cursor = page_info.get("endCursor")
                
                logging.debug(f"Fetched {len(items)} items, total: {len(all_items)}, has_next: {has_next_page}")
                
                # Add a small delay between pages to avoid rate limiting (reduced for efficiency)
                if has_next_page:
                    import time
                    time.sleep(0.2)  # 200ms delay between pages
                
                break  # Success, exit retry loop
                
            except Exception as e:
                retries += 1
                if retries >= max_retries:
                    logging.error(f"Error during pagination after {max_retries} retries: {e}")
                    # Return what we have so far instead of failing completely
                    return all_items
                else:
                    logging.warning(f"Pagination error (attempt {retries}/{max_retries}), retrying in {retry_delay}s: {e}")
                    import time
                    time.sleep(retry_delay)
    
    return all_items


async def sync_github_entities(client: Client):
    """
    Sync function that fetches GitHub entities and ingests them with job tracking.
    This function is called periodically by the IngestorBuilder.
    """
    logging.info("Starting GitHub entity sync...")
    
    # Initialize GitHub client with appropriate authentication
    if GITHUB_TOKEN:
        logging.info("Using Personal Access Token authentication")
        github_client = GitHubClient(api_url=GITHUB_API_URL, token=GITHUB_TOKEN)
    else:
        logging.info("Using GitHub App authentication")
        github_app_auth = GitHubAppAuth(
            app_id=GITHUB_APP_ID or "",
            private_key=GITHUB_APP_PRIVATE_KEY or "",
            installation_id=GITHUB_APP_INSTALLATION_ID or "",
            rest_api_url=GITHUB_REST_API_URL
        )
        github_client = GitHubClient(api_url=GITHUB_API_URL, github_app_auth=github_app_auth)
    
    # Determine which organizations to sync
    if GITHUB_ORG:
        org_logins = [GITHUB_ORG]
    else:
        # Get viewer info to determine accessible organizations
        viewer = github_client.get_viewer()
        logging.info(f"Authenticated as: {viewer.get('login')}")
        # For now, require GITHUB_ORG to be set
        logging.error("GITHUB_ORG environment variable must be set")
        return
    
    datasource_id = github_instance_name
    
    # 1. Create/Update the datasource
    datasource_info = DataSourceInfo(
        datasource_id=datasource_id,
        ingestor_id=client.ingestor_id or "",
        description=f"GitHub entities from organization(s): {', '.join(org_logins)}",
        source_type="github",
        last_updated=int(time.time()),
        default_chunk_size=0,  # Skip chunking for graph entities
        default_chunk_overlap=0,
        metadata={
            "github_api_url": GITHUB_API_URL,
            "organizations": org_logins
        }
    )
    await client.upsert_datasource(datasource_info)
    logging.info(f"Created/updated datasource: {datasource_id}")
    
    # 2. Fetch all entities from GitHub
    all_entities: List[Entity] = []
    
    for org_login in org_logins:
        logging.info(f"Processing organization: {org_login}")
        
        # Create a job immediately when we start processing
        job_response = await client.create_job(
            datasource_id=datasource_id,
            job_status=JobStatus.IN_PROGRESS,
            message=f"Starting GitHub ingestion for {org_login}...",
            total=1  # Will update total once we know the counts
        )
        job_id = job_response["job_id"]
        logging.info(f"Created job {job_id} for datasource={datasource_id}")
        
        try:
            # Fetch organization data
            await client.update_job(
                job_id=job_id,
                job_status=JobStatus.IN_PROGRESS,
                message=f"Fetching organization metadata for {org_login}..."
            )
            org_data = github_client.get_organization(org_login)
            if not org_data:
                error_msg = f"Could not fetch organization {org_login}"
                await client.update_job(
                    job_id=job_id,
                    job_status=JobStatus.FAILED,
                    message=error_msg
                )
                logging.error(error_msg)
                continue
            
            # Fetch repositories
            await client.update_job(
                job_id=job_id,
                job_status=JobStatus.IN_PROGRESS,
                message=f"Fetching repositories for {org_login}..."
            )
            logging.info(f"Fetching repositories for {org_login}...")
            repos_data = fetch_all_paginated(github_client.get_organization_repositories, org_login)
            logging.info(f"Fetched {len(repos_data)} repositories")
            
            # Fetch teams
            await client.update_job(
                job_id=job_id,
                job_status=JobStatus.IN_PROGRESS,
                message=f"Fetching teams for {org_login}..."
            )
            logging.info(f"Fetching teams for {org_login}...")
            teams_data = fetch_all_paginated(github_client.get_organization_teams, org_login)
            logging.info(f"Fetched {len(teams_data)} teams")
            
            # Fetch organization members (users)
            await client.update_job(
                job_id=job_id,
                job_status=JobStatus.IN_PROGRESS,
                message=f"Fetching members for {org_login}..."
            )
            logging.info(f"Fetching members for {org_login}...")
            members_data = fetch_all_paginated(
                github_client.get_organization_members, 
                org_login, 
                include_org_emails=FETCH_ORG_EMAILS
            )
            logging.info(f"Fetched {len(members_data)} members")
            
            # Now update the total count
            total_entities = (
                1 +  # Organization
                len(repos_data) +
                len(teams_data) +
                len(members_data)
            )
            
            total_items = total_entities
            
            logging.info(f"Total items to process for {org_login}: {total_items} ({total_entities} entities)")
            
            # Update job with correct total
            await client.update_job(
                job_id=job_id,
                job_status=JobStatus.IN_PROGRESS,
                message=f"Fetching complete. Processing {total_items} entities...",
                total=total_items
            )
            
            if total_items == 0:
                await client.update_job(
                    job_id=job_id,
                    job_status=JobStatus.COMPLETED,
                    message=f"No items to process for {org_login}"
                )
                logging.info(f"No items to process for {org_login}")
                continue
            
            # Create Organization entity
            logging.info(f"Creating organization entity for {org_login}")
            await client.update_job(
                job_id=job_id,
                job_status=JobStatus.IN_PROGRESS,
                message="Converting organization metadata..."
            )
            org_entity = Entity(
                entity_type="GitHubOrganization",
                all_properties={
                    "github_instance": github_instance_name,
                    "id": org_data.get("id"),
                    "login": org_data.get("login"),
                    "name": org_data.get("name"),
                    "description": org_data.get("description"),
                    "email": org_data.get("email"),
                    "url": org_data.get("url"),
                    "website_url": org_data.get("websiteUrl"),
                    "location": org_data.get("location"),
                    "created_at": org_data.get("createdAt"),
                    "is_verified": org_data.get("isVerified"),
                    "twitter_username": org_data.get("twitterUsername"),
                },
                primary_key_properties=["github_instance", "id"],
                additional_key_properties=[["login"]]
            )
            all_entities.append(org_entity)
            await client.increment_job_progress(job_id, 1)
            logging.info("Organization entity created and tracked")
            
            # Convert Repositories
            logging.info(f"Converting {len(repos_data)} repositories to entities")
            await client.update_job(
                job_id=job_id,
                job_status=JobStatus.IN_PROGRESS,
                message=f"Converting {len(repos_data)} repositories..."
            )
            repos_converted = 0
            for repo in repos_data:
                try:
                    # Extract languages - safely handle None values
                    languages = []
                    if repo.get("languages") and repo.get("languages").get("nodes"):
                        languages = [lang["name"] for lang in repo["languages"]["nodes"]]
                    
                    # Safely get primary language
                    primary_language = None
                    primary_lang_data = repo.get("primaryLanguage")
                    if primary_lang_data and isinstance(primary_lang_data, dict):
                        primary_language = primary_lang_data.get("name")
                    
                    # Safely get default branch
                    default_branch = None
                    default_branch_data = repo.get("defaultBranchRef")
                    if default_branch_data and isinstance(default_branch_data, dict):
                        default_branch = default_branch_data.get("name")
                    
                    # Safely get license info
                    license_name = None
                    license_spdx = None
                    license_data = repo.get("licenseInfo")
                    if license_data and isinstance(license_data, dict):
                        license_name = license_data.get("name")
                        license_spdx = license_data.get("spdxId")
                    
                    # Safely get vulnerability alerts count
                    vulnerability_count = 0
                    vuln_data = repo.get("vulnerabilityAlerts")
                    if vuln_data and isinstance(vuln_data, dict):
                        vulnerability_count = vuln_data.get("totalCount", 0)
                    
                    repo_entity = Entity(
                        entity_type="GitHubRepository",
                        all_properties={
                            "github_instance": github_instance_name,
                            "organization": org_login,
                            "id": repo.get("id"),
                            "name": repo.get("name"),
                            "name_with_owner": repo.get("nameWithOwner"),
                            "description": repo.get("description"),
                            "url": repo.get("url"),
                            "created_at": repo.get("createdAt"),
                            "updated_at": repo.get("updatedAt"),
                            "pushed_at": repo.get("pushedAt"),
                            "is_private": repo.get("isPrivate", False),
                            "is_fork": repo.get("isFork", False),
                            "is_archived": repo.get("isArchived", False),
                            "is_locked": repo.get("isLocked", False),
                            "is_template": repo.get("isTemplate", False),
                            "is_empty": repo.get("isEmpty", False),
                            "default_branch": default_branch,
                            "languages": languages,
                            "primary_language": primary_language,
                            "stargazer_count": repo.get("stargazerCount", 0),
                            "fork_count": repo.get("forkCount", 0),
                            "disk_usage": repo.get("diskUsage"),
                            "license": license_name,
                            "license_spdx_id": license_spdx,
                            "visibility": repo.get("visibility"),
                            "has_projects_enabled": repo.get("hasProjectsEnabled", False),
                            "has_wiki_enabled": repo.get("hasWikiEnabled", False),
                            "vulnerability_alerts_count": vulnerability_count,
                            "security_policy_url": repo.get("securityPolicyUrl"),
                        },
                        primary_key_properties=["github_instance", "id"],
                        additional_key_properties=[
                            ["organization", "name_with_owner"],
                            ["organization", "name"],
                            ["url"]
                        ]
                    )
                    all_entities.append(repo_entity)
                    repos_converted += 1
                    
                    # Update progress every 50 repos
                    if repos_converted % 50 == 0:
                        await client.increment_job_progress(job_id, 50)
                        logging.info(f"Progress: {repos_converted}/{len(repos_data)} repositories converted")
                    
                except Exception as e:
                    logging.error(f"Error converting repository to Entity: {e}", exc_info=True)
                    await client.add_job_error(job_id, [f"Error converting repository: {str(e)}"])
                    await client.increment_job_failure(job_id, 1)
            
            # Update remaining repos progress
            remaining_repos = repos_converted % 50
            if remaining_repos > 0:
                await client.increment_job_progress(job_id, remaining_repos)
            logging.info(f"Completed converting {repos_converted} repositories")
            
            # Convert Teams
            logging.info(f"Converting {len(teams_data)} teams to entities")
            await client.update_job(
                job_id=job_id,
                job_status=JobStatus.IN_PROGRESS,
                message=f"Converting {len(teams_data)} teams and fetching members/permissions..."
            )
            teams_converted = 0
            for team in teams_data:
                try:
                    team_slug = team.get("slug")
                    
                    # Safely get counts
                    member_count = 0
                    if team.get("members"):
                        member_count = team["members"].get("totalCount", 0)
                    
                    repo_count = 0
                    if team.get("repositories"):
                        repo_count = team["repositories"].get("totalCount", 0)
                    
                    # Fetch team members and repos only if enabled (can create many API calls)
                    team_members = []
                    team_repos = []
                    members_info = []
                    repo_permissions = []
                    
                    if FETCH_TEAM_DETAILS and team_slug:
                        # Fetch team members with error handling
                        try:
                            team_members = fetch_all_paginated(
                                github_client.get_team_members,
                                org_login,
                                team_slug
                            )
                            # Extract member info
                            for edge in team_members:
                                if edge and edge.get("node"):
                                    members_info.append({
                                        "login": edge["node"].get("login"),
                                        "role": edge.get("role")
                                    })
                        except Exception as e:
                            logging.warning(f"Could not fetch members for team {team_slug}: {e}")
                        
                        # Fetch team repositories with error handling
                        try:
                            team_repos = fetch_all_paginated(
                                github_client.get_team_repositories,
                                org_login,
                                team_slug
                            )
                            # Extract repository permissions
                            for edge in team_repos:
                                if edge and edge.get("node"):
                                    repo_permissions.append({
                                        "repository": edge["node"].get("nameWithOwner"),
                                        "permission": edge.get("permission")
                                    })
                        except Exception as e:
                            logging.warning(f"Could not fetch repositories for team {team_slug}: {e}")
                    else:
                        if not FETCH_TEAM_DETAILS:
                            logging.debug(f"Skipping detailed member/repo fetch for team {team_slug} (FETCH_TEAM_DETAILS=false)")
                    
                    team_entity = Entity(
                        entity_type="GitHubTeam",
                        all_properties={
                            "github_instance": github_instance_name,
                            "organization": org_login,
                            "id": team.get("id"),
                            "name": team.get("name"),
                            "slug": team.get("slug"),
                            "description": team.get("description"),
                            "privacy": team.get("privacy"),
                            "url": team.get("url"),
                            "created_at": team.get("createdAt"),
                            "updated_at": team.get("updatedAt"),
                            "member_count": member_count,
                            "repository_count": repo_count,
                            "members": members_info,
                            "repository_permissions": repo_permissions,
                        },
                        primary_key_properties=["github_instance", "organization", "id"],
                        additional_key_properties=[
                            ["organization", "slug"],
                            ["organization", "name"],
                            ["url"]
                        ]
                    )
                    all_entities.append(team_entity)
                    teams_converted += 1
                    
                    # Update progress every 10 teams
                    if teams_converted % 10 == 0:
                        await client.increment_job_progress(job_id, 10)
                        logging.info(f"Progress: {teams_converted}/{len(teams_data)} teams converted")
                    
                except Exception as e:
                    logging.error(f"Error converting team to Entity: {e}", exc_info=True)
                    await client.add_job_error(job_id, [f"Error converting team: {str(e)}"])
                    await client.increment_job_failure(job_id, 1)
            
            # Update remaining teams progress
            remaining_teams = teams_converted % 10
            if remaining_teams > 0:
                await client.increment_job_progress(job_id, remaining_teams)
            logging.info(f"Completed converting {teams_converted} teams")
            
            # Convert Users (Organization Members)
            logging.info(f"Converting {len(members_data)} users to entities")
            await client.update_job(
                job_id=job_id,
                job_status=JobStatus.IN_PROGRESS,
                message=f"Converting {len(members_data)} organization members..."
            )
            users_converted = 0
            for member_edge in members_data:
                try:
                    member = member_edge["node"]
                    role = member_edge["role"]
                    
                    # Build user properties
                    user_properties = {
                        "github_instance": github_instance_name,
                        "id": member.get("id"),
                        "login": member.get("login"),
                        "name": member.get("name"),
                        "email": member.get("email"),
                        "bio": member.get("bio"),
                        "company": member.get("company"),
                        "location": member.get("location"),
                        "website_url": member.get("websiteUrl"),
                        "twitter_username": member.get("twitterUsername"),
                        "created_at": member.get("createdAt"),
                        "updated_at": member.get("updatedAt"),
                        "is_hireable": member.get("isHireable"),
                        "organization_role": role,
                    }
                    
                    # Add org verified domain emails if available
                    if FETCH_ORG_EMAILS and "organizationVerifiedDomainEmails" in member:
                        org_emails = member.get("organizationVerifiedDomainEmails", [])
                        if org_emails:
                            user_properties["organization_verified_emails"] = org_emails
                    
                    # Build additional key properties - include email lookups
                    additional_keys = [["login"]]
                    
                    # Add regular email as lookup key if present
                    if member.get("email"):
                        additional_keys.append(["email"])
                    
                    # Add each verified org email as a lookup key if enabled
                    if FETCH_ORG_EMAILS and "organizationVerifiedDomainEmails" in member:
                        org_emails = member.get("organizationVerifiedDomainEmails", [])
                        for org_email in org_emails:
                            if org_email:
                                additional_keys.append([org_email])
                    
                    user_entity = Entity(
                        entity_type="GitHubUser",
                        all_properties=user_properties,
                        primary_key_properties=["github_instance", "id"],
                        additional_key_properties=additional_keys
                    )
                    all_entities.append(user_entity)
                    users_converted += 1
                    
                    # Update progress every 50 users
                    if users_converted % 50 == 0:
                        await client.increment_job_progress(job_id, 50)
                        logging.info(f"Progress: {users_converted}/{len(members_data)} users converted")
                    
                except Exception as e:
                    logging.error(f"Error converting user to Entity: {e}", exc_info=True)
                    await client.add_job_error(job_id, [f"Error converting user: {str(e)}"])
                    await client.increment_job_failure(job_id, 1)
            
            # Update remaining users progress
            remaining_users = users_converted % 50
            if remaining_users > 0:
                await client.increment_job_progress(job_id, remaining_users)
            logging.info(f"Completed converting {users_converted} users")
            
            logging.info(f"Converted {len(all_entities)} GitHub items to Entity objects total")
            
            # 4. Ingest entities using automatic batching
            if all_entities:
                logging.info(f"Ingesting {len(all_entities)} entities with automatic batching")
                await client.update_job(
                    job_id=job_id,
                    job_status=JobStatus.IN_PROGRESS,
                    message=f"Ingesting {len(all_entities)} entities into RAG system..."
                )
                await client.ingest_entities(
                    job_id=job_id,
                    datasource_id=datasource_id,
                    entities=all_entities,
                    fresh_until=utils.get_default_fresh_until()
                )
                logging.info(f"Successfully ingested {len(all_entities)} entities")
            
            # Mark job as complete
            await client.update_job(
                job_id=job_id,
                job_status=JobStatus.COMPLETED,
                message=f"Successfully ingested {len(all_entities)} entities (Org: 1, Repos: {len(repos_data)}, Teams: {len(teams_data)}, Users: {len(members_data)})"
            )
            logging.info(f"Successfully completed ingestion: {len(all_entities)} entities total")
            
        except Exception as e:
            # Mark job as failed
            error_msg = f"Ingestion failed: {str(e)}"
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
        auth_method = "PAT" if GITHUB_TOKEN else "GitHub App"
        logging.info(f"Starting GitHub ingestor using IngestorBuilder with {auth_method} authentication...")
        
        # Use IngestorBuilder for simplified ingestor creation
        IngestorBuilder()\
            .name(github_instance_name)\
            .type("github")\
            .description("Ingestor for GitHub entities" + (f" from organization {GITHUB_ORG}" if GITHUB_ORG else ""))\
            .metadata({
                "github_api_url": GITHUB_API_URL,
                "github_org": GITHUB_ORG,
                "sync_interval": SYNC_INTERVAL,
                "auth_method": auth_method
            })\
            .sync_with_fn(sync_github_entities)\
            .every(SYNC_INTERVAL)\
            .with_init_delay(int(os.getenv("INIT_DELAY_SECONDS", "0")))\
            .run()
            
    except KeyboardInterrupt:
        logging.info("GitHub ingestor execution interrupted by user")
    except Exception as e:
        logging.error(f"GitHub ingestor failed: {e}", exc_info=True)

