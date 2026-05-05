from __future__ import annotations

import asyncio
import csv
import json
import os
from datetime import datetime, timedelta
from typing import Any, Literal
from urllib.parse import quote
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse
from pydantic import BaseModel

from nifty_alert_bot.backtesting import (
    BacktestRequest as EngineBacktestRequest,
    FiveMinuteOptionBacktestRequest,
    OptionContractBacktestRequest,
    run_backtest,
    run_five_minute_option_backtest,
    run_option_contract_backtest,
)
from nifty_alert_bot.config import get_settings
from nifty_alert_bot.bot import (
    NIFTY_OPTION_CONTRACT_5M_STRATEGY_KEY,
    OPTION_CONTRACT_STRATEGY_KEY,
    SENSEX_OPTION_CONTRACT_5M_STRATEGY_KEY,
    SENSEX_OPTION_CONTRACT_STRATEGY_KEY,
    build_state_store,
    option_strategy_settings_for_key,
    send_sample_alert,
)
from nifty_alert_bot.live_trading import LiveTradingBroker, LiveTradingError
from nifty_alert_bot.option_price_provider import OptionPriceProvider
from nifty_alert_bot.paper_trade_repository import PaperTradeRepository
from nifty_alert_bot.run_log_store import RunLogStore
from nifty_alert_bot.scheduler import WEEKDAYS, next_run_at, parse_hhmm
from nifty_alert_bot.text_log_parser import parse_text_logs


