"""File-related tools for Slack MCP Server"""

import logging
import os
from typing import Dict, Any, Optional, List, BinaryIO
from pydantic import BaseModel
from ..api.client import make_api_request

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("slack_mcp")

class FileModel(BaseModel):
    """Model for Slack file"""
    id: str
    name: str
    title: Optional[str] = ""
    mimetype: Optional[str] = ""
    filetype: Optional[str] = ""
    user: Optional[str] = ""
    created: Optional[int] = 0
    size: Optional[int] = 0
    url_private: Optional[str] = ""
    permalink: Optional[str] = ""

async def list_files(
    limit: int = 100,
    cursor: Optional[str] = None,
    channel: Optional[str] = None,
    user: Optional[str] = None,
    types: Optional[str] = None
) -> Dict[str, Any]:
    """
    List files in the Slack workspace.
    
    Args:
        limit: Maximum number of files to return (default: 100)
        cursor: Pagination cursor for large result sets
        channel: Optional channel ID to filter files by
        user: Optional user ID to filter files by
        types: Optional comma-separated list of file types to filter by
        
    Returns:
        Dict containing files and pagination metadata
        
    Example response: 
        {
            "files": [{"id": "F12345", "name": "document.pdf", ...}],
            "response_metadata": {"next_cursor": "..."}
        }
    """
    logger.debug("Getting files with filters:")
    logger.debug(f"Limit: {limit}")
    logger.debug(f"Cursor: {cursor}")
    logger.debug(f"Channel: {channel}")
    logger.debug(f"User: {user}")
    logger.debug(f"Types: {types}")

    params = {
        "limit": limit
    }
    if cursor:
        params["cursor"] = cursor
    if channel:
        params["channel"] = channel
    if user:
        params["user"] = user
    if types:
        params["types"] = types

    logger.debug(f"Making API request with params: {params}")
    success, data = await make_api_request("files.list", params=params)
    
    if not success:
        logger.error(f"Failed to list files: {data.get('error')}")
        return {"error": data.get("error", "Failed to list files")}

    files = data.get("files", [])
    logger.info(f"Successfully retrieved {len(files)} files")
    
    return {
        "files": files,
        "response_metadata": data.get("response_metadata", {})
    }

async def upload_file(
    channel_id: str,
    file_path: str,
    title: Optional[str] = None,
    initial_comment: Optional[str] = None
) -> Dict[str, Any]:
    """
    Upload a file to a Slack channel.
    
    Args:
        channel_id: ID of the channel to upload to
        file_path: Path to the file to upload
        title: Optional title for the file
        initial_comment: Optional comment to include with the file
        
    Returns:
        Dict containing the uploaded file details
        
    Example response: 
        {
            "file": {"id": "F12345", "name": "document.pdf", ...}
        }
    """
    logger.debug(f"Uploading file from path: {file_path}")
    logger.debug(f"Target channel: {channel_id}")
    logger.debug(f"File title: {title}")
    logger.debug(f"Initial comment provided: {initial_comment is not None}")

    try:
        with open(file_path, 'rb') as f:
            files = {'file': f}
            data = {
                'channels': channel_id,
            }
            if title:
                data['title'] = title
            if initial_comment:
                data['initial_comment'] = initial_comment

            logger.debug(f"Making API request with file upload data")
            success, response = await make_api_request(
                "files.upload",
                method="POST",
                data=data,
                files=files
            )
            
            if success:
                logger.info(f"Successfully uploaded file to channel {channel_id}")
                return {"file": response.get("file", {})}
            else:
                logger.error(f"Failed to upload file: {response.get('error')}")
                return {"error": response.get("error", "Failed to upload file")}
    except Exception as e:
        logger.error(f"Exception during file upload: {str(e)}")
        return {"error": f"Failed to upload file: {str(e)}"}

async def get_file_info(file_id: str) -> Dict[str, Any]:
    """
    Get information about a specific file.
    
    Args:
        file_id: ID of the file to retrieve information for
        
    Returns:
        Dict containing file information
        
    Example response: 
        {
            "file": {"id": "F12345", "name": "document.pdf", ...}
        }
    """
    logger.debug(f"Getting info for file ID: {file_id}")

    success, data = await make_api_request(
        "files.info",
        params={"file": file_id}
    )
    
    if success:
        logger.info(f"Successfully retrieved info for file {file_id}")
        return {"file": data.get("file", {})}
    else:
        logger.error(f"Failed to get file info: {data.get('error')}")
        return {"error": data.get("error", "Failed to get file info")}

async def delete_file(file_id: str) -> Dict[str, Any]:
    """
    Delete a file from Slack.
    
    Args:
        file_id: ID of the file to delete
        
    Returns:
        Dict indicating success or failure
        
    Example response: 
        {"success": true}
    """
    logger.debug(f"Deleting file with ID: {file_id}")

    success, data = await make_api_request(
        "files.delete",
        method="POST",
        data={"file": file_id}
    )
    
    if success:
        logger.info(f"Successfully deleted file {file_id}")
        return {"success": True}
    else:
        logger.error(f"Failed to delete file: {data.get('error')}")
        return {"error": data.get("error", "Failed to delete file")}