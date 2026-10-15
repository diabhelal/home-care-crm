from datetime import time
from zoneinfo import ZoneInfo

from app.models import Booking, Staff
from app.scheduling import conflicts, db_weekday, is_valid_slot, slots_for_day
from tests.conftest import local

TZ = ZoneInfo("Asia/Jerusalem")
S = Staff(1, "A", "nurse", slot_minutes=60)


def bk(h, m=0, addr="A st"):
    return Booking(1, "p", 1, "checkup", local(18, h, m), visit_address=addr)


def test_buffer_inside_different_address():
    # existing 10:00-11:00; candidate 11:20 -> only 20 min gap
    assert conflicts(local(18, 11, 20), "B st", S, [bk(10)], 30)


def test_buffer_exactly_30_ok_different_address():
    assert not conflicts(local(18, 11, 30), "B st", S, [bk(10)], 30)


def test_buffer_before_existing():
    # candidate 08:50-09:50 vs existing 10:00 -> 10 min gap
    assert conflicts(local(18, 8, 50), "B st", S, [bk(10)], 30)
    assert not conflicts(local(18, 8, 30), "B st", S, [bk(10)], 30)


def test_same_address_no_buffer():
    assert not conflicts(local(18, 11, 0), "a  ST", S, [bk(10)], 30)


def test_overlap_always_conflicts_even_same_address():
    assert conflicts(local(18, 10, 30), "A st", S, [bk(10)], 30)


def test_cancelled_ignored():
    b = bk(10).with_(status="cancelled")
    assert not conflicts(local(18, 10), "B", S, [b], 30)


def test_working_weekday_and_hours():
    assert db_weekday(local(18, 8).date()) == 0  # Sunday
    assert len(slots_for_day(S, local(18, 8).date(), TZ)) == 10  # 08..18
    assert slots_for_day(S, local(16, 8).date(), TZ) == []  # Friday
    assert slots_for_day(S, local(17, 8).date(), TZ) == []  # Saturday


def test_valid_slot_grid():
    assert is_valid_slot(S, local(18, 9), TZ)
    assert not is_valid_slot(S, local(18, 9, 30), TZ)
    assert not is_valid_slot(S, local(18, 18), TZ)
    assert not is_valid_slot(S, local(18, 7), TZ)