app = FastAPI(title="NIFTY Alert Dashboard API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

_LIVE_TRADING_SNAPSHOT_CACHE: dict[str, Any] = {
    "expires_at": None,
    "payload": None,
}
_LIVE_TRADING_SNAPSHOT_TTL_SECONDS = 10
_OPTION_EXPIRY_CACHE: dict[str, Any] = {
    "expires_at": None,
    "items": {},
}
_OPTION_EXPIRY_CACHE_TTL_SECONDS = 60 * 60 * 6


class SampleAlertRequest(BaseModel):
    signal: Literal["BUY", "SELL"]


class ZerodhaExchangeRequest(BaseModel):
    requestToken: str
    saveToEnv: bool = True


class StrategyContractsRequest(BaseModel):
    strategyKey: Literal["option_contracts_1m", "option_contracts_1m_sensex", "option_contracts_5m", "option_contracts_5m_sensex"] = "option_contracts_1m"
    contractMode: Literal["fixed", "dynamic"] | None = "dynamic"
    contract1: str
    contract2: str
    scheduleStart: str | None = None
    scheduleEnd: str | None = None
    startingBalance: float | None = None
    targetPct: float | None = None
    maxSignalCandlePct: float | None = None
    minSignalCandlePct: float | None = None
    strikeOffset: int | None = None
    entrySignal: Literal["BUY", "SELL", "BOTH"] | None = None
    stopLossMode: Literal["signal_low", "percent"] | None = None
    stopLossPct: float | None = None


class AddPaperBalanceRequest(BaseModel):
    amount: float
    strategyKey: Literal["option_contracts_1m", "option_contracts_1m_sensex", "option_contracts_5m", "option_contracts_5m_sensex"] = "option_contracts_1m"


class LiveTradingToggleRequest(BaseModel):
    enabled: bool
    enabledStrategyKeys: list[
        Literal["option_contracts_1m", "option_contracts_1m_sensex", "option_contracts_5m", "option_contracts_5m_sensex"]
    ] | None = None


class LiveOrderCancelRequest(BaseModel):
    variety: str = "regular"


class BacktestApiRequest(BaseModel):
    instrument: Literal["NIFTY", "SENSEX"] = "NIFTY"
    signalMode: Literal["both", "st_10_1"] = "both"
    startDate: str
    endDate: str
    balance: float
    targetPct: float
    stopLossPct: float
    stopLossMode: Literal["signal_low", "percent"] = "signal_low"
    capStopLoss: bool = True
    requireVwap: bool = False
    entryTiming: Literal["signal_close", "next_minute"] = "next_minute"
    entryTime: str
    exitTime: str


class BacktestExportRequest(BaseModel):
    result: dict[str, Any]
    reportType: str = "trades"


class OptionContractBacktestApiRequest(BaseModel):
    exchange: str = "NFO"
    optionSymbol: str
    optionSymbol2: str = ""
    interval: Literal["1m", "5m"] = "1m"
    signalMode: Literal["both", "st_10_1"] = "both"
    entrySignal: Literal["BUY", "SELL", "BOTH"] = "BUY"
    startDate: str
    endDate: str
    balance: float
    lotSize: int = 75
    targetPct: float
    maxSignalCandlePct: float = 10
    stopLossPct: float
    strikeOffset: int = 0
    stopLossMode: Literal["signal_low", "percent"] = "signal_low"
    capStopLoss: bool = True
    requireVwap: bool = False
    entryTiming: Literal["signal_close", "next_minute"] = "next_minute"
    entryTime: str
    exitTime: str


class FiveMinuteOptionBacktestApiRequest(BaseModel):
    instrument: Literal["NIFTY", "SENSEX"] = "NIFTY"
    mode: Literal["fixed", "dynamic"] = "fixed"
    contract1: str = ""
    contract2: str = ""
    contractSide: Literal["PE", "CE", "BOTH"] = "PE"
    startDate: str
    endDate: str
    balance: float
    targetPct: float
    maxBodyPct: float
    minBodyPct: float = 0
    stopLossPct: float = 0
    strikeOffset: int = 0
    entryTime: str
    exitTime: str


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


def _kite_login_url(api_key: str, redirect_url: str) -> str:
    del redirect_url
    return f"https://kite.zerodha.com/connect/login?v=3&api_key={quote(api_key)}"


def _update_env_value(env_path: Path, key: str, value: str) -> None:
    lines: list[str] = []
    if env_path.exists():
        lines = env_path.read_text(encoding="utf-8").splitlines()

    updated = False
    for index, line in enumerate(lines):
        if line.startswith(f"{key}="):
            lines[index] = f"{key}={value}"
            updated = True
            break

    if not updated:
        lines.append(f"{key}={value}")

    env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _exchange_zerodha_request_token(request_token: str, save_to_env: bool) -> dict:
    settings = get_settings()

    if not settings.zerodha_api_key or not settings.zerodha_api_secret:
        raise ValueError("ZERODHA_API_KEY and ZERODHA_API_SECRET must be set before exchanging a request token.")

    try:
        from kiteconnect import KiteConnect
    except ImportError as exc:  # pragma: no cover - dependency is optional
        raise RuntimeError("kiteconnect is not installed. Run `pip install -r requirements.txt`.") from exc

    kite = KiteConnect(api_key=settings.zerodha_api_key)
    session = kite.generate_session(request_token, api_secret=settings.zerodha_api_secret)
    access_token = session["access_token"]
    os.environ["ZERODHA_ACCESS_TOKEN"] = access_token

    if save_to_env:
        _update_env_value(Path(".env"), "ZERODHA_ACCESS_TOKEN", access_token)

    session_payload = {
        "updatedAt": datetime.now(settings.timezone).isoformat(),
        "requestToken": request_token,
        "accessTokenSavedToEnv": save_to_env,
        "userId": session.get("user_id"),
        "userName": session.get("user_name"),
        "email": session.get("email"),
        "broker": "zerodha",
        "redirectUrl": settings.zerodha_redirect_url,
        "apiKeyConfigured": bool(settings.zerodha_api_key),
        "accessTokenConfigured": True,
    }
    state_store = build_state_store(settings)
    try:
        state_store.record_zerodha_session(session_payload)
    finally:
        state_store.close()

    return {
        "status": "ok",
        "message": "Zerodha access token generated successfully.",
        "accessTokenSavedToEnv": save_to_env,
        "userId": session.get("user_id"),
        "userName": session.get("user_name"),
        "email": session.get("email"),
        "loginTime": session.get("login_time"),
    }


def _csv_value(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return value


def _write_backtest_csv(result: dict[str, Any], timezone) -> Path:
    trades = result.get("trades") or []
    if not isinstance(trades, list) or not trades:
        raise ValueError("No backtest trades are available to export.")

    data = result.get("data") if isinstance(result.get("data"), dict) else {}
    summary = result.get("summary") if isinstance(result.get("summary"), dict) else {}
    request = result.get("request") if isinstance(result.get("request"), dict) else {}

    export_dir = Path("exports/backtests")
    export_dir.mkdir(parents=True, exist_ok=True)
    generated_at = datetime.now(timezone)
    instrument = str(data.get("instrument") or request.get("instrument") or "BACKTEST").upper()
    path = export_dir / f"{generated_at.strftime('%Y%m%d_%H%M%S')}_{instrument}_backtest.csv"

    fieldnames = [
        "exportedAt",
        "instrument",
        "symbol",
        "signalMode",
        "pricingModel",
        "signalDataSource",
        "executionDataSource",
        "startDate",
        "endDate",
        "balance",
        "targetPct",
        "stopLossPct",
        "stopLossMode",
        "capStopLoss",
        "entryTiming",
        "entryWindow",
        "exitWindow",
        "summaryNetPnl",
        "summaryTrades",
        "summaryWins",
        "summaryLosses",
        "summaryWinRate",
        "signal",
        "candleTime",
        "entryTime",
        "exitTime",
        "strike",
        "optionType",
        "optionSymbol",
        "quantity",
        "marketEntry",
        "execEntry",
        "marketExit",
        "execExit",
        "stopLoss",
        "stopLossSource",
        "target",
        "capitalUsed",
        "grossPnl",
        "charges",
        "netPnl",
        "status",
        "exitReason",
        "executionSource",
    ]

    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for trade in trades:
            if not isinstance(trade, dict):
                continue
            writer.writerow(
                {
                    "exportedAt": generated_at.isoformat(),
                    "instrument": data.get("instrument") or trade.get("instrument"),
                    "symbol": data.get("symbol"),
                    "signalMode": data.get("signalMode") or trade.get("signalMode"),
                    "pricingModel": data.get("pricingModel"),
                    "signalDataSource": data.get("signalDataSource"),
                    "executionDataSource": data.get("executionDataSource"),
                    "startDate": request.get("start_date"),
                    "endDate": request.get("end_date"),
                    "balance": request.get("balance"),
                    "targetPct": request.get("target_pct"),
                    "stopLossPct": request.get("stop_loss_pct"),
                    "stopLossMode": request.get("stop_loss_mode") or trade.get("stopLossMode"),
                    "capStopLoss": request.get("cap_stop_loss"),
                    "entryTiming": request.get("entry_timing") or trade.get("entryTiming"),
                    "entryWindow": request.get("entry_time"),
                    "exitWindow": request.get("exit_time"),
                    "summaryNetPnl": summary.get("netPnl"),
                    "summaryTrades": summary.get("tradeCount"),
                    "summaryWins": summary.get("wins"),
                    "summaryLosses": summary.get("losses"),
                    "summaryWinRate": summary.get("winRate"),
                    "signal": trade.get("signal"),
                    "candleTime": trade.get("candleTime"),
                    "entryTime": trade.get("entryTime"),
                    "exitTime": trade.get("exitTime"),
                    "strike": trade.get("strike"),
                    "optionType": trade.get("optionType"),
                    "optionSymbol": trade.get("optionSymbol"),
                    "quantity": trade.get("quantity"),
                    "marketEntry": trade.get("baseEntryPrice"),
                    "execEntry": trade.get("entryPrice"),
                    "marketExit": trade.get("baseExitPrice"),
                    "execExit": trade.get("exitPrice"),
                    "stopLoss": trade.get("stopLoss"),
                    "stopLossSource": trade.get("stopLossSource"),
                    "target": trade.get("target"),
                    "capitalUsed": trade.get("capitalUsed"),
                    "grossPnl": trade.get("grossPnl"),
                    "charges": _csv_value(trade.get("charges")),
                    "netPnl": trade.get("netPnl"),
                    "status": trade.get("status"),
                    "exitReason": trade.get("exitReason"),
                    "executionSource": trade.get("executionSource"),
                }
            )

    return path


def _write_option_backtest_report_csv(result: dict[str, Any], timezone) -> Path:
    trades = result.get("trades") or []
    if not isinstance(trades, list):
        trades = []

    data = result.get("data") if isinstance(result.get("data"), dict) else {}
    summary = result.get("summary") if isinstance(result.get("summary"), dict) else {}
    request = result.get("request") if isinstance(result.get("request"), dict) else {}
    generated_at = datetime.now(timezone)
    export_dir = Path("exports/backtests")
    export_dir.mkdir(parents=True, exist_ok=True)
    symbol = str(data.get("symbol") or "OPTION").replace(" ", "_").replace("/", "-")
    path = export_dir / f"{generated_at.strftime('%Y%m%d_%H%M%S')}_{symbol}_option_report.csv"

    option_rows = {
        "CE": {"trades": 0, "pnl": 0.0},
        "PE": {"trades": 0, "pnl": 0.0},
    }
    for trade in trades:
        if not isinstance(trade, dict):
            continue
        option_type = str(trade.get("optionType") or "").upper()
        if option_type not in option_rows:
            continue
        option_rows[option_type]["trades"] += 1
        option_rows[option_type]["pnl"] += float(trade.get("netPnl") or 0.0)

    row = {
        "exportedAt": generated_at.isoformat(),
        "startDate": request.get("start_date"),
        "endDate": request.get("end_date"),
        "contracts": " / ".join(data.get("contracts") or []),
        "exchange": request.get("exchange"),
        "interval": data.get("signalInterval") or data.get("interval"),
        "signalMode": data.get("signalMode"),
        "entrySignal": request.get("entry_signal"),
        "totalTrades": summary.get("tradeCount"),
        "totalPnl": summary.get("netPnl"),
        "ceTrades": option_rows["CE"]["trades"],
        "peTrades": option_rows["PE"]["trades"],
        "cePnl": round(option_rows["CE"]["pnl"], 2),
        "pePnl": round(option_rows["PE"]["pnl"], 2),
    }

    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(row.keys()))
        writer.writeheader()
        writer.writerow(row)

    return path


def _trade_matches_strategy_key(trade: dict, strategy_key: str | None) -> bool:
    if not strategy_key:
        return True
    trade_strategy_key = trade.get("strategy_key") or trade.get("strategyKey")
    if trade_strategy_key:
        return trade_strategy_key == strategy_key
    if strategy_key == OPTION_CONTRACT_STRATEGY_KEY:
        return str(trade.get("strategy_mode") or trade.get("strategyMode") or "").lower() == "option_contracts"
    return False


def _build_paper_dashboard_payload(settings, paper_state: dict, strategy_key: str | None = None) -> dict:
    now = datetime.now(settings.timezone)
    active_trade = paper_state.get("active_trade")
    raw_active_trades = paper_state.get("active_trades")
    if isinstance(raw_active_trades, list):
        active_trades = [trade for trade in raw_active_trades if isinstance(trade, dict)]
    else:
        active_trades = [active_trade] if active_trade else []
    active_trade_unrealized_pnl = 0.0
    price_provider = OptionPriceProvider(settings)

    try:
        enriched_active_trades = []
        for trade in active_trades:
            enriched_trade = _with_computed_target(settings, trade)
            try:
                live_option_price, live_price_source = price_provider.quote_trade(enriched_trade, prefer_stream=False)
                short_trade = str(enriched_trade.get("signal") or "").upper() == "SELL"
                unrealized_pnl = round(
                    (
                        (float(enriched_trade["entry_price"]) - live_option_price)
                        if short_trade
                        else (live_option_price - float(enriched_trade["entry_price"]))
                    )
                    * int(enriched_trade["quantity"]),
                    2,
                )
                enriched_trade = {
                    **enriched_trade,
                    "livePrice": round(live_option_price, 2),
                    "unrealizedPnl": unrealized_pnl,
                    "livePriceSource": live_price_source,
                }
            except Exception:
                unrealized_pnl = 0.0
                enriched_trade = {
                    **enriched_trade,
                    "livePrice": None,
                    "unrealizedPnl": None,
                    "livePriceSource": None,
                }
            active_trade_unrealized_pnl += unrealized_pnl
            enriched_active_trades.append(enriched_trade)
        active_trades = enriched_active_trades
        active_trade = active_trades[0] if active_trades else None
    finally:
        price_provider.close()

    trade_history = _load_paper_trade_history(settings, strategy_key=strategy_key)
    summary_by_range = _build_paper_summary_by_range(
        settings,
        paper_state,
        active_trade_unrealized_pnl,
        trade_history,
    )
    today_summary = summary_by_range.get(
        "today",
        {
            "runningPnl": active_trade_unrealized_pnl,
            "realizedPnl": 0.0,
            "tradeCount": 0,
            "winCount": 0,
            "lossCount": 0,
        },
    )
    daily_realized_pnl = round(float(today_summary.get("realizedPnl", 0.0)), 2)
    schedule_status = _paper_schedule_status(
        now,
        settings.schedule_start,
        settings.schedule_end,
        force_weekend_runs=settings.force_weekend_runs,
    )
    if paper_state.get("day_stopped"):
        schedule_status = {
            "dayStopped": True,
            "dayStopReason": paper_state.get("day_stop_reason") or "Trading stopped for the day.",
        }

    return {
        "runningPnl": round(daily_realized_pnl + active_trade_unrealized_pnl, 2),
        "realizedPnl": daily_realized_pnl,
        "capitalBase": round(float(settings.paper_trade_capital), 2),
        "startingBalance": round(float(paper_state.get("starting_balance") or settings.paper_trade_capital), 2),
        "cashBalance": round(float(paper_state.get("cash_balance") or settings.paper_trade_capital), 2),
        "balanceAdjustments": paper_state.get("balance_adjustments", []),
        "activeTrade": active_trade,
        "activeTrades": active_trades,
        "tradeHistory": trade_history,
        "summaryByRange": summary_by_range,
        "dailySummary": {
            "tradeDate": paper_state.get("trade_date"),
            "tradeCount": int(today_summary.get("tradeCount", 0)),
            "winCount": int(today_summary.get("winCount", 0)),
            "lossCount": int(today_summary.get("lossCount", 0)),
            "consecutiveLosses": int(paper_state.get("consecutive_losses", 0)),
            "dayStopped": schedule_status["dayStopped"],
            "dayStopReason": schedule_status["dayStopReason"],
        },
        "historyCount": len(trade_history),
    }


def _with_computed_target(settings, trade: dict) -> dict:
    if not isinstance(trade, dict):
        return trade
    updated_trade = dict(trade)

    try:
        entry_price = float(updated_trade.get("entry_price"))
    except (TypeError, ValueError):
        return updated_trade

    if updated_trade.get("target_price") is None:
        short_trade = str(updated_trade.get("signal") or "").upper() == "SELL"
        target_pct = (
            float(settings.option_contract_target_pct)
            if updated_trade.get("strategy_mode") == "option_contracts"
            else float(settings.paper_trade_target_pct)
        )
        target_multiplier = 1 - target_pct / 100.0 if short_trade else 1 + target_pct / 100.0
        updated_trade["target_price"] = round(
            entry_price * target_multiplier,
            2,
        )
        updated_trade["target_source"] = "computed_from_env"
        updated_trade["target_pct"] = target_pct

    if updated_trade.get("strategy_mode") == "option_contracts":
        try:
            stop_loss_price = float(updated_trade.get("stop_loss_price"))
        except (TypeError, ValueError):
            return updated_trade

        if (
            updated_trade.get("manual_stop_loss") is True
            or str(updated_trade.get("stop_loss_source") or "").startswith("manual")
        ):
            updated_trade["stop_loss_pct"] = round(
                (abs(entry_price - stop_loss_price) / entry_price) * 100.0,
                2,
            )
            return updated_trade

        stop_loss_pct = abs(entry_price - stop_loss_price) / entry_price * 100.0
        if stop_loss_pct > float(settings.paper_trade_max_sl_pct):
            updated_trade["stop_loss_reference"] = stop_loss_price
            short_trade = str(updated_trade.get("signal") or "").upper() == "SELL"
            stop_multiplier = 1 + float(settings.paper_trade_max_sl_pct) / 100.0 if short_trade else 1 - float(settings.paper_trade_max_sl_pct) / 100.0
            updated_trade["stop_loss_price"] = round(
                entry_price * stop_multiplier,
                2,
            )
            updated_trade["stop_loss_pct"] = round(float(settings.paper_trade_max_sl_pct), 2)
            updated_trade["stop_loss_source"] = (
                f"{updated_trade.get('stop_loss_source') or 'entry_signal_option_candle_low'}"
                f"_capped_{settings.paper_trade_max_sl_pct:g}pct"
            )

    return updated_trade


def _paper_schedule_status(
    now: datetime,
    schedule_start: str,
    schedule_end: str,
    *,
    force_weekend_runs: bool = False,
) -> dict[str, str | bool]:
    if not force_weekend_runs and now.weekday() not in WEEKDAYS:
        return {
            "dayStopped": True,
            "dayStopReason": "Outside trading days.",
        }

    start_time = parse_hhmm(schedule_start)
    end_time = parse_hhmm(schedule_end)
    current_time = now.timetz().replace(tzinfo=None)

    if current_time < start_time:
        return {
            "dayStopped": True,
            "dayStopReason": f"Trading starts at {schedule_start} IST.",
        }

    if current_time > end_time:
        return {
            "dayStopped": True,
            "dayStopReason": f"Trading closed at {schedule_end} IST.",
        }

    return {
        "dayStopped": False,
        "dayStopReason": "Within trading window.",
    }


def _build_paper_summary_by_range(
    settings,
    paper_state: dict,
    active_trade_unrealized_pnl: float,
    trades: list[dict] | None = None,
) -> dict[str, dict]:
    now = datetime.now(settings.timezone)
    start_of_today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    start_of_week = start_of_today - timedelta(days=start_of_today.weekday())
    start_of_month = start_of_today.replace(day=1)
    active_trade = paper_state.get("active_trade")

    if trades is None:
        trades = _load_paper_trade_history(settings)

    ranges = {
        "today": start_of_today,
        "week": start_of_week,
        "month": start_of_month,
        "total": None,
    }

    summaries: dict[str, dict] = {}
    for key, start_at in ranges.items():
        filtered = []
        for trade in trades:
            exit_dt = _parse_dashboard_datetime(trade.get("exit_time"), settings.timezone)
            if exit_dt is None:
                continue
            if start_at is not None and exit_dt < start_at:
                continue
            filtered.append(trade)

        realized_pnl = round(sum(float(trade.get("net_pnl") or 0.0) for trade in filtered), 2)
        trade_count = len(filtered)
        win_count = sum(1 for trade in filtered if str(trade.get("status", "")).upper() == "WIN")
        loss_count = sum(1 for trade in filtered if str(trade.get("status", "")).upper() == "LOSS")

        unrealized_pnl = 0.0
        if active_trade and active_trade.get("entry_time"):
            entry_dt = _parse_dashboard_datetime(active_trade.get("entry_time"), settings.timezone)
            if entry_dt is not None and (start_at is None or entry_dt >= start_at):
                unrealized_pnl = round(active_trade_unrealized_pnl, 2)

        summaries[key] = {
            "runningPnl": round(realized_pnl + unrealized_pnl, 2),
            "realizedPnl": realized_pnl,
            "unrealizedPnl": unrealized_pnl,
            "tradeCount": trade_count,
            "winCount": win_count,
            "lossCount": loss_count,
        }

    return summaries


def _load_paper_trade_history(settings, strategy_key: str | None = None) -> list[dict]:
    repository = PaperTradeRepository(
        settings.mongodb_uri,
        settings.mongodb_database,
        settings.mongodb_paper_trades_collection,
    )
    try:
        trades = repository.list_trades()
        return [trade for trade in trades if _trade_matches_strategy_key(trade, strategy_key)]
    finally:
        repository.close()


def _parse_dashboard_datetime(value, timezone) -> datetime | None:
    if not value:
        return None

    try:
        parsed = datetime.fromisoformat(str(value))
    except ValueError:
        return None

    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone)

    return parsed.astimezone(timezone)


