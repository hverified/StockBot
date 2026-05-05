from __future__ import annotations

import argparse
import logging
import threading
import time
from dataclasses import replace
from datetime import datetime
from typing import Any

import pandas as pd

from nifty_alert_bot.alerts import format_alert
from nifty_alert_bot.config import get_settings
from nifty_alert_bot.data import fetch_candles
from nifty_alert_bot.indicators import build_signal_frame
from nifty_alert_bot.logging_utils import configure_logging
from nifty_alert_bot.notifier import TelegramNotifier
from nifty_alert_bot.paper_trading import PaperTradingEngine
from nifty_alert_bot.run_log_store import RunLogStore
from nifty_alert_bot.scheduler import WEEKDAYS, next_run_at
from nifty_alert_bot.state import StateStore


logger = logging.getLogger(__name__)


INDEX_STRATEGY_KEY = "index_5m"
OPTION_CONTRACT_STRATEGY_KEY = "option_contracts_1m"
SENSEX_OPTION_CONTRACT_STRATEGY_KEY = "option_contracts_1m_sensex"
NIFTY_OPTION_CONTRACT_5M_STRATEGY_KEY = "option_contracts_5m"
SENSEX_OPTION_CONTRACT_5M_STRATEGY_KEY = "option_contracts_5m_sensex"


def build_state_store(settings) -> StateStore:
    return StateStore(
        settings.mongodb_uri,
        settings.mongodb_database,
        settings.mongodb_collection,
        settings.mongodb_signal_alerts_collection,
        settings.legacy_state_file,
    )


def strategy_key_for_settings(settings, state_key: str | None = None) -> str | None:
    if state_key:
        return state_key
    if settings.strategy_mode == "option_contracts":
        return OPTION_CONTRACT_STRATEGY_KEY
    if settings.strategy_mode == "index":
        return INDEX_STRATEGY_KEY
    return None


def option_strategy_settings_for_key(settings, strategy_key: str):
    is_five_minute = strategy_key in {
        NIFTY_OPTION_CONTRACT_5M_STRATEGY_KEY,
        SENSEX_OPTION_CONTRACT_5M_STRATEGY_KEY,
    }
    base = replace(
        settings,
        strategy_mode="option_contracts",
        option_contract_interval="5m" if is_five_minute else "1m",
        schedule_interval_minutes=5 if is_five_minute else 1,
        schedule_buffer_seconds=2,
        paper_trade_entry_second=2,
        option_contract_entry_signal="BUY" if is_five_minute else settings.option_contract_entry_signal,
        option_contract_target_pct=8 if is_five_minute else settings.option_contract_target_pct,
        option_contract_min_signal_candle_pct=2 if is_five_minute else settings.option_contract_min_signal_candle_pct,
        option_contract_strike_offset=100 if is_five_minute else settings.option_contract_strike_offset,
    )
    if strategy_key in {SENSEX_OPTION_CONTRACT_STRATEGY_KEY, SENSEX_OPTION_CONTRACT_5M_STRATEGY_KEY}:
        return replace(
            base,
            zerodha_option_exchange="BFO",
            zerodha_underlying="SENSEX",
            paper_trade_lot_size=20,
            option_contract_1="",
            option_contract_2="",
        )
    return replace(
        base,
        zerodha_option_exchange="NFO",
        zerodha_underlying="NIFTY",
        paper_trade_lot_size=75,
    )


