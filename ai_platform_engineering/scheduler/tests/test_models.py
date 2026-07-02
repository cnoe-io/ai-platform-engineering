import pytest
from pydantic import ValidationError

from caipe_scheduler.models import ScheduleCreate


def test_schedule_create_rejects_caller_supplied_owner():
  with pytest.raises(ValidationError, match="owner_user_id"):
    ScheduleCreate(
      agent_id="agent-weekly-report",
      title="Weekly report",
      message_template="Create the weekly report.",
      cron="0 9 * * MON",
      tz="Etc/UTC",
      owner_user_id="victim@example.com",
    )
