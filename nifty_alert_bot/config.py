from __future__ import annotations

import os
from dataclasses import dataclass
from zoneinfo import ZoneInfo

from dotenv import load_dotenv


load_dotenv()


@dataclass(frozen=True)
class Settings:
    symbol: str
    interval: str
    period: str
    state_file: str
    run_logs_dir: str
    telegram_bot_token: str
    telegram_chat_id: str
    mongodb_uri: str
    mongodb_database: str
    mongodb_collection: str
    mongodb_logs_collection: str
    mongodb_paper_trades_collection: str
    log_file: str
    timezone_name: str
    schedule_start: str
    schedule_end: str
    schedule_interval_minutes: int
    schedule_buffer_seconds: int
    paper_trade_capital: float
    paper_trade_lot_size: int
    paper_trade_slippage_pct: float
    paper_trade_target_pct: float
    paper_trade_max_sl_pct: float
    paper_trade_monitor_seconds: int
    paper_trade_entry_second: int
    zerodha_api_key: str
    zerodha_api_secret: str
    zerodha_access_token: str
    zerodha_redirect_url: str
    zerodha_option_exchange: str
    zerodha_underlying: str
    zerodha_enable_websocket: bool
    zerodha_quote_timeout_seconds: float

    @property
    def timezone(self) -> ZoneInfo:
        return ZoneInfo(self.timezone_name)


def get_settings() -> Settings:
    telegram_bot_token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    telegram_chat_id = os.getenv("TELEGRAM_CHAT_ID", "").strip()
    mongodb_uri = os.getenv("MONGODB_URI", "").strip()

    if not telegram_bot_token or not telegram_chat_id or not mongodb_uri:
        raise ValueError(
            "TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, and MONGODB_URI must be set in the environment."
        )

    return Settings(
        symbol=os.getenv("NIFTY_SYMBOL", "^NSEI").strip() or "^NSEI",
        interval=os.getenv("NIFTY_INTERVAL", "5m").strip() or "5m",
        period=os.getenv("NIFTY_PERIOD", "5d").strip() or "5d",
        state_file=os.getenv("STATE_FILE", "bot_state.json").strip() or "bot_state.json",
        run_logs_dir=os.getenv("RUN_LOGS_DIR", "logs/run_logs").strip() or "logs/run_logs",
        telegram_bot_token=telegram_bot_token,
        telegram_chat_id=telegram_chat_id,
        mongodb_uri=mongodb_uri,
        mongodb_database=os.getenv("MONGODB_DATABASE", "nifty_alert_bot").strip()
        or "nifty_alert_bot",
        mongodb_collection=os.getenv("MONGODB_COLLECTION", "bot_state").strip()
        or "bot_state",
        mongodb_logs_collection=os.getenv("MONGODB_LOGS_COLLECTION", "run_logs_archive").strip()
        or "run_logs_archive",
        mongodb_paper_trades_collection=os.getenv("MONGODB_PAPER_TRADES_COLLECTION", "paper_trades").strip()
        or "paper_trades",
        log_file=os.getenv("LOG_FILE", "logs/nifty_alert_bot.log").strip()
        or "logs/nifty_alert_bot.log",
        timezone_name=os.getenv("TIMEZONE", "Asia/Kolkata").strip() or "Asia/Kolkata",
        schedule_start=os.getenv("SCHEDULE_START_IST", "09:55").strip() or "09:55",
        schedule_end=os.getenv("SCHEDULE_END_IST", "13:30").strip() or "13:30",
        schedule_interval_minutes=int(os.getenv("SCHEDULE_INTERVAL_MINUTES", "5")),
        schedule_buffer_seconds=int(os.getenv("SCHEDULE_BUFFER_SECONDS", "10")),
        paper_trade_capital=float(os.getenv("PAPER_TRADE_CAPITAL", "100000")),
        paper_trade_lot_size=int(os.getenv("PAPER_TRADE_LOT_SIZE", "75")),
        paper_trade_slippage_pct=float(os.getenv("PAPER_TRADE_SLIPPAGE_PCT", "0.75")),
        paper_trade_target_pct=float(os.getenv("PAPER_TRADE_TARGET_PCT", "8")),
        paper_trade_max_sl_pct=float(os.getenv("PAPER_TRADE_MAX_SL_PCT", "8")),
        paper_trade_monitor_seconds=int(os.getenv("PAPER_TRADE_MONITOR_SECONDS", "5")),
        paper_trade_entry_second=int(os.getenv("PAPER_TRADE_ENTRY_SECOND", "55")),
        zerodha_api_key=os.getenv("ZERODHA_API_KEY", "").strip(),
        zerodha_api_secret=os.getenv("ZERODHA_API_SECRET", "").strip(),
        zerodha_access_token=os.getenv("ZERODHA_ACCESS_TOKEN", "").strip(),
        zerodha_redirect_url=os.getenv("ZERODHA_REDIRECT_URL", "http://127.0.0.1:8000/kite/callback").strip()
        or "http://127.0.0.1:8000/kite/callback",
        zerodha_option_exchange=os.getenv("ZERODHA_OPTION_EXCHANGE", "NFO").strip() or "NFO",
        zerodha_underlying=os.getenv("ZERODHA_UNDERLYING", "NIFTY").strip() or "NIFTY",
        zerodha_enable_websocket=os.getenv("ZERODHA_ENABLE_WEBSOCKET", "true").strip().lower()
        in {"1", "true", "yes", "on"},
        zerodha_quote_timeout_seconds=float(os.getenv("ZERODHA_QUOTE_TIMEOUT_SECONDS", "2.0")),
    )
