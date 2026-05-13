# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

"""Tests for autonomous_agents Pydantic models."""

import pydantic
import pytest

from autonomous_agents.models import (
    CronTrigger,
    IntervalTrigger,
    TaskDefinition,
    TaskStatus,
    TriggerType,
    WebhookTrigger,
)


class TestTriggerTypes:
    """Trigger model discriminator and basic field defaults."""

    def test_cron_trigger_type(self):
        """CronTrigger reports ``TriggerType.CRON`` and round-trips ``schedule``."""
        trigger = CronTrigger(schedule="0 9 * * *")
        assert trigger.type == TriggerType.CRON
        assert trigger.schedule == "0 9 * * *"

    def test_interval_trigger_type(self):
        """IntervalTrigger reports ``TriggerType.INTERVAL``."""
        trigger = IntervalTrigger(minutes=30)
        assert trigger.type == TriggerType.INTERVAL
        assert trigger.minutes == 30

    def test_webhook_trigger_type(self):
        """WebhookTrigger reports ``TriggerType.WEBHOOK``."""
        trigger = WebhookTrigger()
        assert trigger.type == TriggerType.WEBHOOK

    def test_webhook_trigger_optional_secret(self):
        """``secret`` is optional on WebhookTrigger."""
        trigger = WebhookTrigger(secret="my-secret")
        assert trigger.secret == "my-secret"

        trigger_no_secret = WebhookTrigger()
        assert trigger_no_secret.secret is None


class TestTaskDefinition:
    """TaskDefinition construction defaults and validation."""

    def test_task_definition_cron(self):
        """CronTrigger task constructs with sensible defaults."""
        task = TaskDefinition(
            id="daily-scan",
            name="Daily Scan",
            agent="github",
            prompt="Scan for vulnerabilities",
            trigger=CronTrigger(schedule="0 9 * * 1-5"),
        )
        assert task.id == "daily-scan"
        assert task.enabled is True
        assert task.trigger.type == TriggerType.CRON

    def test_task_definition_disabled_by_default_is_true(self):
        """``enabled`` defaults to True."""
        task = TaskDefinition(
            id="test",
            name="Test",
            agent="github",
            prompt="test prompt",
            trigger=IntervalTrigger(minutes=10),
        )
        assert task.enabled is True

    def test_task_definition_can_be_disabled(self):
        """``enabled=False`` is honoured."""
        task = TaskDefinition(
            id="test",
            name="Test",
            agent="github",
            prompt="test prompt",
            trigger=IntervalTrigger(hours=1),
            enabled=False,
        )
        assert task.enabled is False


class TestTaskStatus:
    """TaskStatus enum string values."""

    def test_task_status_values(self):
        """Status names match the persisted string values."""
        assert TaskStatus.PENDING == "pending"
        assert TaskStatus.RUNNING == "running"
        assert TaskStatus.SUCCESS == "success"
        assert TaskStatus.FAILED == "failed"


class TestPerTaskA2AOverrides:
    """Per-task ``timeout_seconds`` override."""

    def test_task_definition_a2a_overrides_default_to_none(self):
        """Without an override the field is None so the scheduler uses Settings."""
        task = TaskDefinition(
            id="test",
            name="Test",
            agent="github",
            prompt="x",
            trigger=CronTrigger(schedule="* * * * *"),
        )
        assert task.timeout_seconds is None

    def test_task_definition_accepts_per_task_overrides(self):
        """Explicit override is stored verbatim."""
        task = TaskDefinition(
            id="test",
            name="Test",
            agent="github",
            prompt="x",
            trigger=CronTrigger(schedule="* * * * *"),
            timeout_seconds=42.5,
        )
        assert task.timeout_seconds == 42.5

    def test_task_definition_rejects_non_positive_timeout(self):
        """``timeout_seconds`` must be strictly positive."""
        for bad in (0, -1, -0.5):
            with pytest.raises(pydantic.ValidationError):
                TaskDefinition(
                    id="test",
                    name="Test",
                    agent="github",
                    prompt="x",
                    trigger=CronTrigger(schedule="* * * * *"),
                    timeout_seconds=bad,
                )

    def test_task_definition_rejects_inf_and_nan_timeout(self):
        """``inf`` / ``-inf`` / ``nan`` timeouts are rejected at construction."""
        for bad in (float("inf"), float("-inf"), float("nan")):
            with pytest.raises(pydantic.ValidationError):
                TaskDefinition(
                    id="test",
                    name="Test",
                    agent="github",
                    prompt="x",
                    trigger=CronTrigger(schedule="* * * * *"),
                    timeout_seconds=bad,
                )
