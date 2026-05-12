"""Tests for generic SQS webhook proxy receiver defaults."""

# assisted-by Codex Codex-sonnet-4-6

from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch


SRC_DIR = Path(__file__).resolve().parents[1] / "src"


class ReceiverDefaultsTest(TestCase):
    def _load_forwarder(self):
        for key in (
            "SQS_QUEUE_NAME",
            "CAIPE_WEBHOOK_URL",
            "AWS_ASSUME_ROLE_SESSION_NAME",
            "AWS_REGION",
            "AWS_DEFAULT_REGION",
        ):
            os.environ.pop(key, None)
        sys.path.insert(0, str(SRC_DIR))
        sys.modules.pop("caipe_forwarder", None)
        return importlib.import_module("caipe_forwarder")

    def test_defaults_are_generic_and_caipe_compatible(self):
        forwarder = self._load_forwarder()

        self.assertEqual(forwarder.SQS_QUEUE_NAME, "webhook-deliveries")
        self.assertEqual(
            forwarder.CAIPE_WEBHOOK_URL,
            "http://caipe-ui:3000/api/agentic-sdlc/webhooks/github",
        )
        self.assertEqual(
            forwarder.AWS_ASSUME_ROLE_SESSION_NAME,
            "sqs-webhook-proxy-receiver",
        )
        self.assertEqual(forwarder.log.name, "sqs-webhook-proxy-receiver")
        self.assertEqual(forwarder._resolve_region(), "us-east-1")

    def test_forwarder_marks_requests_with_generic_receiver_header(self):
        forwarder = self._load_forwarder()

        with patch.object(forwarder.requests, "post") as post:
            forwarder._forward_to_caipe(
                event_name="issues",
                raw_payload='{"action":"opened"}',
                delivery_id="delivery-1",
                signature="sha256=test",
            )

        headers = post.call_args.kwargs["headers"]
        self.assertEqual(
            headers["X-CAIPE-Forwarder"],
            "sqs-webhook-proxy-receiver",
        )
