from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

import yfinance as yf

from nifty_alert_bot.data import fetch_latest_price


logger = logging.getLogger(__name__)

try:
    from kiteconnect import KiteConnect, KiteTicker
except ImportError:  # pragma: no cover - optional dependency
    KiteConnect = None
    KiteTicker = None


@dataclass(frozen=True)
class OptionContract:
    exchange: str
    tradingsymbol: str
    instrument_token: int
    strike: int
    option_type: str
    expiry: str


def synthetic_option_price(spot: float, strike: int, option_type: str) -> float:
    intrinsic = max(spot - strike, 0.0) if option_type == "CE" else max(strike - spot, 0.0)
    time_value = max(12.0, spot * 0.0025)
    return round(max(intrinsic + time_value, 1.0), 2)


def _parse_expiry(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        return datetime.fromisoformat(value).date()
    return None


class OptionPriceProvider:
    def __init__(self, settings) -> None:
        self.settings = settings
        self._kite = None
        self._ticker = None
        self._instrument_rows: list[dict[str, Any]] | None = None
        self._ws_started = False
        self._ws_connected = threading.Event()
        self._lock = threading.Lock()
        self._latest_ticks: dict[int, float] = {}
        self._subscribed_tokens: set[int] = set()

    @property
    def zerodha_available(self) -> bool:
        return bool(
            KiteConnect is not None
            and self.settings.zerodha_api_key
            and self.settings.zerodha_access_token
        )

    def close(self) -> None:
        ticker = self._ticker
        self._ticker = None
        if ticker is not None:
            try:
                ticker.close()
            except Exception:
                logger.debug("Failed to close Zerodha ticker cleanly.", exc_info=True)

    def health_check(self) -> dict[str, Any]:
        if not self.zerodha_available:
            return {
                "ok": False,
                "message": "Zerodha API key or access token is missing.",
            }

        try:
            kite = self._get_kite()
            profile = kite.profile()
            quote_key = "NSE:NIFTY 50"
            quote = kite.ltp([quote_key]).get(quote_key, {})
            return {
                "ok": True,
                "message": "Zerodha profile and NIFTY quote fetched successfully.",
                "userId": profile.get("user_id"),
                "userName": profile.get("user_name"),
                "email": profile.get("email"),
                "niftyLtp": quote.get("last_price"),
            }
        except Exception as exc:
            logger.exception("Zerodha health check failed.")
            return {
                "ok": False,
                "message": str(exc),
            }

    def index_quotes(self) -> list[dict[str, Any]]:
        instruments = [
            {"name": "NIFTY 50", "key": "NSE:NIFTY 50", "fallback_symbol": "^NSEI"},
            {"name": "SENSEX", "key": "BSE:SENSEX", "fallback_symbol": "^BSESN"},
        ]

        if self.zerodha_available:
            try:
                payload = self._get_kite().quote([item["key"] for item in instruments])
                quotes = []
                for item in instruments:
                    quote = payload.get(item["key"], {})
                    ltp = float(quote["last_price"]) if quote.get("last_price") is not None else None
                    previous_close = None
                    if isinstance(quote.get("ohlc"), dict) and quote["ohlc"].get("close") is not None:
                        previous_close = float(quote["ohlc"]["close"])
                    change = round(ltp - previous_close, 2) if ltp is not None and previous_close else None
                    change_pct = (
                        round((change / previous_close) * 100.0, 2)
                        if change is not None and previous_close
                        else None
                    )
                    quotes.append(
                        {
                            "name": item["name"],
                            "ltp": round(ltp, 2) if ltp is not None else None,
                            "change": change,
                            "changePct": change_pct,
                            "source": "zerodha_rest",
                            "updatedAt": datetime.now(self.settings.timezone).isoformat(),
                        }
                    )
                return quotes
            except Exception:
                logger.exception("Zerodha index quote fetch failed. Falling back to yfinance.")

        quotes = []
        for item in instruments:
            try:
                ltp = float(fetch_latest_price(item["fallback_symbol"]))
                daily = yf.download(
                    tickers=item["fallback_symbol"],
                    interval="1d",
                    period="5d",
                    progress=False,
                    auto_adjust=False,
                    threads=False,
                )
                if hasattr(daily.columns, "get_level_values"):
                    daily.columns = daily.columns.get_level_values(0)
                daily = daily.dropna()
                previous_close = float(daily["Close"].iloc[-2]) if len(daily) >= 2 else None
                change = round(ltp - previous_close, 2) if previous_close else None
                change_pct = round((change / previous_close) * 100.0, 2) if change is not None and previous_close else None
                quotes.append(
                    {
                        "name": item["name"],
                        "ltp": round(ltp, 2),
                        "change": change,
                        "changePct": change_pct,
                        "source": "yfinance",
                        "updatedAt": datetime.now(self.settings.timezone).isoformat(),
                    }
                )
            except Exception as exc:
                quotes.append(
                    {
                        "name": item["name"],
                        "ltp": None,
                        "source": "unavailable",
                        "updatedAt": datetime.now(self.settings.timezone).isoformat(),
                        "error": str(exc),
                    }
                )
        return quotes

    def resolve_contract(self, strike: int, option_type: str, as_of: datetime) -> OptionContract | None:
        if not self.zerodha_available:
            return None

        try:
            rows = self._load_option_instruments()
        except Exception:
            logger.exception("Unable to load Zerodha option instruments. Falling back to synthetic pricing.")
            return None

        today = as_of.date()
        matches: list[dict[str, Any]] = []

        for item in rows:
            if str(item.get("name", "")).upper() != self.settings.zerodha_underlying.upper():
                continue
            if str(item.get("instrument_type", "")).upper() != option_type.upper():
                continue
            if int(round(float(item.get("strike", 0)))) != int(strike):
                continue

            expiry_date = _parse_expiry(item.get("expiry"))
            if expiry_date is None or expiry_date < today:
                continue

            matches.append(item)

        if not matches:
            logger.warning(
                "No Zerodha option instrument found for %s %s %s. Using synthetic fallback.",
                self.settings.zerodha_underlying,
                strike,
                option_type,
            )
            return None

        chosen = min(matches, key=lambda item: (_parse_expiry(item.get("expiry")) or today, item.get("tradingsymbol", "")))
        expiry_value = _parse_expiry(chosen.get("expiry"))
        return OptionContract(
            exchange=str(chosen.get("exchange") or self.settings.zerodha_option_exchange),
            tradingsymbol=str(chosen["tradingsymbol"]),
            instrument_token=int(chosen["instrument_token"]),
            strike=int(strike),
            option_type=option_type.upper(),
            expiry=expiry_value.isoformat() if expiry_value is not None else "",
        )

    def quote_trade(self, trade: dict[str, Any], *, prefer_stream: bool = True) -> tuple[float, str]:
        contract = None
        if trade.get("instrument_exchange") and trade.get("option_symbol") and trade.get("instrument_token"):
            contract = OptionContract(
                exchange=str(trade["instrument_exchange"]),
                tradingsymbol=str(trade["option_symbol"]),
                instrument_token=int(trade["instrument_token"]),
                strike=int(trade["strike"]),
                option_type=str(trade["option_type"]),
                expiry=str(trade.get("expiry") or ""),
            )
        elif trade.get("strike") and trade.get("option_type"):
            contract = self.resolve_contract(int(trade["strike"]), str(trade["option_type"]), datetime.now(self.settings.timezone))

        spot = fetch_latest_price(self.settings.symbol)
        return self.quote_option(
            float(spot),
            int(trade["strike"]),
            str(trade["option_type"]),
            contract=contract,
            prefer_stream=prefer_stream,
        )

    def quote_option(
        self,
        spot: float,
        strike: int,
        option_type: str,
        *,
        contract: OptionContract | None,
        prefer_stream: bool,
    ) -> tuple[float, str]:
        if contract is not None and self.zerodha_available:
            if prefer_stream:
                price = self._stream_price(contract, wait_seconds=self.settings.zerodha_quote_timeout_seconds)
                if price is not None:
                    return price, "zerodha_websocket"

            price = self._rest_price(contract)
            if price is not None:
                return price, "zerodha_rest"

        return synthetic_option_price(spot, strike, option_type), "synthetic"

    def candle_for_start(self, contract: OptionContract, candle_start: datetime, interval_minutes: int = 5) -> dict[str, Any] | None:
        if not self.zerodha_available:
            return None

        candle_start_ist = candle_start.astimezone(self.settings.timezone).replace(second=0, microsecond=0)
        candle_end_ist = candle_start_ist + timedelta(minutes=interval_minutes)
        from_date = (candle_start_ist - timedelta(minutes=5)).strftime("%Y-%m-%d %H:%M:%S")
        to_date = candle_end_ist.strftime("%Y-%m-%d %H:%M:%S")

        try:
            candles = self._get_kite().historical_data(
                contract.instrument_token,
                from_date,
                to_date,
                "5minute",
                continuous=False,
                oi=False,
            )
        except Exception:
            logger.exception(
                "Failed to fetch option candle for %s at %s (from=%s to=%s).",
                contract.tradingsymbol,
                candle_start_ist,
                from_date,
                to_date,
            )
            return None

        if not candles:
            return None

        for candle in candles:
            candle_time = candle.get("date")
            if isinstance(candle_time, datetime):
                candle_time_ist = candle_time.astimezone(self.settings.timezone).replace(second=0, microsecond=0)
                if candle_time_ist == candle_start_ist:
                    return candle

        return None

    def _get_kite(self):
        if self._kite is None:
            if not self.zerodha_available:
                raise RuntimeError("Zerodha credentials are not available.")
            self._kite = KiteConnect(api_key=self.settings.zerodha_api_key)
            self._kite.set_access_token(self.settings.zerodha_access_token)
        return self._kite

    def _load_option_instruments(self) -> list[dict[str, Any]]:
        if self._instrument_rows is None:
            kite = self._get_kite()
            self._instrument_rows = kite.instruments(self.settings.zerodha_option_exchange)
        return self._instrument_rows

    def _rest_price(self, contract: OptionContract) -> float | None:
        try:
            quote_key = f"{contract.exchange}:{contract.tradingsymbol}"
            payload = self._get_kite().ltp([quote_key])
            quote = payload.get(quote_key)
            if quote and quote.get("last_price") is not None:
                return round(float(quote["last_price"]), 2)
        except Exception:
            logger.exception("Zerodha REST LTP fetch failed for %s.", contract.tradingsymbol)
        return None

    def _stream_price(self, contract: OptionContract, wait_seconds: float) -> float | None:
        if not self.settings.zerodha_enable_websocket or KiteTicker is None:
            return None

        self._ensure_websocket()

        with self._lock:
            token_already_subscribed = contract.instrument_token in self._subscribed_tokens

        if not token_already_subscribed:
            self._subscribe(contract.instrument_token)

        deadline = time.time() + max(wait_seconds, 0.0)
        while time.time() <= deadline:
            with self._lock:
                price = self._latest_ticks.get(contract.instrument_token)
            if price is not None:
                return round(price, 2)
            time.sleep(0.1)

        with self._lock:
            return self._latest_ticks.get(contract.instrument_token)

    def _ensure_websocket(self) -> None:
        if self._ws_started or not self.zerodha_available or KiteTicker is None:
            return

        with self._lock:
            if self._ws_started:
                return

            ticker = KiteTicker(self.settings.zerodha_api_key, self.settings.zerodha_access_token)

            def on_connect(ws, _response) -> None:
                self._ws_connected.set()
                tokens = list(self._subscribed_tokens)
                if tokens:
                    ws.subscribe(tokens)
                    ws.set_mode(ws.MODE_LTP, tokens)

            def on_ticks(_ws, ticks) -> None:
                with self._lock:
                    for tick in ticks:
                        instrument_token = tick.get("instrument_token")
                        last_price = tick.get("last_price")
                        if instrument_token is not None and last_price is not None:
                            self._latest_ticks[int(instrument_token)] = float(last_price)

            def on_close(_ws, _code, _reason) -> None:
                self._ws_connected.clear()

            def on_error(_ws, _code, reason) -> None:
                logger.warning("Zerodha ticker error: %s", reason)

            ticker.on_connect = on_connect
            ticker.on_ticks = on_ticks
            ticker.on_close = on_close
            ticker.on_error = on_error
            ticker.connect(threaded=True)

            self._ticker = ticker
            self._ws_started = True

        self._ws_connected.wait(timeout=self.settings.zerodha_quote_timeout_seconds)

    def _subscribe(self, instrument_token: int) -> None:
        with self._lock:
            self._subscribed_tokens.add(instrument_token)
            ticker = self._ticker

        if ticker is None:
            return

        try:
            ticker.subscribe([instrument_token])
            ticker.set_mode(ticker.MODE_LTP, [instrument_token])
        except Exception:
            logger.exception("Failed to subscribe Zerodha ticker for token %s.", instrument_token)
