from __future__ import annotations

import logging
import time
from datetime import datetime
from typing import Any

from nifty_alert_bot.option_price_provider import OptionPriceProvider


logger = logging.getLogger(__name__)


class LiveTradingError(RuntimeError):
    pass


def _kite_client(settings):
    try:
        from kiteconnect import KiteConnect
    except ImportError as exc:  # pragma: no cover - optional dependency
        raise LiveTradingError("kiteconnect is not installed. Run `pip install -r requirements.txt`.") from exc

    if not settings.zerodha_api_key or not settings.zerodha_access_token:
        raise LiveTradingError("ZERODHA_API_KEY and ZERODHA_ACCESS_TOKEN are required for live trading.")

    kite = KiteConnect(api_key=settings.zerodha_api_key)
    kite.set_access_token(settings.zerodha_access_token)
    return kite


def _clean_order(order: dict[str, Any]) -> dict[str, Any]:
    cleaned = {}
    for key, value in order.items():
        if hasattr(value, "isoformat"):
            cleaned[key] = value.isoformat()
        else:
            cleaned[key] = value
    return cleaned


def _order_fill_summary(order: dict[str, Any] | None) -> dict[str, Any]:
    order = order or {}
    average_price = order.get("average_price")
    filled_quantity = order.get("filled_quantity")
    pending_quantity = order.get("pending_quantity")
    try:
        average_price = float(average_price) if average_price is not None else None
    except (TypeError, ValueError):
        average_price = None
    return {
        "status": order.get("status"),
        "statusMessage": order.get("status_message") or order.get("status_message_raw"),
        "averagePrice": average_price,
        "filledQuantity": filled_quantity,
        "pendingQuantity": pending_quantity,
        "exchangeOrderId": order.get("exchange_order_id"),
        "exchangeTimestamp": order.get("exchange_timestamp"),
        "orderTimestamp": order.get("order_timestamp"),
        "raw": _clean_order(order) if order else None,
    }


def _safe_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


