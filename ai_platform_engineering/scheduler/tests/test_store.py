from caipe_scheduler.store import ScheduleStore, _case_insensitive_exact_match


class _FakeCursor(list):
    def sort(self, *_args, **_kwargs):
        return self


class _FakeCollection:
    def __init__(self):
        self.last_query = None

    def find(self, query):
        self.last_query = query
        return _FakeCursor()


def test_list_filters_pod_id_case_insensitively():
    store = ScheduleStore.__new__(ScheduleStore)
    store._col = _FakeCollection()

    store.list(
        owner_user_id="empowers@cisco.com",
        pod_id="mycelium-team",
        agent_id="agent-sunny-webex-meeting-writeup-runner",
    )

    assert store._col.last_query == {
        "owner_user_id": "empowers@cisco.com",
        "pod_id": {"$regex": r"^mycelium\-team$", "$options": "i"},
        "agent_id": "agent-sunny-webex-meeting-writeup-runner",
    }


def test_case_insensitive_pod_filter_escapes_regex_metacharacters():
    assert _case_insensitive_exact_match("pod.team+1") == {
        "$regex": r"^pod\.team\+1$",
        "$options": "i",
    }
