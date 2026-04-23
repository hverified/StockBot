from __future__ import annotations

from datetime import date, datetime, time, timedelta


WEEKDAYS = {0, 1, 2, 3, 4}


def parse_hhmm(value: str) -> time:
    hours, minutes = value.split(":")
    return time(hour=int(hours), minute=int(minutes))


def session_slots(
    day: date,
    start_time: time,
    end_time: time,
    interval_minutes: int,
    buffer_seconds: int,
    tzinfo,
) -> list[datetime]:
    current = datetime.combine(day, start_time, tzinfo=tzinfo).replace(second=buffer_seconds)
    end = datetime.combine(day, end_time, tzinfo=tzinfo).replace(second=buffer_seconds)
    slots: list[datetime] = []

    while current <= end:
        slots.append(current)
        current += timedelta(minutes=interval_minutes)

    return slots


def next_run_at(
    now: datetime,
    start_hhmm: str,
    end_hhmm: str,
    interval_minutes: int,
    buffer_seconds: int,
) -> datetime:
    start_time = parse_hhmm(start_hhmm)
    end_time = parse_hhmm(end_hhmm)
    current_day = now.date()

    for day_offset in range(8):
        candidate_day = current_day + timedelta(days=day_offset)
        if candidate_day.weekday() not in WEEKDAYS:
            continue

        for slot in session_slots(
            candidate_day,
            start_time,
            end_time,
            interval_minutes,
            buffer_seconds,
            now.tzinfo,
        ):
            if slot > now:
                return slot

    raise RuntimeError("Unable to compute the next scheduled run.")
