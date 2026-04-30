from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from pymongo import MongoClient
from pymongo.errors import OperationFailure


logger = logging.getLogger(__name__)


class PaperTradeRepository:
    def __init__(self, mongodb_uri: str, database: str, collection: str) -> None:
        self.client = MongoClient(mongodb_uri)
        self.collection = self.client[database][collection]
        self._create_index_safely(
            [("trade_id", 1)],
            unique=True,
            partialFilterExpression={"doc_type": "trade"},
        )
        self._create_index_safely([("trade_date", -1), ("entry_time", -1)])
        self._create_index_safely("status")

    def _create_index_safely(self, keys, **kwargs) -> None:
        try:
            self.collection.create_index(keys, **kwargs)
        except OperationFailure as exc:
            if exc.code == 86:
                logger.warning("MongoDB index already exists with different options for %s. Continuing.", keys)
                return
            raise

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
        query = {
            "deleted_at": {"$exists": False},
            "$or": [
                {"doc_type": "trade"},
                {
                    "doc_type": {"$exists": False},
                    "trade_id": {"$exists": True},
                    "event_type": {"$exists": False},
                },
            ]
        }
        try:
            return list(self.collection.find(query, {"_id": 0}).sort("entry_time", -1))
        except Exception:
            logger.exception("Failed to load paper trades from MongoDB.")
            return []

    def soft_delete_trade(self, trade_id: str, deleted_by: str = "dashboard") -> bool:
        try:
            result = self.collection.update_one(
                {
                    "trade_id": trade_id,
                    "deleted_at": {"$exists": False},
                    "$or": [
                        {"doc_type": "trade"},
                        {
                            "doc_type": {"$exists": False},
                            "event_type": {"$exists": False},
                        },
                    ],
                },
                {
                    "$set": {
                        "deleted_at": datetime.utcnow().isoformat(),
                        "deleted_by": deleted_by,
                        "updated_at": datetime.utcnow().isoformat(),
                    }
                },
            )
            return result.modified_count > 0
        except Exception:
            logger.exception("Failed to soft-delete paper trade %s from MongoDB.", trade_id)
            return False
