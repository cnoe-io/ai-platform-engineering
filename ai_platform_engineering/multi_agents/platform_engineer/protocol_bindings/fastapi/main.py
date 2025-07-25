# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

import logging

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from ai_platform_engineering.multi_agents.platform_engineer.supervisor_agent import AIPlatformEngineerMAS
from ai_platform_engineering.utils.models.generic_agent import UserPrompt

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("mas.ai_platform_engineer.main")

app = FastAPI()
# Add CORS middleware
app.add_middleware(
  CORSMiddleware,
  allow_origins=["*"],  # Replace "*" with specific origins if needed
  allow_credentials=True,
  allow_methods=["*"],  # Allow all HTTP methods
  allow_headers=["*"],  # Allow all headers
)

mas_graph = AIPlatformEngineerMAS()


@app.post("/agent/prompt")
async def handle_prompt(request: UserPrompt):
  """
  This endpoint processes the prompt using the exchange graph and returns the result.
  Args:
    request (UserPrompt): The input prompt from the user.
  Returns:
    dict: A dictionary containing the response from the ExchangeGraph.
  """
  try:
    # Process the prompt using the exchange graph
    result = await mas_graph.serve(request.prompt)
    logger.info(f"Final result from LangGraph: {result}")
    return {"response": result}
  except ValueError as ve:
    raise HTTPException(status_code=400, detail=str(ve))
  except Exception as e:
    raise HTTPException(status_code=500, detail=f"Operation failed: {str(e)}")


@app.get("/health")
async def health_check():
  return {"status": "ok"}
