from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timedelta
from typing import Literal
from urllib.parse import quote
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse
from pydantic import BaseModel

from nifty_alert_bot.config import get_settings
from nifty_alert_bot.bot import send_sample_alert
from nifty_alert_bot.option_price_provider import OptionPriceProvider
from nifty_alert_bot.paper_trade_repository import PaperTradeRepository
from nifty_alert_bot.run_log_store import RunLogStore
from nifty_alert_bot.scheduler import WEEKDAYS, next_run_at, parse_hhmm
from nifty_alert_bot.state import StateStore
from nifty_alert_bot.text_log_parser import parse_text_logs


app = FastAPI(title="NIFTY Alert Dashboard API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SampleAlertRequest(BaseModel):
    signal: Literal["BUY", "SELL"]


class ZerodhaExchangeRequest(BaseModel):
    requestToken: str
    saveToEnv: bool = True


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
    state_store = StateStore(settings.state_file)

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
    state_store.record_zerodha_session(session_payload)

    return {
        "status": "ok",
        "message": "Zerodha access token generated successfully.",
        "accessTokenSavedToEnv": save_to_env,
        "userId": session.get("user_id"),
        "userName": session.get("user_name"),
        "email": session.get("email"),
        "loginTime": session.get("login_time"),
    }


def _build_paper_dashboard_payload(settings, paper_state: dict) -> dict:
    now = datetime.now(settings.timezone)
    active_trade = paper_state.get("active_trade")
    active_trade_unrealized_pnl = 0.0
    price_provider = OptionPriceProvider(settings)

    try:
        if active_trade:
            try:
                live_option_price, live_price_source = price_provider.quote_trade(active_trade, prefer_stream=False)
                active_trade_unrealized_pnl = round(
                    (live_option_price - float(active_trade["entry_price"])) * int(active_trade["quantity"]),
                    2,
                )
                active_trade = {
                    **active_trade,
                    "livePrice": round(live_option_price, 2),
                    "unrealizedPnl": active_trade_unrealized_pnl,
                    "livePriceSource": live_price_source,
                }
            except Exception:
                active_trade = {
                    **active_trade,
                    "livePrice": None,
                    "unrealizedPnl": None,
                    "livePriceSource": None,
                }
                active_trade_unrealized_pnl = 0.0
    finally:
        price_provider.close()

    daily_realized_pnl = round(float(paper_state.get("daily_realized_pnl", 0.0)), 2)
    trade_history = paper_state.get("trade_history", [])
    summary_by_range = _build_paper_summary_by_range(settings, paper_state, active_trade_unrealized_pnl)
    schedule_status = _paper_schedule_status(now, settings.schedule_start, settings.schedule_end)

    return {
        "runningPnl": round(daily_realized_pnl + active_trade_unrealized_pnl, 2),
        "realizedPnl": daily_realized_pnl,
        "capitalBase": round(float(settings.paper_trade_capital), 2),
        "activeTrade": active_trade,
        "tradeHistory": trade_history,
        "recentSkippedTrades": _load_recent_skipped_trades(settings),
        "summaryByRange": summary_by_range,
        "dailySummary": {
            "tradeDate": paper_state.get("trade_date"),
            "tradeCount": int(paper_state.get("daily_trade_count", 0)),
            "winCount": int(paper_state.get("daily_win_count", 0)),
            "lossCount": int(paper_state.get("daily_loss_count", 0)),
            "consecutiveLosses": int(paper_state.get("consecutive_losses", 0)),
            "dayStopped": schedule_status["dayStopped"],
            "dayStopReason": schedule_status["dayStopReason"],
            "cooldownUntil": paper_state.get("cooldown_until"),
        },
        "historyCount": len(trade_history),
    }


def _paper_schedule_status(now: datetime, schedule_start: str, schedule_end: str) -> dict[str, str | bool]:
    if now.weekday() not in WEEKDAYS:
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


def _build_paper_summary_by_range(settings, paper_state: dict, active_trade_unrealized_pnl: float) -> dict[str, dict]:
    now = datetime.now(settings.timezone)
    start_of_today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    start_of_week = start_of_today - timedelta(days=start_of_today.weekday())
    start_of_month = start_of_today.replace(day=1)
    active_trade = paper_state.get("active_trade")

    repository = PaperTradeRepository(
        settings.mongodb_uri,
        settings.mongodb_database,
        settings.mongodb_paper_trades_collection,
    )
    try:
        trades = repository.list_trades()
    finally:
        repository.close()

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
            exit_time = trade.get("exit_time")
            if not exit_time:
                continue
            try:
                exit_dt = datetime.fromisoformat(str(exit_time))
            except ValueError:
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
            try:
                entry_dt = datetime.fromisoformat(str(active_trade["entry_time"]))
            except ValueError:
                entry_dt = None
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


def _filtered_recent_alerts(state: dict) -> list[dict]:
    alerts = state.get("recent_alerts", [])
    if not isinstance(alerts, list):
        return []
    return [alert for alert in alerts if not _is_sample_alert(alert)]


def _load_recent_skipped_trades(settings, limit: int = 12) -> list[dict]:
    repository = PaperTradeRepository(
        settings.mongodb_uri,
        settings.mongodb_database,
        settings.mongodb_paper_trades_collection,
    )
    try:
        rows = repository.list_recent_skipped_events(limit=limit)
    finally:
        repository.close()

    return [
        {
            "timestamp": row.get("timestamp"),
            "signal": row.get("signal"),
            "status": row.get("status"),
            "skipReason": row.get("skip_reason"),
            "optionSymbol": row.get("option_symbol"),
            "strike": row.get("strike"),
            "optionType": row.get("option_type"),
            "entryPrice": row.get("entry_price"),
            "stopLossPrice": row.get("stop_loss_price"),
            "stopLossSource": row.get("stop_loss_source"),
            "message": row.get("message"),
        }
        for row in rows
    ]


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


def _load_dashboard_payload() -> dict:
    settings = get_settings()
    state_store = StateStore(settings.state_file)
    state = state_store.load_state()
    paper_state = state_store.load_paper_trading()
    now = datetime.now(settings.timezone)
    next_run = next_run_at(
        now,
        settings.schedule_start,
        settings.schedule_end,
        settings.schedule_interval_minutes,
        settings.schedule_buffer_seconds,
    )
    recent_alerts = _filtered_recent_alerts(state)

    return {
        "generatedAt": now.isoformat(),
        "symbol": settings.symbol,
        "interval": settings.interval,
        "schedule": {
            "timezone": settings.timezone_name,
            "start": settings.schedule_start,
            "end": settings.schedule_end,
            "intervalMinutes": settings.schedule_interval_minutes,
            "bufferSeconds": settings.schedule_buffer_seconds,
            "nextRunAt": next_run.isoformat(),
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
        "marketQuotes": _load_market_quotes(settings),
        "latestAlert": recent_alerts[0] if recent_alerts else None,
        "recentAlerts": recent_alerts,
        "paperTrading": _build_paper_dashboard_payload(settings, paper_state),
    }


def _load_logs_payload(date: str) -> dict:
    settings = get_settings()
    structured_path = Path(settings.run_logs_dir) / f"{date}.jsonl"

    logs = []
    source = "none"

    if structured_path.exists():
        store = RunLogStore(
            settings.run_logs_dir,
            settings.mongodb_uri,
            settings.mongodb_database,
            settings.mongodb_logs_collection,
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
                settings.mongodb_uri,
                settings.mongodb_database,
                settings.mongodb_logs_collection,
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