def _is_sample_alert(alert: dict) -> bool:
    if not isinstance(alert, dict):
        return False
    if alert.get("isSample") is True:
        return True
    return (
        round(float(alert.get("close", 0.0)), 2) == 24330.90
        and round(float(alert.get("st_10_1", 0.0)), 2) == 24312.45
        and round(float(alert.get("st_10_3", 0.0)), 2) == 24288.10
    )


def _filtered_recent_alerts(alerts: list[dict]) -> list[dict]:
    if not isinstance(alerts, list):
        return []
    return [alert for alert in alerts if not _is_sample_alert(alert)]


def _load_market_quotes(settings) -> list[dict]:
    price_provider = OptionPriceProvider(settings)
    try:
        return price_provider.index_quotes()
    finally:
        price_provider.close()


def _load_zerodha_health(settings) -> dict:
    price_provider = OptionPriceProvider(settings)
    try:
        return price_provider.health_check()
    finally:
        price_provider.close()


def _to_optional_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return None


def _live_balance_summary(margins: dict[str, Any]) -> dict[str, float | None]:
    equity = margins.get("equity") if isinstance(margins, dict) else {}
    if not isinstance(equity, dict):
        equity = {}
    available = equity.get("available") if isinstance(equity.get("available"), dict) else {}
    utilised = equity.get("utilised") if isinstance(equity.get("utilised"), dict) else {}
    return {
        "net": _to_optional_float(equity.get("net")),
        "cash": _to_optional_float(available.get("cash")),
        "liveBalance": _to_optional_float(available.get("live_balance")),
        "openingBalance": _to_optional_float(available.get("opening_balance")),
        "collateral": _to_optional_float(available.get("collateral")),
        "utilisedDebits": _to_optional_float(utilised.get("debits")),
        "span": _to_optional_float(utilised.get("span")),
        "exposure": _to_optional_float(utilised.get("exposure")),
    }


