# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import logging
import os
from typing import Any, Iterable

from langchain_openai import AzureChatOpenAI, ChatOpenAI
from langchain_anthropic import ChatAnthropic
from langchain_google_genai import ChatGoogleGenerativeAI


class LLMFactory:
  """Factory that returns a *ready‑to‑use* LangChain chat model.

  Parameters
  ----------
  provider : {"azure-openai", "openai", "anthropic-claude", "google-gemini"}
      Which LLM backend to use.
  """

  SUPPORTED_PROVIDERS = {"azure-openai", "openai", "anthropic-claude", "google-gemini"}

  # ------------------------------------------------------------------ #
  # Construction helpers
  # ------------------------------------------------------------------ #

  def __init__(self, provider: str | None = None) -> None:
    if provider is None:
      provider = os.getenv("LLM_PROVIDER")
      if provider is None:
        raise ValueError(
          "Provider must be specified as one of: azure-openai, openai, anthropic-claude, "
          "or set the LLM_PROVIDER environment variable"
        )
    if provider not in self.SUPPORTED_PROVIDERS:
      raise ValueError(
        f"Unsupported provider: {self.provider}. Supported providers are: {self.SUPPORTED_PROVIDERS}"
      )
    self.provider = provider.lower().replace("-", "_")

  # ------------------------------------------------------------------ #
  # Public helpers
  # ------------------------------------------------------------------ #

  def get_llm(
    self,
    response_format: str | dict | None = None,
    tools: Iterable[Any] | None = None,
    strict_tools: bool = True,
    temperature: float | None = None,
    **kwargs,
  ):
    """Return a LangChain chat model, optionally bound to *tools*.

    The returned object is an instance of ``ChatOpenAI``,
    ``AzureChatOpenAI`` or ``ChatAnthropic`` depending on the selected
    *provider*.
    """

    builder = getattr(self, f"_build_{self.provider}_llm")
    llm = builder(response_format, temperature, **kwargs)
    return llm.bind_tools(tools, strict=strict_tools) if tools else llm

  # ------------------------------------------------------------------ #
  # Internal builders (one per provider)
  # ------------------------------------------------------------------ #

  def _build_azure_openai_llm(
    self,
    response_format: str | dict | None,
    temperature: float | None,
    **kwargs,
  ):
    deployment = os.getenv("AZURE_OPENAI_DEPLOYMENT")
    api_version = os.getenv("AZURE_OPENAI_API_VERSION")
    endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
    api_key = os.getenv("AZURE_OPENAI_API_KEY")

    if not all([deployment, api_version, endpoint, api_key]):
      raise EnvironmentError(
        "Missing one or more Azure OpenAI environment variables "
        "(AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_DEPLOYMENT, "
        "AZURE_OPENAI_API_KEY, AZURE_OPENAI_API_VERSION)."
      )

    logging.info(
      f"[LLM] AzureOpenAI deployment={deployment} api_version={api_version}"
    )

    model_kwargs = {"response_format": response_format} if response_format else {}
    return AzureChatOpenAI(
      azure_endpoint=endpoint,
      azure_deployment=deployment,
      openai_api_key=api_key,
      api_version=api_version,
      temperature=temperature if temperature is not None else 0,
      max_tokens=None,
      timeout=None,
      max_retries=5,
      model_kwargs=model_kwargs,
      **kwargs,
    )

  def _build_openai_llm(
    self,
    response_format: str | dict | None,
    temperature: float | None,
    **kwargs,
  ):
    api_key = os.getenv("OPENAI_API_KEY")
    base_url = os.getenv("OPENAI_ENDPOINT", "https://api.openai.com/v1")
    model_name = os.getenv("OPENAI_MODEL_NAME", "gpt-4o-mini")

    if not api_key:
      raise EnvironmentError("OPENAI_API_KEY environment variable is required")

    logging.info(f"[LLM] OpenAI model={model_name} endpoint={base_url}")

    model_kwargs = {"response_format": response_format} if response_format else {}
    return ChatOpenAI(
      model_name=model_name,
      api_key=api_key,
      base_url=base_url,
      temperature=temperature if temperature is not None else 0,
      model_kwargs=model_kwargs,
      **kwargs,
    )

  def _build_anthropic_claude_llm(
    self,
    response_format: str | dict | None,
    temperature: float | None,
    **kwargs,
  ):
    api_key = os.getenv("ANTHROPIC_API_KEY")
    model_name = os.getenv("ANTHROPIC_MODEL_NAME", "claude-3-sonnet-20240229")

    if not api_key:
      raise EnvironmentError("ANTHROPIC_API_KEY environment variable is required")

    logging.info(f"[LLM] Anthropic model={model_name}")

    model_kwargs = {"response_format": response_format} if response_format else {}
    return ChatAnthropic(
      model_name=model_name,
      anthropic_api_key=api_key,
      temperature=temperature if temperature is not None else 0,
      max_tokens=None,
      timeout=None,
      model_kwargs=model_kwargs,
      **kwargs,
    )

  def _build_google_gemini_llm(
    self,
    response_format: str | dict | None,
    temperature: float | None,
    **kwargs,
  ):

    api_key = os.getenv("GOOGLE_API_KEY")
    model_name = os.getenv("GOOGLE_GEMINI_MODEL_NAME", "gemini-2.0-flash")

    if not api_key:
      raise EnvironmentError("GOOGLE_API_KEY environment variable is required")

    logging.info(f"[LLM] Google Gemini model={model_name}")

    model_kwargs = {"response_format": response_format} if response_format else {}
    return ChatGoogleGenerativeAI(
      model=model_name,
      google_api_key=api_key,
      temperature=temperature if temperature is not None else 0,
      model_kwargs=model_kwargs,
      **kwargs,
    )