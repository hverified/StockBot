from __future__ import annotations

import warnings

import pandas as pd
import yfinance as yf


REQUIRED_COLUMNS = ["Open", "High", "Low", "Close"]

warnings.filterwarnings(
    "ignore",
    message=".*ChainedAssignmentError: behaviour will change in pandas 3.0!.*",
    category=FutureWarning,
)


def fetch_candles(symbol: str, interval: str, period: str) -> pd.DataFrame:
    try:
        frame = yf.download(
            tickers=symbol,
            interval=interval,
            period=period,
            progress=False,
            auto_adjust=False,
            threads=False,
        )
    except Exception as exc:
        raise RuntimeError(f"Failed to fetch candle data for {symbol}: {exc}") from exc

    if frame.empty:
        raise ValueError(f"No candle data returned for {symbol}.")

    if isinstance(frame.columns, pd.MultiIndex):
        frame.columns = frame.columns.get_level_values(0)

    missing = [column for column in REQUIRED_COLUMNS if column not in frame.columns]
    if missing:
        raise ValueError(f"Missing required columns: {missing}")

    frame = frame[REQUIRED_COLUMNS].copy()
    frame = frame.dropna()
    frame.index = pd.to_datetime(frame.index)
    return frame


def fetch_latest_price(symbol: str) -> float:
    frame = fetch_candles(symbol, interval="1m", period="1d")
    if frame.empty:
        raise ValueError(f"No latest price returned for {symbol}.")
    return float(frame["Close"].iloc[-1])
