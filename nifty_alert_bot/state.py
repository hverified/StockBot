from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from pymongo import MongoClient


class StateStore:
    def __init__(
        self,
        mongodb_uri: str,
        database: str,
        collection: str,
        signal_alerts_collection: str | None = None,
        legacy_state_file: str | None = None,
    ) -> None:
        self.client = MongoClient(mongodb_uri)
        self.collection = self.client[database][collection]
        self.alert_collection = self.client[database][signal_alerts_collection] if signal_alerts_collection else None
        self.legacy_path = Path(legacy_state_file) if legacy_state_file else None
        self.collection.create_index("updated_at")
        if self.alert_collection is not None:
            self.alert_collection.create_index("alert_key", unique=True)
            self.alert_collection.create_index([("alertTime", -1)])

    def _default_state(self) -> dict[str, Any]:
        return {
            "last_alert_key": None,
            "last_run_at": None,
            "last_run_status": "idle",
            "last_run_message": "Bot has not run yet.",
            "last_telegram_delivery": None,
            "zerodha_session": None,
            "daily_option_contracts": None,
            "daily_strategy_setups": {},
            "last_alert": None,
            "paper_trading": {
                "trade_date": None,
                "active_trade": None,
                "last_signal_key": None,
                "daily_realized_pnl": 0.0,
                "daily_trade_count": 0,
                "daily_win_count": 0,
                "daily_loss_count": 0,
                "consecutive_losses": 0,
                "day_stopped": False,
                "day_stop_reason": None,
                "trade_history": [],
                "cash_balance": None,
                "starting_balance": None,
                "balance_adjustments": [],
            },
            "paper_trading_by_strategy": {},
            "live_trading": {
                "enabled": False,
                "enabled_strategy_keys": [],
                "updated_at": None,
                "updated_by": None,
                "last_action": None,
            },
        }

    def load_state(self) -> dict[str, Any]:
        state = self._default_state()

        payload = self.collection.find_one({"_id": "bot_state"}, {"_id": 0})
        if payload is None:
            payload = self._load_legacy_state()
            if payload is not None:
                self.save_state(payload)

        if isinstance(payload, dict):
            state.update(payload)
        return state

    def save_state(self, payload: dict[str, Any]) -> None:
        document = dict(payload)
        document["updated_at"] = datetime.utcnow().isoformat()
        self.collection.update_one(
            {"_id": "bot_state"},
            {"$set": document},
            upsert=True,
        )

    def close(self) -> None:
        self.client.close()

    def _load_legacy_state(self) -> dict[str, Any] | None:
        if self.legacy_path is None or not self.legacy_path.exists():
            return None

        try:
            payload = json.loads(self.legacy_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return None

        return payload if isinstance(payload, dict) else None

    def record_run(self, run_at: datetime, status: str, message: str) -> None:
        self.collection.update_one(
            {"_id": "bot_state"},
            {
                "$set": {
                    "last_run_at": run_at.isoformat(),
                    "last_run_status": status,
                    "last_run_message": message,
                    "updated_at": datetime.utcnow().isoformat(),
                }
            },
            upsert=True,
        )

    def record_alert(
        self,
        alert_key: str,
        alert_payload: dict[str, Any],
        *,
        update_last_alert_key: bool = True,
    ) -> None:
        state_update = {
            "last_alert": alert_payload,
            "updated_at": datetime.utcnow().isoformat(),
        }
        if update_last_alert_key:
            state_update["last_alert_key"] = alert_key
        self.collection.update_one(
            {"_id": "bot_state"},
            {"$set": state_update},
            upsert=True,
        )

        if self.alert_collection is None:
            return

        payload = dict(alert_payload)
        payload["alert_key"] = alert_key
        payload["updated_at"] = datetime.utcnow().isoformat()
        self.alert_collection.update_one(
            {"alert_key": alert_key},
            {"$set": payload},
            upsert=True,
        )

    def list_recent_alerts(self, limit: int = 50) -> list[dict[str, Any]]:
        if self.alert_collection is None:
            return self.load_state().get("recent_alerts", [])[:limit]

        alerts = list(
            self.alert_collection.find({}, {"_id": 0})
            .sort("alertTime", -1)
            .limit(limit)
        )
        if alerts:
            return alerts

        legacy_alerts = self.load_state().get("recent_alerts", [])[:limit]
        self._migrate_legacy_alerts(legacy_alerts)
        return list(
            self.alert_collection.find({}, {"_id": 0})
            .sort("alertTime", -1)
            .limit(limit)
        )

    def _migrate_legacy_alerts(self, alerts: list[dict[str, Any]]) -> None:
        if self.alert_collection is None or not alerts:
            return

        for alert in alerts:
            if not isinstance(alert, dict):
                continue
            alert_key = self._alert_key_from_payload(alert)
            payload = dict(alert)
            payload["alert_key"] = alert_key
            payload["updated_at"] = datetime.utcnow().isoformat()
            self.alert_collection.update_one(
                {"alert_key": alert_key},
                {"$set": payload},
                upsert=True,
            )

    def _alert_key_from_payload(self, alert: dict[str, Any]) -> str:
        return str(
            alert.get("alert_key")
            or f"{alert.get('candleTime', '')}::{alert.get('signal', '')}"
            or f"legacy::{alert.get('alertTime', '')}"
        )

    def record_telegram_delivery(self, delivery_payload: dict[str, Any]) -> None:
        self.collection.update_one(
            {"_id": "bot_state"},
            {
                "$set": {
                    "last_telegram_delivery": delivery_payload,
                    "updated_at": datetime.utcnow().isoformat(),
                }
            },
            upsert=True,
        )

    def record_zerodha_session(self, session_payload: dict[str, Any]) -> None:
        state = self.load_state()
        state["zerodha_session"] = session_payload
        self.save_state(state)

    def load_daily_option_contracts(
        self,
        trade_date: str,
        strategy_key: str | None = None,
    ) -> dict[str, Any] | None:
        state = self.load_state()
        payload = None
        if strategy_key:
            setups = state.get("daily_strategy_setups")
            if isinstance(setups, dict):
                payload = setups.get(strategy_key)
            if not isinstance(payload, dict):
                return None

        if not isinstance(payload, dict):
            payload = state.get("daily_option_contracts")
        if not isinstance(payload, dict):
            return None
        if payload.get("trade_date") != trade_date:
            return None
        return payload

    def save_daily_option_contracts(
        self,
        trade_date: str,
        contract_1: str,
        contract_2: str,
        updated_at: datetime,
        settings_payload: dict[str, Any] | None = None,
        strategy_key: str | None = None,
    ) -> dict[str, Any]:
        payload = {
            "trade_date": trade_date,
            "contract_1": str(contract_1 or "").strip().upper(),
            "contract_2": str(contract_2 or "").strip().upper(),
            "updated_at": updated_at.isoformat(),
        }
        if settings_payload:
            payload.update(settings_payload)
        state = self.load_state()
        if strategy_key:
            setups = state.get("daily_strategy_setups")
            if not isinstance(setups, dict):
                setups = {}
            payload["strategy_key"] = strategy_key
            setups[strategy_key] = payload
            state["daily_strategy_setups"] = setups
        else:
            state["daily_option_contracts"] = payload
        self.save_state(state)
        return payload

    def load_daily_strategy_setups(self, trade_date: str) -> dict[str, dict[str, Any]]:
        setups = self.load_state().get("daily_strategy_setups")
        if not isinstance(setups, dict):
            return {}
        return {
            key: payload
            for key, payload in setups.items()
            if isinstance(payload, dict) and payload.get("trade_date") == trade_date
        }

    def load_paper_trading(self, strategy_key: str | None = None) -> dict[str, Any]:
        state = self.load_state()
        default_paper_state = self._default_state()["paper_trading"]
        if not strategy_key:
            return state.get("paper_trading", default_paper_state)

        strategies = state.get("paper_trading_by_strategy")
        if not isinstance(strategies, dict):
            strategies = {}

        paper_state = strategies.get(strategy_key)
        if isinstance(paper_state, dict):
            return paper_state

        legacy_paper_state = state.get("paper_trading")
        legacy_active_trade = (
            legacy_paper_state.get("active_trade")
            if isinstance(legacy_paper_state, dict)
            else None
        )
        legacy_strategy = (
            "option_contracts_1m"
            if isinstance(legacy_active_trade, dict)
            and legacy_active_trade.get("strategy_mode") == "option_contracts"
            else "index_5m"
        )
        if strategy_key == legacy_strategy and isinstance(legacy_paper_state, dict):
            return legacy_paper_state

        return default_paper_state.copy()

    def save_paper_trading(self, paper_state: dict[str, Any], strategy_key: str | None = None) -> None:
        if strategy_key:
            self.collection.update_one(
                {"_id": "bot_state"},
                {
                    "$set": {
                        f"paper_trading_by_strategy.{strategy_key}": paper_state,
                        "updated_at": datetime.utcnow().isoformat(),
                    }
                },
                upsert=True,
            )
        else:
            self.collection.update_one(
                {"_id": "bot_state"},
                {
                    "$set": {
                        "paper_trading": paper_state,
                        "updated_at": datetime.utcnow().isoformat(),
                    }
                },
                upsert=True,
            )

    def load_paper_trading_strategies(self) -> dict[str, Any]:
        strategies = self.load_state().get("paper_trading_by_strategy")
        return strategies if isinstance(strategies, dict) else {}

    def load_live_trading(self) -> dict[str, Any]:
        payload = self.load_state().get("live_trading")
        default_payload = self._default_state()["live_trading"]
        return payload if isinstance(payload, dict) else default_payload.copy()

    def save_live_trading(self, payload: dict[str, Any]) -> dict[str, Any]:
        state = self.load_state()
        current = state.get("live_trading")
        if not isinstance(current, dict):
            current = self._default_state()["live_trading"]
        current.update(payload)
        state["live_trading"] = current
        self.save_state(state)
        return current
