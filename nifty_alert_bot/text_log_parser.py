from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path


LOG_PATTERN = re.compile(
    r"^(?P<timestamp>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}),\d+\s+\|\s+"
    r"(?P<level>[A-Z]+)\s+\|\s+(?P<logger>[^|]+)\|\s+(?P<message>.*)$"
)


def parse_text_logs(log_file: str, date_value: str, limit: int = 500) -> list[dict]:
    path = Path(log_file)
    if not path.exists():
        return []

    entries: list[dict] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            match = LOG_PATTERN.match(line.strip())
            if not match:
                continue

            timestamp = datetime.strptime(match.group("timestamp"), "%Y-%m-%d %H:%M:%S")
            if timestamp.date().isoformat() != date_value:
                continue

            message = match.group("message")
            entries.append(
                {
                    "date": date_value,
                    "run_at": timestamp.isoformat(),
                    "symbol": None,
                    "interval": None,
                    "status": match.group("level").lower(),
                    "message": message,
                    "alert_sent": "Alert sent:" in message or "Sample " in message,
                    "sample": "Sample " in message,
                    "signal": "BUY"
                    if "BUY" in message
                    else "SELL"
                    if "SELL" in message
                    else None,
                    "close": None,
                    "st_10_1": None,
                    "st_10_3": None,
                    "st_10_1_trend": None,
                    "st_10_3_trend": None,
                    "candle_time": None,
                    "source": "text_log",
                }
            )

    return list(reversed(entries[-limit:]))
