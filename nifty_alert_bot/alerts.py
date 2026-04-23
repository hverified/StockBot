from __future__ import annotations

from datetime import datetime

import pandas as pd


def format_alert(row: pd.Series, symbol: str, interval: str, now: datetime) -> str:
    candle_time = row.name.tz_convert(now.tzinfo).strftime("%Y-%m-%d %I:%M:%S %p %Z")
    sent_time = now.strftime("%Y-%m-%d %I:%M:%S %p %Z")
    signal = str(row["signal"]).upper()
    emoji = "🟢" if signal == "BUY" else "🔴"
    return (
        f"{emoji} NIFTY {signal} Alert\n"
        f"📈 Symbol: {symbol}\n"
        f"⏱ Timeframe: {interval}\n"
        f"💰 Close: {row['Close']:.2f}\n"
        f"🧭 Supertrend (10,1): {row['st_10_1']:.2f}\n"
        f"🧭 Supertrend (10,3): {row['st_10_3']:.2f}\n"
        f"🕯 Candle Time: {candle_time}\n"
        f"🕒 Alert Time: {sent_time}"
    )


def build_alert_key(row: pd.Series) -> str:
    return f"{row.name.isoformat()}::{row['signal']}"


def build_alert_payload(row: pd.Series, symbol: str, interval: str, now: datetime) -> dict:
    candle_time = row.name.tz_convert(now.tzinfo)
    return {
        "symbol": symbol,
        "interval": interval,
        "signal": str(row["signal"]).upper(),
        "close": round(float(row["Close"]), 2),
        "st_10_1": round(float(row["st_10_1"]), 2),
        "st_10_3": round(float(row["st_10_3"]), 2),
        "candleTime": candle_time.isoformat(),
        "alertTime": now.isoformat(),
    }