def _clear_live_trading_cache() -> None:
    _LIVE_TRADING_SNAPSHOT_CACHE["expires_at"] = None
    _LIVE_TRADING_SNAPSHOT_CACHE["payload"] = None


def _load_live_trading_payload(settings, *, force_refresh: bool = False) -> dict:
    state_store = build_state_store(settings)
    broker = LiveTradingBroker(settings, state_store)
    try:
        status = broker.status()
        payload = {
            "status": status,
            "orders": [],
            "trades": [],
            "positions": {},
            "margins": {},
            "balance": {},
            "error": None,
        }
        if status["zerodhaReady"]:
            now = datetime.now(settings.timezone)
            cached_until = _LIVE_TRADING_SNAPSHOT_CACHE.get("expires_at")
            cached_payload = _LIVE_TRADING_SNAPSHOT_CACHE.get("payload")
            if (
                not force_refresh
                and cached_until is not None
                and cached_until > now
                and isinstance(cached_payload, dict)
            ):
                cached_payload = dict(cached_payload)
                cached_payload["status"] = status
                return cached_payload
            try:
                payload.update(
                    {
                        "orders": broker.orderbook(),
                        "trades": broker.trades(),
                        "positions": broker.positions(),
                        "margins": broker.margins(),
                    }
                )
                payload["balance"] = _live_balance_summary(payload["margins"])
                _LIVE_TRADING_SNAPSHOT_CACHE["expires_at"] = now + timedelta(
                    seconds=_LIVE_TRADING_SNAPSHOT_TTL_SECONDS
                )
                _LIVE_TRADING_SNAPSHOT_CACHE["payload"] = dict(payload)
            except Exception as exc:
                payload["error"] = str(exc)
        return payload
    finally:
        broker.close()
        state_store.close()


def _live_broker() -> tuple[LiveTradingBroker, Any]:
    settings = get_settings()
    state_store = build_state_store(settings)
    return LiveTradingBroker(settings, state_store), state_store


def _raise_live_error(exc: Exception) -> None:
    raise HTTPException(status_code=400, detail=str(exc))


def _combine_paper_states(paper_states: dict[str, dict]) -> dict:
    combined: dict[str, Any] = {
        "trade_date": None,
        "active_trade": None,
        "active_trades": [],
        "last_signal_key": None,
        "daily_realized_pnl": 0.0,
        "daily_trade_count": 0,
        "daily_win_count": 0,
        "daily_loss_count": 0,
        "consecutive_losses": 0,
        "day_stopped": False,
        "day_stop_reason": None,
        "trade_history": [],
        "cash_balance": None,
        "starting_balance": None,
        "balance_adjustments": [],
    }
    for strategy_key, paper_state in paper_states.items():
        if not isinstance(paper_state, dict):
            continue

        active_trade = paper_state.get("active_trade")
        if active_trade:
            active_with_strategy = {
                **active_trade,
                "strategy_key": strategy_key,
            }
            combined["active_trades"].append(active_with_strategy)
            if combined["active_trade"] is None:
                combined["active_trade"] = active_with_strategy

        for numeric_key in (
            "daily_realized_pnl",
            "daily_trade_count",
            "daily_win_count",
            "daily_loss_count",
            "consecutive_losses",
        ):
            combined[numeric_key] += paper_state.get(numeric_key, 0) or 0

        if paper_state.get("trade_date"):
            combined["trade_date"] = paper_state.get("trade_date")
        if paper_state.get("last_signal_key"):
            combined["last_signal_key"] = paper_state.get("last_signal_key")
        active_strategy_mode = (
            paper_state.get("active_trade", {}).get("strategy_mode")
            if isinstance(paper_state.get("active_trade"), dict)
            else None
        )
        if strategy_key == "option_contracts_1m" or active_strategy_mode == "option_contracts":
            combined["cash_balance"] = paper_state.get("cash_balance")
            combined["starting_balance"] = paper_state.get("starting_balance")
            combined["balance_adjustments"] = paper_state.get("balance_adjustments", [])

    return combined