def apply_daily_option_contracts(
    settings,
    state: StateStore,
    now: datetime,
    state_key: str | None = None,
):
    strategy_key = strategy_key_for_settings(settings, state_key)
    daily_contracts = state.load_daily_option_contracts(
        now.date().isoformat(),
        strategy_key,
    )
    if (
        not daily_contracts
        and settings.strategy_mode in {"option_contracts", "both"}
        and strategy_key in {None, OPTION_CONTRACT_STRATEGY_KEY}
    ):
        daily_contracts = state.load_daily_option_contracts(now.date().isoformat())
    if not daily_contracts:
        return settings

    target_pct = float(daily_contracts.get("target_pct") or settings.option_contract_target_pct)

    if settings.strategy_mode not in {"option_contracts", "both"}:
        return replace(
            settings,
            schedule_start=str(daily_contracts.get("schedule_start") or settings.schedule_start),
            schedule_end=str(daily_contracts.get("schedule_end") or settings.schedule_end),
            paper_trade_capital=float(daily_contracts.get("starting_balance") or settings.paper_trade_capital),
            paper_trade_target_pct=target_pct,
        )

    contract_1 = str(daily_contracts.get("contract_1") or settings.option_contract_1 or "").strip().upper()
    contract_2 = str(daily_contracts.get("contract_2") or settings.option_contract_2 or "").strip().upper()

    return replace(
        settings,
        option_contract_1=contract_1,
        option_contract_2=contract_2,
        schedule_start=str(daily_contracts.get("schedule_start") or settings.schedule_start),
        schedule_end=str(daily_contracts.get("schedule_end") or settings.schedule_end),
        option_contract_target_pct=target_pct,
        option_contract_max_signal_candle_pct=float(
            daily_contracts.get("max_signal_candle_pct") or settings.option_contract_max_signal_candle_pct
        ),
        option_contract_min_signal_candle_pct=float(
            daily_contracts.get("min_signal_candle_pct")
            if daily_contracts.get("min_signal_candle_pct") is not None
            else settings.option_contract_min_signal_candle_pct
        ),
        option_contract_strike_offset=int(
            daily_contracts.get("strike_offset") if daily_contracts.get("strike_offset") is not None else settings.option_contract_strike_offset
        ),
        option_contract_entry_signal=str(
            "BUY"
            if settings.option_contract_interval_minutes == 5
            else daily_contracts.get("entry_signal") or settings.option_contract_entry_signal
        ).upper(),
        option_contract_stop_loss_mode=str(
            daily_contracts.get("stop_loss_mode") or settings.option_contract_stop_loss_mode
        ).lower(),
        option_contract_stop_loss_pct=float(
            daily_contracts.get("stop_loss_pct") or settings.option_contract_stop_loss_pct
        ),
        paper_trade_capital=float(daily_contracts.get("starting_balance") or settings.paper_trade_capital),
    )


def to_python_scalar(value: Any) -> Any:
    if isinstance(value, list):
        return [
            to_python_scalar(item)
            if not isinstance(item, dict)
            else {key: to_python_scalar(inner) for key, inner in item.items()}
            for item in value
        ]
    if isinstance(value, dict):
        return {key: to_python_scalar(inner) for key, inner in value.items()}
    if value is None or pd.isna(value):
        return None
    if hasattr(value, "item"):
        return value.item()
    return value


def _first_contract_log_detail(details: dict[str, Any] | None) -> dict[str, Any] | None:
    if not details:
        return None
    contract_signals = details.get("contract_signals")
    if not isinstance(contract_signals, list):
        return None

    for item in contract_signals:
        if not isinstance(item, dict):
            continue
        if item.get("resolved_symbol") or item.get("close") is not None:
            return item
    return None


def build_telegram_delivery_payload(result: dict, now: datetime) -> dict:
    chat = result.get("chat", {})
    sender = result.get("from", {})
    return {
        "confirmedAt": now.isoformat(),
        "messageId": result.get("message_id"),
        "chatId": chat.get("id"),
        "chatType": chat.get("type"),
        "chatName": chat.get("title") or chat.get("first_name") or chat.get("username"),
        "botUsername": sender.get("username"),
        "botName": sender.get("first_name"),
    }


def build_run_log_payload(
    row: pd.Series | None,
    symbol: str,
    interval: str,
    now: datetime,
    status: str,
    message: str,
    *,
    alert_sent: bool = False,
    sample: bool = False,
    details: dict[str, Any] | None = None,
) -> dict:
    payload = {
        "date": now.date().isoformat(),
        "run_at": now.isoformat(),
        "symbol": symbol,
        "interval": interval,
        "status": status,
        "message": message,
        "alert_sent": alert_sent,
        "sample": sample,
    }

    if row is None:
        contract_detail = _first_contract_log_detail(details)
        payload.update(
            {
                "signal": contract_detail.get("signal") if contract_detail else None,
                "close": contract_detail.get("close") if contract_detail else None,
                "st_10_1": contract_detail.get("st_10_1") if contract_detail else None,
                "st_10_3": contract_detail.get("st_10_3") if contract_detail else None,
                "st_10_1_trend": contract_detail.get("st_10_1_trend") if contract_detail else None,
                "st_10_3_trend": contract_detail.get("st_10_3_trend") if contract_detail else None,
                "candle_time": contract_detail.get("candle_time") if contract_detail else None,
                "option_symbol": contract_detail.get("resolved_symbol") if contract_detail else None,
            }
        )
        if details:
            payload.update(
                {
                    key: to_python_scalar(value)
                    for key, value in details.items()
                }
            )
        return payload

    candle_time = row.name.tz_convert(now.tzinfo).strftime("%Y-%m-%d %H:%M:%S %Z")
    payload.update(
        {
            "signal": to_python_scalar(row.get("signal")),
            "close": round(float(row.get("Close")), 2),
            "st_10_1": round(float(row.get("st_10_1")), 2),
            "st_10_3": round(float(row.get("st_10_3")), 2),
            "st_10_1_trend": to_python_scalar(row.get("st_10_1_trend")),
            "st_10_3_trend": to_python_scalar(row.get("st_10_3_trend")),
            "candle_time": candle_time,
        }
    )
    if details:
        payload.update(
            {
                key: to_python_scalar(value)
                for key, value in details.items()
            }
        )
    return payload


