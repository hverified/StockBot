from __future__ import annotations

import logging
import csv
import io
import time
from datetime import datetime
from pathlib import Path
from typing import Any

import requests


logger = logging.getLogger(__name__)


class DhanTradingError(RuntimeError):
    pass


def _safe_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _safe_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


class DhanLiveTradingBroker:
    base_url = "https://api.dhan.co/v2"
    instrument_master_url = "https://images.dhan.co/api-data/api-scrip-master.csv"

    def __init__(self, settings, state_store) -> None:
        self.settings = settings
        self.state_store = state_store
        self.session = requests.Session()

    def close(self) -> None:
        self.session.close()

    def status(self) -> dict[str, Any]:
        state = self.state_store.load_dhan_live_trading()
        enabled_strategy_keys = state.get("enabled_strategy_keys")
        if not isinstance(enabled_strategy_keys, list):
            enabled_strategy_keys = []
        return {
            "enabled": bool(state.get("enabled")),
            "enabledStrategyKeys": enabled_strategy_keys,
            "updatedAt": state.get("updated_at"),
            "updatedBy": state.get("updated_by"),
            "lastAction": state.get("last_action"),
            "dhanReady": bool(self.settings.dhan_client_id and self.settings.dhan_access_token),
        }

    def set_enabled(
        self,
        enabled: bool,
        *,
        updated_by: str = "dashboard",
        enabled_strategy_keys: list[str] | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "enabled": bool(enabled),
            "updated_at": datetime.now(self.settings.timezone).isoformat(),
            "updated_by": updated_by,
            "last_action": "enabled" if enabled else "disabled",
        }
        if enabled_strategy_keys is not None:
            payload["enabled_strategy_keys"] = list(dict.fromkeys(enabled_strategy_keys))
        return self.state_store.save_dhan_live_trading(payload)

    def assert_ready(self) -> None:
        if not self.settings.dhan_client_id or not self.settings.dhan_access_token:
            raise DhanTradingError("DHAN_CLIENT_ID and DHAN_ACCESS_TOKEN are required for Dhan live trading.")

    def assert_enabled(self) -> None:
        self.assert_ready()
        if not self.status()["enabled"]:
            raise DhanTradingError("Dhan live trading is disabled. Turn it on from the Dhan Live tab first.")

    def _request(self, method: str, path: str, *, json_payload: dict[str, Any] | None = None) -> Any:
        self.assert_ready()
        headers = {
            "Content-Type": "application/json",
            "access-token": self.settings.dhan_access_token,
        }
        if self.settings.dhan_client_id:
            headers["client-id"] = self.settings.dhan_client_id
        response = self.session.request(
            method,
            f"{self.base_url}{path}",
            headers=headers,
            json=json_payload,
            timeout=10,
        )
        if response.status_code >= 400:
            try:
                detail = response.json()
            except ValueError:
                detail = response.text
            raise DhanTradingError(f"Dhan API {method} {path} failed with {response.status_code}: {detail}")
        if not response.content:
            return {}
        try:
            return response.json()
        except ValueError:
            return {"raw": response.text}

    def orderbook(self) -> list[dict[str, Any]]:
        payload = self._request("GET", "/orders")
        return payload if isinstance(payload, list) else []

    def trades(self) -> list[dict[str, Any]]:
        payload = self._request("GET", "/trades")
        return payload if isinstance(payload, list) else []

    def positions(self) -> list[dict[str, Any]]:
        payload = self._request("GET", "/positions")
        return payload if isinstance(payload, list) else []

    def fundlimit(self) -> dict[str, Any]:
        payload = self._request("GET", "/fundlimit")
        return payload if isinstance(payload, dict) else {}

    def ltp_by_security_ids(
        self,
        *,
        exchange_segment: str,
        security_ids: list[str | int],
    ) -> dict[str, dict[str, Any]]:
        ids = [str(security_id) for security_id in security_ids if str(security_id or "").strip()]
        if not ids:
            return {}

        payload_ids: list[int | str] = []
        for security_id in ids:
            try:
                payload_ids.append(int(security_id))
            except ValueError:
                payload_ids.append(security_id)

        segment = str(exchange_segment or "NSE_FNO").upper()
        payload = self._request("POST", "/marketfeed/ltp", json_payload={segment: payload_ids})
        if not isinstance(payload, dict):
            return {}

        data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
        segment_data = data.get(segment) if isinstance(data, dict) else None
        if not isinstance(segment_data, dict):
            return {}

        quotes: dict[str, dict[str, Any]] = {}
        for security_id in ids:
            quote = segment_data.get(security_id)
            if quote is None:
                try:
                    quote = segment_data.get(int(security_id))
                except ValueError:
                    quote = None
            if not isinstance(quote, dict):
                continue
            ltp = _first_number(quote, "last_price", "lastPrice", "ltp", "LTP")
            quotes[security_id] = {
                "ltp": ltp,
                "raw": quote,
            }
        return quotes

    def order_by_id(self, order_id: str) -> dict[str, Any] | None:
        for order in self.orderbook():
            if str(order.get("orderId") or order.get("order_id")) == str(order_id):
                return order
        try:
            payload = self._request("GET", f"/orders/{order_id}")
        except Exception:
            return None
        return payload if isinstance(payload, dict) else None

    def trades_for_order(self, order_id: str) -> list[dict[str, Any]]:
        try:
            payload = self._request("GET", f"/trades/{order_id}")
        except Exception:
            return []
        return payload if isinstance(payload, list) else []

    def available_cash(self) -> float:
        balance = self.balance_summary()
        cash = _safe_float(balance.get("cash"))
        return round(cash, 2) if cash is not None else 0.0

    def balance_summary(self) -> dict[str, Any]:
        funds = self.fundlimit()
        cash = _first_number(
            funds,
            "availabelBalance",
            "availableBalance",
            "availableBalanceForTrading",
            "withdrawableBalance",
            "netAvailableBalance",
            "sodLimit",
            "collateralAmount",
        )
        return {
            "cash": cash,
            "availableBalance": _first_number(funds, "availableBalance", "availabelBalance"),
            "withdrawableBalance": _first_number(funds, "withdrawableBalance"),
            "sodLimit": _first_number(funds, "sodLimit"),
            "utilizedAmount": _first_number(funds, "utilizedAmount", "utilizedLimit"),
            "collateralAmount": _first_number(funds, "collateralAmount"),
            "raw": funds,
        }

    def place_order(
        self,
        *,
        transaction_type: str,
        exchange_segment: str,
        product_type: str,
        security_id: str,
        quantity: int,
        order_type: str = "MARKET",
        validity: str = "DAY",
        price: float | None = None,
        trigger_price: float | None = None,
        correlation_id: str | None = None,
    ) -> dict[str, Any]:
        self.assert_enabled()
        payload: dict[str, Any] = {
            "dhanClientId": self.settings.dhan_client_id,
            "correlationId": correlation_id or f"tradewise-{int(datetime.now(self.settings.timezone).timestamp())}",
            "transactionType": transaction_type.upper(),
            "exchangeSegment": exchange_segment,
            "productType": product_type or "INTRADAY",
            "orderType": order_type,
            "validity": validity,
            "securityId": str(security_id),
            "quantity": int(quantity),
            "disclosedQuantity": 0,
            "price": price or 0,
            "triggerPrice": trigger_price or 0,
            "afterMarketOrder": False,
        }
        result = self._request("POST", "/orders", json_payload=payload)
        self.state_store.save_dhan_live_trading(
            {
                "last_action": "place_order",
                "last_order_id": result.get("orderId") if isinstance(result, dict) else None,
                "last_order_payload": payload,
                "updated_at": datetime.now(self.settings.timezone).isoformat(),
            }
        )
        return {"request": payload, "response": result}

    def wait_for_order_completion(
        self,
        order_id: str,
        *,
        timeout_seconds: float = 8.0,
        poll_seconds: float = 0.5,
    ) -> dict[str, Any]:
        deadline = time.monotonic() + timeout_seconds
        terminal_statuses = {"TRADED", "COMPLETE", "REJECTED", "CANCELLED", "EXPIRED"}
        last_order: dict[str, Any] | None = None

        while True:
            last_order = self.order_by_id(order_id)
            status = str((last_order or {}).get("orderStatus") or (last_order or {}).get("status") or "").upper()
            if status in terminal_statuses:
                trades = self.trades_for_order(order_id)
                traded_qty = sum(_safe_int(trade.get("tradedQuantity")) or 0 for trade in trades)
                traded_value = sum(
                    ((_safe_int(trade.get("tradedQuantity")) or 0) * (_safe_float(trade.get("tradedPrice")) or 0.0))
                    for trade in trades
                )
                order_avg = _safe_float((last_order or {}).get("averageTradedPrice")) or _safe_float(
                    (last_order or {}).get("average_price")
                )
                average_price = round(traded_value / traded_qty, 2) if traded_qty else order_avg
                summary = {
                    "status": status,
                    "confirmed": status in {"TRADED", "COMPLETE"},
                    "averagePrice": average_price,
                    "filledQuantity": traded_qty or _safe_int((last_order or {}).get("filledQty")),
                    "pendingQuantity": _safe_int((last_order or {}).get("remainingQuantity")),
                    "raw": last_order,
                    "trades": trades,
                }
                if not summary["confirmed"]:
                    raise DhanTradingError(f"Dhan order {order_id} ended with status {status}.")
                return summary

            if time.monotonic() >= deadline:
                return {
                    "status": status or None,
                    "confirmed": False,
                    "timedOut": True,
                    "raw": last_order,
                }

            time.sleep(poll_seconds)

    def place_order_and_wait(
        self,
        *,
        timeout_seconds: float = 8.0,
        poll_seconds: float = 0.5,
        **order_payload,
    ) -> dict[str, Any]:
        result = self.place_order(**order_payload)
        response = result.get("response") if isinstance(result.get("response"), dict) else {}
        order_id = response.get("orderId") or response.get("order_id")
        if not order_id:
            raise DhanTradingError(f"Dhan order response did not include orderId: {response}")
        result["orderId"] = order_id
        result["fill"] = self.wait_for_order_completion(
            str(order_id),
            timeout_seconds=timeout_seconds,
            poll_seconds=poll_seconds,
        )
        return result

    def cancel_order(self, *, order_id: str) -> dict[str, Any]:
        self.assert_enabled()
        payload = self._request("DELETE", f"/orders/{order_id}")
        self.state_store.save_dhan_live_trading(
            {
                "last_action": "cancel_order",
                "last_order_id": order_id,
                "updated_at": datetime.now(self.settings.timezone).isoformat(),
            }
        )
        return payload if isinstance(payload, dict) else {"orderId": order_id, "orderStatus": "CANCELLED"}

    def cancel_order_if_open(self, *, order_id: str) -> dict[str, Any] | None:
        order = self.order_by_id(order_id)
        status = str((order or {}).get("orderStatus") or (order or {}).get("status") or "").upper()
        if status in {"TRADED", "COMPLETE", "REJECTED", "CANCELLED", "EXPIRED"}:
            return {"orderId": order_id, "status": status, "skipped": True}
        return self.cancel_order(order_id=order_id)

    def place_broker_exit_orders(
        self,
        *,
        security_id: str,
        trading_symbol: str,
        exchange_segment: str,
        transaction_type: str,
        quantity: int,
        product_type: str,
        target_price: float,
        stop_loss_price: float,
        sl_order_type: str = "STOP_LOSS_MARKET",
    ) -> dict[str, Any]:
        self.assert_enabled()
        target_order: dict[str, Any] | None = None
        try:
            target_order = self.place_order(
                transaction_type=transaction_type,
                exchange_segment=exchange_segment,
                product_type=product_type,
                security_id=security_id,
                quantity=quantity,
                order_type="LIMIT",
                price=round(float(target_price), 2),
                correlation_id=f"tw-tgt-{security_id}",
            )
            stop_order_type = self._normalize_sl_order_type(sl_order_type)
            stop_order = self.place_order(
                transaction_type=transaction_type,
                exchange_segment=exchange_segment,
                product_type=product_type,
                security_id=security_id,
                quantity=quantity,
                order_type=stop_order_type,
                price=round(float(stop_loss_price), 2) if stop_order_type == "STOP_LOSS" else 0,
                trigger_price=round(float(stop_loss_price), 2),
                correlation_id=f"tw-sl-{security_id}",
            )
        except Exception:
            response = target_order.get("response") if isinstance(target_order, dict) else {}
            order_id = response.get("orderId") if isinstance(response, dict) else None
            if order_id:
                try:
                    self.cancel_order(order_id=str(order_id))
                except Exception:
                    logger.exception("Failed to cancel Dhan target order after stop-loss placement failed.")
            raise

        target_order_id = _extract_order_id(target_order)
        stop_order_id = _extract_order_id(stop_order)
        if not target_order_id or not stop_order_id:
            for order in (target_order, stop_order):
                order_id = _extract_order_id(order)
                if not order_id:
                    continue
                try:
                    self.cancel_order(order_id=str(order_id))
                except Exception:
                    logger.exception("Failed to cancel Dhan exit order after incomplete target/SL placement.")
            raise DhanTradingError(
                "Dhan target/SL placement did not return both order IDs. "
                f"target={target_order_id or '-'} stopLoss={stop_order_id or '-'}"
            )

        self.state_store.save_dhan_live_trading(
            {
                "last_action": "place_exit_orders",
                "last_order_id": stop_order_id,
                "updated_at": datetime.now(self.settings.timezone).isoformat(),
            }
        )
        return {"target": target_order, "stopLoss": stop_order}

    def exit_position(
        self,
        *,
        security_id: str,
        trading_symbol: str,
        exchange_segment: str,
        product_type: str,
        quantity: int,
        transaction_type: str,
    ) -> dict[str, Any]:
        if quantity <= 0:
            raise DhanTradingError("Exit quantity must be greater than zero.")
        result = self.place_order(
            transaction_type=transaction_type,
            exchange_segment=exchange_segment,
            product_type=product_type or "INTRADAY",
            security_id=security_id,
            quantity=quantity,
            order_type="MARKET",
            correlation_id=_safe_correlation_id("manual-exit", trading_symbol),
        )
        self.state_store.save_dhan_live_trading(
            {
                "last_action": "manual_exit",
                "last_exit_symbol": trading_symbol,
                "updated_at": datetime.now(self.settings.timezone).isoformat(),
            }
        )
        return result

    def resolve_option_security(
        self,
        *,
        underlying: str,
        strike: int | float,
        option_type: str,
        expiry: Any,
    ) -> dict[str, Any] | None:
        target_underlying = str(underlying or "NIFTY").upper()
        target_option = str(option_type or "").upper()
        target_strike = float(strike)
        target_expiry = _normalize_date(expiry)
        today = datetime.now(self.settings.timezone).date().isoformat()
        candidates: list[tuple[str, dict[str, Any]]] = []

        for row in self._load_instrument_rows():
            row_underlying = _first_present(row, "UNDERLYING_SYMBOL", "SM_SYMBOL_NAME", "SYMBOL_NAME", "SEM_CUSTOM_SYMBOL")
            row_option = _first_present(row, "SEM_OPTION_TYPE", "OPTION_TYPE")
            row_strike = _safe_float(_first_present(row, "SEM_STRIKE_PRICE", "STRIKE_PRICE"))
            row_expiry = _normalize_date(_first_present(row, "SEM_EXPIRY_DATE", "SM_EXPIRY_DATE"))
            row_segment = str(_first_present(row, "SEM_SEGMENT", "SEGMENT") or "").upper()
            row_instrument = str(_first_present(row, "SEM_INSTRUMENT_NAME", "INSTRUMENT") or "").upper()

            if target_underlying not in str(row_underlying or "").upper():
                continue
            if row_option != target_option:
                continue
            if row_strike is None or abs(row_strike - target_strike) > 0.01:
                continue
            if target_expiry and row_expiry != target_expiry:
                continue
            if not target_expiry and row_expiry and row_expiry < today:
                continue
            if row_segment not in {"D", "NSE_FNO"} and "OPT" not in row_instrument:
                continue

            security_id = _first_present(row, "SEM_SMST_SECURITY_ID", "SECURITY_ID", "SECURITYID")
            if not security_id:
                continue
            candidates.append((row_expiry or "9999-12-31", row))

        if not candidates:
            return None

        _, row = sorted(candidates, key=lambda item: item[0])[0]
        security_id = _first_present(row, "SEM_SMST_SECURITY_ID", "SECURITY_ID", "SECURITYID")
        trading_symbol = _first_present(row, "SEM_TRADING_SYMBOL", "TRADING_SYMBOL", "SYMBOL_NAME")
        row_expiry = _normalize_date(_first_present(row, "SEM_EXPIRY_DATE", "SM_EXPIRY_DATE"))
        return {
            "securityId": str(security_id),
            "tradingSymbol": str(trading_symbol or ""),
            "exchangeSegment": "NSE_FNO",
            "instrument": "OPTIDX",
            "expiry": row_expiry,
            "raw": row,
        }

    def _load_instrument_rows(self) -> list[dict[str, str]]:
        cached = getattr(self, "_instrument_rows", None)
        if isinstance(cached, list):
            return cached
        cache_path = self.instrument_master_cache_path()
        if cache_path.exists():
            text = cache_path.read_text(encoding="utf-8", errors="replace")
        else:
            cache_result = self.cache_instrument_master(force=False)
            text = cache_path.read_text(encoding="utf-8", errors="replace")
            logger.info("Cached Dhan instrument master: %s", cache_result)
        rows = list(csv.DictReader(io.StringIO(text)))
        self._instrument_rows = rows
        return rows

    def instrument_master_cache_path(self) -> Path:
        cache_dir = Path(self.settings.candle_cache_dir) / "dhan"
        trade_date = datetime.now(self.settings.timezone).date().isoformat()
        return cache_dir / f"dhan_instrument_master_{trade_date}.csv"

    def instrument_master_cache_status(self) -> dict[str, Any]:
        path = self.instrument_master_cache_path()
        if not path.exists():
            return {
                "cached": False,
                "path": str(path),
                "rows": 0,
                "updatedAt": None,
            }

        rows = 0
        try:
            with path.open("r", encoding="utf-8", errors="replace", newline="") as handle:
                reader = csv.reader(handle)
                rows = max(sum(1 for _ in reader) - 1, 0)
        except Exception:
            rows = 0
        return {
            "cached": True,
            "path": str(path),
            "rows": rows,
            "updatedAt": datetime.fromtimestamp(path.stat().st_mtime, self.settings.timezone).isoformat(),
            "sizeBytes": path.stat().st_size,
        }

    def cache_instrument_master(self, *, force: bool = False) -> dict[str, Any]:
        path = self.instrument_master_cache_path()
        if path.exists() and not force:
            return self.instrument_master_cache_status() | {"downloaded": False}

        response = self.session.get(self.instrument_master_url, timeout=30)
        response.raise_for_status()
        text = response.content.decode("utf-8", errors="replace")
        all_rows = list(csv.DictReader(io.StringIO(text)))
        nifty_option_rows = [row for row in all_rows if _is_nifty_option_row(row)]
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8", newline="") as handle:
            fieldnames = list(all_rows[0].keys()) if all_rows else []
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(nifty_option_rows)
        self._instrument_rows = nifty_option_rows
        status = self.instrument_master_cache_status()
        status["downloaded"] = True
        status["sourceRows"] = len(all_rows)
        status["filteredRows"] = len(nifty_option_rows)
        return status

    @staticmethod
    def _normalize_sl_order_type(value: str) -> str:
        normalized = str(value or "STOP_LOSS_MARKET").upper()
        if normalized in {"SL-M", "SLM", "STOP_LOSS_MARKET"}:
            return "STOP_LOSS_MARKET"
        if normalized in {"SL", "STOP_LOSS"}:
            return "STOP_LOSS"
        return "STOP_LOSS_MARKET"


