from __future__ import annotations

import os
from dataclasses import dataclass
from zoneinfo import ZoneInfo

from dotenv import load_dotenv


load_dotenv()


@dataclass(frozen=True)
class Settings:
    strategy_mode: str
    option_contract_1: str
    option_contract_2: str
    option_contract_interval: str
    option_contract_signal_mode: str
    option_contract_entry_signal: str
    option_contract_target_pct: float
    option_contract_max_signal_candle_pct: float
    option_contract_min_signal_candle_pct: float
    option_contract_strike_offset: int
    option_contract_expiry_offset: int
    option_contract_stop_loss_mode: str
    option_contract_stop_loss_pct: float
    option_contract_require_vwap: bool
    option_contract_min_volume_multiplier: float
    option_contract_volume_lookback: int
    option_contract_max_entry_gap_pct: float
    option_contract_trailing_stop_pct: float
    option_contract_max_trades_per_day: int
    symbol: str
    interval: str
    period: str
    legacy_state_file: str
    run_logs_dir: str
    candle_cache_dir: str
    telegram_bot_token: str
    telegram_chat_id: str
    mongodb_uri: str
    mongodb_database: str
    mongodb_collection: str
    mongodb_paper_trades_collection: str
    mongodb_signal_alerts_collection: str
    log_file: str
    timezone_name: str
    schedule_start: str
    schedule_end: str
    schedule_interval_minutes: int
    schedule_buffer_seconds: int
    force_weekend_runs: bool
    paper_trade_capital: float
    paper_trade_lot_size: int
    paper_trade_slippage_pct: float
    paper_trade_target_pct: float
    paper_trade_max_sl_pct: float
    paper_trade_daily_profit_stop_pct: float
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
    dhan_client_id: str
    dhan_access_token: str
    mongodb_option_candles_collection: str
    enable_exact_candle_storage: bool
    nifty_store_strike_offsets: str
    sensex_store_strike_offsets: str
    store_option_types: str
    live_trading_use_broker_exits: bool
    live_trading_sl_order_type: str

    @property
    def timezone(self) -> ZoneInfo:
        return ZoneInfo(self.timezone_name)

    @property
    def option_contracts(self) -> list[str]:
        return [
            contract
            for contract in (self.option_contract_1, self.option_contract_2)
            if contract
        ]

    @property
    def option_contract_interval_minutes(self) -> int:
        return interval_to_minutes(self.option_contract_interval)


def interval_to_minutes(interval: str) -> int:
    normalized = str(interval or "5m").strip().lower()
    if normalized in {"1m", "1min", "minute"}:
        return 1
    if normalized in {"3m", "3min", "3minute"}:
        return 3
    if normalized in {"5m", "5min", "5minute"}:
        return 5
    if normalized in {"10m", "10min", "10minute"}:
        return 10
    if normalized in {"15m", "15min", "15minute"}:
        return 15
    raise ValueError(f"Unsupported candle interval: {interval}")


def kite_interval(interval: str) -> str:
    minutes = interval_to_minutes(interval)
    if minutes == 1:
        return "minute"
    return f"{minutes}minute"


