from __future__ import annotations

import argparse
import logging
import time
from datetime import datetime
from typing import Any

import pandas as pd

from nifty_alert_bot.alerts import build_alert_payload, format_alert
from nifty_alert_bot.config import get_settings
from nifty_alert_bot.data import fetch_candles
from nifty_alert_bot.indicators import build_signal_frame
from nifty_alert_bot.logging_utils import configure_logging
from nifty_alert_bot.notifier import TelegramNotifier
from nifty_alert_bot.paper_trading import PaperTradingEngine
from nifty_alert_bot.run_log_store import RunLogStore
from nifty_alert_bot.scheduler import next_run_at, parse_hhmm
from nifty_alert_bot.state import StateStore


logger = logging.getLogger(__name__)


def to_python_scalar(value: Any) -> Any:
    if value is None or pd.isna(value):
        return None
    if hasattr(value, "item"):
        return value.item()
    return value


def build_alert_key(row: pd.Series) -> str:
    return f"{row.name.isoformat()}::{row['signal']}"


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
        payload.update(
            {
                "signal": None,
                "close": None,
                "st_10_1": None,
                "st_10_3": None,
                "st_10_1_trend": None,
                "st_10_3_trend": None,
                "candle_time": None,
            }
        )
        if details:
            payload.update(
                {
                    key: to_python_scalar(value)
                    if not isinstance(value, dict)
                    else value
                    for key, value in details.items()
                }
            )
        return payload

    candle_time = row.name.tz_convert(now.tzinfo).strftime("%Y-%m-%d %I:%M:%S %p %Z")
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
                if not isinstance(value, dict)
                else value
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
) -> None:
    now_ist = datetime.now(settings.timezone)
    engine = PaperTradingEngine(settings, state)
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
                details=resumed_trade.details,
            )
            logger.info(resumed_trade.message)
            return

        closed_candle = None
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
            details=cycle_result.details,
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
    state = StateStore(settings.state_file)
    run_logs = RunLogStore(
        settings.run_logs_dir,
        settings.mongodb_uri,
        settings.mongodb_database,
        settings.mongodb_logs_collection,
    )
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


def archive_due_run_logs(settings, run_logs: RunLogStore, now_ist: datetime) -> None:
    end_time = parse_hhmm(settings.schedule_end)
    end_of_session = now_ist.replace(
        hour=end_time.hour,
        minute=end_time.minute,
        second=settings.schedule_buffer_seconds,
        microsecond=0,
    )
    today = now_ist.date().isoformat()

    for date_value in run_logs.local_dates():
        if date_value < today or (date_value == today and now_ist >= end_of_session):
            archived_count = run_logs.archive_date(date_value)
            if archived_count:
                logger.info("Archived %s run logs for %s to MongoDB.", archived_count, date_value)


def run_once() -> None:
    settings = get_settings()
    configure_logging(settings.log_file)
    notifier = TelegramNotifier(settings.telegram_bot_token, settings.telegram_chat_id)
    state = StateStore(settings.state_file)
    run_logs = RunLogStore(
        settings.run_logs_dir,
        settings.mongodb_uri,
        settings.mongodb_database,
        settings.mongodb_logs_collection,
    )
    archive_due_run_logs(settings, run_logs, datetime.now(settings.timezone))
    process_once(settings, notifier, state, run_logs)


def run_live() -> None:
    settings = get_settings()
    configure_logging(settings.log_file)
    notifier = TelegramNotifier(settings.telegram_bot_token, settings.telegram_chat_id)
    state = StateStore(settings.state_file)
    run_logs = RunLogStore(
        settings.run_logs_dir,
        settings.mongodb_uri,
        settings.mongodb_database,
        settings.mongodb_logs_collection,
    )
    archive_due_run_logs(settings, run_logs, datetime.now(settings.timezone))
    logger.info(
        "Starting NIFTY alert bot for %s on %s candles. Schedule: %s to %s IST every %s minutes at +%s seconds.",
        settings.symbol,
        settings.interval,
        settings.schedule_start,
        settings.schedule_end,
        settings.schedule_interval_minutes,
        settings.schedule_buffer_seconds,
    )

    while True:
        now_ist = datetime.now(settings.timezone)
        next_run = next_run_at(
            now_ist,
            settings.schedule_start,
            settings.schedule_end,
            settings.schedule_interval_minutes,
            settings.schedule_buffer_seconds,
        )
        sleep_seconds = max((next_run - now_ist).total_seconds(), 0.0)
        logger.info(
            "Next scheduled run at %s. Sleeping for %.2f seconds.",
            next_run.strftime("%Y-%m-%d %I:%M:%S %p %Z"),
            sleep_seconds,
        )
        time.sleep(sleep_seconds)

        try:
            process_once(settings, notifier, state, run_logs)
            archive_due_run_logs(settings, run_logs, datetime.now(settings.timezone))
        except Exception:
            logger.exception("Scheduled bot iteration failed")


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
    args = parser.parse_args()

    if args.mode == "sample-alert":
        send_sample_alert(args.signal)
        return

    if args.mode == "once":
        run_once()
        return

    run_live()
