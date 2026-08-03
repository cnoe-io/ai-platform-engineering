from types import SimpleNamespace

from kubernetes import client

from caipe_scheduler.k8s import CronJobOps


def _settings():
    return SimpleNamespace(
        namespace="caipe",
        owner_deployment_name=None,
        owner_deployment_uid=None,
        cron_runner_service_account="caipe-cron-runner",
        cron_runner_image="cron-runner:test",
        cron_runner_image_pull_policy="IfNotPresent",
        scheduler_internal_url="http://caipe-scheduler:8080",
        caipe_api_url="http://caipe-web:3000",
        caipe_chat_path="/api/v1/chat/invoke",
        caipe_api_token_secret="caipe-api-token",
        caipe_api_token_secret_key="token",
    )


def _ops():
    ops = CronJobOps.__new__(CronJobOps)
    ops._settings = _settings()
    return ops


def _runner_env_from_body(body):
    return body["spec"]["jobTemplate"]["spec"]["template"]["spec"]["containers"][0][
        "env"
    ]


def _cronjob_with_env(env):
    return client.V1CronJob(
        spec=client.V1CronJobSpec(
            schedule="0 9 * * *",
            job_template=client.V1JobTemplateSpec(
                spec=client.V1JobSpec(
                    template=client.V1PodTemplateSpec(
                        spec=client.V1PodSpec(
                            containers=[client.V1Container(name="runner", env=env)]
                        )
                    )
                )
            ),
        )
    )


class _FakeBatch:
    def __init__(self, cronjob):
        self.cronjob = cronjob
        self.patches = []

    def read_namespaced_cron_job(self, *, name, namespace):
        return self.cronjob

    def patch_namespaced_cron_job(self, *, name, namespace, body, **kwargs):
        self.patches.append({"body": body, "kwargs": kwargs})


def test_build_body_includes_default_http_timeout_when_unset():
    body = _ops()._build_body(
        name="caipe-sched-test",
        schedule_id="sched_test",
        cron="0 9 * * *",
        tz="UTC",
    )

    env = _runner_env_from_body(body)

    assert {"name": "HTTP_TIMEOUT", "value": "300"} in env


def test_build_body_includes_http_timeout_when_set():
    body = _ops()._build_body(
        name="caipe-sched-test",
        schedule_id="sched_test",
        cron="0 9 * * *",
        tz="UTC",
        http_timeout_seconds=900,
    )

    env = _runner_env_from_body(body)

    assert {"name": "HTTP_TIMEOUT", "value": "900"} in env


def test_patch_sets_http_timeout_env():
    cronjob = _cronjob_with_env(
        [
            client.V1EnvVar(name="SCHEDULE_ID", value="sched_test"),
            client.V1EnvVar(name="HTTP_TIMEOUT", value="300"),
            client.V1EnvVar(
                name="CAIPE_API_TOKEN",
                value_from=client.V1EnvVarSource(
                    secret_key_ref=client.V1SecretKeySelector(
                        name="caipe-api-token",
                        key="token",
                    )
                ),
            ),
        ]
    )
    batch = _FakeBatch(cronjob)
    ops = _ops()
    ops._batch = batch

    ops.patch(cronjob_name="caipe-sched-test", http_timeout_seconds=900)

    patch = batch.patches[0]
    env = patch["body"][0]["value"]
    secret_env = next(item for item in env if item["name"] == "CAIPE_API_TOKEN")

    assert patch["kwargs"] == {"_content_type": "application/json-patch+json"}
    assert [item for item in env if item["name"] == "HTTP_TIMEOUT"] == [
        {"name": "HTTP_TIMEOUT", "value": "900"}
    ]
    assert secret_env["valueFrom"]["secretKeyRef"]["name"] == "caipe-api-token"
    assert secret_env["valueFrom"]["secretKeyRef"]["key"] == "token"
