from __future__ import annotations

import logging
import math
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

import pandas as pd

from nifty_alert_bot.alerts import build_alert_payload, format_alert
from nifty_alert_bot.config import kite_interval
from nifty_alert_bot.data import fetch_latest_price
from nifty_alert_bot.indicators import build_signal_frame
from nifty_alert_bot.live_trading import LiveTradingBroker, LiveTradingError
from nifty_alert_bot.option_price_provider import OptionPriceProvider
from nifty_alert_bot.paper_trade_repository import PaperTradeRepository
from nifty_alert_bot.scheduler import parse_hhmm


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CycleResult:
    status: str
    message: str
    row: pd.Series | None
    details: dict[str, Any] | None = None
    alert_sent: bool = False


def _round_to_50(value: float) -> int:
    return int(round(value / 50.0) * 50)


def _compute_itm_strike(spot: float, signal: str) -> tuple[int, str]:
    nearest_50 = _round_to_50(spot)
    if signal == "BUY":
        strike = nearest_50 if nearest_50 < spot else nearest_50 - 50
        return strike, "CE"
    strike = nearest_50 if nearest_50 > spot else nearest_50 + 50
    return strike, "PE"

def _normalize_quantity(capital: float, option_price: float, lot_size: int) -> int:
    raw_quantity = math.floor(capital / option_price)
    return (raw_quantity // lot_size) * lot_size


def _estimate_charges(entry_price: float, exit_price: float, quantity: int) -> float:
    entry_turnover = entry_price * quantity
    exit_turnover = exit_price * quantity
    turnover = entry_turnover + exit_turnover
    brokerage = 40.0
    transaction_charges = turnover * 0.00053
    sebi_charges = turnover * 0.000001
    stamp_duty = entry_turnover * 0.00003
    gst = 0.18 * (brokerage + transaction_charges + sebi_charges)
    return round(brokerage + transaction_charges + sebi_charges + stamp_duty + gst, 2)


def _apply_entry_slippage(price: float, slippage_pct: float) -> float:
    return round(price * (1 + slippage_pct / 100.0), 2)


def _apply_exit_slippage(price: float, slippage_pct: float) -> float:
    return round(price * (1 - slippage_pct / 100.0), 2)


def _is_short_trade_signal(signal: str | None) -> bool:
    return str(signal or "").upper() == "SELL"


def _entry_execution_price(price: float, slippage_pct: float, signal: str | None) -> float:
    if _is_short_trade_signal(signal):
        return round(price * (1 - slippage_pct / 100.0), 2)
    return _apply_entry_slippage(price, slippage_pct)


def _exit_execution_price(price: float, slippage_pct: float, signal: str | None) -> float:
    if _is_short_trade_signal(signal):
        return round(price * (1 + slippage_pct / 100.0), 2)
    return _apply_exit_slippage(price, slippage_pct)


def _trade_gross_pnl(entry_price: float, exit_price: float, quantity: int, signal: str | None) -> float:
    if _is_short_trade_signal(signal):
        return round((entry_price - exit_price) * quantity, 2)
    return round((exit_price - entry_price) * quantity, 2)


def _live_average_price(order_result: dict[str, Any] | None) -> float | None:
    if not order_result:
        return None
    fill = order_result.get("fill") or {}
    price = fill.get("averagePrice")
    try:
        price = float(price)
    except (TypeError, ValueError):
        return None
    return price if price > 0 else None


def _fill_average_price(fill: dict[str, Any] | None) -> float | None:
    if not fill:
        return None
    price = fill.get("averagePrice")
    try:
        price = float(price)
    except (TypeError, ValueError):
        return None
    return price if price > 0 else None


def _trade_window_end(now: datetime, end_hhmm: str, buffer_seconds: int) -> datetime:
    end_time = parse_hhmm(end_hhmm)
    return now.replace(
        hour=end_time.hour,
        minute=end_time.minute,
        second=buffer_seconds,
        microsecond=0,
    )


def _signal_execution_time(candle_time: datetime, interval_minutes: int, entry_second: int) -> datetime:
    # yfinance labels 5-minute candles by their start time, so add one interval to get the close.
    candle_close = candle_time + timedelta(minutes=interval_minutes)
    return candle_close.replace(second=entry_second, microsecond=0)


def _safe_float(value: Any) -> float | None:
    if value is None or pd.isna(value):
        return None
    return float(value)


def _option_candles_to_frame(candles: list[dict[str, Any]], timezone) -> pd.DataFrame:
    if not candles:
        return pd.DataFrame()

    frame = pd.DataFrame(candles)
    if frame.empty or "date" not in frame.columns:
        return pd.DataFrame()

    frame = frame.rename(
        columns={
            "open": "Open",
            "high": "High",
            "low": "Low",
            "close": "Close",
        }
    )
    frame.index = pd.to_datetime(frame["date"])
    if frame.index.tz is None:
        frame.index = frame.index.tz_localize(timezone)
    else:
        frame.index = frame.index.tz_convert(timezone)
    return frame[["Open", "High", "Low", "Close"]].dropna()


def _current_candle_start(now: datetime, interval_minutes: int) -> datetime:
    minute_bucket = (now.minute // interval_minutes) * interval_minutes
    return now.replace(minute=minute_bucket, second=0, microsecond=0)


def _latest_closed_row(signal_frame: pd.DataFrame, now: datetime, interval_minutes: int) -> pd.Series | None:
    if signal_frame.empty:
        return None

    current_start = pd.Timestamp(_current_candle_start(now, interval_minutes))
    rows = signal_frame[signal_frame.index < current_start]
    if rows.empty:
        return None
    return rows.iloc[-1]


def _format_option_contract_alert(row: pd.Series, contract_symbol: str, interval: str, now: datetime) -> str:
    candle_time = row.name.tz_convert(now.tzinfo).strftime("%d %b %H:%M:%S")
    sent_time = now.strftime("%d %b %H:%M:%S")
    signal = str(row["signal"]).upper()
    emoji = "🟢" if signal == "BUY" else "🔴"
    return (
        f"{emoji} {signal} signal\n"
        f"{contract_symbol} · {interval}\n\n"
        f"Close: ₹{row['Close']:.2f}\n"
        f"Candle: {candle_time}\n"
        f"Sent: {sent_time}"
    )


def _format_trade_entry_message(signal_block: str, trade: dict[str, Any]) -> str:
    live_lines = []
    if trade.get("live_entry_order_id"):
        live_lines = [
            "",
            "Live",
            f"Order: {trade['live_entry_order_id']}",
            f"Qty: {trade.get('live_quantity', trade.get('quantity'))}",
            f"Cash: ₹{float(trade.get('live_available_cash') or 0.0):.2f}",
        ]
        if trade.get("live_target_order_id") or trade.get("live_stop_loss_order_id"):
            live_lines.extend(
                [
                    f"Target order: {trade.get('live_target_order_id') or '-'}",
                    f"SL order: {trade.get('live_stop_loss_order_id') or '-'}",
                ]
            )

    return "\n".join(
        [
            signal_block,
            "",
            "Entry",
            f"{trade['option_symbol']} · {trade.get('signal', '-')}",
            f"Qty: {trade.get('quantity', '-')}",
            f"Entry: ₹{float(trade['entry_price']):.2f}",
            f"SL: ₹{float(trade['stop_loss_price']):.2f}",
            f"Target: ₹{float(trade['target_price']):.2f}",
            "Exit: Target / SL / ST flip",
            *live_lines,
        ]
    )


def _format_trade_exit_message(trade: dict[str, Any], *, exit_reason: str, exit_price: float, net_pnl: float, status: str) -> str:
    status_icon = "✅" if status == "WIN" else "⚠️"
    live_lines = []
    if trade.get("live_exit_order_id"):
        live_lines = [
            "",
            "Live",
            f"Exit order: {trade['live_exit_order_id']}",
            f"Mode: {trade.get('live_exit_order_mode') or 'market'}",
        ]

    return "\n".join(
        [
            f"{status_icon} Trade exit · {status}",
            f"{trade['option_symbol']} · {trade.get('signal', '-')}",
            "",
            f"Reason: {exit_reason}",
            f"Exit: ₹{exit_price:.2f}",
            f"Net PnL: ₹{net_pnl:.2f}",
            *live_lines,
        ]
    )


class PaperTradingEngine:
    def __init__(self, settings, state_store, *, state_key: str | None = None) -> None:
        self.settings = settings
        self.state_store = state_store
        self.state_key = state_key
        self.price_provider = OptionPriceProvider(settings)
        self.paper_trade_repository = PaperTradeRepository(
            settings.mongodb_uri,
            settings.mongodb_database,
            settings.mongodb_paper_trades_collection,
        )
        self._option_contract_session_initialized = False

    def close(self) -> None:
        self.price_provider.close()
        self.paper_trade_repository.close()

    def _load_paper_state(self) -> dict[str, Any]:
        return self.state_store.load_paper_trading(self.state_key)

    def _save_paper_state(self, paper_state: dict[str, Any]) -> None:
        self.state_store.save_paper_trading(paper_state, self.state_key)

    def _record_delivery(self, result: dict, now: datetime) -> None:
        chat = result.get("chat", {})
        sender = result.get("from", {})
        self.state_store.record_telegram_delivery(
            {
                "confirmedAt": now.isoformat(),
                "messageId": result.get("message_id"),
                "chatId": chat.get("id"),
                "chatType": chat.get("type"),
                "chatName": chat.get("title") or chat.get("first_name") or chat.get("username"),
                "botUsername": sender.get("username"),
                "botName": sender.get("first_name"),
            }
        )

    def _notify(self, notifier, message: str, now: datetime) -> None:
        try:
            telegram_result = notifier.send(message)
            self._record_delivery(telegram_result, now)
        except Exception:
            logger.exception("Paper-trade Telegram notification failed")

    def _submit_live_order_if_enabled(
        self,
        trade: dict[str, Any],
        *,
        transaction_type: str,
        tag: str,
        live_entry_price: float | None = None,
    ) -> dict[str, Any] | None:
        broker = LiveTradingBroker(self.settings, self.state_store)
        try:
            broker_status = broker.status()
            if not broker_status.get("enabled"):
                return None
            enabled_strategy_keys = broker_status.get("enabledStrategyKeys")
            if (
                isinstance(enabled_strategy_keys, list)
                and enabled_strategy_keys
                and self.state_key not in enabled_strategy_keys
            ):
                return None
            requested_quantity = int(trade["quantity"])
            live_available_cash = None
            live_quantity = int(trade.get("live_quantity") or 0)
            if tag == "hverified-entry":
                live_available_cash = broker.available_cash()
                price_for_quantity = float(live_entry_price or trade.get("entry_price") or 0.0)
                live_quantity = _normalize_quantity(
                    live_available_cash,
                    price_for_quantity,
                    self.settings.paper_trade_lot_size,
                )
                if live_quantity < self.settings.paper_trade_lot_size:
                    raise LiveTradingError(
                        "Live order skipped because Zerodha available cash "
                        f"{live_available_cash:.2f} cannot buy one lot at {price_for_quantity:.2f}."
                    )
            elif live_quantity < self.settings.paper_trade_lot_size:
                live_quantity = requested_quantity

            return broker.place_order_and_wait(
                exchange=str(trade["instrument_exchange"]),
                tradingsymbol=str(trade["option_symbol"]),
                transaction_type=transaction_type,
                quantity=live_quantity,
                product="MIS",
                order_type="MARKET",
                validity="DAY",
                tag=tag,
            ) | {
                "liveQuantity": live_quantity,
                "paperQuantity": requested_quantity,
                "liveAvailableCash": live_available_cash,
            }
        finally:
            broker.close()

    def _apply_live_entry_fill(
        self,
        trade: dict[str, Any],
        live_order: dict[str, Any] | None,
        *,
        target_pct: float,
        percent_stop_loss_pct: float,
    ) -> None:
        if not live_order:
            return

        trade["live_entry_order_id"] = live_order.get("orderId")
        trade["live_entry_order_request"] = live_order.get("request")
        trade["live_entry_fill"] = live_order.get("fill")
        trade["paper_quantity"] = live_order.get("paperQuantity", trade.get("quantity"))
        trade["live_quantity"] = live_order.get("liveQuantity", trade.get("quantity"))
        trade["live_available_cash"] = live_order.get("liveAvailableCash")
        trade["live_capital_used"] = round(
            float(trade.get("entry_price") or 0.0) * int(trade["live_quantity"]),
            2,
        )

        fill_price = _live_average_price(live_order)
        if fill_price is None:
            return

        fill_price = round(fill_price, 2)
        trade["paper_entry_price"] = trade.get("entry_price")
        trade["entry_price"] = fill_price
        trade["price_source"] = "zerodha_live_fill"
        trade["live_capital_used"] = round(fill_price * int(trade["live_quantity"]), 2)

        short_trade = _is_short_trade_signal(trade.get("signal"))
        stop_loss_mode = str(trade.get("stop_loss_mode") or "").lower()
        if stop_loss_mode == "percent":
            stop_multiplier = 1 + percent_stop_loss_pct / 100.0 if short_trade else 1 - percent_stop_loss_pct / 100.0
            trade["stop_loss_price"] = round(fill_price * stop_multiplier, 2)
            trade["stop_loss_source"] = f"fixed_{percent_stop_loss_pct:g}pct_live_fill"

        stop_loss_price = float(trade["stop_loss_price"])
        invalid_stop_loss = stop_loss_price <= fill_price if short_trade else stop_loss_price >= fill_price
        stop_loss_pct = round((abs(fill_price - stop_loss_price) / fill_price) * 100.0, 2)
        if invalid_stop_loss or (stop_loss_mode != "percent" and stop_loss_pct > self.settings.paper_trade_max_sl_pct):
            stop_multiplier = (
                1 + self.settings.paper_trade_max_sl_pct / 100.0
                if short_trade
                else 1 - self.settings.paper_trade_max_sl_pct / 100.0
            )
            trade["stop_loss_reference"] = stop_loss_price
            trade["stop_loss_price"] = round(fill_price * stop_multiplier, 2)
            trade["stop_loss_source"] = (
                f"{trade.get('stop_loss_source') or 'signal_stop_loss'}"
                f"_live_fill_capped_{self.settings.paper_trade_max_sl_pct:g}pct"
            )
            stop_loss_pct = round(self.settings.paper_trade_max_sl_pct, 2)

        trade["stop_loss_pct"] = stop_loss_pct
        target_multiplier = 1 - target_pct / 100.0 if short_trade else 1 + target_pct / 100.0
        trade["target_price"] = round(fill_price * target_multiplier, 2)

    def _place_live_broker_exit_orders_if_ready(self, trade: dict[str, Any]) -> None:
        if not self.settings.live_trading_use_broker_exits:
            return
        if trade.get("live_target_order_id") or trade.get("live_stop_loss_order_id"):
            return
        live_fill = trade.get("live_entry_fill") or {}
        if live_fill.get("confirmed") is not True:
            return
        live_quantity = int(trade.get("live_quantity") or 0)
        if live_quantity < self.settings.paper_trade_lot_size:
            return

        short_trade = _is_short_trade_signal(trade.get("signal"))
        exit_side = "BUY" if short_trade else "SELL"
        broker = LiveTradingBroker(self.settings, self.state_store)
        try:
            if not broker.status().get("enabled"):
                return
            orders = broker.place_broker_exit_orders(
                exchange=str(trade["instrument_exchange"]),
                tradingsymbol=str(trade["option_symbol"]),
                transaction_type=exit_side,
                quantity=live_quantity,
                product="MIS",
                target_price=float(trade["target_price"]),
                stop_loss_price=float(trade["stop_loss_price"]),
                sl_order_type=self.settings.live_trading_sl_order_type,
            )
        finally:
            broker.close()

        target_order = orders.get("target") or {}
        stop_order = orders.get("stopLoss") or {}
        trade.update(
            {
                "live_exit_order_mode": "broker_target_sl",
                "live_target_order_id": target_order.get("orderId"),
                "live_target_order_request": target_order.get("request"),
                "live_stop_loss_order_id": stop_order.get("orderId"),
                "live_stop_loss_order_request": stop_order.get("request"),
                "live_exit_orders_placed_at": datetime.now(self.settings.timezone).isoformat(),
            }
        )

    def _cancel_live_broker_exit_orders(self, trade: dict[str, Any]) -> dict[str, Any]:
        cancellations: dict[str, Any] = {}
        order_ids = {
            "target": trade.get("live_target_order_id"),
            "stopLoss": trade.get("live_stop_loss_order_id"),
        }
        if not any(order_ids.values()):
            return cancellations

        broker = LiveTradingBroker(self.settings, self.state_store)
        try:
            for key, order_id in order_ids.items():
                if not order_id:
                    continue
                try:
                    cancellations[key] = broker.cancel_order_if_open(order_id=str(order_id))
                except Exception as exc:
                    cancellations[key] = {"orderId": order_id, "error": str(exc)}
                    logger.warning("Failed to cancel live %s exit order %s: %s", key, order_id, exc)
        finally:
            broker.close()
        return cancellations

    def _check_live_broker_exit_orders(self, trade: dict[str, Any]) -> dict[str, Any] | None:
        target_order_id = trade.get("live_target_order_id")
        stop_order_id = trade.get("live_stop_loss_order_id")
        if not target_order_id and not stop_order_id:
            return None

        broker = LiveTradingBroker(self.settings, self.state_store)
        try:
            target_order = broker.order_by_id(str(target_order_id)) if target_order_id else None
            stop_order = broker.order_by_id(str(stop_order_id)) if stop_order_id else None
            target_status = str((target_order or {}).get("status") or "").upper()
            stop_status = str((stop_order or {}).get("status") or "").upper()

            if target_status == "COMPLETE":
                cancellation = None
                if stop_order_id:
                    try:
                        cancellation = broker.cancel_order_if_open(order_id=str(stop_order_id))
                    except Exception as exc:
                        cancellation = {"orderId": stop_order_id, "error": str(exc)}
                        logger.warning("Failed to cancel stop-loss sibling order %s: %s", stop_order_id, exc)
                fill = {
                    "confirmed": True,
                    "exitOrderType": "target",
                    "averagePrice": _fill_average_price({"averagePrice": (target_order or {}).get("average_price")}),
                    "raw": target_order,
                    "cancelledSibling": cancellation,
                }
                return {
                    "exit_reason": "TARGET",
                    "order_id": target_order_id,
                    "fill": fill,
                }

            if stop_status == "COMPLETE":
                cancellation = None
                if target_order_id:
                    try:
                        cancellation = broker.cancel_order_if_open(order_id=str(target_order_id))
                    except Exception as exc:
                        cancellation = {"orderId": target_order_id, "error": str(exc)}
                        logger.warning("Failed to cancel target sibling order %s: %s", target_order_id, exc)
                fill = {
                    "confirmed": True,
                    "exitOrderType": "stop_loss",
                    "averagePrice": _fill_average_price({"averagePrice": (stop_order or {}).get("average_price")}),
                    "raw": stop_order,
                    "cancelledSibling": cancellation,
                }
                return {
                    "exit_reason": "STOP_LOSS",
                    "order_id": stop_order_id,
                    "fill": fill,
                }

            terminal_problem_statuses = {"REJECTED", "CANCELLED"}
            if target_status in terminal_problem_statuses or stop_status in terminal_problem_statuses:
                trade["live_exit_order_warning"] = {
                    "targetStatus": target_status,
                    "stopLossStatus": stop_status,
                    "checkedAt": datetime.now(self.settings.timezone).isoformat(),
                }
        finally:
            broker.close()

        return None

    def _record_signal_alert(
        self,
        row: pd.Series,
        signal_key: str,
        now: datetime,
        *,
        symbol: str | None = None,
        extra: dict[str, Any] | None = None,
    ) -> None:
        interval = (
            self.settings.option_contract_interval
            if (extra or {}).get("strategyMode") == "option_contracts"
            else self.settings.interval
        )
        payload = build_alert_payload(row, symbol or self.settings.symbol, interval, now)
        if extra:
            payload.update(extra)
        self.state_store.record_alert(
            signal_key,
            payload,
        )

    def reset_daily_state_if_needed(self, now: datetime) -> dict[str, Any]:
        paper_state = self._load_paper_state()
        today = now.date().isoformat()
        changed = False
        if paper_state.get("trade_date") != today:
            carried_cash_balance = paper_state.get("cash_balance")
            try:
                day_start_balance = round(float(carried_cash_balance), 2)
            except (TypeError, ValueError):
                day_start_balance = round(float(self.settings.paper_trade_capital), 2)
            paper_state.update(
                {
                    "trade_date": today,
                    "active_trade": None,
                    "last_signal_key": None,
                    "option_contract_scan_initialized": False,
                    "option_contract_session_initialized_at": None,
                    "daily_realized_pnl": 0.0,
                    "daily_trade_count": 0,
                    "daily_win_count": 0,
                    "daily_loss_count": 0,
                    "consecutive_losses": 0,
                    "day_stopped": False,
                    "day_stop_reason": None,
                    "trade_history": [],
                    "starting_balance": day_start_balance,
                    "cash_balance": day_start_balance,
                }
            )
            paper_state.setdefault("balance_adjustments", [])
            changed = True
        elif paper_state.get("cash_balance") is None:
            paper_state["starting_balance"] = round(float(self.settings.paper_trade_capital), 2)
            paper_state["cash_balance"] = round(float(self.settings.paper_trade_capital), 2)
            paper_state.setdefault("balance_adjustments", [])
            changed = True
        elif (
            paper_state.get("day_stopped")
            and not str(paper_state.get("day_stop_reason") or "").startswith("Daily profit lock active")
        ):
            paper_state["day_stopped"] = False
            paper_state["day_stop_reason"] = None
            changed = True
        if "cooldown_until" in paper_state:
            paper_state.pop("cooldown_until", None)
            changed = True
        if changed:
            self._save_paper_state(paper_state)
        return paper_state

    def _daily_profit_stop_status(self, paper_state: dict[str, Any]) -> tuple[bool, float, float]:
        threshold_pct = float(self.settings.paper_trade_daily_profit_stop_pct)
        if threshold_pct <= 0:
            return False, 0.0, threshold_pct

        base_capital = float(
            paper_state.get("starting_balance")
            or self.settings.paper_trade_capital
            or 0.0
        )
        if base_capital <= 0:
            return False, 0.0, threshold_pct

        realized_pnl = float(paper_state.get("daily_realized_pnl") or 0.0)
        profit_pct = round((realized_pnl / base_capital) * 100.0, 2)
        return profit_pct >= threshold_pct, profit_pct, threshold_pct

    def _stop_new_entries_if_daily_profit_reached(
        self,
        paper_state: dict[str, Any],
    ) -> tuple[bool, str | None, float, float]:
        is_stopped, profit_pct, threshold_pct = self._daily_profit_stop_status(paper_state)
        if not is_stopped:
            if str(paper_state.get("day_stop_reason") or "").startswith("Daily profit lock active"):
                paper_state["day_stopped"] = False
                paper_state["day_stop_reason"] = None
                self._save_paper_state(paper_state)
            return False, None, profit_pct, threshold_pct

        reason = (
            f"Daily profit lock active: realized PnL is {profit_pct:.2f}% "
            f"against the {threshold_pct:.2f}% limit."
        )
        if (
            paper_state.get("day_stopped") is not True
            or paper_state.get("day_stop_reason") != reason
        ):
            paper_state["day_stopped"] = True
            paper_state["day_stop_reason"] = reason
            self._save_paper_state(paper_state)
        return True, reason, profit_pct, threshold_pct

    def _ensure_active_trade_target(self, trade: dict[str, Any], paper_state: dict[str, Any]) -> dict[str, Any]:
        changed = False
        if trade.get("target_price") is not None:
            return self._ensure_active_trade_stop_loss_cap(trade, paper_state)

        entry_price = _safe_float(trade.get("entry_price"))
        if entry_price is None:
            return self._ensure_active_trade_stop_loss_cap(trade, paper_state)

        target_pct = (
            self.settings.option_contract_target_pct
            if trade.get("strategy_mode") == "option_contracts"
            else self.settings.paper_trade_target_pct
        )
        target_multiplier = (
            1 - target_pct / 100.0
            if _is_short_trade_signal(trade.get("signal"))
            else 1 + target_pct / 100.0
        )
        trade["target_price"] = round(entry_price * target_multiplier, 2)
        trade["target_pct"] = target_pct
        changed = True
        logger.info(
            "Backfilled target_price for active paper trade %s using target_pct=%s.",
            trade.get("trade_id"),
            target_pct,
        )
        if changed:
            paper_state["active_trade"] = trade
            self._save_paper_state(paper_state)
            self.paper_trade_repository.save_trade(trade)
        return self._ensure_active_trade_stop_loss_cap(trade, paper_state)

    def _ensure_active_trade_stop_loss_cap(self, trade: dict[str, Any], paper_state: dict[str, Any]) -> dict[str, Any]:
        if trade.get("strategy_mode") != "option_contracts":
            return trade

        entry_price = _safe_float(trade.get("entry_price"))
        stop_loss_price = _safe_float(trade.get("stop_loss_price"))
        if entry_price is None or stop_loss_price is None or entry_price <= 0:
            return trade

        if trade.get("manual_stop_loss") is True or str(trade.get("stop_loss_source") or "").startswith("manual"):
            stop_loss_pct = (abs(entry_price - stop_loss_price) / entry_price) * 100.0
            trade["stop_loss_pct"] = round(stop_loss_pct, 2)
            return trade

        stop_loss_pct = (abs(entry_price - stop_loss_price) / entry_price) * 100.0
        if stop_loss_pct <= self.settings.paper_trade_max_sl_pct:
            trade["stop_loss_pct"] = round(stop_loss_pct, 2)
            return trade

        stop_multiplier = (
            1 + self.settings.paper_trade_max_sl_pct / 100.0
            if _is_short_trade_signal(trade.get("signal"))
            else 1 - self.settings.paper_trade_max_sl_pct / 100.0
        )
        capped_stop_loss = round(
            entry_price * stop_multiplier,
            2,
        )
        trade["stop_loss_reference"] = stop_loss_price
        trade["stop_loss_price"] = capped_stop_loss
        trade["stop_loss_pct"] = round(self.settings.paper_trade_max_sl_pct, 2)
        trade["stop_loss_source"] = f"{trade.get('stop_loss_source') or 'entry_signal_option_candle_low'}_capped_{self.settings.paper_trade_max_sl_pct:g}pct"
        paper_state["active_trade"] = trade
        self._save_paper_state(paper_state)
        self.paper_trade_repository.save_trade(trade)
        logger.info(
            "Capped stop_loss_price for active paper trade %s from %.2f to %.2f using PAPER_TRADE_MAX_SL_PCT=%s.",
            trade.get("trade_id"),
            stop_loss_price,
            capped_stop_loss,
            self.settings.paper_trade_max_sl_pct,
        )
        return trade

    def resume_active_trade_if_any(self, notifier, now: datetime) -> CycleResult | None:
        paper_state = self.reset_daily_state_if_needed(now)
        active_trade = paper_state.get("active_trade")
        if not active_trade:
            return None
        active_trade = self._ensure_active_trade_target(active_trade, paper_state)
        return self._monitor_trade(active_trade, paper_state, notifier, resumed=True)

    def evaluate_signal(self, signal_frame: pd.DataFrame, notifier, now: datetime) -> CycleResult:
        paper_state = self.reset_daily_state_if_needed(now)

        if len(signal_frame) < 3:
            return CycleResult("skipped", "Not enough candles for paper-trading rules.", None)

        closed_candle = signal_frame.iloc[-2]
        previous_candle = signal_frame.iloc[-3]
        signal = closed_candle.get("signal")

        if pd.isna(signal):
            return CycleResult("OK", "No fresh signal", closed_candle)

        signal = str(signal).upper()
        signal_key = f"{closed_candle.name.isoformat()}::{signal}"
        if paper_state.get("last_signal_key") == signal_key:
            return CycleResult("duplicate", f"Duplicate signal skipped for {signal_key}", closed_candle)

        if paper_state.get("active_trade"):
            paper_state["last_signal_key"] = signal_key
            self._save_paper_state(paper_state)
            return CycleResult("skipped", "Signal skipped because an active trade is already open.", closed_candle)

        profit_stopped, profit_stop_reason, profit_pct, threshold_pct = (
            self._stop_new_entries_if_daily_profit_reached(paper_state)
        )
        if profit_stopped:
            paper_state["last_signal_key"] = signal_key
            self._save_paper_state(paper_state)
            return CycleResult(
                "skipped",
                "Signal skipped because daily profit lock is active.",
                closed_candle,
                details={
                    "skip_reason": "daily_profit_lock",
                    "daily_profit_pct": profit_pct,
                    "daily_profit_stop_pct": threshold_pct,
                    "day_stop_reason": profit_stop_reason,
                },
            )

        candle_time_ist = closed_candle.name.tz_convert(self.settings.timezone)
        execute_at = _signal_execution_time(
            candle_time_ist,
            self.settings.schedule_interval_minutes,
            self.settings.paper_trade_entry_second,
        )
        session_end = _trade_window_end(now, self.settings.schedule_end, self.settings.schedule_buffer_seconds)

        if execute_at > session_end:
            paper_state["last_signal_key"] = signal_key
            self._save_paper_state(paper_state)
            return CycleResult("skipped", "Signal skipped because entry would be outside the trade window.", closed_candle)

        spot_before_entry = fetch_latest_price(self.settings.symbol)
        strike, option_type = _compute_itm_strike(spot_before_entry, signal)
        contract = self.price_provider.resolve_contract(strike, option_type, now)
        quoted_option_price, quoted_price_source = self.price_provider.quote_option(
            spot_before_entry,
            strike,
            option_type,
            contract=contract,
            prefer_stream=False,
        )
        quantity = _normalize_quantity(
            self.settings.paper_trade_capital,
            quoted_option_price,
            self.settings.paper_trade_lot_size,
        )

        if quantity < self.settings.paper_trade_lot_size:
            paper_state["last_signal_key"] = signal_key
            self._save_paper_state(paper_state)
            return CycleResult(
                "skipped",
                "Signal skipped because calculated quantity is less than one lot.",
                closed_candle,
                details={
                    "signal": signal,
                    "strike": strike,
                    "option_type": option_type,
                    "quoted_option_price": quoted_option_price,
                    "price_source": quoted_price_source,
                },
            )

        if now < execute_at:
            logger.info(
                "Paper trade signal queued for %s. Sleeping until %s.",
                signal_key,
                execute_at.strftime("%Y-%m-%d %I:%M:%S %p %Z"),
            )
            time.sleep(max((execute_at - now).total_seconds(), 0.0))

        entry_time = datetime.now(self.settings.timezone)
        entry_spot = fetch_latest_price(self.settings.symbol)
        contract = contract or self.price_provider.resolve_contract(strike, option_type, entry_time)
        base_option_price, entry_price_source = self.price_provider.quote_option(
            entry_spot,
            strike,
            option_type,
            contract=contract,
            prefer_stream=True,
        )
        entry_price = _apply_entry_slippage(base_option_price, self.settings.paper_trade_slippage_pct)

        option_candle = (
            self.price_provider.candle_for_start(
                contract,
                candle_time_ist,
                interval_minutes=self.settings.schedule_interval_minutes,
            )
            if contract is not None
            else None
        )
        if contract is not None and option_candle is None:
            paper_state["last_signal_key"] = signal_key
            self._save_paper_state(paper_state)
            return CycleResult(
                "skipped",
                "Signal skipped because the exact option signal candle was unavailable, so stop loss could not be derived safely.",
                closed_candle,
                details={
                    "signal": signal,
                    "strike": strike,
                    "option_type": option_type,
                    "option_symbol": contract.tradingsymbol,
                    "entry_price": entry_price,
                    "price_source": entry_price_source,
                    "stop_loss_source": "option_signal_candle_low",
                },
            )

        stop_loss_source = "option_signal_candle_low"
        if option_candle is not None:
            stop_reference = float(option_candle["low"])
            stop_loss_price = round(stop_reference, 2)
            stop_loss_pct = (entry_price - stop_loss_price) / entry_price * 100.0
        else:
            stop_loss_source = "fallback_underlying_signal_candle_pct"
            stop_reference = float(closed_candle["Low"]) if signal == "BUY" else float(closed_candle["High"])
            stop_loss_pct = (
                (entry_spot - stop_reference) / entry_spot * 100.0
                if signal == "BUY"
                else (stop_reference - entry_spot) / entry_spot * 100.0
            )
            stop_loss_price = round(entry_price * (1 - stop_loss_pct / 100.0), 2)

        if stop_loss_pct <= 0:
            paper_state["last_signal_key"] = signal_key
            self._save_paper_state(paper_state)
            return CycleResult(
                "skipped",
                f"Signal skipped because stop-loss percentage {stop_loss_pct:.2f}% from {stop_loss_source} is invalid.",
                closed_candle,
                details={
                    "signal": signal,
                    "strike": strike,
                    "option_type": option_type,
                    "entry_price": entry_price,
                    "stop_loss_pct": round(stop_loss_pct, 2),
                    "stop_loss_source": stop_loss_source,
                },
            )

        if stop_loss_pct > self.settings.paper_trade_max_sl_pct:
            stop_loss_pct = self.settings.paper_trade_max_sl_pct
            stop_loss_price = round(entry_price * (1 - stop_loss_pct / 100.0), 2)
            stop_loss_source = f"{stop_loss_source}_capped_{int(self.settings.paper_trade_max_sl_pct)}pct"

        if option_candle is None and contract is None:
            logger.warning(
                "Signal candle option OHLC unavailable because no Zerodha contract was resolved at %s. Stop loss used fallback underlying percentage logic.",
                candle_time_ist.isoformat(),
            )

        trade = {
            "trade_id": f"{signal_key}::{entry_time.isoformat()}",
            "strategy_mode": "index",
            "signal_interval": self.settings.interval,
            "signal_interval_minutes": self.settings.schedule_interval_minutes,
            "signal": signal,
            "strike": strike,
            "option_type": option_type,
            "option_symbol": contract.tradingsymbol if contract is not None else f"NIFTY-{strike}-{option_type}",
            "instrument_exchange": contract.exchange if contract is not None else None,
            "instrument_token": contract.instrument_token if contract is not None else None,
            "expiry": contract.expiry if contract is not None else None,
            "entry_time": entry_time.isoformat(),
            "entry_spot": round(entry_spot, 2),
            "entry_price": entry_price,
            "quoted_entry_price": base_option_price,
            "price_source": entry_price_source,
            "quantity": quantity,
            "capital_used": round(entry_price * quantity, 2),
            "stop_loss_reference": round(stop_reference, 2),
            "stop_loss_pct": round(stop_loss_pct, 2),
            "stop_loss_source": stop_loss_source,
            "stop_loss_price": stop_loss_price,
            "target_price": round(entry_price * (1 + self.settings.paper_trade_target_pct / 100.0), 2),
            "status": "OPEN",
            "pnl": None,
            "charges": None,
            "net_pnl": None,
            "exit_reason": None,
            "exit_time": None,
            "exit_price": None,
            "exit_spot": None,
        }

        live_entry_order = self._submit_live_order_if_enabled(
            trade,
            transaction_type="SELL" if short_trade else "BUY",
            tag="hverified-entry",
            live_entry_price=entry_price,
        )
        self._apply_live_entry_fill(
            trade,
            live_entry_order,
            target_pct=self.settings.paper_trade_target_pct,
            percent_stop_loss_pct=self.settings.paper_trade_max_sl_pct,
        )
        try:
            self._place_live_broker_exit_orders_if_ready(trade)
        except Exception as exc:
            trade["live_exit_order_warning"] = {
                "message": str(exc),
                "checkedAt": datetime.now(self.settings.timezone).isoformat(),
            }
            logger.exception("Failed to place broker-side live exit orders for %s.", trade["trade_id"])

        paper_state["active_trade"] = trade
        paper_state["last_signal_key"] = signal_key
        self._save_paper_state(paper_state)
        self.paper_trade_repository.save_trade(trade)

        self._record_signal_alert(closed_candle, signal_key, entry_time)

        self._notify(
            notifier,
            _format_trade_entry_message(
                format_alert(closed_candle, self.settings.symbol, self.settings.interval, entry_time),
                trade,
            ),
            entry_time,
        )

        return self._monitor_trade(trade, paper_state, notifier, resumed=False)

    def _option_signal_frame(self, contract, now: datetime) -> pd.DataFrame:
        from_dt = (now - timedelta(days=5)).replace(hour=0, minute=0, second=0, microsecond=0)
        candles = self.price_provider.historical_option_candles(
            contract,
            from_dt,
            now,
            interval=kite_interval(self.settings.option_contract_interval),
        )
        frame = _option_candles_to_frame(candles, self.settings.timezone)
        if frame.empty:
            return frame
        return build_signal_frame(
            frame,
            signal_mode=self.settings.option_contract_signal_mode,
        )

    def _contract_run_detail(
        self,
        contract_input: str,
        contract,
        row: pd.Series | None,
        *,
        status: str | None = None,
    ) -> dict[str, Any]:
        detail = {
            "input": contract_input,
            "resolved_symbol": contract.tradingsymbol if contract is not None else None,
            "status": status or ("resolved" if contract is not None else "not_found"),
        }
        if row is not None:
            signal = None if pd.isna(row.get("signal")) else str(row.get("signal")).upper()
            detail.update(
                {
                    "status": status or ("signal" if signal else "no_signal"),
                    "signal": signal,
                    "close": round(float(row.get("Close")), 2),
                    "st_10_1": round(float(row.get("st_10_1")), 2),
                    "st_10_3": round(float(row.get("st_10_3")), 2),
                    "st_10_1_trend": int(row.get("st_10_1_trend")),
                    "st_10_3_trend": int(row.get("st_10_3_trend")),
                    "candle_time": row.name.tz_convert(self.settings.timezone).strftime("%Y-%m-%d %H:%M:%S %Z"),
                }
            )
        return detail

    def _resolved_trade_contract(self, trade: dict[str, Any]):
        if not (trade.get("instrument_exchange") and trade.get("option_symbol") and trade.get("instrument_token")):
            return None

        from nifty_alert_bot.option_price_provider import OptionContract

        return OptionContract(
            exchange=str(trade["instrument_exchange"]),
            tradingsymbol=str(trade["option_symbol"]),
            instrument_token=int(trade["instrument_token"]),
            strike=int(trade["strike"]),
            option_type=str(trade["option_type"]),
            expiry=str(trade.get("expiry") or ""),
        )

    def _trend_flip_exit(self, trade: dict[str, Any], now: datetime) -> tuple[float, datetime] | None:
        if trade.get("strategy_mode") != "option_contracts":
            return None

        contract = self._resolved_trade_contract(trade)
        if contract is None:
            return None

        signal_frame = self._option_signal_frame(contract, now)
        interval_minutes = self.settings.option_contract_interval_minutes
        latest_closed = _latest_closed_row(signal_frame, now, interval_minutes)
        if latest_closed is None:
            return None

        entry_candle_time = trade.get("entry_signal_candle_time")
        if entry_candle_time and latest_closed.name <= pd.Timestamp(entry_candle_time):
            return None

        current_trend = int(latest_closed.get("st_10_1_trend"))
        entry_trend = int(trade.get("entry_signal_trend") or 1)
        if current_trend == entry_trend:
            return None

        candle_time = latest_closed.name.tz_convert(self.settings.timezone).to_pydatetime()
        candle_close_time = candle_time + timedelta(
            minutes=interval_minutes,
            seconds=self.settings.schedule_buffer_seconds,
        )
        return round(float(latest_closed["Close"]), 2), candle_close_time

    def evaluate_option_contracts(self, notifier, now: datetime) -> CycleResult:
        paper_state = self.reset_daily_state_if_needed(now)
        contract_inputs = self.settings.option_contracts
        if not contract_inputs:
            return CycleResult(
                "skipped",
                "Option-contract strategy is enabled but OPTION_CONTRACT_1/2 are empty.",
                None,
                details={"strategy_mode": "option_contracts", "skip_reason": "missing_contract_inputs"},
            )

        if paper_state.get("active_trade"):
            return CycleResult(
                "skipped",
                "Contract signal scan skipped because an active trade is already open.",
                None,
                details={"strategy_mode": "option_contracts", "skip_reason": "active_trade_open"},
            )

        profit_stopped, profit_stop_reason, profit_pct, threshold_pct = (
            self._stop_new_entries_if_daily_profit_reached(paper_state)
        )
        if profit_stopped:
            return CycleResult(
                "skipped",
                "Contract signal scan skipped because daily profit lock is active.",
                None,
                details={
                    "strategy_mode": "option_contracts",
                    "skip_reason": "daily_profit_lock",
                    "daily_profit_pct": profit_pct,
                    "daily_profit_stop_pct": threshold_pct,
                    "day_stop_reason": profit_stop_reason,
                },
            )

        contract_details: list[dict[str, Any]] = []
        candidates: list[tuple[str, Any, pd.Series, str]] = []
        entry_signal_mode = str(self.settings.option_contract_entry_signal or "BUY").upper()
        allowed_entry_signals = {"BUY", "SELL"} if entry_signal_mode == "BOTH" else {entry_signal_mode}
        interval_minutes = self.settings.option_contract_interval_minutes

        for contract_input in contract_inputs:
            contract = self.price_provider.resolve_contract_input(
                contract_input,
                now,
                self.settings.zerodha_option_exchange,
                self.settings.zerodha_underlying,
            )
            if contract is None:
                contract_details.append(self._contract_run_detail(contract_input, None, None))
                continue

            try:
                signal_frame = self._option_signal_frame(contract, now)
            except Exception:
                logger.exception("Failed to build option signal frame for %s.", contract.tradingsymbol)
                contract_details.append(
                    self._contract_run_detail(contract_input, contract, None, status="data_error")
                )
                continue

            row = _latest_closed_row(signal_frame, now, interval_minutes)
            detail_status = "no_data" if signal_frame.empty else None
            if row is None and detail_status is None:
                detail_status = "no_closed_candle"
            contract_details.append(
                self._contract_run_detail(contract_input, contract, row, status=detail_status)
            )
            if row is None:
                continue

            signal = row.get("signal")
            signal = None if pd.isna(signal) else str(signal).upper()
            if signal not in allowed_entry_signals:
                continue

            signal_key = f"option_contract::{contract.tradingsymbol}::{row.name.isoformat()}::{signal}"
            if paper_state.get("last_signal_key") == signal_key:
                contract_details[-1]["status"] = "duplicate"
                continue

            candidates.append((signal_key, contract, row, signal))

        if not candidates:
            if paper_state.get("option_contract_scan_initialized") is not True:
                paper_state["option_contract_scan_initialized"] = True
                paper_state["option_contract_session_initialized_at"] = now.isoformat()
                self._save_paper_state(paper_state)
                self._option_contract_session_initialized = True
            return CycleResult(
                "OK",
                f"No fresh option-contract {entry_signal_mode} signal",
                None,
                details={
                    "strategy_mode": "option_contracts",
                    "contract_signals": contract_details,
                },
            )

        baseline_already_seen = (
            paper_state.get("option_contract_scan_initialized") is True
            or bool(paper_state.get("option_contract_session_initialized_at"))
            or bool(paper_state.get("last_signal_key"))
        )
        if not baseline_already_seen:
            signal_key, contract, closed_candle, entry_signal = candidates[0]
            paper_state["option_contract_scan_initialized"] = True
            paper_state["last_signal_key"] = signal_key
            paper_state["option_contract_session_initialized_at"] = now.isoformat()
            self._save_paper_state(paper_state)
            self._option_contract_session_initialized = True
            return CycleResult(
                "skipped",
                "Initial option-contract scan used as baseline. Waiting for the next fresh BUY signal.",
                closed_candle,
                details={
                    "strategy_mode": "option_contracts",
                    "option_symbol": contract.tradingsymbol,
                    "signal": entry_signal,
                    "skip_reason": "initial_scan_baseline",
                    "contract_signals": contract_details,
                },
            )

        signal_key, contract, closed_candle, entry_signal = candidates[0]
        candle_time_ist = closed_candle.name.tz_convert(self.settings.timezone)
        execute_at = _signal_execution_time(
            candle_time_ist,
            interval_minutes,
            self.settings.paper_trade_entry_second,
        )
        session_end = _trade_window_end(now, self.settings.schedule_end, self.settings.schedule_buffer_seconds)
        if execute_at > session_end:
            paper_state["last_signal_key"] = signal_key
            self._save_paper_state(paper_state)
            return CycleResult(
                "skipped",
                "Option-contract signal skipped because entry would be outside the trade window.",
                closed_candle,
                details={
                    "strategy_mode": "option_contracts",
                    "option_symbol": contract.tradingsymbol,
                    "skip_reason": "entry_outside_trade_window",
                    "contract_signals": contract_details,
                },
            )

        if now < execute_at:
            logger.info(
                "Option-contract signal queued for %s. Sleeping until %s.",
                signal_key,
                execute_at.strftime("%Y-%m-%d %H:%M:%S %Z"),
            )
            time.sleep(max((execute_at - now).total_seconds(), 0.0))

        entry_time = datetime.now(self.settings.timezone)
        base_option_price, entry_price_source = self.price_provider.quote_option(
            float(closed_candle["Close"]),
            contract.strike,
            contract.option_type,
            contract=contract,
            prefer_stream=True,
        )
        entry_price = _entry_execution_price(
            base_option_price,
            self.settings.paper_trade_slippage_pct,
            entry_signal,
        )
        available_balance = round(float(paper_state.get("cash_balance") or self.settings.paper_trade_capital), 2)
        quantity = _normalize_quantity(
            available_balance,
            entry_price,
            self.settings.paper_trade_lot_size,
        )
        if quantity < self.settings.paper_trade_lot_size:
            paper_state["last_signal_key"] = signal_key
            self._save_paper_state(paper_state)
            return CycleResult(
                "skipped",
                "Option-contract signal skipped because calculated quantity is less than one lot.",
                closed_candle,
                details={
                    "strategy_mode": "option_contracts",
                    "option_symbol": contract.tradingsymbol,
                    "entry_price": entry_price,
                    "available_balance": available_balance,
                    "skip_reason": "less_than_one_lot",
                    "contract_signals": contract_details,
                },
            )

        signal_candle_low = round(float(closed_candle["Low"]), 2)
        signal_candle_high = round(float(closed_candle["High"]), 2)
        signal_candle_open = round(float(closed_candle["Open"]), 2)
        signal_candle_close = round(float(closed_candle["Close"]), 2)
        signal_candle_body_pct = (
            round((abs(signal_candle_close - signal_candle_open) / signal_candle_open) * 100.0, 2)
            if signal_candle_open > 0
            else None
        )
        if (
            signal_candle_body_pct is not None
            and signal_candle_body_pct > self.settings.option_contract_max_signal_candle_pct
        ):
            paper_state["last_signal_key"] = signal_key
            self._save_paper_state(paper_state)
            return CycleResult(
                "skipped",
                (
                    "Option-contract signal skipped because signal candle body "
                    f"{signal_candle_body_pct:.2f}% is above "
                    f"{self.settings.option_contract_max_signal_candle_pct:.2f}%."
                ),
                closed_candle,
                details={
                    "strategy_mode": "option_contracts",
                    "option_symbol": contract.tradingsymbol,
                    "entry_price": entry_price,
                    "signal_candle_low": signal_candle_low,
                    "signal_candle_high": signal_candle_high,
                    "signal_candle_open": signal_candle_open,
                    "signal_candle_close": signal_candle_close,
                    "signal_candle_body_pct": signal_candle_body_pct,
                    "signal_candle_range_pct": signal_candle_body_pct,
                    "max_signal_candle_pct": self.settings.option_contract_max_signal_candle_pct,
                    "skip_reason": "signal_candle_body_above_limit",
                    "contract_signals": contract_details,
                },
            )
        if (
            signal_candle_body_pct is not None
            and signal_candle_body_pct < self.settings.option_contract_min_signal_candle_pct
        ):
            paper_state["last_signal_key"] = signal_key
            self._save_paper_state(paper_state)
            return CycleResult(
                "skipped",
                (
                    "Option-contract signal skipped because signal candle body "
                    f"{signal_candle_body_pct:.2f}% is below "
                    f"{self.settings.option_contract_min_signal_candle_pct:.2f}%."
                ),
                closed_candle,
                details={
                    "strategy_mode": "option_contracts",
                    "option_symbol": contract.tradingsymbol,
                    "entry_price": entry_price,
                    "signal_candle_low": signal_candle_low,
                    "signal_candle_high": signal_candle_high,
                    "signal_candle_open": signal_candle_open,
                    "signal_candle_close": signal_candle_close,
                    "signal_candle_body_pct": signal_candle_body_pct,
                    "signal_candle_range_pct": signal_candle_body_pct,
                    "min_signal_candle_pct": self.settings.option_contract_min_signal_candle_pct,
                    "skip_reason": "signal_candle_body_below_limit",
                    "contract_signals": contract_details,
                },
            )

        stop_loss_mode = str(self.settings.option_contract_stop_loss_mode or "signal_low").lower()
        short_trade = _is_short_trade_signal(entry_signal)
        if stop_loss_mode == "percent":
            stop_loss_multiplier = 1 + self.settings.option_contract_stop_loss_pct / 100.0 if short_trade else 1 - self.settings.option_contract_stop_loss_pct / 100.0
            stop_loss_price = round(entry_price * stop_loss_multiplier, 2)
            stop_loss_source = f"fixed_{self.settings.option_contract_stop_loss_pct:g}pct"
        else:
            stop_loss_price = signal_candle_high if short_trade else signal_candle_low
            stop_loss_source = "entry_signal_option_candle_high" if short_trade else "entry_signal_option_candle_low"
        stop_loss_pct = round((abs(entry_price - stop_loss_price) / entry_price) * 100.0, 2)
        invalid_stop_loss = stop_loss_price <= entry_price if short_trade else stop_loss_price >= entry_price
        if invalid_stop_loss:
            paper_state["last_signal_key"] = signal_key
            self._save_paper_state(paper_state)
            return CycleResult(
                "skipped",
                "Option-contract signal skipped because stop loss is invalid for entry direction.",
                closed_candle,
                details={
                    "strategy_mode": "option_contracts",
                    "option_symbol": contract.tradingsymbol,
                    "entry_price": entry_price,
                    "stop_loss_price": stop_loss_price,
                    "stop_loss_pct": stop_loss_pct,
                    "skip_reason": "invalid_signal_stop_loss",
                    "contract_signals": contract_details,
                },
            )
        if stop_loss_mode != "percent" and stop_loss_pct > self.settings.paper_trade_max_sl_pct:
            stop_loss_multiplier = 1 + self.settings.paper_trade_max_sl_pct / 100.0 if short_trade else 1 - self.settings.paper_trade_max_sl_pct / 100.0
            stop_loss_price = round(
                entry_price * stop_loss_multiplier,
                2,
            )
            stop_loss_pct = round(self.settings.paper_trade_max_sl_pct, 2)
            stop_loss_source = f"{stop_loss_source}_capped_{self.settings.paper_trade_max_sl_pct:g}pct"

        target_multiplier = 1 - self.settings.option_contract_target_pct / 100.0 if short_trade else 1 + self.settings.option_contract_target_pct / 100.0

        trade = {
            "trade_id": f"{signal_key}::{entry_time.isoformat()}",
            "strategy_mode": "option_contracts",
            "strategy_key": self.state_key,
            "underlying": self.settings.zerodha_underlying,
            "signal": entry_signal,
            "strike": contract.strike,
            "option_type": contract.option_type,
            "option_symbol": contract.tradingsymbol,
            "contract_input": contract.tradingsymbol,
            "instrument_exchange": contract.exchange,
            "instrument_token": contract.instrument_token,
            "expiry": contract.expiry,
            "entry_signal_candle_time": candle_time_ist.isoformat(),
            "entry_signal_trend": int(closed_candle.get("st_10_1_trend")),
            "exit_on_trend": -int(closed_candle.get("st_10_1_trend")),
            "entry_time": entry_time.isoformat(),
            "entry_spot": None,
            "entry_price": entry_price,
            "quoted_entry_price": base_option_price,
            "price_source": entry_price_source,
            "quantity": quantity,
            "capital_used": round(entry_price * quantity, 2),
            "balance_before": available_balance,
            "balance_after": None,
            "signal_candle_low": signal_candle_low,
            "signal_candle_high": signal_candle_high,
            "signal_candle_open": signal_candle_open,
            "signal_candle_close": signal_candle_close,
            "signal_candle_body_pct": signal_candle_body_pct,
            "signal_candle_range_pct": signal_candle_body_pct,
            "max_signal_candle_pct": self.settings.option_contract_max_signal_candle_pct,
            "min_signal_candle_pct": self.settings.option_contract_min_signal_candle_pct,
            "stop_loss_reference": signal_candle_high if short_trade else signal_candle_low,
            "stop_loss_mode": stop_loss_mode,
            "stop_loss_pct": stop_loss_pct,
            "stop_loss_source": stop_loss_source,
            "stop_loss_price": stop_loss_price,
            "target_price": round(entry_price * target_multiplier, 2),
            "target_pct": self.settings.option_contract_target_pct,
            "signal_interval": self.settings.option_contract_interval,
            "signal_interval_minutes": interval_minutes,
            "status": "OPEN",
            "pnl": None,
            "charges": None,
            "net_pnl": None,
            "exit_reason": None,
            "exit_time": None,
            "exit_price": None,
            "exit_spot": None,
        }

        live_entry_order = self._submit_live_order_if_enabled(
            trade,
            transaction_type=entry_signal,
            tag="hverified-entry",
            live_entry_price=entry_price,
        )
        self._apply_live_entry_fill(
            trade,
            live_entry_order,
            target_pct=self.settings.option_contract_target_pct,
            percent_stop_loss_pct=self.settings.option_contract_stop_loss_pct,
        )
        try:
            self._place_live_broker_exit_orders_if_ready(trade)
        except Exception as exc:
            trade["live_exit_order_warning"] = {
                "message": str(exc),
                "checkedAt": datetime.now(self.settings.timezone).isoformat(),
            }
            logger.exception("Failed to place broker-side live exit orders for %s.", trade["trade_id"])

        paper_state["active_trade"] = trade
        paper_state["last_signal_key"] = signal_key
        self._save_paper_state(paper_state)
        self.paper_trade_repository.save_trade(trade)

        self._record_signal_alert(
            closed_candle,
            signal_key,
            entry_time,
            symbol=contract.tradingsymbol,
            extra={
                "optionSymbol": contract.tradingsymbol,
                "strategyMode": "option_contracts",
                "strategyKey": self.state_key,
                "underlying": self.settings.zerodha_underlying,
                "contractInput": contract.tradingsymbol,
                "interval": self.settings.option_contract_interval,
            },
        )

        self._notify(
            notifier,
            _format_trade_entry_message(
                _format_option_contract_alert(
                    closed_candle,
                    contract.tradingsymbol,
                    self.settings.option_contract_interval,
                    entry_time,
                ),
                trade,
            ),
            entry_time,
        )

        return self._monitor_trade(trade, paper_state, notifier, resumed=False)

    def _monitor_trade(self, trade: dict[str, Any], paper_state: dict[str, Any], notifier, *, resumed: bool) -> CycleResult:
        session_end = _trade_window_end(datetime.now(self.settings.timezone), self.settings.schedule_end, self.settings.schedule_buffer_seconds)
        monitor_message = "Resumed active paper trade monitoring." if resumed else "Paper trade entered and monitoring started."
        logger.info("%s trade_id=%s", monitor_message, trade["trade_id"])
        last_trend_check_bucket: datetime | None = None

        while True:
            now = datetime.now(self.settings.timezone)
            spot = None
            if trade.get("strategy_mode") != "option_contracts":
                try:
                    spot = fetch_latest_price(self.settings.symbol)
                except Exception:
                    logger.debug("Underlying spot fetch failed while monitoring paper trade.", exc_info=True)
            exit_reason = None
            exit_timestamp = now
            live_exit_order = None
            broker_exit = self._check_live_broker_exit_orders(trade)
            if broker_exit is not None:
                exit_reason = broker_exit["exit_reason"]
                broker_exit_fill = broker_exit.get("fill") or {}
                exit_price_reference = (
                    _fill_average_price(broker_exit_fill)
                    or float(trade["target_price"] if exit_reason == "TARGET" else trade["stop_loss_price"])
                )
                live_price_source = "zerodha_broker_exit_order"
                live_exit_order = {
                    "orderId": broker_exit.get("order_id"),
                    "request": None,
                    "fill": broker_exit_fill,
                }
                option_price = exit_price_reference
            else:
                option_price, live_price_source = self.price_provider.quote_trade(trade)
                exit_price_reference = option_price

            short_trade = _is_short_trade_signal(trade.get("signal"))
            broker_exit_orders_active = bool(
                trade.get("live_target_order_id") or trade.get("live_stop_loss_order_id")
            )
            if exit_reason:
                pass
            elif not broker_exit_orders_active and (
                (short_trade and option_price >= trade["stop_loss_price"])
                or (not short_trade and option_price <= trade["stop_loss_price"])
            ):
                exit_reason = "STOP_LOSS"
            elif not broker_exit_orders_active and trade.get("target_price") is not None and (
                (short_trade and option_price <= trade["target_price"])
                or (not short_trade and option_price >= trade["target_price"])
            ):
                exit_reason = "TARGET"
            elif now >= session_end:
                exit_reason = "SESSION_CLOSE"
            elif trade.get("strategy_mode") == "option_contracts":
                interval_minutes = int(trade.get("signal_interval_minutes") or self.settings.option_contract_interval_minutes)
                current_bucket = _current_candle_start(now, interval_minutes)
                should_check_trend = (
                    now.second >= self.settings.schedule_buffer_seconds
                    and current_bucket != last_trend_check_bucket
                )
                if should_check_trend:
                    last_trend_check_bucket = current_bucket
                else:
                    should_check_trend = False

                if should_check_trend:
                    trend_exit = self._trend_flip_exit(trade, now)
                    if trend_exit is not None:
                        exit_price_reference, exit_timestamp = trend_exit
                        exit_reason = "SUPER_TREND_FLIP"

            if exit_reason:
                if live_exit_order is None:
                    if broker_exit_orders_active:
                        trade["live_exit_order_cancellations"] = self._cancel_live_broker_exit_orders(trade)
                    live_exit_order = self._submit_live_order_if_enabled(
                        trade,
                        transaction_type="BUY" if short_trade else "SELL",
                        tag="hverified-exit",
                    )
                live_exit_average_price = _live_average_price(live_exit_order)
                if live_exit_average_price is not None:
                    exit_price = round(live_exit_average_price, 2)
                    exit_price_source = (
                        "zerodha_broker_exit_order"
                        if broker_exit is not None
                        else "zerodha_live_fill"
                    )
                else:
                    exit_price = _exit_execution_price(
                        exit_price_reference,
                        self.settings.paper_trade_slippage_pct,
                        trade.get("signal"),
                    )
                    exit_price_source = (
                        live_price_source
                        if exit_reason != "SUPER_TREND_FLIP"
                        else f"option_{trade.get('signal_interval') or self.settings.option_contract_interval}_close"
                    )
                pnl_quantity = int(trade.get("live_quantity") or trade["quantity"]) if trade.get("live_entry_order_id") else int(trade["quantity"])
                gross_pnl = _trade_gross_pnl(
                    float(trade["entry_price"]),
                    exit_price,
                    pnl_quantity,
                    trade.get("signal"),
                )
                charges = _estimate_charges(trade["entry_price"], exit_price, pnl_quantity)
                net_pnl = round(gross_pnl - charges, 2)
                status = "WIN" if net_pnl >= 0 else "LOSS"

                trade.update(
                    {
                        "status": status,
                        "exit_reason": exit_reason,
                        "exit_time": exit_timestamp.isoformat(),
                        "exit_price": exit_price,
                        "exit_spot": round(spot, 2) if spot is not None else None,
                        "exit_price_source": exit_price_source,
                        "live_exit_order_id": live_exit_order.get("orderId") if live_exit_order else None,
                        "live_exit_order_request": live_exit_order.get("request") if live_exit_order else None,
                        "live_exit_fill": live_exit_order.get("fill") if live_exit_order else None,
                        "pnl_quantity": pnl_quantity,
                        "pnl": gross_pnl,
                        "charges": charges,
                        "net_pnl": net_pnl,
                    }
                )

                history = paper_state.get("trade_history", [])
                history.insert(0, trade.copy())
                paper_state["trade_history"] = history[:100]
                paper_state["active_trade"] = None
                paper_state.pop("cooldown_until", None)
                paper_state["daily_trade_count"] = int(paper_state.get("daily_trade_count", 0)) + 1
                paper_state["daily_realized_pnl"] = round(float(paper_state.get("daily_realized_pnl", 0.0)) + net_pnl, 2)
                paper_state["cash_balance"] = round(
                    float(paper_state.get("cash_balance") or self.settings.paper_trade_capital) + net_pnl,
                    2,
                )
                trade["balance_after"] = paper_state["cash_balance"]

                if net_pnl >= 0:
                    paper_state["daily_win_count"] = int(paper_state.get("daily_win_count", 0)) + 1
                    paper_state["consecutive_losses"] = 0
                else:
                    paper_state["daily_loss_count"] = int(paper_state.get("daily_loss_count", 0)) + 1
                    paper_state["consecutive_losses"] = int(paper_state.get("consecutive_losses", 0)) + 1

                paper_state["day_stopped"] = False
                paper_state["day_stop_reason"] = None
                self._stop_new_entries_if_daily_profit_reached(paper_state)

                self._save_paper_state(paper_state)
                self.paper_trade_repository.save_trade(trade)

                self._notify(
                    notifier,
                    _format_trade_exit_message(
                        trade,
                        exit_reason=exit_reason,
                        exit_price=exit_price,
                        net_pnl=net_pnl,
                        status=status,
                    ),
                    now,
                )

                return CycleResult(
                    status.lower(),
                    f"Paper trade closed with {status}. Reason: {exit_reason}. Net PnL: {net_pnl:.2f}",
                    None,
                    details=trade.copy(),
                    alert_sent=True,
                )

            time.sleep(self.settings.paper_trade_monitor_seconds)
