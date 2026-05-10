from __future__ import annotations

import numpy as np
import pandas as pd


def true_range(frame: pd.DataFrame) -> pd.Series:
    high_low = frame["High"] - frame["Low"]
    high_close = (frame["High"] - frame["Close"].shift(1)).abs()
    low_close = (frame["Low"] - frame["Close"].shift(1)).abs()
    return pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)


def rma(series: pd.Series, period: int) -> pd.Series:
    # TradingView's ta.rma seeds Wilder smoothing with SMA over the first
    # `period` values, then applies alpha = 1 / period. Starting the EMA from
    # the first candle shifts ATR and Supertrend flips noticeably.
    values = pd.to_numeric(series, errors="coerce")
    result = pd.Series(np.nan, index=values.index, dtype="float64")
    valid = values.dropna()
    if len(valid) < period:
        return result

    first_average = float(valid.iloc[:period].mean())
    first_index = valid.index[period - 1]
    result.loc[first_index] = first_average

    previous = first_average
    alpha = 1 / period
    for index, value in valid.iloc[period:].items():
        previous = (alpha * float(value)) + ((1 - alpha) * previous)
        result.loc[index] = previous

    return result


def atr(frame: pd.DataFrame, period: int) -> pd.Series:
    return rma(true_range(frame), period)


def supertrend(frame: pd.DataFrame, period: int, multiplier: float) -> pd.DataFrame:
    price = frame.copy()
    price.loc[:, "atr"] = atr(price, period)
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


def build_signal_frame(frame: pd.DataFrame, signal_mode: str = "both") -> pd.DataFrame:
    result = frame.copy()

    st_fast = supertrend(result, period=10, multiplier=1)
    st_slow = supertrend(result, period=10, multiplier=3)

    result["st_10_1"] = st_fast["supertrend"]
    result["st_10_1_trend"] = st_fast["trend"]
    result["st_10_3"] = st_slow["supertrend"]
    result["st_10_3_trend"] = st_slow["trend"]

    fast_buy_mask = result["st_10_1_trend"] == 1
    fast_sell_mask = result["st_10_1_trend"] == -1
    both_buy_mask = fast_buy_mask & (result["st_10_3_trend"] == 1)
    both_sell_mask = fast_sell_mask & (result["st_10_3_trend"] == -1)

    fast_cross_to_buy = fast_buy_mask & ~fast_buy_mask.shift(1, fill_value=False)
    fast_cross_to_sell = fast_sell_mask & ~fast_sell_mask.shift(1, fill_value=False)
    both_cross_to_buy = both_buy_mask & ~both_buy_mask.shift(1, fill_value=False)
    both_cross_to_sell = both_sell_mask & ~both_sell_mask.shift(1, fill_value=False)

    result.loc[:, "signal_st_10_1"] = None
    result.loc[fast_cross_to_buy, "signal_st_10_1"] = "BUY"
    result.loc[fast_cross_to_sell, "signal_st_10_1"] = "SELL"

    result.loc[:, "signal_both"] = None
    result.loc[both_cross_to_buy, "signal_both"] = "BUY"
    result.loc[both_cross_to_sell, "signal_both"] = "SELL"

    normalized_mode = str(signal_mode or "both").lower()
    result.loc[:, "signal"] = (
        result["signal_st_10_1"]
        if normalized_mode == "st_10_1"
        else result["signal_both"]
    )
    return result
