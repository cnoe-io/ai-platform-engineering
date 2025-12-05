"""Attachment operations for Jira MCP"""

import logging
import os
from mcp_jira.api.client import make_api_request
from mcp_jira.models.jira.common import JiraAttachment
from mcp_jira.tools.jira.constants import check_read_only

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp-jira")

# Refactor download_attachment to return a JiraAttachment object
async def download_attachment(url: str, target_path: str) -> JiraAttachment:
    """Download a Jira attachment to the specified path and return a JiraAttachment object."""
    logger.debug(f"Downloading attachment from {url} to {target_path}")
    if not url:
        logger.error("No URL provided for attachment download")
        return None

    try:
        # Convert to absolute path if relative
        if not os.path.isabs(target_path):
            target_path = os.path.abspath(target_path)

        logger.info(f"Downloading attachment from {url} to {target_path}")

        # Create the directory if it doesn't exist
        os.makedirs(os.path.dirname(target_path), exist_ok=True)

        # Use the Jira session to download the file
        response = await make_api_request(url, stream=True)
        response.raise_for_status()

        # Write the file to disk
        with open(target_path, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)

        # Verify the file was created
        if os.path.exists(target_path):
            file_size = os.path.getsize(target_path)
            logger.info(
                f"Successfully downloaded attachment to {target_path} (size: {file_size} bytes)"
            )
            return JiraAttachment(filename=os.path.basename(target_path), url=url, size=file_size)
        else:
            logger.error(f"File was not created at {target_path}")
            return None

    except Exception as e:
        logger.error(f"Error downloading attachment: {str(e)}")
        return None

# Refactor upload_attachment to accept and return JiraAttachment objects
async def upload_attachment(issue_key: str, attachment: JiraAttachment) -> JiraAttachment:
    """Upload a single attachment to a Jira issue and return the updated JiraAttachment object.

    Raises:
        ValueError: If in read-only mode.
    """
    check_read_only()

    logger.debug(f"Uploading attachment {attachment.filename} to issue {issue_key}")
    if not issue_key:
        logger.error("No issue key provided for attachment upload")
        return None

    if not attachment or not attachment.filename:
        logger.error("No attachment provided for upload")
        return None

    try:
        # Use the Jira API to upload the file
        with open(attachment.filename, "rb") as file:
            success, response  = await make_api_request(
                f"/rest/api/2/issue/{issue_key}/attachments", method="POST", files={"file": file}
            )

        if success and response:
            logger.info(
                f"Successfully uploaded attachment {attachment.filename} to {issue_key}"
            )
            attachment.id = response.get("id") if isinstance(response, dict) else None
            return attachment
        else:
            logger.error(f"Failed to upload attachment {attachment.filename} to {issue_key}: {response}")
            return None

    except Exception as e:
        logger.error(f"Error uploading attachment: {str(e)}")
        return None

async def get_issue_attachments(issue_key: str) -> list[JiraAttachment]:
    """Retrieve all attachments for a Jira issue."""
    logger.debug(f"Fetching attachments for issue {issue_key}")
    response = await make_api_request(f"/rest/api/2/issue/{issue_key}?fields=attachment")
    issue_data = response.json()

    if not isinstance(issue_data, dict):
        msg = f"Unexpected return value type from `jira.issue`: {type(issue_data)}"
        logger.error(msg)
        raise TypeError(msg)

    if "fields" not in issue_data:
        logger.error(f"Could not retrieve issue {issue_key}")
        return []

    # Extract attachments from the API response
    attachment_data = issue_data.get("fields", {}).get("attachment", [])

    if not attachment_data:
        return []

    # Create JiraAttachment objects for each attachment
    attachments = []
    for attachment in attachment_data:
        if isinstance(attachment, dict):
            attachments.append(JiraAttachment(**attachment))

    return attachments