def _strategy_setup_payload(
    *,
    strategy_key: str,
    label: str,
    trade_date: str,
    daily_setup: dict | None,
    settings,
    schedule_start: str,
    schedule_end: str,
    target_pct: float,
    include_env_contracts: bool,
) -> dict:
    daily_setup = daily_setup or {}
    payload = {
        "strategyKey": strategy_key,
        "label": label,
        "date": trade_date,
        "scheduleStart": schedule_start,
        "scheduleEnd": schedule_end,
        "contractMode": daily_setup.get("contract_mode") or "dynamic",
        "targetPct": daily_setup.get("target_pct") or target_pct,
        "entrySignal": daily_setup.get("entry_signal") or settings.option_contract_entry_signal,
        "maxSignalCandlePct": daily_setup.get("max_signal_candle_pct")
        or settings.option_contract_max_signal_candle_pct,
        "minSignalCandlePct": daily_setup.get("min_signal_candle_pct")
        if daily_setup.get("min_signal_candle_pct") is not None
        else settings.option_contract_min_signal_candle_pct,
        "strikeOffset": daily_setup.get("strike_offset")
        if daily_setup.get("strike_offset") is not None
        else settings.option_contract_strike_offset,
        "stopLossMode": daily_setup.get("stop_loss_mode") or settings.option_contract_stop_loss_mode,
        "stopLossPct": daily_setup.get("stop_loss_pct") or settings.option_contract_stop_loss_pct,
        "startingBalance": daily_setup.get("starting_balance") or settings.paper_trade_capital,
        "dailyContracts": daily_setup or None,
        "nextExpiry": _load_next_option_expiry(settings),
        "effectiveContracts": {
            "contract1": daily_setup.get("contract_1") or "",
            "contract2": daily_setup.get("contract_2") or "",
        },
        "usesDailySetup": bool(daily_setup),
    }
    if include_env_contracts:
        payload["envContracts"] = {
            "contract1": settings.option_contract_1,
            "contract2": settings.option_contract_2,
        }
        payload["effectiveContracts"] = {
            "contract1": daily_setup.get("contract_1") or settings.option_contract_1,
            "contract2": daily_setup.get("contract_2") or settings.option_contract_2,
        }
    return payload


def _parse_option_expiry(value: Any):
    if value is None:
        return None
    if hasattr(value, "date"):
        return value.date() if hasattr(value, "hour") else value
    try:
        return datetime.fromisoformat(str(value)).date()
    except ValueError:
        return None


def _load_next_option_expiry(settings) -> dict | None:
    cache_key = f"{settings.zerodha_option_exchange}:{settings.zerodha_underlying}".upper()
    now = datetime.now(settings.timezone)
    cached_items = _OPTION_EXPIRY_CACHE.get("items") or {}
    if (
        _OPTION_EXPIRY_CACHE.get("expires_at")
        and _OPTION_EXPIRY_CACHE["expires_at"] > now
        and cache_key in cached_items
    ):
        return cached_items[cache_key]

    try:
        rows = OptionPriceProvider(settings)._load_option_instruments(
            settings.zerodha_option_exchange,
        )
    except Exception:
        return None

    today = now.date()
    expiries = []
    for row in rows:
        if str(row.get("name", "")).upper() != settings.zerodha_underlying.upper():
            continue
        if str(row.get("instrument_type", "")).upper() not in {"CE", "PE"}:
            continue
        expiry = _parse_option_expiry(row.get("expiry"))
        if expiry is not None and expiry >= today:
            expiries.append(expiry)

    if not expiries:
        payload = None
    else:
        next_expiry = min(expiries)
        payload = {
            "date": next_expiry.isoformat(),
            "label": next_expiry.strftime("%d %b %Y"),
        }

    cached_items[cache_key] = payload
    _OPTION_EXPIRY_CACHE["items"] = cached_items
    _OPTION_EXPIRY_CACHE["expires_at"] = now + timedelta(seconds=_OPTION_EXPIRY_CACHE_TTL_SECONDS)
    return payload


