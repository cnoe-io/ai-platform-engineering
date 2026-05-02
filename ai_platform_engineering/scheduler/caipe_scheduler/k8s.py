"""Kubernetes CronJob lifecycle.

Owns the full podTemplate spec — callers can only fill the schedule, timezone,
and a SCHEDULE_ID env var. Image, command, RBAC, mounts, and resource limits
are baked in here so dynamic-agents (or any other caller) cannot escalate
privileges via this path.
"""

from __future__ import annotations

import logging
import re

from kubernetes import client, config
from kubernetes.client.exceptions import ApiException

from caipe_scheduler.config import Settings

log = logging.getLogger(__name__)


_NAME_RE = re.compile(r"[^a-z0-9-]+")


def _sanitize_name(s: str) -> str:
    """Squeeze a string into a valid k8s resource name fragment."""
    s = s.lower().replace("_", "-")
    s = _NAME_RE.sub("", s)
    s = s.strip("-")
    return s[:40] or "x"


def cronjob_name_for(schedule_id: str) -> str:
    """k8s resource names: ≤ 52 chars, RFC 1123, deterministic from schedule_id."""
    suffix = _sanitize_name(schedule_id)
    return f"caipe-sched-{suffix}"


class CronJobOps:
    def __init__(self, settings: Settings):
        self._settings = settings
        try:
            config.load_incluster_config()
        except config.ConfigException:
            try:
                config.load_kube_config()
            except Exception:
                log.warning(
                    "No kube config found; CronJobOps will fail on real calls. "
                    "OK for unit tests with mocked client."
                )
        self._batch = client.BatchV1Api()

    # ── public ──────────────────────────────────────────────────────────
    def create(
        self,
        *,
        schedule_id: str,
        cron: str,
        tz: str,
    ) -> str:
        """Create the CronJob for the given schedule. Returns its name."""
        name = cronjob_name_for(schedule_id)
        body = self._build_body(name=name, schedule_id=schedule_id, cron=cron, tz=tz)
        try:
            self._batch.create_namespaced_cron_job(
                namespace=self._settings.namespace, body=body
            )
        except ApiException as e:
            log.error(
                "CronJob create failed: name=%s status=%s body=%s",
                name,
                e.status,
                e.body,
            )
            raise
        return name

    def patch(
        self, *, cronjob_name: str, cron: str | None = None, tz: str | None = None,
        suspend: bool | None = None,
    ) -> None:
        body: dict = {"spec": {}}
        if cron is not None:
            body["spec"]["schedule"] = cron
        if tz is not None:
            body["spec"]["timeZone"] = tz
        if suspend is not None:
            body["spec"]["suspend"] = suspend
        if not body["spec"]:
            return
        self._batch.patch_namespaced_cron_job(
            name=cronjob_name, namespace=self._settings.namespace, body=body
        )

    def delete(self, cronjob_name: str) -> None:
        try:
            self._batch.delete_namespaced_cron_job(
                name=cronjob_name,
                namespace=self._settings.namespace,
                propagation_policy="Foreground",
            )
        except ApiException as e:
            if e.status == 404:
                log.info("CronJob %s already gone, ignoring delete", cronjob_name)
                return
            raise

    # ── body builder ────────────────────────────────────────────────────
    def _build_body(
        self, *, name: str, schedule_id: str, cron: str, tz: str
    ) -> dict:
        s = self._settings
        labels = {
            "app.kubernetes.io/name": "caipe-cron-runner",
            "app.kubernetes.io/managed-by": "caipe-scheduler",
            "caipe.cisco.com/schedule-id": _sanitize_name(schedule_id),
        }
        owner_refs = self._owner_references()
        body: dict = {
            "apiVersion": "batch/v1",
            "kind": "CronJob",
            "metadata": {
                "name": name,
                "namespace": s.namespace,
                "labels": labels,
                **({"ownerReferences": owner_refs} if owner_refs else {}),
            },
            "spec": {
                "schedule": cron,
                "timeZone": tz,
                "concurrencyPolicy": "Forbid",
                "successfulJobsHistoryLimit": 3,
                "failedJobsHistoryLimit": 3,
                "startingDeadlineSeconds": 600,
                "jobTemplate": {
                    "metadata": {"labels": labels},
                    "spec": {
                        "backoffLimit": 2,
                        "ttlSecondsAfterFinished": 86400,
                        "template": {
                            "metadata": {"labels": labels},
                            "spec": {
                                "serviceAccountName": s.cron_runner_service_account,
                                "restartPolicy": "OnFailure",
                                "automountServiceAccountToken": False,
                                "containers": [
                                    {
                                        "name": "runner",
                                        "image": s.cron_runner_image,
                                        "imagePullPolicy": "IfNotPresent",
                                        "env": [
                                            {"name": "SCHEDULE_ID", "value": schedule_id},
                                            {"name": "SCHEDULER_INTERNAL_URL", "value": s.scheduler_internal_url},
                                            {"name": "CAIPE_API_URL", "value": s.caipe_api_url},
                                            {
                                                "name": "CAIPE_API_TOKEN",
                                                "valueFrom": {
                                                    "secretKeyRef": {
                                                        "name": s.caipe_api_token_secret,
                                                        "key": s.caipe_api_token_secret_key,
                                                    }
                                                },
                                            },
                                            {
                                                "name": "SCHEDULER_SERVICE_TOKEN",
                                                "valueFrom": {
                                                    "secretKeyRef": {
                                                        "name": "caipe-scheduler-service-token",
                                                        "key": "token",
                                                    }
                                                },
                                            },
                                        ],
                                        "resources": {
                                            "requests": {"cpu": "20m", "memory": "64Mi"},
                                            "limits": {"cpu": "100m", "memory": "128Mi"},
                                        },
                                        "securityContext": {
                                            "allowPrivilegeEscalation": False,
                                            "readOnlyRootFilesystem": True,
                                            "runAsNonRoot": True,
                                            "capabilities": {"drop": ["ALL"]},
                                            "seccompProfile": {"type": "RuntimeDefault"},
                                        },
                                    }
                                ],
                            },
                        },
                    },
                },
            },
        }
        return body

    def _owner_references(self) -> list[dict] | None:
        s = self._settings
        if not (s.owner_deployment_name and s.owner_deployment_uid):
            return None
        return [
            {
                "apiVersion": "apps/v1",
                "kind": "Deployment",
                "name": s.owner_deployment_name,
                "uid": s.owner_deployment_uid,
                "controller": True,
                "blockOwnerDeletion": True,
            }
        ]