def get_settings() -> Settings:
    telegram_bot_token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    telegram_chat_id = os.getenv("TELEGRAM_CHAT_ID", "").strip()
    mongodb_uri = os.getenv("MONGODB_URI", "").strip()
    strategy_mode = os.getenv("STRATEGY_MODE", "index").strip().lower() or "index"
    option_contract_mode = strategy_mode in {"option_contracts", "both"}

    if not telegram_bot_token or not telegram_chat_id or not mongodb_uri:
        raise ValueError(
            "TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, and MONGODB_URI must be set in the environment."
        )

    return Settings(
        strategy_mode=strategy_mode,
        option_contract_1=os.getenv("OPTION_CONTRACT_1", "").strip().upper(),
        option_contract_2=os.getenv("OPTION_CONTRACT_2", "").strip().upper(),
        option_contract_interval=os.getenv("OPTION_CONTRACT_INTERVAL", "1m").strip().lower()
        or "1m",
        option_contract_signal_mode=os.getenv("OPTION_CONTRACT_SIGNAL_MODE", "both").strip().lower()
        or "both",
        option_contract_entry_signal=os.getenv("OPTION_CONTRACT_ENTRY_SIGNAL", "BUY").strip().upper()
        or "BUY",
        option_contract_target_pct=float(os.getenv("OPTION_CONTRACT_TARGET_PCT", "3")),
        option_contract_max_signal_candle_pct=float(
            os.getenv("OPTION_CONTRACT_MAX_SIGNAL_CANDLE_PCT", "8")
        ),
        option_contract_min_signal_candle_pct=float(
            os.getenv("OPTION_CONTRACT_MIN_SIGNAL_CANDLE_PCT", "0")
        ),
        option_contract_strike_offset=int(os.getenv("OPTION_CONTRACT_STRIKE_OFFSET", "0")),
        option_contract_expiry_offset=int(os.getenv("OPTION_CONTRACT_EXPIRY_OFFSET", "0")),
        option_contract_stop_loss_mode=os.getenv("OPTION_CONTRACT_STOP_LOSS_MODE", "signal_low").strip().lower()
        or "signal_low",
        option_contract_stop_loss_pct=float(os.getenv("OPTION_CONTRACT_STOP_LOSS_PCT", "8")),
        option_contract_require_vwap=os.getenv("OPTION_CONTRACT_REQUIRE_VWAP", "false").strip().lower()
        in {"1", "true", "yes", "on"},
        option_contract_min_volume_multiplier=float(os.getenv("OPTION_CONTRACT_MIN_VOLUME_MULTIPLIER", "0")),
        option_contract_volume_lookback=int(os.getenv("OPTION_CONTRACT_VOLUME_LOOKBACK", "20")),
        option_contract_max_entry_gap_pct=float(os.getenv("OPTION_CONTRACT_MAX_ENTRY_GAP_PCT", "0")),
        option_contract_trailing_stop_pct=float(os.getenv("OPTION_CONTRACT_TRAILING_STOP_PCT", "0")),
        option_contract_max_trades_per_day=int(os.getenv("OPTION_CONTRACT_MAX_TRADES_PER_DAY", "0")),
        symbol=os.getenv("NIFTY_SYMBOL", "^NSEI").strip() or "^NSEI",
        interval=os.getenv("NIFTY_INTERVAL", "5m").strip() or "5m",
        period=os.getenv("NIFTY_PERIOD", "5d").strip() or "5d",
        legacy_state_file=(
            os.getenv("LEGACY_STATE_FILE")
            or os.getenv("STATE_FILE")
            or "bot_state.json"
        ).strip()
        or "bot_state.json",
        run_logs_dir=os.getenv("RUN_LOGS_DIR", "logs/run_logs").strip() or "logs/run_logs",
        candle_cache_dir=os.getenv("CANDLE_CACHE_DIR", "logs/candle_cache").strip()
        or "logs/candle_cache",
        telegram_bot_token=telegram_bot_token,
        telegram_chat_id=telegram_chat_id,
        mongodb_uri=mongodb_uri,
        mongodb_database=os.getenv("MONGODB_DATABASE", "nifty_alert_bot").strip()
        or "nifty_alert_bot",
        mongodb_collection=os.getenv("MONGODB_COLLECTION", "bot_state").strip()
        or "bot_state",
        mongodb_paper_trades_collection=os.getenv("MONGODB_PAPER_TRADES_COLLECTION", "paper_trades").strip()
        or "paper_trades",
        mongodb_signal_alerts_collection=os.getenv("MONGODB_SIGNAL_ALERTS_COLLECTION", "signal_alerts").strip()
        or "signal_alerts",
        log_file=os.getenv("LOG_FILE", "logs/nifty_alert_bot.log").strip()
        or "logs/nifty_alert_bot.log",
        timezone_name=os.getenv("TIMEZONE", "Asia/Kolkata").strip() or "Asia/Kolkata",
        schedule_start=os.getenv("SCHEDULE_START_IST", "09:55").strip() or "09:55",
        schedule_end=os.getenv("SCHEDULE_END_IST", "13:30").strip() or "13:30",
        schedule_interval_minutes=int(
            os.getenv("SCHEDULE_INTERVAL_MINUTES", "1" if option_contract_mode else "5")
        ),
        schedule_buffer_seconds=int(
            os.getenv("SCHEDULE_BUFFER_SECONDS", "2" if option_contract_mode else "10")
        ),
        force_weekend_runs=os.getenv("FORCE_WEEKEND_RUNS", "false").strip().lower()
        in {"1", "true", "yes", "on"},
        paper_trade_capital=float(os.getenv("PAPER_TRADE_CAPITAL", "100000")),
        paper_trade_lot_size=int(os.getenv("PAPER_TRADE_LOT_SIZE", "65")),
        paper_trade_slippage_pct=float(os.getenv("PAPER_TRADE_SLIPPAGE_PCT", "0.75")),
        paper_trade_target_pct=float(os.getenv("PAPER_TRADE_TARGET_PCT", "8")),
        paper_trade_max_sl_pct=float(os.getenv("PAPER_TRADE_MAX_SL_PCT", "8")),
        paper_trade_daily_profit_stop_pct=float(
            os.getenv("PAPER_TRADE_DAILY_PROFIT_STOP_PCT", "15")
        ),
        paper_trade_monitor_seconds=int(os.getenv("PAPER_TRADE_MONITOR_SECONDS", "5")),
        paper_trade_entry_second=int(
            os.getenv("PAPER_TRADE_ENTRY_SECOND", "2" if option_contract_mode else "55")
        ),
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
        dhan_client_id=os.getenv("DHAN_CLIENT_ID", "").strip(),
        dhan_access_token=os.getenv("DHAN_ACCESS_TOKEN", "").strip(),
        mongodb_option_candles_collection=os.getenv("MONGODB_OPTION_CANDLES_COLLECTION", "option_candles").strip()
        or "option_candles",
        enable_exact_candle_storage=os.getenv("ENABLE_EXACT_CANDLE_STORAGE", "false").strip().lower()
        in {"1", "true", "yes", "on"},
        nifty_store_strike_offsets=os.getenv("NIFTY_STORE_STRIKE_OFFSETS", "-100,0,100,200").strip(),
        sensex_store_strike_offsets=os.getenv("SENSEX_STORE_STRIKE_OFFSETS", "-200,0,200").strip(),
        store_option_types=os.getenv("STORE_OPTION_TYPES", "PE,CE").strip(),
        live_trading_use_broker_exits=os.getenv("LIVE_TRADING_USE_BROKER_EXITS", "true").strip().lower()
        in {"1", "true", "yes", "on"},
        live_trading_sl_order_type=os.getenv("LIVE_TRADING_SL_ORDER_TYPE", "SL-M").strip().upper() or "SL-M",
    )
