import os
from unittest import TestCase, mock
from cnoe_agent_utils import LLMFactory
from langchain_openai import AzureChatOpenAI


class TestLLMFactory(TestCase):
    @mock.patch.dict(
        os.environ,
        {
            "LLM_PROVIDER": "azure-openai",
            "AZURE_OPENAI_DEPLOYMENT": "test-deployment",
            "AZURE_OPENAI_API_VERSION": "2024-07-01-preview",
            "AZURE_OPENAI_ENDPOINT": "https://test.openai.azure.com",
            "AZURE_OPENAI_API_KEY": "test-key",
        },
    )
    @mock.patch("langchain_openai.AzureChatOpenAI")
    def test_get_llm_azure_openai(self, MockAzureChatOpenAI):
        factory = LLMFactory()
        llm = factory.get_llm()
        MockAzureChatOpenAI.assert_called_once_with(
            azure_endpoint="https://test.openai.azure.com",
            azure_deployment="test-deployment",
            openai_api_key="test-key",
            api_version="2024-07-01-preview",
            temperature=0,
            max_tokens=None,
            timeout=None,
            max_retries=5,
            model_kwargs={},
        )
        self.assertIsNotNone(llm)

    @mock.patch.dict(
        os.environ,
        {
            "LLM_PROVIDER": "openai",
            "OPENAI_API_KEY": "test-key",
            "OPENAI_ENDPOINT": "https://api.openai.com/v1",
            "OPENAI_MODEL_NAME": "gpt-4o-mini",
        },
    )
    @mock.patch("langchain_openai.ChatOpenAI")
    def test_get_llm_openai(self, MockChatOpenAI):
        factory = LLMFactory()
        llm = factory.get_llm()
        MockChatOpenAI.assert_called_once_with(
            model_name="gpt-4o-mini",
            api_key="test-key",
            base_url="https://api.openai.com/v1",
            temperature=0,
            model_kwargs={},
        )
        self.assertIsNotNone(llm)

    @mock.patch.dict(os.environ, {"LLM_PROVIDER": "invalid-provider"})
    def test_get_llm_invalid_provider(self):
        with self.assertRaises(ValueError) as context:
            LLMFactory()
        self.assertIn("Unsupported provider: invalid-provider", str(context.exception)) 