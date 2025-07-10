# Copyright 2025 Cisco
# SPDX-License-Identifier: Apache-2.0

"""User management tools for PagerDuty MCP"""

from typing import Dict, Any, Optional, List
import logging
from pydantic import BaseModel
from ..api.client import make_api_request

logger = logging.getLogger("pagerduty_mcp")

class User(BaseModel):
    """Model for user"""
    type: str = "user"
    name: str
    email: str
    role: str = "user"
    job_title: Optional[str] = None
    time_zone: str = "UTC"

class ContactMethod(BaseModel):
    """Model for contact method"""
    type: str
    address: str
    label: Optional[str] = None
    send_short_email: bool = False

async def get_users(
    team_ids: Optional[List[str]] = None,
    query: Optional[str] = None,
    include: Optional[List[str]] = None,
    limit: int = 100,
) -> Dict[str, Any]:
    """
    Get users from PagerDuty with filtering options

    Args:
        team_ids: Filter users by team IDs
        query: Search query for users
        include: Additional fields to include in the response
        limit: Maximum number of users to return (default: 100)

    Returns:
        List of users with pagination information
    """
    params = {}

    if team_ids:
        params["team_ids[]"] = team_ids

    if query:
        params["query"] = query

    if include:
        params["include[]"] = include

    params["limit"] = limit

    success, data = await make_api_request("users", params=params)

    if not success:
        return {"error": data.get("error", "Failed to retrieve users")}

    return data

async def create_user(
    name: str,
    email: str,
    role: str = "user",
    job_title: Optional[str] = None,
    time_zone: str = "UTC",
) -> Dict[str, Any]:
    """
    Create a new user in PagerDuty

    Args:
        name: The name of the user (required)
        email: The email address of the user (required)
        role: The role of the user (admin, user, observer, restricted_access)
        job_title: The job title of the user
        time_zone: The time zone of the user (default: UTC)

    Returns:
        The created user details
    """
    user_data = {
        "user": {
            "type": "user",
            "name": name,
            "email": email,
            "role": role,
            "time_zone": time_zone,
        }
    }

    if job_title:
        user_data["user"]["job_title"] = job_title

    success, data = await make_api_request("users", method="POST", data=user_data)

    if success:
        logger.info(f"User '{name}' created successfully")
        return data
    else:
        logger.error(f"Failed to create user '{name}': {data.get('error')}")
        return {"error": data.get("error", "Failed to create user")}

async def update_user(
    id: str,
    name: Optional[str] = None,
    email: Optional[str] = None,
    role: Optional[str] = None,
    job_title: Optional[str] = None,
    time_zone: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Update an existing user in PagerDuty

    Args:
        id: The ID of the user to update (required)
        name: New name for the user
        email: New email address for the user
        role: New role for the user
        job_title: New job title for the user
        time_zone: New time zone for the user

    Returns:
        The updated user details
    """
    user_data = {"user": {}}

    if name:
        user_data["user"]["name"] = name

    if email:
        user_data["user"]["email"] = email

    if role:
        user_data["user"]["role"] = role

    if job_title:
        user_data["user"]["job_title"] = job_title

    if time_zone:
        user_data["user"]["time_zone"] = time_zone

    success, data = await make_api_request(f"users/{id}", method="PUT", data=user_data)

    if success:
        logger.info(f"User '{id}' updated successfully")
        return data
    else:
        logger.error(f"Failed to update user '{id}': {data.get('error')}")
        return {"error": data.get("error", "Failed to update user")}

async def add_contact_method(
    user_id: str,
    type: str,
    address: str,
    label: Optional[str] = None,
    send_short_email: bool = False,
) -> Dict[str, Any]:
    """
    Add a contact method to a user

    Args:
        user_id: The ID of the user (required)
        type: The type of contact method (email, phone, sms, push)
        address: The contact address (email or phone number)
        label: A label for the contact method
        send_short_email: Whether to send short emails for notifications

    Returns:
        The created contact method details
    """
    contact_data = {
        "contact_method": {
            "type": type,
            "address": address,
            "send_short_email": send_short_email,
        }
    }

    if label:
        contact_data["contact_method"]["label"] = label

    success, data = await make_api_request(f"users/{user_id}/contact_methods", method="POST", data=contact_data)

    if success:
        logger.info(f"Contact method added to user '{user_id}' successfully")
        return data
    else:
        logger.error(f"Failed to add contact method to user '{user_id}': {data.get('error')}")
        return {"error": data.get("error", "Failed to add contact method")} 