def _load_dashboard_payload() -> dict:
    settings = get_settings()
    nifty_settings = option_strategy_settings_for_key(settings, OPTION_CONTRACT_STRATEGY_KEY)
    sensex_settings = option_strategy_settings_for_key(settings, SENSEX_OPTION_CONTRACT_STRATEGY_KEY)
    nifty_five_minute_settings = option_strategy_settings_for_key(settings, NIFTY_OPTION_CONTRACT_5M_STRATEGY_KEY)
    sensex_five_minute_settings = option_strategy_settings_for_key(settings, SENSEX_OPTION_CONTRACT_5M_STRATEGY_KEY)
    state_store = build_state_store(settings)
    try:
        state = state_store.load_state()
        paper_state = state_store.load_paper_trading(OPTION_CONTRACT_STRATEGY_KEY)
        sensex_paper_state = state_store.load_paper_trading(SENSEX_OPTION_CONTRACT_STRATEGY_KEY)
        nifty_five_minute_paper_state = state_store.load_paper_trading(NIFTY_OPTION_CONTRACT_5M_STRATEGY_KEY)
        sensex_five_minute_paper_state = state_store.load_paper_trading(SENSEX_OPTION_CONTRACT_5M_STRATEGY_KEY)
        trade_date = datetime.now(settings.timezone).date().isoformat()
        nifty_daily_contracts = state_store.load_daily_option_contracts(
            trade_date,
            OPTION_CONTRACT_STRATEGY_KEY,
        ) or state_store.load_daily_option_contracts(trade_date)
        sensex_daily_contracts = state_store.load_daily_option_contracts(
            trade_date,
            SENSEX_OPTION_CONTRACT_STRATEGY_KEY,
        )
        nifty_five_minute_daily_contracts = state_store.load_daily_option_contracts(
            trade_date,
            NIFTY_OPTION_CONTRACT_5M_STRATEGY_KEY,
        )
        sensex_five_minute_daily_contracts = state_store.load_daily_option_contracts(
            trade_date,
            SENSEX_OPTION_CONTRACT_5M_STRATEGY_KEY,
        )
        recent_alerts = _filtered_recent_alerts(state_store.list_recent_alerts())
    finally:
        state_store.close()
    now = datetime.now(settings.timezone)
    trade_date = now.date().isoformat()
    daily_contracts = nifty_daily_contracts
    option_schedule_start = (nifty_daily_contracts or {}).get("schedule_start") or settings.schedule_start
    option_schedule_end = (nifty_daily_contracts or {}).get("schedule_end") or settings.schedule_end
    next_run = next_run_at(
        now,
        option_schedule_start,
        option_schedule_end,
        settings.schedule_interval_minutes,
        settings.schedule_buffer_seconds,
        include_weekends=settings.force_weekend_runs,
    )

    return {
        "generatedAt": now.isoformat(),
        "symbol": settings.symbol,
        "interval": settings.interval,
        "schedule": {
            "timezone": settings.timezone_name,
            "start": (daily_contracts or {}).get("schedule_start") or settings.schedule_start,
            "end": (daily_contracts or {}).get("schedule_end") or settings.schedule_end,
            "intervalMinutes": settings.schedule_interval_minutes,
            "bufferSeconds": settings.schedule_buffer_seconds,
            "forceWeekendRuns": settings.force_weekend_runs,
            "nextRunAt": next_run.isoformat(),
        },
        "strategyConfig": {
            "mode": settings.strategy_mode,
            "date": trade_date,
            "optionInterval": settings.option_contract_interval,
            "optionTargetPct": (daily_contracts or {}).get("target_pct") or settings.option_contract_target_pct,
            "entrySignal": "BUY",
            "maxSignalCandlePct": (daily_contracts or {}).get("max_signal_candle_pct") or settings.option_contract_max_signal_candle_pct,
            "minSignalCandlePct": (daily_contracts or {}).get("min_signal_candle_pct")
            if (daily_contracts or {}).get("min_signal_candle_pct") is not None
            else settings.option_contract_min_signal_candle_pct,
            "stopLossMode": (daily_contracts or {}).get("stop_loss_mode") or settings.option_contract_stop_loss_mode,
            "stopLossPct": (daily_contracts or {}).get("stop_loss_pct") or settings.option_contract_stop_loss_pct,
            "envContracts": {
                "contract1": settings.option_contract_1,
                "contract2": settings.option_contract_2,
            },
            "dailyContracts": daily_contracts,
            "effectiveContracts": {
                "contract1": (daily_contracts or {}).get("contract_1") or settings.option_contract_1,
                "contract2": (daily_contracts or {}).get("contract_2") or settings.option_contract_2,
            },
            "usesDailyContracts": bool(daily_contracts),
            "strategySetups": {
                OPTION_CONTRACT_STRATEGY_KEY: _strategy_setup_payload(
                    strategy_key=OPTION_CONTRACT_STRATEGY_KEY,
                    label="NIFTY 1m option bot",
                    trade_date=trade_date,
                    daily_setup=nifty_daily_contracts,
                    settings=nifty_settings,
                    schedule_start=option_schedule_start,
                    schedule_end=option_schedule_end,
                    target_pct=nifty_settings.option_contract_target_pct,
                    include_env_contracts=True,
                ),
                SENSEX_OPTION_CONTRACT_STRATEGY_KEY: _strategy_setup_payload(
                    strategy_key=SENSEX_OPTION_CONTRACT_STRATEGY_KEY,
                    label="SENSEX 1m option bot",
                    trade_date=trade_date,
                    daily_setup=sensex_daily_contracts,
                    settings=sensex_settings,
                    schedule_start=(sensex_daily_contracts or {}).get("schedule_start") or sensex_settings.schedule_start,
                    schedule_end=(sensex_daily_contracts or {}).get("schedule_end") or sensex_settings.schedule_end,
                    target_pct=sensex_settings.option_contract_target_pct,
                    include_env_contracts=True,
                ),
                NIFTY_OPTION_CONTRACT_5M_STRATEGY_KEY: _strategy_setup_payload(
                    strategy_key=NIFTY_OPTION_CONTRACT_5M_STRATEGY_KEY,
                    label="NIFTY 5m option bot",
                    trade_date=trade_date,
                    daily_setup=nifty_five_minute_daily_contracts,
                    settings=nifty_five_minute_settings,
                    schedule_start=(nifty_five_minute_daily_contracts or {}).get("schedule_start") or nifty_five_minute_settings.schedule_start,
                    schedule_end=(nifty_five_minute_daily_contracts or {}).get("schedule_end") or nifty_five_minute_settings.schedule_end,
                    target_pct=nifty_five_minute_settings.option_contract_target_pct,
                    include_env_contracts=True,
                ),
                SENSEX_OPTION_CONTRACT_5M_STRATEGY_KEY: _strategy_setup_payload(
                    strategy_key=SENSEX_OPTION_CONTRACT_5M_STRATEGY_KEY,
                    label="SENSEX 5m option bot",
                    trade_date=trade_date,
                    daily_setup=sensex_five_minute_daily_contracts,
                    settings=sensex_five_minute_settings,
                    schedule_start=(sensex_five_minute_daily_contracts or {}).get("schedule_start") or sensex_five_minute_settings.schedule_start,
                    schedule_end=(sensex_five_minute_daily_contracts or {}).get("schedule_end") or sensex_five_minute_settings.schedule_end,
                    target_pct=sensex_five_minute_settings.option_contract_target_pct,
                    include_env_contracts=True,
                ),
            },
        },
        "status": {
            "lastRunAt": state.get("last_run_at"),
            "lastRunStatus": state.get("last_run_status"),
            "lastRunMessage": state.get("last_run_message"),
            "lastTelegramDelivery": state.get("last_telegram_delivery"),
        },
        "zerodha": {
            "apiKeyConfigured": bool(settings.zerodha_api_key),
            "apiSecretConfigured": bool(settings.zerodha_api_secret),
            "accessTokenConfigured": bool(
                settings.zerodha_access_token or (state.get("zerodha_session") or {}).get("accessTokenConfigured")
            ),
            "redirectUrl": settings.zerodha_redirect_url,
            "session": state.get("zerodha_session"),
            "loginUrl": _kite_login_url(settings.zerodha_api_key, settings.zerodha_redirect_url)
            if settings.zerodha_api_key
            else None,
            "health": _load_zerodha_health(settings),
        },
        "liveTrading": _load_live_trading_payload(settings),
        "marketQuotes": _load_market_quotes(settings),
        "latestAlert": recent_alerts[0] if recent_alerts else None,
        "recentAlerts": recent_alerts,
        "paperTrading": _build_paper_dashboard_payload(nifty_settings, paper_state, OPTION_CONTRACT_STRATEGY_KEY),
        "paperTradingByStrategy": {
            OPTION_CONTRACT_STRATEGY_KEY: _build_paper_dashboard_payload(
                nifty_settings,
                paper_state,
                OPTION_CONTRACT_STRATEGY_KEY,
            ),
            SENSEX_OPTION_CONTRACT_STRATEGY_KEY: _build_paper_dashboard_payload(
                sensex_settings,
                sensex_paper_state,
                SENSEX_OPTION_CONTRACT_STRATEGY_KEY,
            ),
            NIFTY_OPTION_CONTRACT_5M_STRATEGY_KEY: _build_paper_dashboard_payload(
                nifty_five_minute_settings,
                nifty_five_minute_paper_state,
                NIFTY_OPTION_CONTRACT_5M_STRATEGY_KEY,
            ),
            SENSEX_OPTION_CONTRACT_5M_STRATEGY_KEY: _build_paper_dashboard_payload(
                sensex_five_minute_settings,
                sensex_five_minute_paper_state,
                SENSEX_OPTION_CONTRACT_5M_STRATEGY_KEY,
            ),
        },
    }


def _load_logs_payload(date: str) -> dict:
    settings = get_settings()
    structured_path = Path(settings.run_logs_dir) / f"{date}.jsonl"

    logs = []
    source = "none"

    if structured_path.exists():
        store = RunLogStore(
            settings.run_logs_dir,
        )
        logs = store.load_logs(date)
        source = "structured"
    else:
        logs = parse_text_logs(settings.log_file, date)
        if logs:
            source = "text_log"
        else:
            store = RunLogStore(
                settings.run_logs_dir,
            )
            logs = store.load_logs(date)
            source = "structured" if logs else "none"

    return {
        "date": date,
        "source": source,
        "logs": logs,
    }


@app.get("/api/dashboard")
def dashboard_data() -> dict:
    return _load_dashboard_payload()


@app.get("/api/market-quotes")
def market_quotes_data() -> dict:
    settings = get_settings()
    return {
        "generatedAt": datetime.now(settings.timezone).isoformat(),
        "marketQuotes": _load_market_quotes(settings),
    }


