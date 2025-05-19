# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Tools for /api/v1/certificates operations"""

import logging
from typing import Dict, Any, Optional
from agent_argocd.protocol_bindings.mcp_server.mcp_argocd.api.client import make_api_request

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("mcp_tools")


async def CertificateService_ListCertificates(
        hostNamePattern: Optional[str] = None,
        certType: Optional[str] = None,
        certSubType: Optional[str] = None) -> Dict[str, Any]:
    """
    List all available repository certificates

    Returns:
        API response data
    """
    logger.debug("Making GET request to /api/v1/certificates")
    params = {}
    data = None
    # Add parameters to request
    if hostNamePattern is not None:
        params["hostNamePattern"] = hostNamePattern
    if certType is not None:
        params["certType"] = certType
    if certSubType is not None:
        params["certSubType"] = certSubType
    success, response = await make_api_request(
        "/api/v1/certificates",
        method="GET",
        params=params,
        data=data
    )
    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get('error', 'Request failed')}
    return response

async def CertificateService_CreateCertificate(body: str, upsert: Optional[str] = None) -> Dict[str, Any]:
    """
    Creates repository certificates on the server

    Returns:
        API response data
    """
    logger.debug("Making POST request to /api/v1/certificates")
    params = {}
    data = None
    # Add parameters to request
    if body is not None:
        data = body
    if upsert is not None:
        params["upsert"] = upsert
    success, response = await make_api_request(
        "/api/v1/certificates",
        method="POST",
        params=params,
        data=data
    )
    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get('error', 'Request failed')}
    return response

async def CertificateService_DeleteCertificate(
        hostNamePattern: Optional[str] = None,
        certType: Optional[str] = None,
        certSubType: Optional[str] = None) -> Dict[str, Any]:
    """
    Delete the certificates that match the RepositoryCertificateQuery

    Returns:
        API response data
    """
    logger.debug("Making DELETE request to /api/v1/certificates")
    params = {}
    data = None
    # Add parameters to request
    if hostNamePattern is not None:
        params["hostNamePattern"] = hostNamePattern
    if certType is not None:
        params["certType"] = certType
    if certSubType is not None:
        params["certSubType"] = certSubType
    success, response = await make_api_request(
        "/api/v1/certificates",
        method="DELETE",
        params=params,
        data=data
    )
    if not success:
        logger.error(f"Request failed: {response.get('error')}")
        return {"error": response.get('error', 'Request failed')}
    return response
