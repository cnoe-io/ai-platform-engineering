"""Unit tests for the RAG common ingestor Client authentication parsing."""

import os
import pytest
from common.ingestor import Client


class TestIngestorClientVerifySSL:
    def test_default_verify_ssl_is_true(self, monkeypatch):
        monkeypatch.delenv("INGESTOR_OIDC_VERIFY_SSL", raising=False)
        client = Client(ingestor_name="test", ingestor_type="test")
        assert client.oidc_verify_ssl is True

    @pytest.mark.parametrize("env_val", ["true", "1", "yes", "TRUE", "  Yes  "])
    def test_verify_ssl_true_parsing(self, monkeypatch, env_val):
        monkeypatch.setenv("INGESTOR_OIDC_VERIFY_SSL", env_val)
        client = Client(ingestor_name="test", ingestor_type="test")
        assert client.oidc_verify_ssl is True

    @pytest.mark.parametrize("env_val", ["false", "0", "no", "FALSE", "  No  "])
    def test_verify_ssl_false_parsing(self, monkeypatch, env_val):
        monkeypatch.setenv("INGESTOR_OIDC_VERIFY_SSL", env_val)
        client = Client(ingestor_name="test", ingestor_type="test")
        assert client.oidc_verify_ssl is False

    def test_verify_ssl_invalid_parsing_raises_value_error(self, monkeypatch):
        monkeypatch.setenv("INGESTOR_OIDC_VERIFY_SSL", "invalid_val")
        with pytest.raises(ValueError) as excinfo:
            Client(ingestor_name="test", ingestor_type="test")
        assert "INGESTOR_OIDC_VERIFY_SSL must be one of" in str(excinfo.value)