@app.post("/api/strategy/contracts")
def save_strategy_contracts(payload: StrategyContractsRequest) -> dict:
    settings = get_settings()
    now = datetime.now(settings.timezone)
    contract_1 = payload.contract1.strip().upper().replace(" ", "")
    contract_2 = payload.contract2.strip().upper().replace(" ", "")

    if payload.strategyKey in {OPTION_CONTRACT_STRATEGY_KEY, SENSEX_OPTION_CONTRACT_STRATEGY_KEY} and not contract_1:
        raise HTTPException(status_code=400, detail="Contract 1 is required.")
    five_minute_strategy = payload.strategyKey in {
        NIFTY_OPTION_CONTRACT_5M_STRATEGY_KEY,
        SENSEX_OPTION_CONTRACT_5M_STRATEGY_KEY,
    }
    contract_mode = payload.contractMode or "dynamic"
    if payload.strategyKey in {
        OPTION_CONTRACT_STRATEGY_KEY,
        SENSEX_OPTION_CONTRACT_STRATEGY_KEY,
    } or (five_minute_strategy and contract_mode == "dynamic"):
        invalid_sides = [side for side in (contract_1, contract_2) if side and side not in {"CE", "PE"}]
        if invalid_sides:
            raise HTTPException(status_code=400, detail="Use only CE or PE in contract setup.")

    strategy_settings = option_strategy_settings_for_key(settings, payload.strategyKey)
    state_store = build_state_store(settings)
    try:
        saved = state_store.save_daily_option_contracts(
            now.date().isoformat(),
            contract_1,
            contract_2,
            now,
            {
                "schedule_start": payload.scheduleStart or settings.schedule_start,
                "schedule_end": payload.scheduleEnd or settings.schedule_end,
                "contract_mode": contract_mode,
                "starting_balance": payload.startingBalance or strategy_settings.paper_trade_capital,
                "target_pct": payload.targetPct or strategy_settings.option_contract_target_pct,
                "max_signal_candle_pct": payload.maxSignalCandlePct or strategy_settings.option_contract_max_signal_candle_pct,
                "min_signal_candle_pct": payload.minSignalCandlePct
                if payload.minSignalCandlePct is not None
                else strategy_settings.option_contract_min_signal_candle_pct,
                "strike_offset": payload.strikeOffset if payload.strikeOffset is not None else strategy_settings.option_contract_strike_offset,
                "entry_signal": payload.entrySignal or strategy_settings.option_contract_entry_signal,
                "stop_loss_mode": payload.stopLossMode or strategy_settings.option_contract_stop_loss_mode,
                "stop_loss_pct": payload.stopLossPct or strategy_settings.option_contract_stop_loss_pct,
                "exchange": strategy_settings.zerodha_option_exchange,
                "underlying": strategy_settings.zerodha_underlying,
                "lot_size": strategy_settings.paper_trade_lot_size,
            },
            strategy_key=payload.strategyKey,
        )
        paper_state = state_store.load_paper_trading(payload.strategyKey)
        if (
            paper_state.get("trade_date") != now.date().isoformat()
            or (
                not paper_state.get("active_trade")
                and int(paper_state.get("daily_trade_count", 0) or 0) == 0
            )
        ):
            current_cash_balance = paper_state.get("cash_balance")
            try:
                starting_balance = round(float(current_cash_balance), 2)
            except (TypeError, ValueError):
                starting_balance = round(float(payload.startingBalance or strategy_settings.paper_trade_capital), 2)
            paper_state["trade_date"] = now.date().isoformat()
            paper_state["starting_balance"] = starting_balance
            paper_state["cash_balance"] = starting_balance
            paper_state.setdefault("balance_adjustments", [])
            state_store.save_paper_trading(paper_state, payload.strategyKey)
    finally:
        state_store.close()

    return {
        "message": f"{strategy_settings.zerodha_underlying} {strategy_settings.option_contract_interval} setup saved for today's trading session.",
        "contracts": saved,
    }


def _option_strategy_state_key(settings) -> str | None:
    return OPTION_CONTRACT_STRATEGY_KEY


@app.post("/api/paper-balance/add")
def add_paper_balance(payload: AddPaperBalanceRequest) -> dict:
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than 0.")

    settings = get_settings()
    state_store = build_state_store(settings)
    now = datetime.now(settings.timezone)
    strategy_key = payload.strategyKey
    strategy_settings = option_strategy_settings_for_key(settings, strategy_key)
    try:
        paper_state = state_store.load_paper_trading(strategy_key)
        if paper_state.get("trade_date") != now.date().isoformat():
            current_cash_balance = paper_state.get("cash_balance")
            try:
                day_start_balance = round(float(current_cash_balance), 2)
            except (TypeError, ValueError):
                day_start_balance = round(float(strategy_settings.paper_trade_capital), 2)
            paper_state["trade_date"] = now.date().isoformat()
            paper_state["cash_balance"] = day_start_balance
            paper_state["starting_balance"] = day_start_balance
            paper_state.setdefault("balance_adjustments", [])

        current_balance = float(paper_state.get("cash_balance") or strategy_settings.paper_trade_capital)
        paper_state["cash_balance"] = round(current_balance + payload.amount, 2)
        paper_state["starting_balance"] = round(
            float(paper_state.get("starting_balance") or strategy_settings.paper_trade_capital) + payload.amount,
            2,
        )
        adjustments = paper_state.get("balance_adjustments")
        if not isinstance(adjustments, list):
            adjustments = []
        adjustments.insert(
            0,
            {
                "type": "deposit",
                "amount": round(payload.amount, 2),
                "timestamp": now.isoformat(),
                "balance_after": paper_state["cash_balance"],
            },
        )
        paper_state["balance_adjustments"] = adjustments[:50]
        state_store.save_paper_trading(paper_state, strategy_key)
    finally:
        state_store.close()

    return {
        "message": "Paper balance updated.",
        "cashBalance": paper_state["cash_balance"],
    }


@app.delete("/api/paper-trades/{trade_id}")
def delete_paper_trade(trade_id: str) -> dict:
    settings = get_settings()
    repository = PaperTradeRepository(
        settings.mongodb_uri,
        settings.mongodb_database,
        settings.mongodb_paper_trades_collection,
    )
    try:
        deleted = repository.soft_delete_trade(trade_id)
    finally:
        repository.close()

    if not deleted:
        raise HTTPException(status_code=404, detail="Trade not found or already deleted.")

    return {
        "message": "Trade deleted from dashboard history and calculations.",
        "tradeId": trade_id,
    }


@app.get("/api/dashboard/stream")
async def dashboard_stream(request: Request) -> StreamingResponse:
    async def event_generator():
        previous_payload = ""
        while True:
            if await request.is_disconnected():
                break

            payload = _load_dashboard_payload()
            serialized = json.dumps(payload, sort_keys=True, default=str)

            if serialized != previous_payload:
                yield f"data: {serialized}\n\n"
                previous_payload = serialized
            else:
                yield ": keepalive\n\n"

            await asyncio.sleep(3)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


@app.get("/api/market-quotes/stream")
async def market_quotes_stream(request: Request) -> StreamingResponse:
    async def event_generator():
        previous_payload = ""
        while True:
            if await request.is_disconnected():
                break

            settings = get_settings()
            payload = {
                "generatedAt": datetime.now(settings.timezone).isoformat(),
                "marketQuotes": _load_market_quotes(settings),
            }
            serialized = json.dumps(payload, sort_keys=True, default=str)

            if serialized != previous_payload:
                yield f"data: {serialized}\n\n"
                previous_payload = serialized
            else:
                yield ": keepalive\n\n"

            await asyncio.sleep(1)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


@app.get("/api/logs")
def dashboard_logs(date: str) -> dict:
    return _load_logs_payload(date)


