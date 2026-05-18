from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, replace
from datetime import date, datetime, time, timedelta
from math import floor
import logging
import re
from typing import Any

import pandas as pd

from nifty_alert_bot.data import fetch_candles_between
from nifty_alert_bot.exact_candle_repository import ExactCandleRepository
from nifty_alert_bot.indicators import build_signal_frame
from nifty_alert_bot.instruments import get_instrument_spec
from nifty_alert_bot.option_price_provider import OptionContract, OptionPriceProvider, synthetic_option_price
from nifty_alert_bot.paper_trading import _apply_entry_slippage, _apply_exit_slippage, _estimate_charges
from nifty_alert_bot.scheduler import parse_hhmm


logger = logging.getLogger(__name__)


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
    expiry_offset: int = 0
    require_vwap: bool = False
    min_volume_multiplier: float = 0
    volume_lookback: int = 20
    max_entry_gap_pct: float = 0
    trailing_stop_pct: float = 0
    max_trades_per_day: int = 0


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
    expiry_offset: int = 0,
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
        expiry_offset=expiry_offset,
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
    allow_cached: bool = True,
    expiry_offset: int = 0,
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
            allow_cached=allow_cached,
            expiry_offset=expiry_offset,
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


def _synthetic_option_frame_from_underlying(
    underlying_frame: pd.DataFrame,
    strike: int,
    option_type: str,
    timezone,
) -> pd.DataFrame:
    if underlying_frame.empty:
        return pd.DataFrame()

    working = underlying_frame.copy()
    if working.index.tz is None:
        working.index = working.index.tz_localize(timezone)
    else:
        working.index = working.index.tz_convert(timezone)

    rows: list[dict[str, Any]] = []
    for index, row in working.iterrows():
        option_open = _option_price_from_underlying(float(row["Open"]), strike, option_type)
        option_close = _option_price_from_underlying(float(row["Close"]), strike, option_type)
        if option_type == "CE":
            option_low = _option_price_from_underlying(float(row["Low"]), strike, option_type)
            option_high = _option_price_from_underlying(float(row["High"]), strike, option_type)
        else:
            option_low = _option_price_from_underlying(float(row["High"]), strike, option_type)
            option_high = _option_price_from_underlying(float(row["Low"]), strike, option_type)
        payload = {
            "date": index,
            "Open": round(option_open, 2),
            "High": round(max(option_high, option_low, option_open, option_close), 2),
            "Low": round(min(option_high, option_low, option_open, option_close), 2),
            "Close": round(option_close, 2),
            "Strike": int(strike),
            "Spot": round(float(row["Close"]), 2),
        }
        if "Volume" in working.columns:
            payload["Volume"] = row.get("Volume")
        rows.append(payload)

    frame = pd.DataFrame(rows)
    if frame.empty:
        return frame
    frame.index = pd.to_datetime(frame.pop("date"))
    if frame.index.tz is None:
        frame.index = frame.index.tz_localize(timezone)
    else:
        frame.index = frame.index.tz_convert(timezone)
    return frame.dropna(subset=["Open", "High", "Low", "Close"])


def _synthetic_option_contract(
    instrument_id: str,
    strike: int,
    option_type: str,
    input_value: str,
) -> OptionContract:
    del input_value
    return OptionContract(
        exchange="YFINANCE_SYNTHETIC",
        tradingsymbol=f"{instrument_id}{int(strike)}{option_type.upper()}",
        instrument_token=0,
        strike=int(strike),
        option_type=option_type.upper(),
        expiry="synthetic",
    )