def record_run_event(
    state: StateStore,
    run_logs: RunLogStore,
    now: datetime,
    symbol: str,
    interval: str,
    status: str,
    message: str,
    row: pd.Series | None,
    *,
    alert_sent: bool = False,
    sample: bool = False,
    details: dict[str, Any] | None = None,
) -> None:
    state.record_run(now, status, message)
    run_logs.append_log(
        build_run_log_payload(
            row,
            symbol,
            interval,
            now,
            status,
            message,
            alert_sent=alert_sent,
            sample=sample,
            details=details,
        )
    )


def process_once(
    settings,
    notifier: TelegramNotifier,
    state: StateStore,
    run_logs: RunLogStore,
    *,
    state_key: str | None = None,
) -> None:
    now_ist = datetime.now(settings.timezone)
    settings = apply_daily_option_contracts(settings, state, now_ist, state_key)
    if not settings.force_weekend_runs and now_ist.weekday() not in WEEKDAYS:
        message = "Bot disabled on Saturday/Sunday. Set FORCE_WEEKEND_RUNS=true to force a manual test run."
        record_run_event(
            state,
            run_logs,
            now_ist,
            settings.symbol,
            settings.interval,
            "skipped",
            message,
            None,
            details={"skip_reason": "weekend_disabled"},
        )
        logger.info(message)
        return

    closed_candle = None
    engine = PaperTradingEngine(settings, state, state_key=state_key)
    try:
        resumed_trade = engine.resume_active_trade_if_any(notifier, now_ist)
        if resumed_trade is not None:
            record_run_event(
                state,
                run_logs,
                now_ist,
                settings.symbol,
                settings.interval,
                resumed_trade.status,
                resumed_trade.message,
                resumed_trade.row,
                alert_sent=resumed_trade.alert_sent,
                details={
                    **(resumed_trade.details or {}),
                    "strategy_key": state_key,
                    "strategy_mode": settings.strategy_mode,
                },
            )
            logger.info(resumed_trade.message)
            return

        if settings.strategy_mode == "option_contracts":
            cycle_result = engine.evaluate_option_contracts(notifier, now_ist)
            record_run_event(
                state,
                run_logs,
                now_ist,
                ", ".join(settings.option_contracts) or settings.symbol,
                settings.option_contract_interval,
                cycle_result.status,
                cycle_result.message,
                cycle_result.row,
                alert_sent=cycle_result.alert_sent,
                details={
                    **(cycle_result.details or {}),
                    "strategy_key": state_key,
                    "strategy_mode": settings.strategy_mode,
                },
            )
            logger.info(cycle_result.message)
            return

        frame = fetch_candles(settings.symbol, settings.interval, settings.period)
        signal_frame = build_signal_frame(frame)

        if len(signal_frame) < 3:
            message = "Not enough candles yet to evaluate a closed candle."
            record_run_event(
                state,
                run_logs,
                now_ist,
                settings.symbol,
                settings.interval,
                "skipped",
                message,
                None,
            )
            logger.info(message)
            return

        closed_candle = signal_frame.iloc[-2]
        cycle_result = engine.evaluate_signal(signal_frame, notifier, now_ist)
        record_run_event(
            state,
            run_logs,
            now_ist,
            settings.symbol,
            settings.interval,
            cycle_result.status,
            cycle_result.message,
            cycle_result.row if cycle_result.row is not None else closed_candle,
            alert_sent=cycle_result.alert_sent,
            details={
                **(cycle_result.details or {}),
                "strategy_key": state_key,
                "strategy_mode": settings.strategy_mode,
            },
        )
        logger.info(cycle_result.message)
    except Exception as exc:
        record_run_event(
            state,
            run_logs,
            now_ist,
            settings.symbol,
            settings.interval,
            "error",
            str(exc),
            closed_candle,
        )
        raise
    finally:
        engine.close()


