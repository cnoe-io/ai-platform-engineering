"""Generic AI assistant endpoint for LLM-powered suggestions.

Provides a thin, generic wrapper around LLMFactory for simple text generation.
No agent orchestration, no tools, no conversation persistence — just a direct
LLM call with a system prompt and user message.
"""

import logging

from cnoe_agent_utils import LLMFactory
from fastapi import APIRouter, Depends, HTTPException
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from dynamic_agents.auth.auth import UserContext, get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/assistant", tags=["assistant"])

MAX_INPUT_CHARS = 4000
MAX_OUTPUT_TOKENS = 2000


class SuggestRequest(BaseModel):
    """Request for a generic LLM suggestion."""

    system_prompt: str = Field(..., description="System prompt for the LLM")
    user_message: str = Field(..., description="User message for the LLM")
    model_id: str = Field(..., description="LLM model ID")
    model_provider: str = Field(..., description="LLM provider (e.g. aws-bedrock, azure-openai)")


class SuggestResponse(BaseModel):
    """Response from the LLM suggestion."""

    content: str = Field(..., description="Generated text content")


@router.post("/suggest", response_model=SuggestResponse)
async def suggest(
    request: SuggestRequest,
    user: UserContext = Depends(get_current_user),
) -> SuggestResponse:
    """Generate a suggestion using the specified LLM model.

    This is a generic, stateless LLM call — no agent graph, no tools,
    no conversation history. The caller provides the full system prompt
    and user message.
    """
    # Validate input length
    if len(request.system_prompt) > MAX_INPUT_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"system_prompt exceeds maximum length of {MAX_INPUT_CHARS} characters",
        )
    if len(request.user_message) > MAX_INPUT_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"user_message exceeds maximum length of {MAX_INPUT_CHARS} characters",
        )

    logger.info(
        "AI suggest request from user=%s, model=%s/%s, system_prompt_len=%d, user_message_len=%d",
        user.email,
        request.model_provider,
        request.model_id,
        len(request.system_prompt),
        len(request.user_message),
    )

    try:
        llm = LLMFactory(provider=request.model_provider).get_llm(
            model=request.model_id,
        )
        result = await llm.ainvoke(
            [
                SystemMessage(content=request.system_prompt),
                HumanMessage(content=request.user_message),
            ]
        )
        # result.content may be a plain string or a list of content blocks
        # (e.g. [{'type': 'text', 'text': '...', 'index': 0}])
        raw = result.content
        if isinstance(raw, str):
            content = raw
        elif isinstance(raw, list):
            content = "".join(block.get("text", "") if isinstance(block, dict) else str(block) for block in raw)
        else:
            content = str(raw)

        logger.info(
            "AI suggest completed for user=%s, response_len=%d",
            user.email,
            len(content),
        )

        return SuggestResponse(content=content)

    except Exception as exc:
        logger.error(
            "AI suggest failed for user=%s, model=%s/%s: %s",
            user.email,
            request.model_provider,
            request.model_id,
            str(exc),
            exc_info=exc,
        )
        raise HTTPException(
            status_code=500,
            detail="Failed to generate suggestion. Please try again.",
        ) from exc