def _synthetic_dynamic_contract_specs(
    instrument,
    contract_input: str,
    contract_order: int,
    spot_frame: pd.DataFrame,
    timezone,
    signal_interval_minutes: int,
    strike_offset: int,
) -> list[dict[str, Any]]:
    option_side = str(contract_input or "").strip().upper()
    if spot_frame.empty:
        return []

    strike_to_times: dict[int, set[str]] = {}
    for index, row in spot_frame.iterrows():
        candle_time = _signal_bucket(_as_ist(index, timezone), signal_interval_minutes)
        spot = float(row["Close"])
        atm = _round_to_step(spot, instrument.strike_step)
        strike = atm + int(strike_offset or 0)
        strike_to_times.setdefault(strike, set()).add(candle_time.isoformat())

    return [
        {
            "input": contract_input,
            "order": contract_order,
            "contract": _synthetic_option_contract(instrument.id, strike, option_side, contract_input),
            "option_side": option_side,
            "strike_offset": strike_offset,
            "active_times": active_times,
            "data_provider": "yfinance_synthetic",
        }
        for strike, active_times in sorted(strike_to_times.items())
    ]


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
            "strike": "Strike",
            "spot": "Spot",
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
    if "Strike" in frame.columns:
        columns.append("Strike")
    if "Spot" in frame.columns:
        columns.append("Spot")
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


def _add_volume_average(frame: pd.DataFrame, lookback: int) -> pd.DataFrame:
    if frame.empty or "Volume" not in frame.columns:
        return frame.assign(VolumeAvg=pd.NA)

    output = frame.copy()
    period = max(1, int(lookback or 1))
    output["VolumeAvg"] = (
        output["Volume"]
        .groupby(output.index.date)
        .transform(lambda series: series.shift(1).rolling(period, min_periods=min(5, period)).mean())
    )
    return output


