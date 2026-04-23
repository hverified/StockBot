from __future__ import annotations

import numpy as np
import pandas as pd


def true_range(frame: pd.DataFrame) -> pd.Series:
    high_low = frame["High"] - frame["Low"]
    high_close = (frame["High"] - frame["Close"].shift(1)).abs()
    low_close = (frame["Low"] - frame["Close"].shift(1)).abs()
    return pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)


def rma(series: pd.Series, period: int) -> pd.Series:
    # TradingView's ta.atr uses Wilder's smoothing (RMA).
    return series.ewm(alpha=1 / period, adjust=False).mean()


def atr(frame: pd.DataFrame, period: int) -> pd.Series:
    return rma(true_range(frame), period)


def supertrend(frame: pd.DataFrame, period: int, multiplier: float) -> pd.DataFrame:
    price = frame.copy()
    price["atr"] = atr(price, period)
    hl2 = (price["High"] + price["Low"]) / 2.0

    upper_band = hl2 + (multiplier * price["atr"])
    lower_band = hl2 - (multiplier * price["atr"])

    final_upper_band = upper_band.to_numpy(copy=True)
    final_lower_band = lower_band.to_numpy(copy=True)
    close = price["Close"].to_numpy()
    supertrend_line = np.full(len(price), np.nan, dtype="float64")
    direction = np.full(len(price), 1, dtype="int64")

    if len(price) > 0:
        supertrend_line[0] = final_upper_band[0]

    for index in range(1, len(price)):
        prev_index = index - 1

        if close[prev_index] <= final_upper_band[prev_index]:
            final_upper_band[index] = min(upper_band.iloc[index], final_upper_band[prev_index])
        else:
            final_upper_band[index] = upper_band.iloc[index]

        if close[prev_index] >= final_lower_band[prev_index]:
            final_lower_band[index] = max(lower_band.iloc[index], final_lower_band[prev_index])
        else:
            final_lower_band[index] = lower_band.iloc[index]

        if np.isnan(price["atr"].iloc[prev_index]):
            direction[index] = 1
        elif supertrend_line[prev_index] == final_upper_band[prev_index]:
            direction[index] = -1 if close[index] > final_upper_band[index] else 1
        else:
            direction[index] = 1 if close[index] < final_lower_band[index] else -1

        supertrend_line[index] = (
            final_upper_band[index] if direction[index] == 1 else final_lower_band[index]
        )

    result = pd.DataFrame(index=price.index)
    result["trend"] = np.where(direction == 1, -1, 1)
    result["supertrend"] = supertrend_line
    result["final_upper_band"] = final_upper_band
    result["final_lower_band"] = final_lower_band
    return result


def build_signal_frame(frame: pd.DataFrame) -> pd.DataFrame:
    result = frame.copy()

    st_fast = supertrend(result, period=10, multiplier=1)
    st_slow = supertrend(result, period=10, multiplier=3)

    result["st_10_1"] = st_fast["supertrend"]
    result["st_10_1_trend"] = st_fast["trend"]
    result["st_10_3"] = st_slow["supertrend"]
    result["st_10_3_trend"] = st_slow["trend"]

    result["signal"] = None
    buy_mask = (result["st_10_1_trend"] == 1) & (result["st_10_3_trend"] == 1)
    sell_mask = (result["st_10_1_trend"] == -1) & (result["st_10_3_trend"] == -1)

    cross_to_buy = buy_mask & ~buy_mask.shift(1, fill_value=False)
    cross_to_sell = sell_mask & ~sell_mask.shift(1, fill_value=False)

    result.loc[cross_to_buy, "signal"] = "BUY"
    result.loc[cross_to_sell, "signal"] = "SELL"
    return result