class LiveTradingBroker:
    def __init__(self, settings, state_store) -> None:
        self.settings = settings
        self.state_store = state_store
        self.price_provider = OptionPriceProvider(settings)

    def close(self) -> None:
        self.price_provider.close()

    def status(self) -> dict[str, Any]:
        state = self.state_store.load_live_trading()
        enabled_strategy_keys = state.get("enabled_strategy_keys")
        if not isinstance(enabled_strategy_keys, list):
            enabled_strategy_keys = []
        return {
            "enabled": bool(state.get("enabled")),
            "enabledStrategyKeys": enabled_strategy_keys,
            "updatedAt": state.get("updated_at"),
            "updatedBy": state.get("updated_by"),
            "lastAction": state.get("last_action"),
            "zerodhaReady": bool(self.settings.zerodha_api_key and self.settings.zerodha_access_token),
        }

    def set_enabled(
        self,
        enabled: bool,
        *,
        updated_by: str = "dashboard",
        enabled_strategy_keys: list[str] | None = None,
    ) -> dict[str, Any]:
        now = datetime.now(self.settings.timezone).isoformat()
        payload: dict[str, Any] = {
            "enabled": bool(enabled),
            "updated_at": now,
            "updated_by": updated_by,
            "last_action": "enabled" if enabled else "disabled",
        }
        if enabled_strategy_keys is not None:
            payload["enabled_strategy_keys"] = list(dict.fromkeys(enabled_strategy_keys))
        return self.state_store.save_live_trading(payload)

    def assert_enabled(self) -> None:
        if not self.status()["enabled"]:
            raise LiveTradingError("Live trading is disabled. Turn it on from the Live Trading tab first.")

    def _kite(self):
        return _kite_client(self.settings)

    def orderbook(self) -> list[dict[str, Any]]:
        return [_clean_order(order) for order in self._kite().orders()]

    def trades(self) -> list[dict[str, Any]]:
        return [_clean_order(trade) for trade in self._kite().trades()]

    def positions(self) -> dict[str, Any]:
        return self._kite().positions()

    def margins(self) -> dict[str, Any]:
        return self._kite().margins()

    def available_cash(self) -> float:
        margins = self.margins()
        equity = margins.get("equity") if isinstance(margins, dict) else {}
        available = equity.get("available") if isinstance(equity, dict) else {}
        if not isinstance(available, dict):
            available = {}

        for key in ("cash", "live_balance", "opening_balance"):
            amount = _safe_float(available.get(key))
            if amount is not None and amount > 0:
                return round(amount, 2)
        return 0.0

    def order_by_id(self, order_id: str) -> dict[str, Any] | None:
        for order in self.orderbook():
            if str(order.get("order_id")) == str(order_id):
                return order
        return None

    def wait_for_order_completion(
        self,
        order_id: str,
        *,
        timeout_seconds: float = 8.0,
        poll_seconds: float = 0.5,
    ) -> dict[str, Any]:
        deadline = time.monotonic() + timeout_seconds
        last_order: dict[str, Any] | None = None
        terminal_statuses = {"COMPLETE", "REJECTED", "CANCELLED"}

        while True:
            last_order = self.order_by_id(order_id)
            status = str((last_order or {}).get("status") or "").upper()
            if status in terminal_statuses:
                summary = _order_fill_summary(last_order)
                summary["confirmed"] = status == "COMPLETE"
                if status != "COMPLETE":
                    raise LiveTradingError(
                        f"Live order {order_id} ended with status {status}: "
                        f"{summary.get('statusMessage') or 'no broker message'}"
                    )
                return summary

            if time.monotonic() >= deadline:
                summary = _order_fill_summary(last_order)
                summary["confirmed"] = False
                summary["timedOut"] = True
                return summary

            time.sleep(poll_seconds)

    def place_order(
        self,
        *,
        exchange: str,
        tradingsymbol: str,
        transaction_type: str,
        quantity: int,
        product: str,
        order_type: str,
        variety: str = "regular",
        validity: str = "DAY",
        price: float | None = None,
        trigger_price: float | None = None,
        tag: str | None = None,
    ) -> dict[str, Any]:
        self.assert_enabled()
        payload: dict[str, Any] = {
            "variety": variety,
            "exchange": exchange,
            "tradingsymbol": tradingsymbol,
            "transaction_type": transaction_type,
            "quantity": quantity,
            "product": product,
            "order_type": order_type,
            "validity": validity,
        }
        if price is not None:
            payload["price"] = price
        if trigger_price is not None:
            payload["trigger_price"] = trigger_price
        if tag:
            payload["tag"] = tag

        order_id = self._kite().place_order(**payload)
        self.state_store.save_live_trading(
            {
                "last_action": "place_order",
                "last_order_id": order_id,
                "last_order_payload": payload,
                "updated_at": datetime.now(self.settings.timezone).isoformat(),
            }
        )
        return {"orderId": order_id, "request": payload}

    def place_order_and_wait(
        self,
        *,
        timeout_seconds: float = 8.0,
        poll_seconds: float = 0.5,
        **order_payload,
    ) -> dict[str, Any]:
        result = self.place_order(**order_payload)
        result["fill"] = self.wait_for_order_completion(
            result["orderId"],
            timeout_seconds=timeout_seconds,
            poll_seconds=poll_seconds,
        )
        return result

    def place_broker_exit_orders(
        self,
        *,
        exchange: str,
        tradingsymbol: str,
        transaction_type: str,
        quantity: int,
        product: str,
        target_price: float,
        stop_loss_price: float,
        sl_order_type: str = "SL-M",
    ) -> dict[str, Any]:
        self.assert_enabled()
        target_order: dict[str, Any] | None = None
        try:
            target_order = self.place_order(
                exchange=exchange,
                tradingsymbol=tradingsymbol,
                transaction_type=transaction_type,
                quantity=quantity,
                product=product,
                order_type="LIMIT",
                validity="DAY",
                price=round(float(target_price), 2),
                tag="hverified-target",
            )
            sl_type = str(sl_order_type or "SL-M").upper()
            stop_order = self.place_order(
                exchange=exchange,
                tradingsymbol=tradingsymbol,
                transaction_type=transaction_type,
                quantity=quantity,
                product=product,
                order_type=sl_type,
                validity="DAY",
                price=round(float(stop_loss_price), 2) if sl_type == "SL" else None,
                trigger_price=round(float(stop_loss_price), 2),
                tag="hverified-stop",
            )
        except Exception:
            if target_order and target_order.get("orderId"):
                try:
                    self.cancel_order(order_id=target_order["orderId"])
                except Exception:
                    logger.exception("Failed to cancel target order after stop-loss placement failed.")
            raise

        self.state_store.save_live_trading(
            {
                "last_action": "place_exit_orders",
                "last_order_id": stop_order.get("orderId"),
                "updated_at": datetime.now(self.settings.timezone).isoformat(),
            }
        )
        return {"target": target_order, "stopLoss": stop_order}

    def modify_order(
        self,
        *,
        order_id: str,
        variety: str = "regular",
        quantity: int | None = None,
        order_type: str | None = None,
        price: float | None = None,
        trigger_price: float | None = None,
        validity: str | None = None,
    ) -> dict[str, Any]:
        self.assert_enabled()
        payload: dict[str, Any] = {"variety": variety, "order_id": order_id}
        if quantity is not None:
            payload["quantity"] = quantity
        if order_type:
            payload["order_type"] = order_type
        if price is not None:
            payload["price"] = price
        if trigger_price is not None:
            payload["trigger_price"] = trigger_price
        if validity:
            payload["validity"] = validity

        modified_order_id = self._kite().modify_order(**payload)
        self.state_store.save_live_trading(
            {
                "last_action": "modify_order",
                "last_order_id": modified_order_id,
                "last_order_payload": payload,
                "updated_at": datetime.now(self.settings.timezone).isoformat(),
            }
        )
        return {"orderId": modified_order_id, "request": payload}

    def cancel_order(self, *, order_id: str, variety: str = "regular") -> dict[str, Any]:
        self.assert_enabled()
        cancelled_order_id = self._kite().cancel_order(variety=variety, order_id=order_id)
        self.state_store.save_live_trading(
            {
                "last_action": "cancel_order",
                "last_order_id": cancelled_order_id,
                "updated_at": datetime.now(self.settings.timezone).isoformat(),
            }
        )
        return {"orderId": cancelled_order_id}

    def cancel_order_if_open(self, *, order_id: str, variety: str = "regular") -> dict[str, Any] | None:
        order = self.order_by_id(order_id)
        status = str((order or {}).get("status") or "").upper()
        if status in {"COMPLETE", "REJECTED", "CANCELLED"}:
            return {"orderId": order_id, "status": status, "skipped": True}
        return self.cancel_order(order_id=order_id, variety=variety)

    def option_ltp(
        self,
        *,
        exchange: str,
        tradingsymbol: str,
        prefer_stream: bool = True,
    ) -> dict[str, Any]:
        contract = self.price_provider.find_contract_by_symbol(tradingsymbol, exchange)
        if contract is None:
            raise LiveTradingError(f"Instrument not found: {exchange}:{tradingsymbol}")
        price, source = self.price_provider.quote_option(
            0.0,
            contract.strike,
            contract.option_type,
            contract=contract,
            prefer_stream=prefer_stream,
        )
        return {
            "exchange": contract.exchange,
            "tradingsymbol": contract.tradingsymbol,
            "instrumentToken": contract.instrument_token,
            "ltp": price,
            "source": source,
            "updatedAt": datetime.now(self.settings.timezone).isoformat(),
        }