def send_sample_alert(signal: str = "BUY") -> None:
    settings = get_settings()
    configure_logging(settings.log_file)
    notifier = TelegramNotifier(settings.telegram_bot_token, settings.telegram_chat_id)
    state = build_state_store(settings)
    run_logs = RunLogStore(settings.run_logs_dir)
    now_ist = datetime.now(settings.timezone)
    sample_row = pd.Series(
        {
            "signal": signal.upper(),
            "Close": 24330.90,
            "st_10_1": 24312.45,
            "st_10_3": 24288.10,
        },
        name=pd.Timestamp(now_ist.replace(second=0, microsecond=0)),
    )
    telegram_result = notifier.send(format_alert(sample_row, settings.symbol, settings.interval, now_ist))
    state.record_telegram_delivery(build_telegram_delivery_payload(telegram_result, now_ist))
    record_run_event(
        state,
        run_logs,
        now_ist,
        settings.symbol,
        settings.interval,
        "sample_alert_sent",
        f"Sample {signal.upper()} alert sent.",
        sample_row,
        alert_sent=True,
        sample=True,
    )
    logger.info("Sample %s alert sent.", signal.upper())
    state.close()


def run_once(*, force_weekend_runs: bool = False) -> None:
    settings = get_settings()
    if force_weekend_runs:
        settings = replace(settings, force_weekend_runs=True)
    settings = option_contract_runtime_settings(settings)
    configure_logging(settings.log_file)
    notifier = TelegramNotifier(settings.telegram_bot_token, settings.telegram_chat_id)
    state = build_state_store(settings)
    run_logs = RunLogStore(settings.run_logs_dir)
    try:
        process_once(settings, notifier, state, run_logs)
    finally:
        state.close()


def build_dual_strategy_settings(settings) -> list[tuple[Any, str]]:
    index_settings = replace(
        settings,
        strategy_mode="index",
        schedule_interval_minutes=5,
        schedule_buffer_seconds=10,
        paper_trade_entry_second=55,
    )
    option_settings = replace(
        settings,
        strategy_mode="option_contracts",
        schedule_interval_minutes=settings.option_contract_interval_minutes,
        schedule_buffer_seconds=2,
        paper_trade_entry_second=2,
    )
    return [
        (index_settings, INDEX_STRATEGY_KEY),
        (option_settings, OPTION_CONTRACT_STRATEGY_KEY),
    ]


def build_option_contract_strategy_settings(settings) -> list[tuple[Any, str]]:
    return [
        (
            option_strategy_settings_for_key(settings, OPTION_CONTRACT_STRATEGY_KEY),
            OPTION_CONTRACT_STRATEGY_KEY,
        ),
        (
            option_strategy_settings_for_key(settings, SENSEX_OPTION_CONTRACT_STRATEGY_KEY),
            SENSEX_OPTION_CONTRACT_STRATEGY_KEY,
        ),
        (
            option_strategy_settings_for_key(settings, NIFTY_OPTION_CONTRACT_5M_STRATEGY_KEY),
            NIFTY_OPTION_CONTRACT_5M_STRATEGY_KEY,
        ),
        (
            option_strategy_settings_for_key(settings, SENSEX_OPTION_CONTRACT_5M_STRATEGY_KEY),
            SENSEX_OPTION_CONTRACT_5M_STRATEGY_KEY,
        ),
    ]


def option_contract_runtime_settings(settings):
    if settings.strategy_mode == "option_contracts":
        return settings
    logger.warning(
        "STRATEGY_MODE=%s is no longer used for live paper trading. Running only the 1m option-contract bot.",
        settings.strategy_mode,
    )
    return option_strategy_settings_for_key(settings, OPTION_CONTRACT_STRATEGY_KEY)


def run_dual_live(settings, notifier, state: StateStore, run_logs: RunLogStore) -> None:
    strategies = build_dual_strategy_settings(settings)
    logger.info(
        "Starting dual alert bot: index 5m at +10s and option-contract %s at +2s.",
        settings.option_contract_interval,
    )

    while True:
        now_ist = datetime.now(settings.timezone)
        strategies = [
            (
                apply_daily_option_contracts(strategy_settings, state, now_ist, state_key),
                state_key,
            )
            for strategy_settings, state_key in build_dual_strategy_settings(settings)
        ]
        scheduled_runs = [
            (
                next_run_at(
                    now_ist,
                    strategy_settings.schedule_start,
                    strategy_settings.schedule_end,
                    strategy_settings.schedule_interval_minutes,
                    strategy_settings.schedule_buffer_seconds,
                    include_weekends=strategy_settings.force_weekend_runs,
                ),
                strategy_settings,
                state_key,
            )
            for strategy_settings, state_key in strategies
        ]
        next_run, _, _ = min(scheduled_runs, key=lambda item: item[0])
        sleep_seconds = max((next_run - now_ist).total_seconds(), 0.0)
        logger.info(
            "Next dual scheduled run at %s. Sleeping for %.2f seconds.",
            next_run.strftime("%Y-%m-%d %I:%M:%S %p %Z"),
            sleep_seconds,
        )
        time.sleep(sleep_seconds)

        due_at = datetime.now(settings.timezone)
        for strategy_run_at, strategy_settings, state_key in scheduled_runs:
            if strategy_run_at <= due_at:
                try:
                    process_once(
                        strategy_settings,
                        notifier,
                        state,
                        run_logs,
                        state_key=state_key,
                    )
                except Exception:
                    logger.exception("Scheduled %s bot iteration failed", state_key)