@app.get("/api/logs/stream")
async def dashboard_logs_stream(request: Request, date: str) -> StreamingResponse:
    async def event_generator():
        previous_payload = ""
        while True:
            if await request.is_disconnected():
                break

            payload = _load_logs_payload(date)
            payload["generatedAt"] = datetime.now(get_settings().timezone).isoformat()
            serialized = json.dumps(payload, sort_keys=True, default=str)

            if serialized != previous_payload:
                yield f"data: {serialized}\n\n"
                previous_payload = serialized
            else:
                yield ": keepalive\n\n"

            await asyncio.sleep(2)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


@app.get("/api/zerodha/login-url")
def zerodha_login_url() -> dict[str, str | bool]:
    settings = get_settings()
    if not settings.zerodha_api_key:
        raise ValueError("ZERODHA_API_KEY is not configured.")

    return {
        "status": "ok",
        "loginUrl": _kite_login_url(settings.zerodha_api_key, settings.zerodha_redirect_url),
        "redirectUrl": settings.zerodha_redirect_url,
        "apiSecretConfigured": bool(settings.zerodha_api_secret),
    }


@app.get("/api/zerodha/health")
def zerodha_health() -> dict:
    settings = get_settings()
    return _load_zerodha_health(settings)


@app.get("/api/live-trading")
def live_trading_status() -> dict:
    return _load_live_trading_payload(get_settings(), force_refresh=True)


@app.post("/api/live-trading/toggle")
def live_trading_toggle(payload: LiveTradingToggleRequest) -> dict:
    broker, state_store = _live_broker()
    try:
        _clear_live_trading_cache()
        return {
            "status": broker.set_enabled(
                payload.enabled,
                enabled_strategy_keys=payload.enabledStrategyKeys,
            )
        }
    except LiveTradingError as exc:
        _raise_live_error(exc)
    finally:
        broker.close()
        state_store.close()


@app.delete("/api/live-trading/orders/{order_id}")
def live_cancel_order(order_id: str, payload: LiveOrderCancelRequest | None = None) -> dict:
    broker, state_store = _live_broker()
    try:
        _clear_live_trading_cache()
        return broker.cancel_order(
            order_id=order_id,
            variety=(payload.variety if payload else "regular"),
        )
    except LiveTradingError as exc:
        _raise_live_error(exc)
    except Exception as exc:
        _raise_live_error(exc)
    finally:
        broker.close()
        state_store.close()


@app.get("/api/live-trading/ltp")
def live_ltp(exchange: str, tradingsymbol: str, preferStream: bool = True) -> dict:
    broker, state_store = _live_broker()
    try:
        return broker.option_ltp(
            exchange=exchange.strip().upper(),
            tradingsymbol=tradingsymbol.strip().upper(),
            prefer_stream=preferStream,
        )
    except LiveTradingError as exc:
        _raise_live_error(exc)
    except Exception as exc:
        _raise_live_error(exc)
    finally:
        broker.close()
        state_store.close()


@app.post("/api/zerodha/exchange")
def zerodha_exchange(payload: ZerodhaExchangeRequest) -> dict:
    return _exchange_zerodha_request_token(payload.requestToken, payload.saveToEnv)


@app.get("/kite/callback")
def zerodha_callback(
    request_token: str | None = None,
    status: str | None = None,
    action: str | None = None,
) -> HTMLResponse:
    if status != "success" or not request_token:
        return HTMLResponse(
            "<h2>Zerodha login did not complete successfully.</h2>"
            "<p>Check the callback URL and try again.</p>",
            status_code=400,
        )

    try:
        result = _exchange_zerodha_request_token(request_token, save_to_env=True)
    except Exception as exc:
        return HTMLResponse(
            "<h2>Zerodha token exchange failed.</h2>"
            f"<p>{exc}</p>"
            "<p>If your Kite redirect is still on port 5173, keep using the dashboard-based exchange flow.</p>",
            status_code=500,
        )

    return HTMLResponse(
        "<h2>Zerodha connected successfully.</h2>"
        f"<p>User: {result.get('userName') or result.get('userId') or 'Unknown'}</p>"
        f"<p>Action: {action or 'login'}</p>"
        "<p>The access token has been saved to your local <code>.env</code>. "
        "Restart the bot process so it picks up the new token.</p>",
    )


@app.post("/api/sample-alert")
def trigger_sample_alert(payload: SampleAlertRequest) -> dict[str, str]:
    send_sample_alert(payload.signal)
    return {
        "status": "ok",
        "message": f"Sample {payload.signal} alert triggered.",
    }


@app.post("/api/backtest")
def run_backtest_api(payload: BacktestApiRequest) -> dict:
    settings = get_settings()
    return run_backtest(
        settings,
        EngineBacktestRequest(
            instrument=payload.instrument,
            signal_mode=payload.signalMode,
            start_date=payload.startDate,
            end_date=payload.endDate,
            balance=payload.balance,
            target_pct=payload.targetPct,
            stop_loss_pct=payload.stopLossPct,
            stop_loss_mode=payload.stopLossMode,
            cap_stop_loss=payload.capStopLoss,
            require_vwap=payload.requireVwap,
            entry_timing=payload.entryTiming,
            entry_time=payload.entryTime,
            exit_time=payload.exitTime,
        ),
    )


@app.post("/api/backtest/option-contract")
def run_option_contract_backtest_api(payload: OptionContractBacktestApiRequest) -> dict:
    settings = get_settings()
    try:
        return run_option_contract_backtest(
            settings,
            OptionContractBacktestRequest(
                exchange=payload.exchange,
                option_symbol=payload.optionSymbol,
                option_symbol_2=payload.optionSymbol2,
                interval=payload.interval,
                signal_mode=payload.signalMode,
                entry_signal=payload.entrySignal,
                start_date=payload.startDate,
                end_date=payload.endDate,
                balance=payload.balance,
                lot_size=payload.lotSize,
                target_pct=payload.targetPct,
                max_signal_candle_pct=payload.maxSignalCandlePct,
                stop_loss_pct=payload.stopLossPct,
                strike_offset=payload.strikeOffset,
                stop_loss_mode=payload.stopLossMode,
                cap_stop_loss=payload.capStopLoss,
                require_vwap=payload.requireVwap,
                entry_timing=payload.entryTiming,
                entry_time=payload.entryTime,
                exit_time=payload.exitTime,
            ),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/backtest/option-5m")
@app.post("/api/backtest/nifty-5m")
def run_five_minute_option_backtest_api(payload: FiveMinuteOptionBacktestApiRequest) -> dict:
    settings = get_settings()
    try:
        return run_five_minute_option_backtest(
            settings,
            FiveMinuteOptionBacktestRequest(
                instrument=payload.instrument,
                mode=payload.mode,
                contract_1=payload.contract1,
                contract_2=payload.contract2,
                contract_side=payload.contractSide,
                start_date=payload.startDate,
                end_date=payload.endDate,
                balance=payload.balance,
                target_pct=payload.targetPct,
                max_body_pct=payload.maxBodyPct,
                min_body_pct=payload.minBodyPct,
                stop_loss_pct=payload.stopLossPct,
                strike_offset=payload.strikeOffset,
                entry_time=payload.entryTime,
                exit_time=payload.exitTime,
            ),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/backtest/export")
def export_backtest_api(payload: BacktestExportRequest) -> dict[str, Any]:
    settings = get_settings()
    if payload.reportType == "option_summary":
        path = _write_option_backtest_report_csv(payload.result, settings.timezone)
        rows = 1
    else:
        path = _write_backtest_csv(payload.result, settings.timezone)
        rows = len(payload.result.get("trades") or [])
    return {
        "status": "ok",
        "message": f"Backtest CSV saved to {path}.",
        "path": str(path),
        "rows": rows,
    }
