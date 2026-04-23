from __future__ import annotations

import json
import logging
from pathlib import Path

from pymongo import DESCENDING, MongoClient, ReplaceOne


logger = logging.getLogger(__name__)


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

    def _make_log_id(self, payload: dict) -> str:
        return (
            payload.get("log_id")
            or f"{payload.get('date')}::{payload.get('run_at')}::{payload.get('status')}::{payload.get('message')}"
        )

    def append_log(self, payload: dict) -> None:
        # 1. Write to local .jsonl file (intraday buffer, fast reads)
        path = self._path_for_date(payload["date"])
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, ensure_ascii=True) + "\n")

        # 2. Write to MongoDB immediately so the dashboard can read it live
        log_id = self._make_log_id(payload)
        mongo_payload = {**payload, "log_id": log_id}
        try:
            self.collection.update_one(
                {"log_id": log_id},
                {"$set": mongo_payload},
                upsert=True,
            )
        except Exception:
            logger.exception("Failed to write run log to MongoDB for run_at=%s", payload.get("run_at"))

    def load_logs(self, date_value: str, limit: int = 500) -> list[dict]:
        # Always prefer local .jsonl for today (most up-to-date, avoids round-trip)
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

        # Fall back to MongoDB for past dates (local file has been archived/deleted)
        cursor = (
            self.collection.find({"date": date_value}, {"_id": 0})
            .sort("run_at", DESCENDING)
            .limit(limit)
        )
        return list(cursor)

    def local_dates(self) -> list[str]:
        return sorted(path.stem for path in self.logs_dir.glob("*.jsonl"))

    def archive_date(self, date_value: str) -> int:
        """
        Flush a past date's local .jsonl file to MongoDB (upsert), then delete
        the local file. Since append_log already writes to MongoDB in real time,
        this is mostly a cleanup step to remove the local file and catch any
        entries that may have been missed (e.g. if MongoDB was temporarily down).
        """
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
                payload["log_id"] = self._make_log_id(payload)
                entries.append(payload)

        if not entries:
            path.unlink(missing_ok=True)
            return 0

        operations = [
            ReplaceOne({"log_id": entry["log_id"]}, entry, upsert=True)
            for entry in entries
        ]
        try:
            self.collection.bulk_write(operations, ordered=False)
        except Exception:
            logger.exception("Failed to bulk-archive run logs for date=%s to MongoDB.", date_value)
            return 0

        path.unlink(missing_ok=True)
        return len(entries)