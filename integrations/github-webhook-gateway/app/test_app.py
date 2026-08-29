"""Unit tests for the GitHub webhook SNS gateway."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
from unittest import TestCase
from unittest.mock import patch

import app


class GitHubWebhookGatewayTest(TestCase):
    def setUp(self) -> None:
        os.environ["SNS_TOPIC_ARN"] = "arn:aws:sns:us-east-1:123456789012:webhooks"

    def test_valid_delivery_is_published_without_reserialising_payload(self) -> None:
        secret = "test-secret"
        payload = '{"action":"edited","repository":{"id":123}}'
        signature = "sha256=" + hmac.new(
            secret.encode(), payload.encode(), hashlib.sha256
        ).hexdigest()
        event = {
            "headers": {
                "Content-Type": "application/json",
                "X-GitHub-Event": "issues",
                "X-GitHub-Delivery": "delivery-1",
                "X-Hub-Signature-256": signature,
            },
            "body": payload,
            "isBase64Encoded": False,
        }

        with (
            patch.object(app, "_get_secret", return_value=secret),
            patch.object(app, "_publish") as publish,
        ):
            response = app.lambda_handler(event, None)

        self.assertEqual(response["statusCode"], 200)
        envelope = json.loads(publish.call_args.args[0])
        self.assertEqual(envelope["payload"], payload)
        self.assertEqual(envelope["headers"]["x-github-event"], "issues")

    def test_invalid_signature_is_rejected(self) -> None:
        event = {
            "headers": {
                "content-type": "application/json",
                "x-hub-signature-256": "sha256=invalid",
            },
            "body": "{}",
            "isBase64Encoded": False,
        }

        with (
            patch.object(app, "_get_secret", return_value="test-secret"),
            patch.object(app, "_publish") as publish,
        ):
            response = app.lambda_handler(event, None)

        self.assertEqual(response["statusCode"], 401)
        publish.assert_not_called()

    def test_base64_delivery_verifies_the_decoded_bytes(self) -> None:
        secret = "test-secret"
        payload = b'{"zen":"example"}'
        signature = "sha256=" + hmac.new(
            secret.encode(), payload, hashlib.sha256
        ).hexdigest()
        event = {
            "headers": {
                "content-type": "application/json; charset=utf-8",
                "x-hub-signature-256": signature,
            },
            "body": base64.b64encode(payload).decode(),
            "isBase64Encoded": True,
        }

        with (
            patch.object(app, "_get_secret", return_value=secret),
            patch.object(app, "_publish") as publish,
        ):
            response = app.lambda_handler(event, None)

        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(json.loads(publish.call_args.args[0])["payload"], payload.decode())
