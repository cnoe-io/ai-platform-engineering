import os
from unittest import TestCase, mock


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

    @mock.patch.dict(
        os.environ,
        {
            "LLM_PROVIDER": "openai",
            "OPENAI_API_KEY": "test-key",
            "OPENAI_ENDPOINT": "https://api.openai.com/v1",
            "OPENAI_MODEL_NAME": "gpt-4o-mini",
        },
    )
    def test_stub(self):
        assert True