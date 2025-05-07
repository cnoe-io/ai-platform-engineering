# Copyright 2025 Cisco
# SPDX-License-Identifier: Apache-2.0


import logging
import os
from typing import Dict, List, Optional

from fastapi import FastAPI
from pydantic import BaseModel
from langchain.tools import BaseTool
from langchain_core.tools import tool

from .tools import (
    get_incidents,
    get_services,
    get_users,
    get_schedules,
    get_oncalls,
    create_incident,
    update_incident,
    resolve_incident,
    acknowledge_incident,
)

logger = logging.getLogger(__name__)

app = FastAPI(title="PagerDuty MCP Server")

class ToolRequest(BaseModel):
    name: str
    args: Dict[str, str]

class ToolResponse(BaseModel):
    result: str

@app.post("/tools/{tool_name}")
async def execute_tool(tool_name: str, request: ToolRequest) -> ToolResponse:
    """Execute a PagerDuty tool."""
    logger.info(f"Executing tool: {tool_name}")
    
    # Map tool names to their functions
    tool_map = {
        "get_incidents": get_incidents,
        "get_services": get_services,
        "get_users": get_users,
        "get_schedules": get_schedules,
        "get_oncalls": get_oncalls,
        "create_incident": create_incident,
        "update_incident": update_incident,
        "resolve_incident": resolve_incident,
        "acknowledge_incident": acknowledge_incident,
    }
    
    if tool_name not in tool_map:
        raise ValueError(f"Unknown tool: {tool_name}")
    
    tool_func = tool_map[tool_name]
    result = await tool_func(**request.args)
    
    return ToolResponse(result=str(result))

@app.get("/health")
async def health_check() -> Dict[str, str]:
    """Health check endpoint."""
    return {"status": "healthy"} 