from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from pymongo import MongoClient, UpdateOne
from pymongo.errors import OperationFailure


logger = logging.getLogger(__name__)


class ExactCandleRepository:
    def __init__(self, mongodb_uri: str, database: str, collection: str) -> None:
        self.client = MongoClient(mongodb_uri)
        self.collection = self.client[database][collection]
        self._create_index_safely(
            [
                ("underlying", 1),
                ("tradingsymbol", 1),
                ("interval", 1),
                ("candle_time", 1),
            ],
            unique=True,
        )
        self._create_index_safely([("underlying", 1), ("trade_date", 1), ("option_type", 1)])
        self._create_index_safely([("tradingsymbol", 1), ("candle_time", 1)])

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

    def save_candles(
        self,
        *,
        underlying: str,
        contract,
        interval: str,
        candles: list[dict[str, Any]],
        source: str,
        strike_offset: int | None = None,
    ) -> int:
        operations = []
        now = datetime.utcnow().isoformat()
        for candle in candles:
            candle_time = candle.get("date")
            if not hasattr(candle_time, "isoformat"):
                continue
            payload = {
                "underlying": underlying.upper(),
                "exchange": contract.exchange,
                "tradingsymbol": contract.tradingsymbol,
                "instrument_token": int(contract.instrument_token),
                "expiry": contract.expiry,
                "strike": int(contract.strike),
                "option_type": contract.option_type,
                "interval": interval,
                "candle_time": candle_time.isoformat(),
                "trade_date": candle_time.date().isoformat(),
                "open": float(candle["open"]),
                "high": float(candle["high"]),
                "low": float(candle["low"]),
                "close": float(candle["close"]),
                "volume": candle.get("volume"),
                "source": source,
                "strike_offset": strike_offset,
                "updated_at": now,
            }
            operations.append(
                UpdateOne(
                    {
                        "underlying": payload["underlying"],
                        "tradingsymbol": payload["tradingsymbol"],
                        "interval": payload["interval"],
                        "candle_time": payload["candle_time"],
                    },
                    {"$set": payload},
                    upsert=True,
                )
            )

        if not operations:
            return 0
        try:
            result = self.collection.bulk_write(operations, ordered=False)
            return int(result.upserted_count + result.modified_count)
        except Exception:
            logger.exception("Failed to save exact option candles for %s.", contract.tradingsymbol)
            return 0

    def load_candles(
        self,
        *,
        underlying: str,
        tradingsymbol: str,
        interval: str,
        from_dt: datetime,
        to_dt: datetime,
    ) -> list[dict[str, Any]]:
        rows = self.collection.find(
            {
                "underlying": underlying.upper(),
                "tradingsymbol": tradingsymbol.upper(),
                "interval": interval,
                "candle_time": {
                    "$gte": from_dt.isoformat(),
                    "$lt": to_dt.isoformat(),
                },
            },
            {"_id": 0},
        ).sort("candle_time", 1)
        candles = []
        for row in rows:
            candles.append(
                {
                    "date": datetime.fromisoformat(row["candle_time"]),
                    "open": row["open"],
                    "high": row["high"],
                    "low": row["low"],
                    "close": row["close"],
                    "volume": row.get("volume"),
                }
            )
        return candles

    def list_contracts(
        self,
        *,
        underlying: str,
        from_dt: datetime,
        to_dt: datetime,
        option_type: str | None = None,
        strike: int | None = None,
        strike_offset: int | None = None,
        interval: str = "minute",
    ) -> list[dict[str, Any]]:
        query: dict[str, Any] = {
            "underlying": underlying.upper(),
            "interval": interval,
            "candle_time": {
                "$gte": from_dt.isoformat(),
                "$lt": to_dt.isoformat(),
            },
        }
        if option_type:
            query["option_type"] = option_type.upper()
        if strike is not None:
            query["strike"] = int(strike)
        if strike_offset is not None:
            query["strike_offset"] = int(strike_offset)

        rows = self.collection.aggregate(
            [
                {"$match": query},
                {
                    "$group": {
                        "_id": "$tradingsymbol",
                        "tradingsymbol": {"$first": "$tradingsymbol"},
                        "exchange": {"$first": "$exchange"},
                        "instrument_token": {"$first": "$instrument_token"},
                        "expiry": {"$first": "$expiry"},
                        "strike": {"$first": "$strike"},
                        "option_type": {"$first": "$option_type"},
                        "strike_offset": {"$first": "$strike_offset"},
                    }
                },
                {"$sort": {"tradingsymbol": 1}},
            ]
        )
        return list(rows)

    def latest_candle(
        self,
        *,
        underlying: str,
        trade_date: str,
        interval: str = "minute",
    ) -> dict[str, Any] | None:
        try:
            row = self.collection.find_one(
                {
                    "underlying": underlying.upper(),
                    "trade_date": trade_date,
                    "interval": interval,
                },
                {"_id": 0},
                sort=[("candle_time", -1)],
            )
            return row if isinstance(row, dict) else None
        except Exception:
            logger.exception("Failed to load latest exact option candle for %s on %s.", underlying, trade_date)
            return None
