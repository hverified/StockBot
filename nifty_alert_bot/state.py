from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any


class StateStore:
    def __init__(self, state_file: str) -> None:
        self.path = Path(state_file)

    def _default_state(self) -> dict[str, Any]:
        return {
            "last_alert_key": None,
            "last_run_at": None,
            "last_run_status": "idle",
            "last_run_message": "Bot has not run yet.",
            "last_telegram_delivery": None,
            "zerodha_session": None,
            "last_alert": None,
            "recent_alerts": [],
            "paper_trading": {
                "trade_date": None,
                "active_trade": None,
                "cooldown_until": None,
                "last_signal_key": None,
                "daily_realized_pnl": 0.0,
                "daily_trade_count": 0,
                "daily_win_count": 0,
                "daily_loss_count": 0,
                "consecutive_losses": 0,
                "day_stopped": False,
                "day_stop_reason": None,
                "trade_history": [],
            },
        }

    def load_state(self) -> dict[str, Any]:
        state = self._default_state()
        if not self.path.exists():
            return state

        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return state

        if isinstance(payload, dict):
            state.update(payload)
        return state

    def save_state(self, payload: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def load_last_alert_key(self) -> str | None:
        return self.load_state().get("last_alert_key")

    def record_run(self, run_at: datetime, status: str, message: str) -> None:
        state = self.load_state()
        state["last_run_at"] = run_at.isoformat()
        state["last_run_status"] = status
        state["last_run_message"] = message
        self.save_state(state)

    def record_alert(
        self,
        alert_key: str,
        alert_payload: dict[str, Any],
        *,
        update_last_alert_key: bool = True,
    ) -> None:
        state = self.load_state()
        recent_alerts = [alert for alert in state.get("recent_alerts", []) if alert != alert_payload]
        recent_alerts.insert(0, alert_payload)
        state["recent_alerts"] = recent_alerts[:50]
        state["last_alert"] = alert_payload
        if update_last_alert_key:
            state["last_alert_key"] = alert_key
        self.save_state(state)

    def record_telegram_delivery(self, delivery_payload: dict[str, Any]) -> None:
        state = self.load_state()
        state["last_telegram_delivery"] = delivery_payload
        self.save_state(state)

    def record_zerodha_session(self, session_payload: dict[str, Any]) -> None:
        state = self.load_state()
        state["zerodha_session"] = session_payload
        self.save_state(state)

    def load_paper_trading(self) -> dict[str, Any]:
        return self.load_state().get("paper_trading", self._default_state()["paper_trading"])

    def save_paper_trading(self, paper_state: dict[str, Any]) -> None:
        state = self.load_state()
        state["paper_trading"] = paper_state
        self.save_state(state)
