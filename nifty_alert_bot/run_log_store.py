from __future__ import annotations

import json
from collections import deque
from pathlib import Path


class RunLogStore:
    def __init__(self, logs_dir: str) -> None:
        self.logs_dir = Path(logs_dir)
        self.logs_dir.mkdir(parents=True, exist_ok=True)

    def _path_for_date(self, date_value: str) -> Path:
        return self.logs_dir / f"{date_value}.jsonl"

    def append_log(self, payload: dict) -> None:
        path = self._path_for_date(payload["date"])
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, ensure_ascii=True) + "\n")

    def load_logs(self, date_value: str, limit: int = 500) -> list[dict]:
        path = self._path_for_date(date_value)
        if path.exists():
            entries: deque[dict] = deque(maxlen=limit)
            with path.open("r", encoding="utf-8") as handle:
                for line in handle:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entries.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
            return list(reversed(entries))

        return []
