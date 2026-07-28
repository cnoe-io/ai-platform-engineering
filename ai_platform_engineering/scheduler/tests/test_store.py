from caipe_scheduler.store import ScheduleStore


class _FakeCursor(list):
  def sort(self, *_args, **_kwargs):
    return self


class _FakeCollection:
  def __init__(self):
    self.last_query = None
    self.last_update = None

  def find(self, query):
    self.last_query = query
    return _FakeCursor()

  def update_one(self, query, update):
    self.last_query = query
    self.last_update = update


def test_list_filters_by_owner_and_agent():
  store = ScheduleStore.__new__(ScheduleStore)
  store._col = _FakeCollection()

  store.list(
    owner_sub="keycloak-user-id",
    owner_user_id="operator@example.com",
    agent_id="agent-weekly-report",
  )

  assert store._col.last_query == {
    "$or": [
      {"owner_sub": "keycloak-user-id"},
      {
        "owner_sub": {"$exists": False},
        "owner_user_id": "operator@example.com",
      },
    ],
    "agent_id": "agent-weekly-report",
  }


def test_list_ignores_empty_optional_filters():
  store = ScheduleStore.__new__(ScheduleStore)
  store._col = _FakeCollection()

  store.list(owner_user_id="", agent_id=None)

  assert store._col.last_query == {}


def test_record_change_event_caps_embedded_history():
  store = ScheduleStore.__new__(ScheduleStore)
  store._col = _FakeCollection()
  event = {"event_id": "evt_1", "event_type": "runner_image_reconciled"}

  store.record_change_event("schedule-1", event)

  assert store._col.last_query == {"schedule_id": "schedule-1"}
  assert store._col.last_update == {
    "$push": {
      "events": {
        "$each": [event],
        "$slice": -50,
      }
    }
  }