def dhan_position_quantity(position: dict[str, Any]) -> int:
    for key in ("netQty", "netQuantity", "quantity", "positionQty"):
        quantity = _safe_int(position.get(key))
        if quantity is not None:
            return quantity
    buy_qty = _safe_int(position.get("buyQty")) or 0
    sell_qty = _safe_int(position.get("sellQty")) or 0
    return buy_qty - sell_qty


def dhan_exit_side_for_quantity(quantity: int) -> str:
    return "SELL" if quantity > 0 else "BUY"


def _safe_correlation_id(prefix: str, value: str) -> str:
    safe_value = "".join(ch for ch in str(value or "") if ch.isalnum() or ch in {"_", "-"})
    return f"{prefix}-{safe_value}"[:30]


def _first_present(row: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in row and row[key] not in {None, ""}:
            return row[key]
    return None


def _first_number(payload: dict[str, Any], *keys: str) -> float | None:
    for key in keys:
        amount = _safe_float(payload.get(key))
        if amount is not None:
            return round(amount, 2)
    return None


def _extract_order_id(order: dict[str, Any] | None) -> str | None:
    if not isinstance(order, dict):
        return None
    if order.get("orderId"):
        return str(order.get("orderId"))
    response = order.get("response") if isinstance(order.get("response"), dict) else {}
    if response.get("orderId"):
        return str(response.get("orderId"))
    if response.get("order_id"):
        return str(response.get("order_id"))
    return None


def _is_nifty_option_row(row: dict[str, Any]) -> bool:
    row_exchange = str(_first_present(row, "EXCH_ID", "SEM_EXM_EXCH_ID", "EXCHANGE") or "").upper()
    row_underlying = str(_first_present(row, "UNDERLYING_SYMBOL", "SM_SYMBOL_NAME", "SYMBOL_NAME", "SEM_CUSTOM_SYMBOL") or "").upper()
    row_option = str(_first_present(row, "SEM_OPTION_TYPE", "OPTION_TYPE") or "").upper()
    row_segment = str(_first_present(row, "SEM_SEGMENT", "SEGMENT") or "").upper()
    row_instrument = str(_first_present(row, "SEM_INSTRUMENT_NAME", "INSTRUMENT") or "").upper()
    row_symbol = str(_first_present(row, "SEM_TRADING_SYMBOL", "TRADING_SYMBOL", "SYMBOL_NAME") or "").upper()

    is_nse = row_exchange in {"NSE", "NSE_FNO", ""}
    is_nifty = row_underlying == "NIFTY" or (
        row_symbol.startswith("NIFTY")
        and not row_symbol.startswith(("BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT"))
    )
    is_option = row_option in {"CE", "PE"} or "OPT" in row_instrument
    is_derivative = row_segment in {"D", "NSE_FNO"} or "OPT" in row_instrument
    return is_nse and is_nifty and is_option and is_derivative


def _normalize_date(value: Any) -> str | None:
    if value is None:
        return None
    if hasattr(value, "date"):
        value = value.date()
    text = str(value).strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date().isoformat()
    except ValueError:
        return text[:10]
