from dataclasses import dataclass
from typing import Any

from caipe_cron_runner import runner


@dataclass
class _Response:
  body: dict[str, Any]
  status_code: int = 200
  text: str = ""

  @property
  def is_error(self) -> bool:
    return self.status_code >= 400

  def raise_for_status(self) -> None:
    if self.is_error:
      raise RuntimeError(f"HTTP {self.status_code}")

  def json(self) -> dict[str, Any]:
    return self.body


class _Client:
  def __init__(self, schedule: dict[str, Any]) -> None:
    self.schedule = schedule
    self.post_calls: list[tuple[str, dict[str, Any]]] = []

  def __enter__(self):
    return self

  def __exit__(self, exc_type, exc, tb):
    return False

  def get(self, _url: str, **_kwargs: Any) -> _Response:
    return _Response(self.schedule)

  def post(self, url: str, **kwargs: Any) -> _Response:
    self.post_calls.append((url, kwargs))
    return _Response({"success": True})


def _env(monkeypatch) -> None:
  monkeypatch.setenv("SCHEDULE_ID", "sched-1")
  monkeypatch.setenv("SCHEDULER_INTERNAL_URL", "http://scheduler")
  monkeypatch.setenv("SCHEDULER_SERVICE_TOKEN", "service-token")
  monkeypatch.setenv("CAIPE_API_URL", "http://ui")
  monkeypatch.delenv("ONE_OFF_RUN_ID", raising=False)


def test_runner_uses_scheduler_token_without_forwarding_owner_bearer(monkeypatch) -> None:
  _env(monkeypatch)
  client = _Client(
    {
      "schedule_id": "sched-1",
      "agent_id": "agent-1",
      "owner_user_id": "owner@example.com",
      "message_template": "Generate the report",
      "enabled": True,
    }
  )
  monkeypatch.setattr(runner.httpx, "Client", lambda **_kwargs: client)

  assert runner.main() == 0

  chat_url, chat_request = client.post_calls[0]
  assert chat_url == "http://ui/api/v1/chat/invoke"
  assert chat_request["headers"] == {
    "Content-Type": "application/json",
    "X-Scheduler-Token": "service-token",
    "X-Client-Source": "caipe-cron-runner",
  }
  assert "Authorization" not in chat_request["headers"]
  assert "owner_user_id" not in chat_request["json"]
  assert chat_request["json"]["client_context"]["schedule_id"] == "sched-1"
  assert chat_request["json"]["client_context"]["run_id"] == chat_request["json"]["trace_id"]

  report_url, report_request = client.post_calls[1]
  assert report_url == "http://scheduler/v1/schedules/sched-1/runs"
  assert report_request["json"]["status"] == "ok"


def test_disabled_recurring_schedule_does_not_invoke_chat(monkeypatch) -> None:
  _env(monkeypatch)
  client = _Client(
    {
      "schedule_id": "sched-1",
      "agent_id": "agent-1",
      "owner_user_id": "owner@example.com",
      "message_template": "Generate the report",
      "enabled": False,
    }
  )
  monkeypatch.setattr(runner.httpx, "Client", lambda **_kwargs: client)

  assert runner.main() == 0
  assert client.post_calls == []