def _resample_to_five_minute(frame: pd.DataFrame, timezone) -> pd.DataFrame:
    if frame.empty:
        return frame

    working = frame.copy()
    if working.index.tz is None:
        working.index = working.index.tz_localize(timezone)
    else:
        working.index = working.index.tz_convert(timezone)

    aggregations: dict[str, str] = {
        "Open": "first",
        "High": "max",
        "Low": "min",
        "Close": "last",
    }
    if "Volume" in working.columns:
        aggregations["Volume"] = "sum"
    if "Strike" in working.columns:
        aggregations["Strike"] = "last"
    if "Spot" in working.columns:
        aggregations["Spot"] = "last"

    pieces = []
    for _session_date, session_rows in working.groupby(working.index.date):
        session_start = session_rows.index[0].replace(hour=9, minute=15, second=0, microsecond=0)
        pieces.append(
            session_rows.resample(
                "5min",
                origin=session_start,
                label="left",
                closed="left",
            ).agg(aggregations)
        )

    if not pieces:
        return pd.DataFrame()
    return pd.concat(pieces).dropna(subset=["Open", "High", "Low", "Close"]).sort_index()


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
    use_cache = end_date < datetime.now(settings.timezone).date()

    zerodha_frame = _option_candles_to_frame(
        price_provider.historical_index_candles(
            instrument,
            from_dt,
            to_dt,
            interval,
            use_cache=use_cache,
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


def _stored_option_frame(
    settings,
    repository: ExactCandleRepository,
    underlying: str,
    tradingsymbol: str,
    from_dt: datetime,
    to_dt: datetime,
) -> pd.DataFrame:
    minute_frame = _option_candles_to_frame(
        repository.load_candles(
            underlying=underlying,
            tradingsymbol=tradingsymbol,
            interval="minute",
            from_dt=from_dt,
            to_dt=to_dt,
        ),
        settings.timezone,
    )
    return _resample_to_five_minute(minute_frame, settings.timezone)


def _stored_contract_specs(
    repository: ExactCandleRepository,
    underlying: str,
    option_type: str | None,
    from_dt: datetime,
    to_dt: datetime,
    order: int,
    input_value: str,
    strike: int | None = None,
    strike_offset: int | None = None,
) -> list[dict[str, Any]]:
    contracts = repository.list_contracts(
        underlying=underlying,
        from_dt=from_dt,
        to_dt=to_dt,
        option_type=option_type,
        strike=strike,
        strike_offset=strike_offset,
        interval="minute",
    )
    specs: list[dict[str, Any]] = []
    for item in contracts:
        contract = OptionContract(
            exchange=str(item.get("exchange") or ""),
            tradingsymbol=str(item.get("tradingsymbol") or ""),
            instrument_token=int(item.get("instrument_token") or 0),
            strike=int(item.get("strike") or 0),
            option_type=str(item.get("option_type") or option_type or "").upper(),
            expiry=str(item.get("expiry") or ""),
        )
        if not contract.tradingsymbol or not contract.option_type:
            continue
        specs.append(
            {
                "input": input_value,
                "order": order,
                "contract": contract,
                "option_side": contract.option_type,
                "strike_offset": strike_offset,
                "active_times": None,
                "data_provider": "stored_exact",
            }
        )
    return specs


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
    # Match the live 5m option bot, which rebuilds Supertrend from the last 5 days
    # of option candles on every scan. A different warmup can shift crossover points.
    warmup_start_date = start_date - timedelta(days=5)
    from_dt = datetime.combine(warmup_start_date, time.min, tzinfo=settings.timezone)
    to_dt = datetime.combine(end_date + timedelta(days=1), time.min, tzinfo=settings.timezone)
    trade_from_dt = datetime.combine(start_date, time.min, tzinfo=settings.timezone)
    trade_to_dt = datetime.combine(end_date + timedelta(days=1), time.min, tzinfo=settings.timezone)
    price_provider = OptionPriceProvider(settings)
    exact_repository = ExactCandleRepository(
        settings.mongodb_uri,
        settings.mongodb_database,
        settings.mongodb_option_candles_collection,
    )

    try:
        mode = str(request.mode or "fixed").strip().lower()
        contract_inputs: list[str]
        if mode == "dynamic":
            side = str(request.contract_side or "PE").strip().upper()
            contract_inputs = ["PE", "CE"] if side == "BOTH" else [side]
            if any(item not in {"PE", "CE"} for item in contract_inputs):
                raise ValueError("Contract side must be PE, CE, or BOTH.")
            contract_specs = []
            for order, side_input in enumerate(contract_inputs):
                stored_specs = _stored_contract_specs(
                    exact_repository,
                    instrument.id,
                    side_input,
                    trade_from_dt,
                    trade_to_dt,
                    order,
                    side_input,
                    strike_offset=int(request.strike_offset or 0),
                )
                contract_specs.extend(stored_specs)
            spot_frame, _spot_source = _fetch_backtest_candles(
                settings,
                instrument,
                price_provider,
                start_date,
                end_date,
                "5m",
            )
            for order, side_input in enumerate(contract_inputs):
                resolved_specs = _dynamic_contract_specs(
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
                    allow_cached=False,
                    expiry_offset=int(request.expiry_offset or 0),
                )
                contract_specs.extend(resolved_specs)
                if not resolved_specs:
                    contract_specs.extend(
                        _synthetic_dynamic_contract_specs(
                            instrument,
                            side_input,
                            order,
                            spot_frame,
                            settings.timezone,
                            signal_interval_minutes,
                            int(request.strike_offset or 0),
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
                compact_contract = re.fullmatch(r"(\d+)(CE|PE)", contract_input)
                if compact_contract:
                    strike = int(compact_contract.group(1))
                    option_type = compact_contract.group(2)
                    stored_specs = _stored_contract_specs(
                        exact_repository,
                        instrument.id,
                        option_type,
                        trade_from_dt,
                        trade_to_dt,
                        order,
                        contract_input,
                        strike=strike,
                    )
                    if stored_specs:
                        contract_specs.extend(stored_specs)
                        continue
                    specs_by_symbol: dict[str, dict[str, Any]] = {}
                    current_day = start_date
                    while current_day <= end_date:
                        resolve_as_of = datetime.combine(current_day, time.min, tzinfo=settings.timezone)
                        contract = price_provider.resolve_contract(
                            strike,
                            option_type,
                            resolve_as_of,
                            exchange=option_exchange,
                            underlying=option_underlying,
                            max_expiry_gap_days=max_historical_expiry_gap_days,
                            allow_cached=False,
                            expiry_offset=int(request.expiry_offset or 0),
                        )
                        if contract is not None:
                            expiry_date = datetime.fromisoformat(contract.expiry).date() if contract.expiry else None
                            if expiry_date is None or current_day <= expiry_date:
                                day_start = datetime.combine(current_day, time.min, tzinfo=settings.timezone)
                                active_times = {
                                    (day_start + timedelta(minutes=signal_interval_minutes * index)).isoformat()
                                    for index in range((24 * 60) // signal_interval_minutes)
                                }
                                spec = specs_by_symbol.setdefault(
                                    contract.tradingsymbol,
                                    {
                                        "input": contract_input,
                                        "order": order,
                                        "contract": contract,
                                        "option_side": contract.option_type,
                                        "strike_offset": None,
                                        "active_times": set(),
                                    },
                                )
                                spec["active_times"].update(active_times)
                        current_day += timedelta(days=1)

                    contract_specs.extend(specs_by_symbol.values())
                    if not specs_by_symbol:
                        contract_specs.append(
                            {
                                "input": contract_input,
                                "order": order,
                                "contract": _synthetic_option_contract(
                                    instrument.id,
                                    strike,
                                    option_type,
                                    contract_input,
                                ),
                                "option_side": option_type,
                                "strike_offset": None,
                                "active_times": None,
                                "data_provider": "yfinance_synthetic",
                            }
                        )
                    continue

                contract = price_provider.resolve_contract_input(
                    contract_input,
                    datetime.combine(start_date, entry_window, tzinfo=settings.timezone),
                    option_exchange,
                    option_underlying,
                    max_expiry_gap_days=max_historical_expiry_gap_days,
                    allow_cached=False,
                    expiry_offset=int(request.expiry_offset or 0),
                )
                if contract is None:
                    compact_tail = re.search(r"(\d{4,6})(CE|PE)$", contract_input)
                    if compact_tail is None:
                        raise ValueError(
                            f"Option contract not found for {instrument.id} {contract_input} near {start_date.isoformat()}. "
                            "Use compact symbols like 24200PE for yfinance synthetic fallback."
                        )
                    strike = int(compact_tail.group(1))
                    option_type = compact_tail.group(2)
                    contract_specs.append(
                        {
                            "input": contract_input,
                            "order": order,
                            "contract": _synthetic_option_contract(
                                instrument.id,
                                strike,
                                option_type,
                                contract_input,
                            ),
                            "option_side": option_type,
                            "strike_offset": None,
                            "active_times": None,
                            "data_provider": "yfinance_synthetic",
                        }
                    )
                    continue
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

        deduped_specs: dict[tuple[str, int], dict[str, Any]] = {}
        for spec in contract_specs:
            contract = spec["contract"]
            key = (contract.tradingsymbol, int(spec.get("order") or 0))
            existing = deduped_specs.get(key)
            if existing is None or (
                existing.get("data_provider") != "stored_exact"
                and spec.get("data_provider") == "stored_exact"
            ):
                deduped_specs[key] = spec
        contract_specs = list(deduped_specs.values())

        if not contract_specs:
            raise ValueError(
                f"No {instrument.id} option contracts could be resolved for this backtest. "
                "For expired historical contracts, exact option candles must already be stored in MongoDB."
            )

        contract_contexts: list[dict[str, Any]] = []
        signal_events: list[dict[str, Any]] = []
        skipped: list[dict[str, Any]] = []
        signal_diagnostics: list[dict[str, Any]] = []
        both_green_candle_count = 0
        raw_buy_signal_count = 0
        body_accepted_signal_count = 0
        synthetic_underlying_cache: dict[tuple[str, date, date], pd.DataFrame] = {}
        for spec in contract_specs:
            contract = spec["contract"]
            if spec.get("data_provider") == "stored_exact":
                option_candles = _stored_option_frame(
                    settings,
                    exact_repository,
                    instrument.id,
                    contract.tradingsymbol,
                    from_dt,
                    to_dt,
                )
                data_source = "stored_exact_option_5minute"
            elif spec.get("data_provider") == "yfinance_synthetic":
                cache_key = (instrument.id, warmup_start_date, end_date)
                underlying_frame = synthetic_underlying_cache.get(cache_key)
                if underlying_frame is None:
                    underlying_frame = fetch_candles_between(
                        instrument.yfinance_symbol,
                        "5m",
                        warmup_start_date.isoformat(),
                        (end_date + timedelta(days=1)).isoformat(),
                    )
                    synthetic_underlying_cache[cache_key] = underlying_frame
                option_candles = _synthetic_option_frame_from_underlying(
                    underlying_frame,
                    int(contract.strike),
                    contract.option_type,
                    settings.timezone,
                )
                data_source = "yfinance_synthetic_option_5minute"
            else:
                option_candles = _option_candles_to_frame(
                    price_provider.historical_option_candles(
                        contract,
                        from_dt,
                        to_dt,
                        interval="5minute",
                        use_cache=False,
                    ),
                    settings.timezone,
                )
                data_source = "zerodha_option_5minute"
            if option_candles.empty:
                skipped.append(
                    {
                        "optionSymbol": contract.tradingsymbol,
                        "reason": "no_yfinance_underlying_candles"
                        if spec.get("data_provider") == "yfinance_synthetic"
                        else "no_option_candles",
                    }
                )
                continue

            option_candles = _add_volume_average(
                _add_intraday_vwap(option_candles),
                int(request.volume_lookback or 20),
            )
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
                "data_source": data_source,
            }
            contract_contexts.append(context)

            eligible_days: set[date] = set()
            buy_signal_days: set[date] = set()
            accepted_signal_days: set[date] = set()

            for index in range(1, len(signal_frame)):
                row = signal_frame.iloc[index]
                candle_time = _as_ist(signal_frame.index[index], settings.timezone)
                if candle_time < trade_from_dt or candle_time >= trade_to_dt:
                    continue
                active_times = context.get("active_times")
                if active_times is not None and candle_time.isoformat() not in active_times:
                    continue
                eligible_days.add(candle_time.date())
                if int(row.get("st_10_1_trend") or 0) == 1 and int(row.get("st_10_3_trend") or 0) == 1:
                    both_green_candle_count += 1
                signal = row.get("signal")
                if pd.isna(signal) or str(signal).upper() != "BUY":
                    continue
                buy_signal_days.add(candle_time.date())
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
                        "vwap": None if pd.isna(row.get("VWAP")) else round(float(row.get("VWAP")), 2),
                        "volume": None if pd.isna(row.get("Volume")) else int(row.get("Volume")),
                        "volumeAvg": None if pd.isna(row.get("VolumeAvg")) else round(float(row.get("VolumeAvg")), 2),
                        "fastTrend": int(row.get("st_10_1_trend") or 0),
                        "slowTrend": int(row.get("st_10_3_trend") or 0),
                    }
                )
                signal_vwap = row.get("VWAP")
                if request.require_vwap:
                    if pd.isna(signal_vwap):
                        skipped.append(
                            {
                                "candleTime": candle_time.isoformat(),
                                "signal": "BUY",
                                "optionSymbol": contract.tradingsymbol,
                                "reason": "vwap_unavailable",
                            }
                        )
                        continue
                    if signal_close >= float(signal_vwap):
                        skipped.append(
                            {
                                "candleTime": candle_time.isoformat(),
                                "signal": "BUY",
                                "optionSymbol": contract.tradingsymbol,
                                "reason": "close_above_or_equal_vwap",
                                "close": signal_close,
                                "vwap": round(float(signal_vwap), 2),
                            }
                        )
                        continue
                signal_volume = row.get("Volume")
                signal_volume_avg = row.get("VolumeAvg")
                if request.min_volume_multiplier and request.min_volume_multiplier > 0:
                    if pd.isna(signal_volume) or pd.isna(signal_volume_avg) or float(signal_volume_avg) <= 0:
                        skipped.append(
                            {
                                "candleTime": candle_time.isoformat(),
                                "signal": "BUY",
                                "optionSymbol": contract.tradingsymbol,
                                "reason": "volume_average_unavailable",
                            }
                        )
                        continue
                    required_volume = float(signal_volume_avg) * float(request.min_volume_multiplier)
                    if float(signal_volume) < required_volume:
                        skipped.append(
                            {
                                "candleTime": candle_time.isoformat(),
                                "signal": "BUY",
                                "optionSymbol": contract.tradingsymbol,
                                "reason": "volume_below_confirmation",
                                "volume": int(signal_volume),
                                "requiredVolume": round(required_volume, 2),
                                "volumeAvg": round(float(signal_volume_avg), 2),
                            }
                        )
                        continue
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
                accepted_signal_days.add(candle_time.date())
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

            for signal_day in sorted(eligible_days - buy_signal_days):
                day_rows = signal_frame[signal_frame.index.date == signal_day]
                if day_rows.empty:
                    continue
                last_row = day_rows.iloc[-1]
                skipped.append(
                    {
                        "candleTime": _as_ist(day_rows.index[-1], settings.timezone).isoformat(),
                        "signal": "BUY",
                        "optionSymbol": contract.tradingsymbol,
                        "reason": "no_fresh_buy_signal",
                        "close": round(float(last_row["Close"]), 2),
                        "fastTrend": int(last_row.get("st_10_1_trend") or 0),
                        "slowTrend": int(last_row.get("st_10_3_trend") or 0),
                    }
                )
            for signal_day in sorted(buy_signal_days - accepted_signal_days):
                if any(
                    item.get("reason") == "signal_candle_body_outside_range"
                    and item.get("candleTime", "").startswith(signal_day.isoformat())
                    and item.get("optionSymbol") == contract.tradingsymbol
                    for item in skipped
                ):
                    continue
                skipped.append(
                    {
                        "signal": "BUY",
                        "optionSymbol": contract.tradingsymbol,
                        "reason": "buy_signal_rejected_before_execution",
                        "date": signal_day.isoformat(),
                    }
                )

        trades: list[dict[str, Any]] = []
        last_exit_at: datetime | None = None
        trades_per_day: Counter = Counter()
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
            if request.max_trades_per_day and request.max_trades_per_day > 0:
                trade_day = execute_at.date()
                if trades_per_day[trade_day] >= request.max_trades_per_day:
                    skipped.append(
                        {
                            "candleTime": candle_time.isoformat(),
                            "optionSymbol": contract.tradingsymbol,
                            "reason": "max_trades_per_day_reached",
                            "maxTradesPerDay": request.max_trades_per_day,
                        }
                    )
                    continue

            entry_candidate = _candle_at_or_after(option_candles, execute_at)
            if entry_candidate is None:
                skipped.append({"candleTime": candle_time.isoformat(), "optionSymbol": contract.tradingsymbol, "reason": "entry_candle_unavailable"})
                continue
            entry_at, entry_row = entry_candidate
            actual_strike = int(round(float(row.get("Strike") or entry_row.get("Strike") or contract.strike or 0)))
            display_symbol = (
                f"{instrument.id}{actual_strike}{contract.option_type}"
                if actual_strike
                else contract.tradingsymbol
            )
            base_entry_price = round(float(entry_row["Open"]), 2)
            signal_close_for_gap = float(row["Close"])
            entry_gap_pct = (
                round(((base_entry_price - signal_close_for_gap) / signal_close_for_gap) * 100.0, 2)
                if signal_close_for_gap > 0
                else None
            )
            if (
                request.max_entry_gap_pct
                and request.max_entry_gap_pct > 0
                and entry_gap_pct is not None
                and entry_gap_pct > request.max_entry_gap_pct
            ):
                skipped.append(
                    {
                        "candleTime": candle_time.isoformat(),
                        "optionSymbol": contract.tradingsymbol,
                        "reason": "entry_gap_above_limit",
                        "signalClose": round(signal_close_for_gap, 2),
                        "entryOpen": base_entry_price,
                        "entryGapPct": entry_gap_pct,
                        "maxEntryGapPct": request.max_entry_gap_pct,
                    }
                )
                continue
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
            effective_stop_loss = stop_loss_price
            effective_stop_loss_source = stop_loss_source
            for future_index, future_row in future_rows.iterrows():
                future_time = _as_ist(future_index, settings.timezone)
                if trend_flip_exit is not None and future_time >= trend_flip_exit["exitTime"]:
                    base_exit_price = trend_flip_exit["price"]
                    exit_price = _apply_exit_slippage(base_exit_price, settings.paper_trade_slippage_pct)
                    exit_at = trend_flip_exit["exitTime"]
                    exit_reason = "SUPER_TREND_FLIP"
                    break
                if float(future_row["Low"]) <= effective_stop_loss:
                    base_exit_price = effective_stop_loss
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
                if request.trailing_stop_pct and request.trailing_stop_pct > 0:
                    trailing_candidate = round(
                        float(future_row["High"]) * (1 - request.trailing_stop_pct / 100.0),
                        2,
                    )
                    if trailing_candidate > effective_stop_loss and trailing_candidate < target_price:
                        effective_stop_loss = trailing_candidate
                        effective_stop_loss_source = f"trailing_{request.trailing_stop_pct:g}pct"

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
            trades_per_day[entry_at.date()] += 1
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
                    "strike": actual_strike or contract.strike,
                    "optionType": contract.option_type,
                    "optionSymbol": display_symbol,
                    "signalCandleOpen": round(float(row["Open"]), 2),
                    "signalCandleClose": round(float(row["Close"]), 2),
                    "signalCandleLow": signal_low_stop,
                    "signalCandleBodyPct": event["signal_candle_body_pct"],
                    "entryGapPct": entry_gap_pct,
                    "vwap": None if pd.isna(row.get("VWAP")) else round(float(row.get("VWAP")), 2),
                    "volume": None if pd.isna(row.get("Volume")) else int(row.get("Volume")),
                    "volumeAvg": None if pd.isna(row.get("VolumeAvg")) else round(float(row.get("VolumeAvg")), 2),
                    "entryPrice": entry_price,
                    "baseEntryPrice": base_entry_price,
                    "exitPrice": exit_price,
                    "baseExitPrice": base_exit_price,
                    "quantity": quantity,
                    "capitalUsed": round(entry_price * quantity, 2),
                    "stopLoss": stop_loss_price,
                    "stopLossSource": stop_loss_source,
                    "finalStopLoss": effective_stop_loss,
                    "finalStopLossSource": effective_stop_loss_source,
                    "target": target_price,
                    "grossPnl": gross_pnl,
                    "charges": charges,
                    "netPnl": net_pnl,
                    "status": status,
                    "exitReason": exit_reason,
                    "executionSource": context.get("data_source") or "zerodha_option_5minute",
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
                "expiryOffset": request.expiry_offset,
                "interval": "5m",
                "signalMode": "both",
                "entrySignal": "BUY",
                "maxBodyPct": request.max_body_pct,
                "minBodyPct": request.min_body_pct,
                "advancedFilters": {
                    "requireVwap": request.require_vwap,
                    "minVolumeMultiplier": request.min_volume_multiplier,
                    "volumeLookback": request.volume_lookback,
                    "maxEntryGapPct": request.max_entry_gap_pct,
                    "trailingStopPct": request.trailing_stop_pct,
                    "maxTradesPerDay": request.max_trades_per_day,
                },
                "bothGreenCandleCount": both_green_candle_count,
                "rawBuySignalCount": raw_buy_signal_count,
                "freshBuyArrowCount": raw_buy_signal_count,
                "greenStateButNoFreshSignalCount": max(both_green_candle_count - raw_buy_signal_count, 0),
                "bodyAcceptedSignalCount": body_accepted_signal_count,
                "bodyRejectedSignalCount": max(raw_buy_signal_count - body_accepted_signal_count, 0),
                "executedTradeCount": len(trades),
                "skippedCount": len(skipped),
                "skippedReasonCounts": skipped_reason_counts,
                "signalDiagnostics": signal_diagnostics[:100],
                "candleCount": sum(len(context["signal_frame"]) for context in contract_contexts),
                "pricingModel": (
                    "stored_exact_option_5minute"
                    if any(context.get("data_source") == "stored_exact_option_5minute" for context in contract_contexts)
                    else "yfinance_synthetic_option_5minute"
                    if any(context.get("data_source") == "yfinance_synthetic_option_5minute" for context in contract_contexts)
                    else "zerodha_option_5minute"
                ),
                "signalDataSource": " / ".join(sorted({str(context.get("data_source")) for context in contract_contexts})),
                "executionDataSource": " / ".join(sorted({str(context.get("data_source")) for context in contract_contexts})),
            },
        }
    finally:
        price_provider.close()
        exact_repository.close()


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
