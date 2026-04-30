from __future__ import annotations

from datetime import datetime

import pandas as pd


def format_alert(row: pd.Series, symbol: str, interval: str, now: datetime) -> str:
    candle_time = row.name.tz_convert(now.tzinfo).strftime("%d %b %H:%M:%S")
    sent_time = now.strftime("%d %b %H:%M:%S")
    signal = str(row["signal"]).upper()
    emoji = "🟢" if signal == "BUY" else "🔴"
    return (
        f"{emoji} {signal} signal\n"
        f"{symbol} · {interval}\n\n"
        f"Close: ₹{row['Close']:.2f}\n"
        f"Candle: {candle_time}\n"
        f"Sent: {sent_time}"
    )


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
