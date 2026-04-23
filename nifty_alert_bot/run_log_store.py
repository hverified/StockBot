from __future__ import annotations

import json
from pathlib import Path

from pymongo import DESCENDING, MongoClient, ReplaceOne


class RunLogStore:
    def __init__(
        self,
        logs_dir: str,
        mongodb_uri: str,
        database: str,
        collection: str,
    ) -> None:
        self.logs_dir = Path(logs_dir)
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        self.client = MongoClient(mongodb_uri)
        self.collection = self.client[database][collection]
        self.collection.create_index([("date", DESCENDING), ("run_at", DESCENDING)])
        self.collection.create_index("log_id", unique=True)

    def _path_for_date(self, date_value: str) -> Path:
        return self.logs_dir / f"{date_value}.jsonl"

    def append_log(self, payload: dict) -> None:
        path = self._path_for_date(payload["date"])
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, ensure_ascii=True) + "\n")

    def load_logs(self, date_value: str, limit: int = 500) -> list[dict]:
        path = self._path_for_date(date_value)
        if path.exists():
            entries: list[dict] = []
            with path.open("r", encoding="utf-8") as handle:
                for line in handle:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entries.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
            return list(reversed(entries[-limit:]))

        cursor = (
            self.collection.find({"date": date_value}, {"_id": 0})
            .sort("run_at", DESCENDING)
            .limit(limit)
        )
        return list(cursor)

    def local_dates(self) -> list[str]:
        return sorted(path.stem for path in self.logs_dir.glob("*.jsonl"))

    def archive_date(self, date_value: str) -> int:
        path = self._path_for_date(date_value)
        if not path.exists():
            return 0

        entries: list[dict] = []
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    payload = json.loads(line)
                except json.JSONDecodeError:
                    continue
                payload["log_id"] = (
                    payload.get("log_id")
                    or f"{payload.get('date')}::{payload.get('run_at')}::{payload.get('status')}::{payload.get('message')}"
                )
                entries.append(payload)

        if not entries:
            path.unlink(missing_ok=True)
            return 0

        operations = [
            ReplaceOne({"log_id": entry["log_id"]}, entry, upsert=True) for entry in entries
        ]
        self.collection.bulk_write(operations, ordered=False)
        path.unlink(missing_ok=True)
        return len(entries)
