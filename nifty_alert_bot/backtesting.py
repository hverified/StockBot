from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, replace
from datetime import date, datetime, time, timedelta
from math import floor
from typing import Any

import pandas as pd

from nifty_alert_bot.config import interval_to_minutes, kite_interval
from nifty_alert_bot.data import fetch_candles_between
from nifty_alert_bot.indicators import build_signal_frame
from nifty_alert_bot.instruments import get_instrument_spec
from nifty_alert_bot.option_price_provider import OptionPriceProvider, synthetic_option_price
from nifty_alert_bot.paper_trading import _apply_entry_slippage, _apply_exit_slippage, _estimate_charges
from nifty_alert_bot.scheduler import parse_hhmm


@dataclass(frozen=True)
class BacktestRequest:
    instrument: str
    signal_mode: str
    start_date: str
    end_date: str
    balance: float
    target_pct: float
    stop_loss_pct: float
    stop_loss_mode: str
    cap_stop_loss: bool
    require_vwap: bool
    entry_timing: str
    entry_time: str
    exit_time: str


@dataclass(frozen=True)
class OptionContractBacktestRequest:
    exchange: str
    option_symbol: str
    option_symbol_2: str
    interval: str
    signal_mode: str
    entry_signal: str
    start_date: str
    end_date: str
    balance: float
    lot_size: int
    target_pct: float
    max_signal_candle_pct: float
    stop_loss_pct: float
    strike_offset: int
    stop_loss_mode: str
    cap_stop_loss: bool
    require_vwap: bool
    entry_timing: str
    entry_time: str
    exit_time: str


@dataclass(frozen=True)
class FiveMinuteOptionBacktestRequest:
    instrument: str
    mode: str
    contract_1: str
    contract_2: str
    contract_side: str
    start_date: str
    end_date: str
    balance: float
    target_pct: float
    max_body_pct: float
    min_body_pct: float
    stop_loss_pct: float
    strike_offset: int
    entry_time: str
    exit_time: str


def _round_to_step(value: float, step: int) -> int:
    return int(round(value / step) * step)


def _compute_itm_strike(spot: float, signal: str, strike_step: int) -> tuple[int, str]:
    nearest_strike = _round_to_step(spot, strike_step)
    if signal == "BUY":
        strike = nearest_strike if nearest_strike < spot else nearest_strike - strike_step
        return strike, "CE"
    strike = nearest_strike if nearest_strike > spot else nearest_strike + strike_step
    return strike, "PE"


def _is_option_side(value: str) -> bool:
    return str(value or "").strip().upper() in {"CE", "PE"}


def _resolve_dynamic_backtest_contract(
    price_provider: OptionPriceProvider,
    instrument,
    option_side: str,
    spot_frame: pd.DataFrame,
    start_date,
    entry_window,
    timezone,
    strike_offset: int,
    option_exchange: str,
    option_underlying: str,
):
    if spot_frame.empty:
        raise ValueError(
            f"Cannot resolve {option_underlying} {option_side}: historical spot candles are unavailable."
        )

    entry_dt = datetime.combine(start_date, entry_window, tzinfo=timezone)
    entry_row = _candle_at_or_after(spot_frame, entry_dt)
    if entry_row is None:
        entry_row = (_as_ist(spot_frame.index[0], timezone), spot_frame.iloc[0])

    _, row = entry_row
    spot = float(row["Close"])
    atm = _round_to_step(spot, instrument.strike_step)
    strike = atm + int(strike_offset or 0)
    return price_provider.resolve_contract(
        strike,
        option_side,
        entry_dt,
        exchange=option_exchange,
        underlying=option_underlying,
    )