def run_live(*, force_weekend_runs: bool = False) -> None:
    settings = get_settings()
    if force_weekend_runs:
        settings = replace(settings, force_weekend_runs=True)
    configure_logging(settings.log_file)
    notifier = TelegramNotifier(settings.telegram_bot_token, settings.telegram_chat_id)
    state = build_state_store(settings)
    run_logs = RunLogStore(settings.run_logs_dir)
    logger.info(
        "Starting option-contract paper bots for NIFTY/SENSEX 1m and 5m. Schedule: %s to %s IST at each strategy interval +2 seconds.",
        settings.schedule_start,
        settings.schedule_end,
    )
    running_threads: dict[str, threading.Thread] = {}

    while True:
        now_ist = datetime.now(settings.timezone)
        strategies = [
            (
                apply_daily_option_contracts(strategy_settings, state, now_ist, state_key),
                state_key,
            )
            for strategy_settings, state_key in build_option_contract_strategy_settings(settings)
        ]
        scheduled_runs = [
            (
                next_run_at(
                    now_ist,
                    strategy_settings.schedule_start,
                    strategy_settings.schedule_end,
                    strategy_settings.schedule_interval_minutes,
                    strategy_settings.schedule_buffer_seconds,
                    include_weekends=strategy_settings.force_weekend_runs,
                ),
                strategy_settings,
                state_key,
            )
            for strategy_settings, state_key in strategies
        ]
        next_run, _, _ = min(scheduled_runs, key=lambda item: item[0])
        sleep_seconds = max((next_run - now_ist).total_seconds(), 0.0)
        logger.info(
            "Next scheduled run at %s. Sleeping for %.2f seconds.",
            next_run.strftime("%Y-%m-%d %I:%M:%S %p %Z"),
            sleep_seconds,
        )
        if settings.force_weekend_runs:
            logger.info("FORCE_WEEKEND_RUNS is enabled; Saturday/Sunday runs are allowed.")
        time.sleep(sleep_seconds)

        due_at = datetime.now(settings.timezone)
        for strategy_run_at, strategy_settings, state_key in scheduled_runs:
            if strategy_run_at <= due_at:
                running_thread = running_threads.get(state_key)
                if running_thread is not None and running_thread.is_alive():
                    logger.info("Skipped %s scheduled scan because its previous worker is still active.", state_key)
                    continue

                def run_strategy_once(
                    strategy_settings=strategy_settings,
                    state_key=state_key,
                ) -> None:
                    try:
                        process_once(strategy_settings, notifier, state, run_logs, state_key=state_key)
                    except Exception:
                        logger.exception("Scheduled %s bot iteration failed", state_key)

                thread = threading.Thread(
                    target=run_strategy_once,
                    name=f"{state_key}-worker",
                    daemon=True,
                )
                running_threads[state_key] = thread
                thread.start()


def main() -> None:
    parser = argparse.ArgumentParser(description="NIFTY Supertrend Telegram alert bot")
    parser.add_argument(
        "--mode",
        choices=["live", "once", "sample-alert"],
        default="live",
        help="Run the scheduler, execute one live scan, or send a sample alert.",
    )
    parser.add_argument(
        "--signal",
        choices=["BUY", "SELL"],
        default="BUY",
        help="Signal to use with --mode sample-alert.",
    )
    parser.add_argument(
        "--force-weekend-runs",
        action="store_true",
        help="Allow bot scans on Saturday/Sunday for manual testing.",
    )
    args = parser.parse_args()

    if args.mode == "sample-alert":
        send_sample_alert(args.signal)
        return

    if args.mode == "once":
        run_once(force_weekend_runs=args.force_weekend_runs)
        return

    run_live(force_weekend_runs=args.force_weekend_runs)
