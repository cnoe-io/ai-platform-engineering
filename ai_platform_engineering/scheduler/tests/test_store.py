from caipe_scheduler.store import ScheduleStore


class _FakeCursor(list):
  def sort(self, *_args, **_kwargs):
    return self


class _FakeCollection:
  def __init__(self):
    self.last_query = None

  def find(self, query):
    self.last_query = query
    return _FakeCursor()


def test_list_filters_by_owner_and_agent():
  store = ScheduleStore.__new__(ScheduleStore)
  store._col = _FakeCollection()

  store.list(
    owner_user_id="operator@example.com",
    agent_id="agent-weekly-report",
  )

  assert store._col.last_query == {
    "owner_user_id": "operator@example.com",
    "agent_id": "agent-weekly-report",
  }


def test_list_ignores_empty_optional_filters():
  store = ScheduleStore.__new__(ScheduleStore)
  store._col = _FakeCollection()

  store.list(owner_user_id="", agent_id=None)

  assert store._col.last_query == {}