def _signal_bucket(value: datetime, interval_minutes: int) -> datetime:
    minute = (value.minute // interval_minutes) * interval_minutes
    return value.replace(minute=minute, second=0, microsecond=0)


def _dynamic_contract_specs(
    price_provider: OptionPriceProvider,
    instrument,
    contract_input: str,
    contract_order: int,
    spot_frame: pd.DataFrame,
    timezone,
    signal_interval_minutes: int,
    strike_offset: int,
    option_exchange: str,
    option_underlying: str,
    max_expiry_gap_days: int | None = None,
) -> list[dict[str, Any]]:
    option_side = str(contract_input or "").strip().upper()
    if spot_frame.empty:
        raise ValueError(
            f"Cannot resolve {option_underlying} {option_side}: historical spot candles are unavailable."
        )

    # Resolve against the historical candle date, not "today". Otherwise an old
    # backtest can silently use the current weekly expiry.
    strike_date_to_times: dict[tuple[int, date], set[str]] = {}
    for index, row in spot_frame.iterrows():
        candle_time = _signal_bucket(_as_ist(index, timezone), signal_interval_minutes)
        spot = float(row["Close"])
        atm = _round_to_step(spot, instrument.strike_step)
        strike = atm + int(strike_offset or 0)
        strike_date_to_times.setdefault((strike, candle_time.date()), set()).add(
            candle_time.isoformat()
        )

    specs_by_symbol: dict[str, dict[str, Any]] = {}
    for (strike, active_date), active_times in strike_date_to_times.items():
        resolve_as_of = datetime.combine(active_date, time.min, tzinfo=timezone)
        contract = price_provider.resolve_contract(
            strike,
            option_side,
            resolve_as_of,
            exchange=option_exchange,
            underlying=option_underlying,
            max_expiry_gap_days=max_expiry_gap_days,
        )
        if contract is None:
            continue
        expiry_date = datetime.fromisoformat(contract.expiry).date() if contract.expiry else None
        if expiry_date is not None:
            active_times = {
                active_time
                for active_time in active_times
                if datetime.fromisoformat(active_time).date() <= expiry_date
            }
        if not active_times:
            continue
        spec = specs_by_symbol.setdefault(
            contract.tradingsymbol,
            {
                "input": contract_input,
                "order": contract_order,
                "contract": contract,
                "option_side": option_side,
                "strike_offset": strike_offset,
                "active_times": set(),
            },
        )
        spec["active_times"].update(active_times)

    return list(specs_by_symbol.values())


def _normalize_quantity(balance: float, option_price: float, lot_size: int) -> int:
    raw_quantity = floor(balance / option_price)
    return (raw_quantity // lot_size) * lot_size


def _as_ist(value: pd.Timestamp, timezone) -> datetime:
    timestamp = pd.Timestamp(value)
    if timestamp.tzinfo is None:
        timestamp = timestamp.tz_localize(timezone)
    else:
        timestamp = timestamp.tz_convert(timezone)
    return timestamp.to_pydatetime()


def _session_datetime(day: datetime, value: time) -> datetime:
    return day.replace(hour=value.hour, minute=value.minute, second=0, microsecond=0)


def _signal_execution_time(candle_time: datetime, interval_minutes: int, entry_timing: str) -> datetime:
    candle_close = candle_time + timedelta(minutes=interval_minutes)
    if entry_timing == "signal_close":
        return candle_close.replace(second=0, microsecond=0)
    return (candle_close + timedelta(minutes=1)).replace(second=0, microsecond=0)


def _option_price_from_underlying(price: float, strike: int, option_type: str) -> float:
    return synthetic_option_price(float(price), strike, option_type)


def _option_price_for_exit(row: pd.Series, strike: int, option_type: str, signal: str) -> float:
    return _option_price_from_underlying(float(row["Close"]), strike, option_type)


def _option_candle_range(row: pd.Series, strike: int, option_type: str) -> tuple[float, float, float]:
    close_price = _option_price_from_underlying(float(row["Close"]), strike, option_type)
    if option_type == "CE":
        low_price = _option_price_from_underlying(float(row["Low"]), strike, option_type)
        high_price = _option_price_from_underlying(float(row["High"]), strike, option_type)
    else:
        low_price = _option_price_from_underlying(float(row["High"]), strike, option_type)
        high_price = _option_price_from_underlying(float(row["Low"]), strike, option_type)
    return low_price, high_price, close_price


def _option_signal_candle_low(minute_rows: pd.DataFrame, fallback_row: pd.Series, strike: int, option_type: str) -> float:
    if minute_rows.empty:
        if option_type == "CE":
            return _option_price_from_underlying(float(fallback_row["Low"]), strike, option_type)
        return _option_price_from_underlying(float(fallback_row["High"]), strike, option_type)

    lows = [
        _option_candle_range(row, strike, option_type)[0]
        for _, row in minute_rows.iterrows()
    ]
    return min(lows)


def _option_candles_to_frame(candles: list[dict[str, Any]], timezone) -> pd.DataFrame:
    if not candles:
        return pd.DataFrame()

    frame = pd.DataFrame(candles)
    if frame.empty or "date" not in frame.columns:
        return pd.DataFrame()

    frame = frame.rename(
        columns={
            "open": "Open",
            "high": "High",
            "low": "Low",
            "close": "Close",
            "volume": "Volume",
        }
    )
    frame.index = pd.to_datetime(frame["date"])
    if frame.index.tz is None:
        frame.index = frame.index.tz_localize(timezone)
    else:
        frame.index = frame.index.tz_convert(timezone)
    columns = ["Open", "High", "Low", "Close"]
    if "Volume" in frame.columns:
        columns.append("Volume")
    return frame[columns].dropna()


def _add_intraday_vwap(frame: pd.DataFrame) -> pd.DataFrame:
    if frame.empty or "Volume" not in frame.columns:
        return frame.assign(VWAP=pd.NA)

    output = frame.copy()
    typical_price = (output["High"] + output["Low"] + output["Close"]) / 3.0
    volume = output["Volume"].fillna(0)
    session = output.index.date
    cumulative_pv = (typical_price * volume).groupby(session).cumsum()
    cumulative_volume = volume.groupby(session).cumsum()
    output["VWAP"] = cumulative_pv / cumulative_volume.replace(0, pd.NA)
    return output


def _candle_at_or_after(frame: pd.DataFrame, value: datetime) -> tuple[datetime, pd.Series] | None:
    rows = frame[frame.index >= pd.Timestamp(value)]
    if rows.empty:
        return None
    return _as_ist(rows.index[0], value.tzinfo), rows.iloc[0]


def _fetch_backtest_candles(
    settings,
    instrument,
    price_provider: OptionPriceProvider,
    start_date,
    end_date,
    interval: str,
) -> tuple[pd.DataFrame, str]:
    from_dt = datetime.combine(start_date, time.min, tzinfo=settings.timezone)
    to_dt = datetime.combine(end_date + timedelta(days=1), time.min, tzinfo=settings.timezone)

    zerodha_frame = _option_candles_to_frame(
        price_provider.historical_index_candles(
            instrument,
            from_dt,
            to_dt,
            interval,
            use_cache=True,
        ),
        settings.timezone,
    )
    if not zerodha_frame.empty:
        return zerodha_frame, "zerodha_historical"

    yfinance_end = (end_date + timedelta(days=1)).isoformat()
    return (
        fetch_candles_between(
            instrument.yfinance_symbol,
            interval,
            start_date.isoformat(),
            yfinance_end,
        ),
        "yfinance",
    )


def _summarize(trades: list[dict[str, Any]]) -> dict[str, Any]:
    def trade_pnl(trade: dict[str, Any]) -> float:
        return float(trade.get("netPnl", trade.get("net_pnl", 0.0)) or 0.0)

    wins = [trade for trade in trades if trade["status"] == "WIN"]
    losses = [trade for trade in trades if trade["status"] == "LOSS"]
    net_pnl = round(sum(trade_pnl(trade) for trade in trades), 2)
    gross_profit = sum(max(0.0, trade_pnl(trade)) for trade in wins)
    gross_loss = abs(sum(min(0.0, trade_pnl(trade)) for trade in losses))
    return {
        "tradeCount": len(trades),
        "wins": len(wins),
        "losses": len(losses),
        "winRate": round((len(wins) / len(trades) * 100.0) if trades else 0.0, 2),
        "netPnl": net_pnl,
        "profitFactor": round(gross_profit / gross_loss, 2) if gross_loss else None,
        "bestTrade": round(max((trade_pnl(trade) for trade in trades), default=0.0), 2),
        "worstTrade": round(min((trade_pnl(trade) for trade in trades), default=0.0), 2),
        "expectancy": round(net_pnl / len(trades), 2) if trades else 0.0,
    }


def _summarize_by_option_type(trades: list[dict[str, Any]]) -> list[dict[str, Any]]:
    summaries = {
        "CE": {"optionType": "CE", "trades": 0, "wins": 0, "losses": 0, "netPnl": 0.0},
        "PE": {"optionType": "PE", "trades": 0, "wins": 0, "losses": 0, "netPnl": 0.0},
    }
    for trade in trades:
        option_type = str(trade.get("optionType") or trade.get("option_type") or "").upper()
        if option_type not in summaries:
            continue
        summary = summaries[option_type]
        summary["trades"] += 1
        if str(trade.get("status") or "").upper() == "WIN":
            summary["wins"] += 1
        if str(trade.get("status") or "").upper() == "LOSS":
            summary["losses"] += 1
        summary["netPnl"] += float(trade.get("netPnl") or trade.get("net_pnl") or 0.0)

    return [
        {
            **summary,
            "netPnl": round(float(summary["netPnl"]), 2),
            "winRate": round((summary["wins"] / summary["trades"] * 100.0) if summary["trades"] else 0.0, 2),
        }
        for summary in summaries.values()
    ]


def _resolve_long_stop_loss(
    entry_price: float,
    candle_low_stop: float,
    stop_loss_pct: float,
    stop_loss_mode: str,
    cap_stop_loss: bool,
) -> tuple[float, str] | None:
    if stop_loss_mode == "percent":
        return round(entry_price * (1 - stop_loss_pct / 100.0), 2), f"fixed_{stop_loss_pct:g}pct"

    candle_stop_pct = (entry_price - candle_low_stop) / entry_price * 100.0
    if candle_stop_pct <= 0:
        if not cap_stop_loss:
            return None
        return (
            round(entry_price * (1 - stop_loss_pct / 100.0), 2),
            f"fallback_{stop_loss_pct:g}pct_invalid_signal_low",
        )
    if cap_stop_loss and candle_stop_pct > stop_loss_pct:
        return round(entry_price * (1 - stop_loss_pct / 100.0), 2), f"capped_{stop_loss_pct:g}pct"
    return round(candle_low_stop, 2), "signal_option_candle_low"


def run_option_contract_backtest(settings, request: OptionContractBacktestRequest) -> dict[str, Any]:
    start_date = datetime.fromisoformat(request.start_date).date()
    end_date = datetime.fromisoformat(request.end_date).date()
    if end_date < start_date:
        raise ValueError("Exit day must be on or after entry day.")

    entry_window = parse_hhmm(request.entry_time)
    exit_window = parse_hhmm(request.exit_time)
    if exit_window <= entry_window:
        raise ValueError("Exit time must be after entry time.")

    from_dt = datetime.combine(start_date, time.min, tzinfo=settings.timezone)
    to_dt = datetime.combine(end_date + timedelta(days=1), time.min, tzinfo=settings.timezone)
    price_provider = OptionPriceProvider(settings)

    try:
        option_exchange = str(request.exchange or settings.zerodha_option_exchange).strip().upper()
        if option_exchange == "BFO":
            instrument = get_instrument_spec("SENSEX")
            option_underlying = instrument.zerodha_underlying
        else:
            instrument = get_instrument_spec("NIFTY")
            option_underlying = instrument.zerodha_underlying

        signal_interval = str(request.interval or "1m").lower()
        signal_interval_minutes = interval_to_minutes(signal_interval)
        signal_kite_interval = kite_interval(signal_interval)
        signal_mode = str(request.signal_mode or "both").lower()

        contract_inputs = [
            symbol.strip().upper()
            for symbol in (request.option_symbol, request.option_symbol_2)
            if symbol and symbol.strip()
        ]
        if not contract_inputs:
            raise ValueError("At least one option contract is required.")

        spot_frame = pd.DataFrame()
        if any(_is_option_side(contract_input) for contract_input in contract_inputs):
            spot_frame, _spot_source = _fetch_backtest_candles(
                settings,
                instrument,
                price_provider,
                start_date,
                end_date,
                "1m",
            )

        contract_contexts: list[dict[str, Any]] = []
        signal_events: list[dict[str, Any]] = []
        skipped: list[dict[str, Any]] = []
        contract_specs: list[dict[str, Any]] = []
        for contract_order, contract_input in enumerate(contract_inputs):
            if _is_option_side(contract_input):
                contract_specs.extend(
                    _dynamic_contract_specs(
                        price_provider,
                        instrument,
                        contract_input,
                        contract_order,
                        spot_frame,
                        settings.timezone,
                        signal_interval_minutes,
                        int(request.strike_offset or 0),
                        option_exchange,
                        option_underlying,
                    )
                )
                continue

            contract = price_provider.find_contract_by_symbol(contract_input, option_exchange)
            if contract is None:
                contract = price_provider.resolve_contract_input(
                    contract_input,
                    datetime.now(settings.timezone).replace(second=0, microsecond=0),
                    option_exchange,
                    option_underlying,
                )
            if contract is None:
                raise ValueError(
                    f"Option contract not found: {contract_input}. "
                    f"Check exchange {option_exchange}, underlying {option_underlying}, symbol, and token validity."
                )
            contract_specs.append(
                {
                    "input": contract_input,
                    "order": contract_order,
                    "contract": contract,
                    "option_side": contract.option_type,
                    "strike_offset": None,
                    "active_times": None,
                }
            )

        if not contract_specs:
            raise ValueError(
                "No live nearest-expiry option contracts could be resolved for the selected PE/CE sides. "
                "If the matching contract is already expired, Option Backtest will not execute trades for it."
            )

        for spec in contract_specs:
            contract_input = spec["input"]
            contract = spec["contract"]

            option_candles = _option_candles_to_frame(
                price_provider.historical_option_candles(
                    contract,
                    from_dt,
                    to_dt,
                    interval=signal_kite_interval,
                    use_cache=True,
                ),
                settings.timezone,
            )
            if option_candles.empty:
                skipped.append(
                    {
                        "optionSymbol": contract.tradingsymbol,
                        "reason": "no_option_candles",
                        "message": f"No Zerodha {signal_interval} option candles returned for {contract.tradingsymbol}.",
                    }
                )
                continue
            option_candles = _add_intraday_vwap(option_candles)

            minute_candles = _option_candles_to_frame(
                price_provider.historical_option_candles(
                    contract,
                    from_dt,
                    to_dt,
                    interval="minute",
                    use_cache=True,
                ),
                settings.timezone,
            )
            minute_candles = _add_intraday_vwap(minute_candles)
            signal_frame = build_signal_frame(option_candles, signal_mode=signal_mode)
            context = {
                "input": contract_input,
                "order": spec["order"],
                "contract": contract,
                "option_side": spec.get("option_side"),
                "strike_offset": spec.get("strike_offset"),
                "active_times": spec.get("active_times"),
                "option_candles": option_candles,
                "minute_candles": minute_candles,
                "signal_frame": signal_frame,
            }
            contract_contexts.append(context)

            for index in range(1, len(signal_frame)):
                row = signal_frame.iloc[index]
                signal = row.get("signal")
                if pd.isna(signal):
                    continue
                signal = str(signal).upper()
                if str(request.entry_signal or "BUY").upper() != "BOTH" and signal != str(request.entry_signal or "BUY").upper():
                    continue

                candle_time = _as_ist(signal_frame.index[index], settings.timezone)
                active_times = context.get("active_times")
                if active_times is not None and candle_time.isoformat() not in active_times:
                    continue
                execute_at = _signal_execution_time(
                    candle_time,
                    signal_interval_minutes,
                    str(request.entry_timing or "next_minute").lower(),
                )
                signal_events.append(
                    {
                        "execute_at": execute_at,
                        "candle_time": candle_time,
                        "signal": signal,
                        "row": row,
                        "context": context,
                    }
                )

        trades: list[dict[str, Any]] = []
        last_exit_at: datetime | None = None
        selected_signal_count = sum(int(context["signal_frame"]["signal"].notna().sum()) for context in contract_contexts)
        fast_signal_count = sum(int(context["signal_frame"]["signal_st_10_1"].notna().sum()) for context in contract_contexts)
        both_signal_count = sum(int(context["signal_frame"]["signal_both"].notna().sum()) for context in contract_contexts)

        for event in sorted(signal_events, key=lambda item: (item["execute_at"], item["context"]["order"])):
            execute_at = event["execute_at"]
            candle_time = event["candle_time"]
            signal = event["signal"]
            row = event["row"]
            context = event["context"]
            contract = context["contract"]
            option_candles = context["option_candles"]
            minute_candles = context["minute_candles"]
            session_start = _session_datetime(execute_at, entry_window)
            session_end = _session_datetime(execute_at, exit_window)
            if execute_at < session_start or execute_at > session_end:
                skipped.append({"candleTime": candle_time.isoformat(), "signal": signal, "optionSymbol": contract.tradingsymbol, "reason": "outside_trade_window"})
                continue
            if last_exit_at and execute_at <= last_exit_at:
                skipped.append({"candleTime": candle_time.isoformat(), "signal": signal, "optionSymbol": contract.tradingsymbol, "reason": "active_trade_overlap"})
                continue

            entry_candidate = _candle_at_or_after(minute_candles, execute_at) if not minute_candles.empty else None
            if entry_candidate is not None:
                entry_at, entry_row = entry_candidate
                base_entry_price = round(float(entry_row["Open"]), 2)
            else:
                entry_at = execute_at
                base_entry_price = round(float(row["Close"]), 2)
            entry_price = _apply_entry_slippage(base_entry_price, settings.paper_trade_slippage_pct)
            quantity = _normalize_quantity(request.balance, entry_price, request.lot_size)
            if quantity < request.lot_size:
                skipped.append({"candleTime": candle_time.isoformat(), "signal": signal, "optionSymbol": contract.tradingsymbol, "reason": "less_than_one_lot"})
                continue

            signal_vwap = row.get("VWAP")
            signal_vwap_value = None if pd.isna(signal_vwap) else round(float(signal_vwap), 2)
            if request.require_vwap and signal == "BUY":
                if signal_vwap_value is None:
                    skipped.append(
                        {
                            "candleTime": candle_time.isoformat(),
                            "signal": signal,
                            "optionSymbol": contract.tradingsymbol,
                            "reason": "vwap_unavailable",
                        }
                    )
                    continue
                if float(row["Close"]) >= signal_vwap_value:
                    skipped.append(
                        {
                            "candleTime": candle_time.isoformat(),
                            "signal": signal,
                            "optionSymbol": contract.tradingsymbol,
                            "reason": "close_above_or_equal_vwap",
                            "close": round(float(row["Close"]), 2),
                            "vwap": signal_vwap_value,
                        }
                    )
                    continue

            signal_candle_open = round(float(row["Open"]), 2)
            signal_candle_close = round(float(row["Close"]), 2)
            signal_candle_body_pct = (
                round((abs(signal_candle_close - signal_candle_open) / signal_candle_open) * 100.0, 2)
                if signal_candle_open > 0
                else None
            )
            if (
                signal_candle_body_pct is not None
                and signal_candle_body_pct > request.max_signal_candle_pct
            ):
                skipped.append(
                    {
                        "candleTime": candle_time.isoformat(),
                        "signal": signal,
                        "optionSymbol": contract.tradingsymbol,
                        "reason": "signal_candle_body_above_limit",
                        "signalCandleOpen": signal_candle_open,
                        "signalCandleClose": signal_candle_close,
                        "signalCandleBodyPct": signal_candle_body_pct,
                        "maxSignalCandlePct": request.max_signal_candle_pct,
                    }
                )
                continue

            signal_candle_end = candle_time + timedelta(minutes=signal_interval_minutes)
            signal_rows = option_candles[
                (option_candles.index >= pd.Timestamp(candle_time))
                & (option_candles.index < pd.Timestamp(signal_candle_end))
            ]
            candle_low_stop = round(float(signal_rows["Low"].min()), 2) if not signal_rows.empty else entry_price
            stop_loss = _resolve_long_stop_loss(
                entry_price,
                candle_low_stop,
                request.stop_loss_pct,
                str(request.stop_loss_mode or "signal_low").lower(),
                request.cap_stop_loss,
            )
            if stop_loss is None:
                skipped.append({"candleTime": candle_time.isoformat(), "signal": signal, "optionSymbol": contract.tradingsymbol, "reason": "invalid_stop_loss_above_entry"})
                continue
            stop_loss_price, stop_loss_source = stop_loss
            target_price = round(entry_price * (1 + request.target_pct / 100.0), 2)
            if stop_loss_price >= entry_price or target_price <= entry_price:
                skipped.append({"candleTime": candle_time.isoformat(), "signal": signal, "optionSymbol": contract.tradingsymbol, "reason": "invalid_risk_levels"})
                continue

            signal_frame = context["signal_frame"]
            entry_trend = int(row.get("st_10_1_trend") or 1)
            trend_flip_exit: dict[str, Any] | None = None
            future_signal_rows = signal_frame[signal_frame.index > pd.Timestamp(candle_time)]
            for trend_index, trend_row in future_signal_rows.iterrows():
                if int(trend_row.get("st_10_1_trend") or entry_trend) == entry_trend:
                    continue

                trend_candle_time = _as_ist(trend_index, settings.timezone)
                trend_flip_exit = {
                    "candleTime": trend_candle_time,
                    "exitTime": trend_candle_time + timedelta(minutes=signal_interval_minutes),
                    "price": round(float(trend_row["Close"]), 2),
                }
                break

            future_rows = minute_candles[
                (minute_candles.index >= pd.Timestamp(entry_at))
                & (minute_candles.index <= pd.Timestamp(session_end))
            ] if not minute_candles.empty else option_candles[
                (option_candles.index >= pd.Timestamp(entry_at))
                & (option_candles.index <= pd.Timestamp(session_end))
            ]
            using_minute_rows = not minute_candles.empty
            exit_price = None
            base_exit_price = None
            exit_at = None
            exit_reason = "SESSION_CLOSE"
            for future_index, future_row in future_rows.iterrows():
                future_time = _as_ist(future_index, settings.timezone)
                if (
                    using_minute_rows
                    and trend_flip_exit is not None
                    and future_time >= trend_flip_exit["exitTime"]
                ):
                    base_exit_price = trend_flip_exit["price"]
                    exit_price = trend_flip_exit["price"]
                    exit_at = trend_flip_exit["exitTime"]
                    exit_reason = "SUPER_TREND_FLIP"
                    break

                if float(future_row["Low"]) <= stop_loss_price:
                    base_exit_price = stop_loss_price
                    exit_price = stop_loss_price
                    exit_at = future_time
                    exit_reason = "STOP_LOSS"
                    break
                if float(future_row["High"]) >= target_price:
                    base_exit_price = target_price
                    exit_price = target_price
                    exit_at = future_time
                    exit_reason = "TARGET"
                    break
                if (
                    not using_minute_rows
                    and trend_flip_exit is not None
                    and future_time + timedelta(minutes=signal_interval_minutes) >= trend_flip_exit["exitTime"]
                ):
                    base_exit_price = trend_flip_exit["price"]
                    exit_price = trend_flip_exit["price"]
                    exit_at = trend_flip_exit["exitTime"]
                    exit_reason = "SUPER_TREND_FLIP"
                    break

            if exit_price is None:
                if future_rows.empty:
                    skipped.append({"candleTime": candle_time.isoformat(), "signal": signal, "optionSymbol": contract.tradingsymbol, "reason": "no_exit_candles_available"})
                    continue
                exit_row = future_rows.iloc[-1]
                exit_at = _as_ist(future_rows.index[-1], settings.timezone)
                base_exit_price = round(float(exit_row["Close"]), 2)
                exit_price = _apply_exit_slippage(base_exit_price, settings.paper_trade_slippage_pct)

            gross_pnl = round((exit_price - entry_price) * quantity, 2)
            charges = _estimate_charges(entry_price, exit_price, quantity)
            net_pnl = round(gross_pnl - charges, 2)
            status = "WIN" if net_pnl >= 0 else "LOSS"
            last_exit_at = exit_at
            trades.append(
                {
                    "signal": signal,
                    "instrument": "OPTION",
                    "signalMode": signal_mode,
                    "candleTime": candle_time.isoformat(),
                    "entrySignalTrend": entry_trend,
                    "entryTime": entry_at.isoformat(),
                    "entryTiming": str(request.entry_timing or "next_minute").lower(),
                    "exitTime": exit_at.isoformat() if exit_at else None,
                    "trendFlipCandleTime": trend_flip_exit["candleTime"].isoformat()
                    if exit_reason == "SUPER_TREND_FLIP" and trend_flip_exit is not None
                    else None,
                    "strike": contract.strike,
                    "optionType": contract.option_type,
                    "optionSymbol": contract.tradingsymbol,
                    "vwap": signal_vwap_value,
                    "vwapFilterEnabled": request.require_vwap,
                    "signalCandleOpen": signal_candle_open,
                    "signalCandleClose": signal_candle_close,
                    "signalCandleBodyPct": signal_candle_body_pct,
                    "entryPrice": entry_price,
                    "baseEntryPrice": base_entry_price,
                    "exitPrice": exit_price,
                    "baseExitPrice": base_exit_price,
                    "quantity": quantity,
                    "capitalUsed": round(entry_price * quantity, 2),
                    "stopLoss": stop_loss_price,
                    "stopLossMode": str(request.stop_loss_mode or "signal_low").lower(),
                    "stopLossSource": stop_loss_source,
                    "target": target_price,
                    "grossPnl": gross_pnl,
                    "charges": charges,
                    "netPnl": net_pnl,
                    "status": status,
                    "exitReason": exit_reason,
                    "executionSource": "zerodha_option_candles",
                }
            )

        contract_stats = []
        for context in contract_contexts:
            symbol = context["contract"].tradingsymbol
            signal_frame = context["signal_frame"]
            contract_trades = [trade for trade in trades if trade.get("optionSymbol") == symbol]
            contract_skipped = [item for item in skipped if item.get("optionSymbol") == symbol]
            contract_stats.append(
                {
                    "input": context["input"],
                    "optionSymbol": symbol,
                    "optionSide": context.get("option_side"),
                    "strikeOffset": context.get("strike_offset"),
                    "selectedSignals": int(signal_frame["signal"].notna().sum()),
                    "fastSignals": int(signal_frame["signal_st_10_1"].notna().sum()),
                    "bothSignals": int(signal_frame["signal_both"].notna().sum()),
                    "trades": len(contract_trades),
                    "skipped": len(contract_skipped),
                    "netPnl": round(sum(float(trade.get("netPnl", 0.0) or 0.0) for trade in contract_trades), 2),
                }
            )
        option_type_stats = _summarize_by_option_type(trades)

        return {
                "request": request.__dict__,
                "summary": _summarize(trades),
                "trades": trades,
                "skipped": skipped[:100],
                "data": {
                "symbol": " / ".join(context["contract"].tradingsymbol for context in contract_contexts),
                "instrument": "OPTION",
                "instrumentLabel": " / ".join(context["contract"].tradingsymbol for context in contract_contexts),
                "underlying": option_underlying,
                "exchange": option_exchange,
                "contracts": [context["contract"].tradingsymbol for context in contract_contexts],
                "contractInputs": contract_inputs,
                "contractStats": contract_stats,
                "optionTypeStats": option_type_stats,
                "lotSize": request.lot_size,
                "strikeStep": instrument.strike_step,
                "strikeOffset": request.strike_offset,
                "maxSignalCandlePct": request.max_signal_candle_pct,
                "interval": signal_interval,
                "signalInterval": signal_interval,
                "signalCandleCount": sum(len(context["signal_frame"]) for context in contract_contexts),
                "signalMode": signal_mode,
                "selectedSignalCount": selected_signal_count,
                "fastSignalCount": fast_signal_count,
                "bothSignalCount": both_signal_count,
                "executionCandleCount": sum(len(context["minute_candles"]) for context in contract_contexts),
                "candleCount": sum(len(context["signal_frame"]) for context in contract_contexts),
                "pricingModel": "zerodha_option_candles",
                "signalDataSource": f"zerodha_option_{signal_interval}",
                "executionDataSource": "zerodha_option_1minute",
            },
        }
    finally:
        price_provider.close()


def run_five_minute_option_backtest(settings, request: FiveMinuteOptionBacktestRequest) -> dict[str, Any]:
    start_date = datetime.fromisoformat(request.start_date).date()
    end_date = datetime.fromisoformat(request.end_date).date()
    if end_date < start_date:
        raise ValueError("Exit day must be on or after entry day.")

    entry_window = parse_hhmm(request.entry_time)
    exit_window = parse_hhmm(request.exit_time)
    if exit_window <= entry_window:
        raise ValueError("Exit time must be after entry time.")
    if request.max_body_pct < request.min_body_pct:
        raise ValueError("Max body % must be greater than or equal to Min body %.")

    instrument = get_instrument_spec(request.instrument)
    option_exchange = instrument.zerodha_option_exchange
    option_underlying = instrument.zerodha_underlying
    signal_interval = "5m"
    signal_interval_minutes = 5
    max_historical_expiry_gap_days = 7
    warmup_start_date = start_date - timedelta(days=10)
    from_dt = datetime.combine(warmup_start_date, time.min, tzinfo=settings.timezone)
    to_dt = datetime.combine(end_date + timedelta(days=1), time.min, tzinfo=settings.timezone)
    trade_from_dt = datetime.combine(start_date, time.min, tzinfo=settings.timezone)
    trade_to_dt = datetime.combine(end_date + timedelta(days=1), time.min, tzinfo=settings.timezone)
    price_provider = OptionPriceProvider(settings)

    try:
        mode = str(request.mode or "fixed").strip().lower()
        contract_inputs: list[str]
        if mode == "dynamic":
            side = str(request.contract_side or "PE").strip().upper()
            contract_inputs = ["PE", "CE"] if side == "BOTH" else [side]
            if any(item not in {"PE", "CE"} for item in contract_inputs):
                raise ValueError("Contract side must be PE, CE, or BOTH.")
            spot_frame, _spot_source = _fetch_backtest_candles(
                settings,
                instrument,
                price_provider,
                start_date,
                end_date,
                "5m",
            )
            contract_specs = []
            for order, side_input in enumerate(contract_inputs):
                contract_specs.extend(
                    _dynamic_contract_specs(
                        price_provider,
                        instrument,
                        side_input,
                        order,
                        spot_frame,
                        settings.timezone,
                        signal_interval_minutes,
                        int(request.strike_offset or 0),
                        option_exchange,
                        option_underlying,
                        max_expiry_gap_days=max_historical_expiry_gap_days,
                    )
                )
        else:
            contract_inputs = [
                value.strip().upper()
                for value in (request.contract_1, request.contract_2)
                if value and value.strip()
            ]
            if not contract_inputs:
                raise ValueError("At least one fixed contract is required.")
            contract_specs = []
            for order, contract_input in enumerate(contract_inputs):
                contract = price_provider.resolve_contract_input(
                    contract_input,
                    datetime.combine(start_date, entry_window, tzinfo=settings.timezone),
                    option_exchange,
                    option_underlying,
                    max_expiry_gap_days=max_historical_expiry_gap_days,
                )
                if contract is None:
                    raise ValueError(
                        f"Option contract not found for {instrument.id} {contract_input} near {start_date.isoformat()}. "
                        "The backtest will not fall forward to a later weekly expiry like the current expiry."
                    )
                contract_specs.append(
                    {
                        "input": contract_input,
                        "order": order,
                        "contract": contract,
                        "option_side": contract.option_type,
                        "strike_offset": None,
                        "active_times": None,
                    }
                )

        if not contract_specs:
            raise ValueError("No NIFTY option contracts could be resolved for this backtest.")

        contract_contexts: list[dict[str, Any]] = []
        signal_events: list[dict[str, Any]] = []
        skipped: list[dict[str, Any]] = []
        signal_diagnostics: list[dict[str, Any]] = []
        raw_buy_signal_count = 0
        body_accepted_signal_count = 0
        for spec in contract_specs:
            contract = spec["contract"]
            option_candles = _option_candles_to_frame(
                price_provider.historical_option_candles(
                    contract,
                    from_dt,
                    to_dt,
                    interval="5minute",
                    use_cache=True,
                ),
                settings.timezone,
            )
            if option_candles.empty:
                skipped.append(
                    {
                        "optionSymbol": contract.tradingsymbol,
                        "reason": "no_option_candles",
                    }
                )
                continue

            signal_frame = build_signal_frame(option_candles, signal_mode="both")
            context = {
                "input": spec["input"],
                "order": spec["order"],
                "contract": contract,
                "option_side": spec.get("option_side"),
                "strike_offset": spec.get("strike_offset"),
                "active_times": spec.get("active_times"),
                "option_candles": option_candles,
                "signal_frame": signal_frame,
            }
            contract_contexts.append(context)

            for index in range(1, len(signal_frame)):
                row = signal_frame.iloc[index]
                signal = row.get("signal")
                if pd.isna(signal) or str(signal).upper() != "BUY":
                    continue
                candle_time = _as_ist(signal_frame.index[index], settings.timezone)
                if candle_time < trade_from_dt or candle_time >= trade_to_dt:
                    continue
                active_times = context.get("active_times")
                if active_times is not None and candle_time.isoformat() not in active_times:
                    continue
                raw_buy_signal_count += 1
                signal_open = round(float(row["Open"]), 2)
                signal_close = round(float(row["Close"]), 2)
                body_pct = (
                    round((abs(signal_close - signal_open) / signal_open) * 100.0, 2)
                    if signal_open > 0
                    else None
                )
                signal_diagnostics.append(
                    {
                        "candleTime": candle_time.isoformat(),
                        "optionSymbol": contract.tradingsymbol,
                        "open": signal_open,
                        "close": signal_close,
                        "low": round(float(row["Low"]), 2),
                        "bodyPct": body_pct,
                        "fastTrend": int(row.get("st_10_1_trend") or 0),
                        "slowTrend": int(row.get("st_10_3_trend") or 0),
                    }
                )
                if body_pct is None or body_pct < request.min_body_pct or body_pct > request.max_body_pct:
                    skipped.append(
                        {
                            "candleTime": candle_time.isoformat(),
                            "signal": "BUY",
                            "optionSymbol": contract.tradingsymbol,
                            "reason": "signal_candle_body_outside_range",
                            "signalCandleBodyPct": body_pct,
                        }
                    )
                    continue
                execute_at = candle_time + timedelta(minutes=signal_interval_minutes)
                body_accepted_signal_count += 1
                signal_events.append(
                    {
                        "execute_at": execute_at,
                        "candle_time": candle_time,
                        "row": row,
                        "context": context,
                        "signal_candle_body_pct": body_pct,
                    }
                )

        trades: list[dict[str, Any]] = []
        last_exit_at: datetime | None = None
        for event in sorted(signal_events, key=lambda item: (item["execute_at"], item["context"]["order"])):
            execute_at = event["execute_at"]
            candle_time = event["candle_time"]
            row = event["row"]
            context = event["context"]
            contract = context["contract"]
            option_candles = context["option_candles"]
            signal_frame = context["signal_frame"]
            session_start = _session_datetime(execute_at, entry_window)
            session_end = _session_datetime(execute_at, exit_window)
            if execute_at < session_start or execute_at > session_end:
                skipped.append({"candleTime": candle_time.isoformat(), "optionSymbol": contract.tradingsymbol, "reason": "outside_trade_window"})
                continue
            if last_exit_at and execute_at <= last_exit_at:
                skipped.append({"candleTime": candle_time.isoformat(), "optionSymbol": contract.tradingsymbol, "reason": "active_trade_overlap"})
                continue

            entry_candidate = _candle_at_or_after(option_candles, execute_at)
            if entry_candidate is None:
                skipped.append({"candleTime": candle_time.isoformat(), "optionSymbol": contract.tradingsymbol, "reason": "entry_candle_unavailable"})
                continue
            entry_at, entry_row = entry_candidate
            base_entry_price = round(float(entry_row["Open"]), 2)
            entry_price = _apply_entry_slippage(base_entry_price, settings.paper_trade_slippage_pct)
            quantity = _normalize_quantity(request.balance, entry_price, instrument.lot_size)
            if quantity < instrument.lot_size:
                skipped.append({"candleTime": candle_time.isoformat(), "optionSymbol": contract.tradingsymbol, "reason": "less_than_one_lot"})
                continue

            signal_low_stop = round(float(row["Low"]), 2)
            fixed_stop_price = None
            if request.stop_loss_pct and request.stop_loss_pct > 0:
                fixed_stop_price = round(entry_price * (1 - request.stop_loss_pct / 100.0), 2)
            stop_candidates: list[tuple[float, str]] = []
            if signal_low_stop < entry_price:
                stop_candidates.append((signal_low_stop, "signal_low"))
            if fixed_stop_price is not None and fixed_stop_price < entry_price:
                stop_candidates.append((fixed_stop_price, f"fixed_{request.stop_loss_pct:g}pct"))
            if not stop_candidates:
                skipped.append(
                    {
                        "candleTime": candle_time.isoformat(),
                        "optionSymbol": contract.tradingsymbol,
                        "reason": "invalid_risk_levels",
                        "entryPrice": entry_price,
                        "signalCandleLow": signal_low_stop,
                        "fixedStopLoss": fixed_stop_price,
                    }
                )
                continue
            stop_loss_price, stop_loss_source = max(stop_candidates, key=lambda item: item[0])
            target_price = round(entry_price * (1 + request.target_pct / 100.0), 2)
            if target_price <= entry_price:
                skipped.append(
                    {
                        "candleTime": candle_time.isoformat(),
                        "optionSymbol": contract.tradingsymbol,
                        "reason": "invalid_risk_levels",
                        "entryPrice": entry_price,
                        "target": target_price,
                    }
                )
                continue

            entry_trend = int(row.get("st_10_1_trend") or 1)
            trend_flip_exit: dict[str, Any] | None = None
            future_signal_rows = signal_frame[signal_frame.index > pd.Timestamp(candle_time)]
            for trend_index, trend_row in future_signal_rows.iterrows():
                if int(trend_row.get("st_10_1_trend") or entry_trend) == entry_trend:
                    continue
                flip_candle_time = _as_ist(trend_index, settings.timezone)
                exit_time = flip_candle_time + timedelta(minutes=signal_interval_minutes)
                exit_candidate = _candle_at_or_after(option_candles, exit_time)
                trend_flip_exit = {
                    "candleTime": flip_candle_time,
                    "exitTime": exit_time,
                    "price": round(float(exit_candidate[1]["Open"]), 2) if exit_candidate else round(float(trend_row["Close"]), 2),
                }
                break

            future_rows = option_candles[
                (option_candles.index >= pd.Timestamp(entry_at))
                & (option_candles.index <= pd.Timestamp(session_end))
            ]
            exit_price = None
            base_exit_price = None
            exit_at = None
            exit_reason = "SESSION_CLOSE"
            for future_index, future_row in future_rows.iterrows():
                future_time = _as_ist(future_index, settings.timezone)
                if trend_flip_exit is not None and future_time >= trend_flip_exit["exitTime"]:
                    base_exit_price = trend_flip_exit["price"]
                    exit_price = _apply_exit_slippage(base_exit_price, settings.paper_trade_slippage_pct)
                    exit_at = trend_flip_exit["exitTime"]
                    exit_reason = "SUPER_TREND_FLIP"
                    break
                if float(future_row["Low"]) <= stop_loss_price:
                    base_exit_price = stop_loss_price
                    exit_price = _apply_exit_slippage(base_exit_price, settings.paper_trade_slippage_pct)
                    exit_at = future_time
                    exit_reason = "STOP_LOSS"
                    break
                if float(future_row["High"]) >= target_price:
                    base_exit_price = target_price
                    exit_price = _apply_exit_slippage(base_exit_price, settings.paper_trade_slippage_pct)
                    exit_at = future_time
                    exit_reason = "TARGET"
                    break

            if exit_price is None:
                if future_rows.empty:
                    skipped.append({"candleTime": candle_time.isoformat(), "optionSymbol": contract.tradingsymbol, "reason": "no_exit_candles_available"})
                    continue
                exit_row = future_rows.iloc[-1]
                exit_at = _as_ist(future_rows.index[-1], settings.timezone)
                base_exit_price = round(float(exit_row["Close"]), 2)
                exit_price = _apply_exit_slippage(base_exit_price, settings.paper_trade_slippage_pct)

            gross_pnl = round((exit_price - entry_price) * quantity, 2)
            charges = _estimate_charges(entry_price, exit_price, quantity)
            net_pnl = round(gross_pnl - charges, 2)
            status = "WIN" if net_pnl >= 0 else "LOSS"
            last_exit_at = exit_at
            trades.append(
                {
                    "signal": "BUY",
                    "instrument": f"{instrument.id}_OPTION_5M",
                    "candleTime": candle_time.isoformat(),
                    "entryTime": entry_at.isoformat(),
                    "exitTime": exit_at.isoformat() if exit_at else None,
                    "trendFlipCandleTime": trend_flip_exit["candleTime"].isoformat()
                    if exit_reason == "SUPER_TREND_FLIP" and trend_flip_exit is not None
                    else None,
                    "strike": contract.strike,
                    "optionType": contract.option_type,
                    "optionSymbol": contract.tradingsymbol,
                    "signalCandleOpen": round(float(row["Open"]), 2),
                    "signalCandleClose": round(float(row["Close"]), 2),
                    "signalCandleLow": signal_low_stop,
                    "signalCandleBodyPct": event["signal_candle_body_pct"],
                    "entryPrice": entry_price,
                    "baseEntryPrice": base_entry_price,
                    "exitPrice": exit_price,
                    "baseExitPrice": base_exit_price,
                    "quantity": quantity,
                    "capitalUsed": round(entry_price * quantity, 2),
                    "stopLoss": stop_loss_price,
                    "stopLossSource": stop_loss_source,
                    "target": target_price,
                    "grossPnl": gross_pnl,
                    "charges": charges,
                    "netPnl": net_pnl,
                    "status": status,
                    "exitReason": exit_reason,
                    "executionSource": "zerodha_option_5minute",
                }
            )

        option_type_stats = _summarize_by_option_type(trades)
        skipped_reason_counts = dict(Counter(item.get("reason", "unknown") for item in skipped))
        return {
            "summary": _summarize(trades),
            "trades": trades,
            "skipped": skipped[:100],
            "data": {
                "symbol": " / ".join(context["contract"].tradingsymbol for context in contract_contexts),
                "instrument": f"{instrument.id}_OPTION_5M",
                "instrumentLabel": f"{instrument.label} 5m option backtest",
                "underlying": instrument.id,
                "exchange": option_exchange,
                "contracts": [context["contract"].tradingsymbol for context in contract_contexts],
                "contractInputs": contract_inputs,
                "optionTypeStats": option_type_stats,
                "lotSize": instrument.lot_size,
                "strikeStep": instrument.strike_step,
                "strikeOffset": request.strike_offset,
                "interval": "5m",
                "signalMode": "both",
                "entrySignal": "BUY",
                "maxBodyPct": request.max_body_pct,
                "minBodyPct": request.min_body_pct,
                "rawBuySignalCount": raw_buy_signal_count,
                "bodyAcceptedSignalCount": body_accepted_signal_count,
                "executedTradeCount": len(trades),
                "skippedCount": len(skipped),
                "skippedReasonCounts": skipped_reason_counts,
                "signalDiagnostics": signal_diagnostics[:100],
                "candleCount": sum(len(context["signal_frame"]) for context in contract_contexts),
                "pricingModel": "zerodha_option_5minute",
            },
        }
    finally:
        price_provider.close()


def run_backtest(settings, request: BacktestRequest) -> dict[str, Any]:
    instrument = get_instrument_spec(request.instrument)
    settings = replace(
        settings,
        symbol=instrument.yfinance_symbol,
        paper_trade_lot_size=instrument.lot_size,
        zerodha_underlying=instrument.zerodha_underlying,
        zerodha_option_exchange=instrument.zerodha_option_exchange,
    )

    start_date = datetime.fromisoformat(request.start_date).date()
    end_date = datetime.fromisoformat(request.end_date).date()
    if end_date < start_date:
        raise ValueError("Exit day must be on or after entry day.")

    entry_window = parse_hhmm(request.entry_time)
    exit_window = parse_hhmm(request.exit_time)
    if exit_window <= entry_window:
        raise ValueError("Exit time must be after entry time.")

    price_provider = OptionPriceProvider(settings)
    candles, signal_data_source = _fetch_backtest_candles(
        settings,
        instrument,
        price_provider,
        start_date,
        end_date,
        settings.interval,
    )
    try:
        minute_candles, execution_data_source = _fetch_backtest_candles(
            settings,
            instrument,
            price_provider,
            start_date,
            end_date,
            "1m",
        )
    except Exception:
        minute_candles = pd.DataFrame(columns=["Open", "High", "Low", "Close"])
        execution_data_source = "unavailable"
    signal_mode = str(request.signal_mode or "both").lower()
    signal_frame = build_signal_frame(candles, signal_mode=signal_mode)
    if signal_frame.index.tz is None:
        signal_frame.index = signal_frame.index.tz_localize(settings.timezone)
    else:
        signal_frame.index = signal_frame.index.tz_convert(settings.timezone)
    if not minute_candles.empty:
        if minute_candles.index.tz is None:
            minute_candles.index = minute_candles.index.tz_localize(settings.timezone)
        else:
            minute_candles.index = minute_candles.index.tz_convert(settings.timezone)

    trades: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    last_exit_at: datetime | None = None
    used_real_option_candles = False
    selected_signal_count = int(signal_frame["signal"].notna().sum())
    fast_signal_count = int(signal_frame["signal_st_10_1"].notna().sum())
    both_signal_count = int(signal_frame["signal_both"].notna().sum())

    try:
      for index in range(1, len(signal_frame)):
        row = signal_frame.iloc[index]
        signal = row.get("signal")
        if pd.isna(signal):
            continue

        candle_time = _as_ist(signal_frame.index[index], settings.timezone)
        if candle_time.date() < start_date or candle_time.date() > end_date:
            continue

        entry_timing = str(request.entry_timing or "next_minute").lower()
        execute_at = _signal_execution_time(
            candle_time,
            settings.schedule_interval_minutes,
            entry_timing,
        )
        session_start = _session_datetime(execute_at, entry_window)
        session_end = _session_datetime(execute_at, exit_window)

        if execute_at < session_start or execute_at > session_end:
            skipped.append(
                {
                    "candleTime": candle_time.isoformat(),
                    "signal": signal,
                    "reason": "outside_trade_window",
                }
            )
            continue

        if last_exit_at and execute_at <= last_exit_at:
            skipped.append(
                {
                    "candleTime": candle_time.isoformat(),
                    "signal": signal,
                    "reason": "active_trade_overlap",
                }
            )
            continue

        entry_candidates = (
            minute_candles[minute_candles.index >= pd.Timestamp(execute_at)]
            if not minute_candles.empty
            else pd.DataFrame()
        )
        if not entry_candidates.empty:
            entry_row = entry_candidates.iloc[0]
            entry_at = _as_ist(entry_candidates.index[0], settings.timezone)
            entry_spot = float(entry_row["Open"])
        else:
            entry_at = execute_at
            entry_spot = float(row["Close"])
        strike, option_type = _compute_itm_strike(
            entry_spot,
            str(signal).upper(),
            instrument.strike_step,
        )
        contract = price_provider.resolve_contract(strike, option_type, entry_at)
        option_frame = pd.DataFrame()
        if contract is not None:
            option_frame = _option_candles_to_frame(
                price_provider.historical_option_candles(
                    contract,
                    candle_time,
                    session_end,
                    interval="minute",
                ),
                settings.timezone,
            )
        used_real_option_candles = used_real_option_candles or not option_frame.empty

        option_entry = _candle_at_or_after(option_frame, entry_at) if not option_frame.empty else None
        if option_entry is not None:
            entry_at, option_entry_row = option_entry
            base_entry_price = round(float(option_entry_row["Open"]), 2)
        else:
            base_entry_price = _option_price_from_underlying(entry_spot, strike, option_type)
        entry_price = _apply_entry_slippage(base_entry_price, settings.paper_trade_slippage_pct)
        quantity = _normalize_quantity(request.balance, entry_price, settings.paper_trade_lot_size)

        if quantity < settings.paper_trade_lot_size:
            skipped.append(
                {
                    "candleTime": candle_time.isoformat(),
                    "signal": signal,
                    "reason": "less_than_one_lot",
                    "entryPrice": entry_price,
                }
            )
            continue

        signal_candle_end = candle_time + timedelta(minutes=settings.schedule_interval_minutes)
        if not option_frame.empty:
            signal_option_rows = option_frame[
                (option_frame.index >= pd.Timestamp(candle_time))
                & (option_frame.index < pd.Timestamp(signal_candle_end))
            ]
            candle_low_stop = round(float(signal_option_rows["Low"].min()), 2) if not signal_option_rows.empty else entry_price
        else:
            signal_minute_rows = minute_candles[
                (minute_candles.index >= pd.Timestamp(candle_time))
                & (minute_candles.index < pd.Timestamp(signal_candle_end))
            ]
            candle_low_stop = _option_signal_candle_low(signal_minute_rows, row, strike, option_type)
        stop_loss_mode = str(request.stop_loss_mode or "signal_low").lower()
        if stop_loss_mode == "percent":
            stop_loss_price = round(entry_price * (1 - request.stop_loss_pct / 100.0), 2)
            stop_loss_source = f"fixed_{request.stop_loss_pct:g}pct"
        else:
            candle_stop_pct = (entry_price - candle_low_stop) / entry_price * 100.0
            if candle_stop_pct <= 0:
                if not request.cap_stop_loss:
                    skipped.append(
                        {
                            "candleTime": candle_time.isoformat(),
                            "signal": signal,
                            "reason": "invalid_stop_loss_above_entry",
                            "entryPrice": entry_price,
                            "signalCandleStop": round(candle_low_stop, 2),
                        }
                    )
                    continue
                stop_loss_price = round(entry_price * (1 - request.stop_loss_pct / 100.0), 2)
                stop_loss_source = f"fallback_{request.stop_loss_pct:g}pct_invalid_signal_low"
            elif request.cap_stop_loss and candle_stop_pct > request.stop_loss_pct:
                stop_loss_price = round(entry_price * (1 - request.stop_loss_pct / 100.0), 2)
                stop_loss_source = f"capped_{request.stop_loss_pct:g}pct"
            else:
                stop_loss_price = round(candle_low_stop, 2)
                stop_loss_source = "signal_option_candle_low"

        target_price = round(entry_price * (1 + request.target_pct / 100.0), 2)
        if stop_loss_price >= entry_price:
            skipped.append(
                {
                    "candleTime": candle_time.isoformat(),
                    "signal": signal,
                    "reason": "stop_loss_not_below_entry",
                    "entryPrice": entry_price,
                    "stopLoss": stop_loss_price,
                }
            )
            continue
        if target_price <= entry_price:
            skipped.append(
                {
                    "candleTime": candle_time.isoformat(),
                    "signal": signal,
                    "reason": "target_not_above_entry",
                    "entryPrice": entry_price,
                    "target": target_price,
                }
            )
            continue
        exit_price = None
        base_exit_price = None
        exit_at = None
        exit_reason = "SESSION_CLOSE"
        future_rows = (
            option_frame[
                (option_frame.index >= pd.Timestamp(entry_at))
                & (option_frame.index <= pd.Timestamp(session_end))
            ]
            if not option_frame.empty
            else minute_candles[
                (minute_candles.index >= pd.Timestamp(entry_at))
                & (minute_candles.index <= pd.Timestamp(session_end))
            ]
        )

        for future_index, future_row in future_rows.iterrows():
            if not option_frame.empty:
                option_low = float(future_row["Low"])
                option_high = float(future_row["High"])
            else:
                option_low, option_high, _option_close = _option_candle_range(future_row, strike, option_type)
            future_time = _as_ist(future_index, settings.timezone)
            if option_low <= stop_loss_price:
                base_exit_price = stop_loss_price
                exit_price = stop_loss_price
                exit_at = future_time
                exit_reason = "STOP_LOSS"
                break
            if option_high >= target_price:
                base_exit_price = target_price
                exit_price = target_price
                exit_at = future_time
                exit_reason = "TARGET"
                break

        if exit_price is None:
            session_rows = future_rows
            if session_rows.empty:
                session_rows = minute_candles[
                    (minute_candles.index >= pd.Timestamp(entry_at))
                    & (minute_candles.index <= pd.Timestamp(session_end))
                ]
            if session_rows.empty:
                skipped.append(
                    {
                        "candleTime": candle_time.isoformat(),
                        "signal": signal,
                        "reason": "no_exit_candles_available",
                        "entryTime": entry_at.isoformat(),
                    }
                )
                continue
            exit_row = session_rows.iloc[-1]
            exit_at = _as_ist(session_rows.index[-1], settings.timezone)
            base_exit_price = (
                round(float(exit_row["Close"]), 2)
                if not option_frame.empty
                else _option_price_for_exit(exit_row, strike, option_type, str(signal).upper())
            )
            exit_price = _apply_exit_slippage(base_exit_price, settings.paper_trade_slippage_pct)

        gross_pnl = round((exit_price - entry_price) * quantity, 2)
        charges = _estimate_charges(entry_price, exit_price, quantity)
        net_pnl = round(gross_pnl - charges, 2)
        status = "WIN" if net_pnl >= 0 else "LOSS"
        last_exit_at = exit_at

        trades.append(
            {
                "signal": str(signal).upper(),
                "instrument": instrument.id,
                "signalMode": signal_mode,
                "candleTime": candle_time.isoformat(),
                "entryTime": entry_at.isoformat(),
                "entryTiming": entry_timing,
                "exitTime": exit_at.isoformat() if exit_at else None,
                "strike": strike,
                "optionType": option_type,
                "entryPrice": entry_price,
                "baseEntryPrice": base_entry_price,
                "exitPrice": exit_price,
                "baseExitPrice": base_exit_price,
                "quantity": quantity,
                "capitalUsed": round(entry_price * quantity, 2),
                "stopLoss": stop_loss_price,
                "stopLossMode": stop_loss_mode,
                "stopLossSource": stop_loss_source,
                "target": target_price,
                "optionSymbol": contract.tradingsymbol if contract is not None else None,
                "grossPnl": gross_pnl,
                "charges": charges,
                "netPnl": net_pnl,
                "status": status,
                "exitReason": exit_reason,
                "executionSource": "zerodha_option_1m" if not option_frame.empty else "synthetic_1m_underlying",
            }
        )
    finally:
        price_provider.close()

    return {
        "request": request.__dict__,
        "summary": _summarize(trades),
        "trades": trades,
        "skipped": skipped[:100],
        "data": {
            "symbol": settings.symbol,
            "instrument": instrument.id,
            "instrumentLabel": instrument.label,
            "lotSize": instrument.lot_size,
            "strikeStep": instrument.strike_step,
            "interval": settings.interval,
            "signalCandleCount": len(signal_frame),
            "signalMode": signal_mode,
            "selectedSignalCount": selected_signal_count,
            "fastSignalCount": fast_signal_count,
            "bothSignalCount": both_signal_count,
            "executionCandleCount": len(minute_candles),
            "candleCount": len(signal_frame),
            "pricingModel": "zerodha_option_1m" if used_real_option_candles else "synthetic_option_from_1m_underlying_candles",
            "signalDataSource": signal_data_source,
            "executionDataSource": execution_data_source,
        },
    }
