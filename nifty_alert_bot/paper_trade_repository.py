from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from pymongo import MongoClient


logger = logging.getLogger(__name__)


class PaperTradeRepository:
    def __init__(self, mongodb_uri: str, database: str, collection: str) -> None:
        self.client = MongoClient(mongodb_uri)
        self.collection = self.client[database][collection]
        self.collection.create_index("trade_id", unique=True)
        self.collection.create_index([("trade_date", -1), ("entry_time", -1)])
        self.collection.create_index("status")
        self.collection.create_index([("doc_type", 1), ("timestamp", -1)])
        self.collection.create_index("event_id", unique=True, sparse=True)

    def close(self) -> None:
        self.client.close()

    def save_trade(self, trade: dict[str, Any]) -> None:
        payload = dict(trade)
        payload["doc_type"] = "trade"
        payload["updated_at"] = datetime.utcnow().isoformat()
        payload["trade_date"] = str(payload.get("entry_time", ""))[:10] or payload.get("trade_date")
        try:
            self.collection.update_one(
                {"trade_id": payload["trade_id"]},
                {"$set": payload},
                upsert=True,
            )
        except Exception:
            logger.exception("Failed to save paper trade %s to MongoDB.", payload.get("trade_id"))

    def list_trades(self) -> list[dict[str, Any]]:
        try:
            return list(self.collection.find({"doc_type": "trade"}, {"_id": 0}).sort("entry_time", -1))
        except Exception:
            logger.exception("Failed to load paper trades from MongoDB.")
            return []

    def save_event(self, event: dict[str, Any]) -> None:
        payload = dict(event)
        payload["doc_type"] = "event"
        payload["updated_at"] = datetime.utcnow().isoformat()
        payload["event_id"] = (
            str(payload.get("event_id"))
            if payload.get("event_id")
            else f"{payload.get('event_type', 'event')}::{payload.get('timestamp', '')}::{payload.get('trade_id', '')}::{payload.get('skip_reason', '')}"
        )
        try:
            self.collection.update_one(
                {"event_id": payload["event_id"]},
                {"$set": payload},
                upsert=True,
            )
        except Exception:
            logger.exception("Failed to save paper trade event %s to MongoDB.", payload.get("event_id"))

    def list_recent_skipped_events(self, limit: int = 12) -> list[dict[str, Any]]:
        try:
            cursor = self.collection.find(
                {"doc_type": "event", "event_type": "skipped"},
                {"_id": 0},
            ).sort("timestamp", -1).limit(limit)
            return list(cursor)
        except Exception:
            logger.exception("Failed to load skipped paper trade events from MongoDB.")
            return []
