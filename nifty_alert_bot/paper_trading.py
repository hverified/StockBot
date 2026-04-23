from __future__ import annotations

import logging
import math
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

import pandas as pd

from nifty_alert_bot.alerts import build_alert_payload, format_alert
from nifty_alert_bot.data import fetch_latest_price
from nifty_alert_bot.option_price_provider import OptionPriceProvider, synthetic_option_price
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


def _trade_window_end(now: datetime, end_hhmm: str, buffer_seconds: int) -> datetime:
    end_time = parse_hhmm(end_hhmm)
    return now.replace(
        hour=end_time.hour,
        minute=end_time.minute,
        second=buffer_seconds,
        microsecond=0,
    )


def _next_candle_boundary(value: datetime) -> datetime:
    minute_bucket = (value.minute // 5) * 5
    boundary = value.replace(minute=minute_bucket, second=0, microsecond=0)
    if boundary <= value:
        boundary += timedelta(minutes=5)
    return boundary


def _cooldown_until(exit_time: datetime) -> datetime:
    return _next_candle_boundary(exit_time) + timedelta(minutes=5)


def _signal_execution_time(candle_time: datetime, interval_minutes: int, entry_second: int) -> datetime:
    # yfinance labels 5-minute candles by their start time, so add one interval to get the close.
    candle_close = candle_time + timedelta(minutes=interval_minutes)
    return candle_close.replace(second=entry_second, microsecond=0)


def _safe_float(value: Any) -> float | None:
    if value is None or pd.isna(value):
        return None
    return float(value)


class PaperTradingEngine:
    def __init__(self, settings, state_store) -> None:
        self.settings = settings
        self.state_store = state_store
        self.price_provider = OptionPriceProvider(settings)
        self.paper_trade_repository = PaperTradeRepository(
            settings.mongodb_uri,
            settings.mongodb_database,
            settings.mongodb_paper_trades_collection,
        )

    def close(self) -> None:
        self.price_provider.close()
        self.paper_trade_repository.close()

    def _log_trade_event(self, payload: dict[str, Any]) -> None:
        self.paper_trade_repository.save_event(payload)

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

    def _record_signal_alert(self, row: pd.Series, signal_key: str, now: datetime) -> None:
        self.state_store.record_alert(
            signal_key,
            build_alert_payload(row, self.settings.symbol, self.settings.interval, now),
        )

    def reset_daily_state_if_needed(self, now: datetime) -> dict[str, Any]:
        paper_state = self.state_store.load_paper_trading()
        today = now.date().isoformat()
        changed = False
        if paper_state.get("trade_date") != today:
            paper_state.update(
                {
                    "trade_date": today,
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
                }
            )
            changed = True
        elif paper_state.get("day_stopped") or paper_state.get("day_stop_reason"):
            paper_state["day_stopped"] = False
            paper_state["day_stop_reason"] = None
            changed = True

        if changed:
            self.state_store.save_paper_trading(paper_state)
        return paper_state

    def resume_active_trade_if_any(self, notifier, now: datetime) -> CycleResult | None:
        paper_state = self.reset_daily_state_if_needed(now)
        active_trade = paper_state.get("active_trade")
        if not active_trade:
            return None
        return self._monitor_trade(active_trade, paper_state, notifier, resumed=True)

    def evaluate_signal(self, signal_frame: pd.DataFrame, notifier, now: datetime) -> CycleResult:
        paper_state = self.reset_daily_state_if_needed(now)

        if len(signal_frame) < 3:
            return CycleResult("skipped", "Not enough candles for paper-trading rules.", None)

        closed_candle = signal_frame.iloc[-2]
        previous_candle = signal_frame.iloc[-3]
        signal = closed_candle.get("signal")

        if pd.isna(signal):
            self._log_trade_event(
                {
                    "event_type": "signal",
                    "timestamp": now.isoformat(),
                    "trade_date": now.date().isoformat(),
                    "status": "NO_SIGNAL",
                    "message": "No fresh signal",
                }
            )
            return CycleResult("OK", "No fresh signal", closed_candle)

        signal = str(signal).upper()
        signal_key = f"{closed_candle.name.isoformat()}::{signal}"
        if paper_state.get("last_signal_key") == signal_key:
            self._log_trade_event(
                {
                    "event_type": "skipped",
                    "timestamp": now.isoformat(),
                    "trade_date": now.date().isoformat(),
                    "signal": signal,
                    "status": "SKIPPED",
                    "skip_reason": "duplicate_signal",
                    "message": f"Duplicate signal skipped for {signal_key}",
                }
            )
            return CycleResult("duplicate", f"Duplicate signal skipped for {signal_key}", closed_candle)

        if paper_state.get("active_trade"):
            paper_state["last_signal_key"] = signal_key
            self.state_store.save_paper_trading(paper_state)
            self._log_trade_event(
                {
                    "event_type": "skipped",
                    "timestamp": now.isoformat(),
                    "trade_date": now.date().isoformat(),
                    "signal": signal,
                    "status": "SKIPPED",
                    "skip_reason": "active_trade",
                    "message": "Signal skipped because an active trade is already open.",
                }
            )
            return CycleResult("skipped", "Signal skipped because an active trade is already open.", closed_candle)

        cooldown_until = paper_state.get("cooldown_until")
        if cooldown_until and now < datetime.fromisoformat(cooldown_until):
            paper_state["last_signal_key"] = signal_key
            self.state_store.save_paper_trading(paper_state)
            self._log_trade_event(
                {
                    "event_type": "skipped",
                    "timestamp": now.isoformat(),
                    "trade_date": now.date().isoformat(),
                    "signal": signal,
                    "status": "SKIPPED",
                    "skip_reason": "cooldown_active",
                    "message": "Signal skipped because cooldown is active.",
                }
            )
            return CycleResult("skipped", "Signal skipped because cooldown is active.", closed_candle)

        candle_time_ist = closed_candle.name.tz_convert(self.settings.timezone)
        execute_at = _signal_execution_time(
            candle_time_ist,
            self.settings.schedule_interval_minutes,
            self.settings.paper_trade_entry_second,
        )
        session_end = _trade_window_end(now, self.settings.schedule_end, self.settings.schedule_buffer_seconds)

        if execute_at > session_end:
            paper_state["last_signal_key"] = signal_key
            self.state_store.save_paper_trading(paper_state)
            self._log_trade_event(
                {
                    "event_type": "skipped",
                    "timestamp": now.isoformat(),
                    "trade_date": now.date().isoformat(),
                    "signal": signal,
                    "status": "SKIPPED",
                    "skip_reason": "outside_trade_window",
                    "message": "Signal skipped because entry would be outside the trade window.",
                }
            )
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
            self.state_store.save_paper_trading(paper_state)
            self._log_trade_event(
                {
                    "event_type": "skipped",
                    "timestamp": now.isoformat(),
                    "trade_date": now.date().isoformat(),
                    "signal": signal,
                    "status": "SKIPPED",
                    "skip_reason": "less_than_one_lot",
                    "option_symbol": contract.tradingsymbol if contract is not None else None,
                    "strike": strike,
                    "option_type": option_type,
                    "entry_price": round(quoted_option_price, 2),
                    "quantity": quantity,
                    "capital_used": round(quoted_option_price * quantity, 2),
                    "stop_loss_price": None,
                    "stop_loss_source": None,
                    "price_source": quoted_price_source,
                    "message": "Signal skipped because calculated quantity is less than one lot.",
                }
            )
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
            self.state_store.save_paper_trading(paper_state)
            self._log_trade_event(
                {
                    "event_type": "skipped",
                    "timestamp": entry_time.isoformat(),
                    "trade_date": entry_time.date().isoformat(),
                    "signal": signal,
                    "status": "SKIPPED",
                    "skip_reason": "option_signal_candle_unavailable",
                    "strike": strike,
                    "option_type": option_type,
                    "option_symbol": contract.tradingsymbol,
                    "entry_price": entry_price,
                    "stop_loss_price": None,
                    "stop_loss_source": "option_signal_candle_low",
                    "price_source": entry_price_source,
                    "message": (
                        "Signal skipped because the exact option signal candle was unavailable, "
                        "so stop loss could not be derived safely."
                    ),
                }
            )
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
            self.state_store.save_paper_trading(paper_state)
            self._log_trade_event(
                {
                    "event_type": "skipped",
                    "timestamp": now.isoformat(),
                    "trade_date": now.date().isoformat(),
                    "signal": signal,
                    "status": "SKIPPED",
                    "skip_reason": "stop_loss_above_limit",
                    "option_symbol": contract.tradingsymbol if contract is not None else None,
                    "strike": strike,
                    "option_type": option_type,
                    "entry_price": entry_price,
                    "stop_loss_price": stop_loss_price,
                    "stop_loss_source": stop_loss_source,
                    "slippage_pct": self.settings.paper_trade_slippage_pct,
                    "message": f"Signal skipped because stop-loss percentage {stop_loss_pct:.2f}% from {stop_loss_source} is invalid.",
                }
            )
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
            "cooldown_after_exit": None,
            "pnl": None,
            "charges": None,
            "net_pnl": None,
            "exit_reason": None,
            "exit_time": None,
            "exit_price": None,
            "exit_spot": None,
        }

        paper_state["active_trade"] = trade
        paper_state["last_signal_key"] = signal_key
        self.state_store.save_paper_trading(paper_state)
        self.paper_trade_repository.save_trade(trade)
        self._log_trade_event(
            {
                "event_type": "entry",
                "timestamp": entry_time.isoformat(),
                "trade_date": entry_time.date().isoformat(),
                "signal": signal,
                "status": "OPEN",
                "trade_id": trade["trade_id"],
                "option_symbol": trade["option_symbol"],
                "strike": strike,
                "option_type": option_type,
                "entry_price": entry_price,
                "quantity": quantity,
                "capital_used": trade["capital_used"],
                "stop_loss_price": trade["stop_loss_price"],
                "target_price": trade["target_price"],
                "slippage_pct": self.settings.paper_trade_slippage_pct,
                "price_source": entry_price_source,
                "message": "Paper trade entry created.",
            }
        )

        self._record_signal_alert(closed_candle, signal_key, entry_time)

        self._notify(
            notifier,
            (
                f"{format_alert(closed_candle, self.settings.symbol, self.settings.interval, entry_time)}\n\n"
                f"📄 Paper Trade Entry\n"
                f"Contract: {trade['option_symbol']}\n"
                f"Qty: {quantity}\n"
                f"Entry: {entry_price:.2f}\n"
                f"SL: {trade['stop_loss_price']:.2f}\n"
                f"Target: {trade['target_price']:.2f}"
            ),
            entry_time,
        )

        return self._monitor_trade(trade, paper_state, notifier, resumed=False)

    def _monitor_trade(self, trade: dict[str, Any], paper_state: dict[str, Any], notifier, *, resumed: bool) -> CycleResult:
        session_end = _trade_window_end(datetime.now(self.settings.timezone), self.settings.schedule_end, self.settings.schedule_buffer_seconds)
        monitor_message = "Resumed active paper trade monitoring." if resumed else "Paper trade entered and monitoring started."
        logger.info("%s trade_id=%s", monitor_message, trade["trade_id"])

        while True:
            now = datetime.now(self.settings.timezone)
            spot = fetch_latest_price(self.settings.symbol)
            option_price, live_price_source = self.price_provider.quote_trade(trade)
            exit_reason = None

            if option_price <= trade["stop_loss_price"]:
                exit_reason = "STOP_LOSS"
            elif option_price >= trade["target_price"]:
                exit_reason = "TARGET"
            elif now >= session_end:
                exit_reason = "SESSION_CLOSE"

            if exit_reason:
                exit_price = _apply_exit_slippage(option_price, self.settings.paper_trade_slippage_pct)
                gross_pnl = round((exit_price - trade["entry_price"]) * trade["quantity"], 2)
                charges = _estimate_charges(trade["entry_price"], exit_price, trade["quantity"])
                net_pnl = round(gross_pnl - charges, 2)
                status = "WIN" if net_pnl >= 0 else "LOSS"

                trade.update(
                    {
                        "status": status,
                        "exit_reason": exit_reason,
                        "exit_time": now.isoformat(),
                        "exit_price": exit_price,
                        "exit_spot": round(spot, 2),
                        "pnl": gross_pnl,
                        "charges": charges,
                        "net_pnl": net_pnl,
                        "cooldown_after_exit": _cooldown_until(now).isoformat(),
                    }
                )

                history = paper_state.get("trade_history", [])
                history.insert(0, trade.copy())
                paper_state["trade_history"] = history[:100]
                paper_state["active_trade"] = None
                paper_state["cooldown_until"] = trade["cooldown_after_exit"]
                paper_state["daily_trade_count"] = int(paper_state.get("daily_trade_count", 0)) + 1
                paper_state["daily_realized_pnl"] = round(float(paper_state.get("daily_realized_pnl", 0.0)) + net_pnl, 2)

                if net_pnl >= 0:
                    paper_state["daily_win_count"] = int(paper_state.get("daily_win_count", 0)) + 1
                    paper_state["consecutive_losses"] = 0
                else:
                    paper_state["daily_loss_count"] = int(paper_state.get("daily_loss_count", 0)) + 1
                    paper_state["consecutive_losses"] = int(paper_state.get("consecutive_losses", 0)) + 1

                paper_state["day_stopped"] = False
                paper_state["day_stop_reason"] = None

                self.state_store.save_paper_trading(paper_state)
                self.paper_trade_repository.save_trade(trade)
                self._log_trade_event(
                    {
                        "event_type": "exit",
                        "timestamp": now.isoformat(),
                        "trade_date": now.date().isoformat(),
                        "signal": trade["signal"],
                        "status": status,
                        "trade_id": trade["trade_id"],
                        "option_symbol": trade["option_symbol"],
                        "strike": trade["strike"],
                        "option_type": trade["option_type"],
                        "entry_price": trade["entry_price"],
                        "exit_price": exit_price,
                        "quantity": trade["quantity"],
                        "capital_used": trade["capital_used"],
                        "stop_loss_price": trade["stop_loss_price"],
                        "target_price": trade["target_price"],
                        "gross_pnl": gross_pnl,
                        "charges": charges,
                        "net_pnl": net_pnl,
                        "slippage_pct": self.settings.paper_trade_slippage_pct,
                        "price_source": live_price_source,
                        "message": f"Paper trade closed by {exit_reason}.",
                    }
                )

                self._notify(
                    notifier,
                    (
                        f"📄 Paper Trade Exit\n"
                        f"Contract: {trade['option_symbol']}\n"
                        f"Exit reason: {exit_reason}\n"
                        f"Exit: {exit_price:.2f}\n"
                        f"Net PnL: {net_pnl:.2f}\n"
                        f"Status: {status}"
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
