from __future__ import annotations

import logging
import json
import re
import threading
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import yfinance as yf

from nifty_alert_bot.data import fetch_latest_price
from nifty_alert_bot.instruments import get_instrument_spec


logger = logging.getLogger(__name__)

try:
    from kiteconnect import KiteConnect, KiteTicker
    from kiteconnect.exceptions import TokenException
except ImportError:  # pragma: no cover - optional dependency
    KiteConnect = None
    KiteTicker = None
    TokenException = None


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


def _is_token_error(exc: Exception) -> bool:
    return bool(
        (TokenException is not None and isinstance(exc, TokenException))
        or "access_token" in str(exc).lower()
        or "api_key" in str(exc).lower()
    )


def _kite_interval(interval: str) -> str:
    return {
        "1m": "minute",
        "1minute": "minute",
        "minute": "minute",
        "3m": "3minute",
        "5m": "5minute",
        "5minute": "5minute",
        "10m": "10minute",
        "15m": "15minute",
        "30m": "30minute",
        "60m": "60minute",
        "1h": "60minute",
        "day": "day",
        "1d": "day",
    }.get(str(interval).strip().lower(), interval)


class OptionPriceProvider:
    def __init__(self, settings) -> None:
        self.settings = settings
        self._kite = None
        self._ticker = None
        self._instrument_rows_by_exchange: dict[str, list[dict[str, Any]]] = {}
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
            message = str(exc)
            if _is_token_error(exc):
                logger.info("Zerodha health check skipped: invalid or expired access token.")
                message = "Zerodha access token is expired or invalid. Generate a fresh token to enable Zerodha data."
            else:
                logger.exception("Zerodha health check failed.")
            return {
                "ok": False,
                "message": message,
            }

    def index_quotes(self) -> list[dict[str, Any]]:
        instruments = [
            {"id": "NIFTY", "name": "NIFTY 50", "key": "NSE:NIFTY 50", "fallback_symbol": "^NSEI"},
            {"id": "SENSEX", "name": "SENSEX", "key": "BSE:SENSEX", "fallback_symbol": "^BSESN"},
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
                            "sparkline": self._index_sparkline(item),
                            "updatedAt": datetime.now(self.settings.timezone).isoformat(),
                        }
                    )
                return quotes
            except Exception as exc:
                if _is_token_error(exc):
                    logger.info("Zerodha index quote fetch skipped: invalid or expired access token.")
                else:
                    logger.exception("Zerodha index quote fetch failed.")

            return [
                {
                    "name": item["name"],
                    "ltp": None,
                    "source": "zerodha_unavailable",
                    "sparkline": [],
                    "updatedAt": datetime.now(self.settings.timezone).isoformat(),
                    "error": "Zerodha index quote unavailable.",
                }
                for item in instruments
            ]

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
                        "sparkline": self._index_sparkline(item),
                        "updatedAt": datetime.now(self.settings.timezone).isoformat(),
                    }
                )
            except Exception as exc:
                quotes.append(
                    {
                        "name": item["name"],
                        "ltp": None,
                        "source": "unavailable",
                        "sparkline": [],
                        "updatedAt": datetime.now(self.settings.timezone).isoformat(),
                        "error": str(exc),
                    }
                )
        return quotes

    def index_ltp(self, underlying: str) -> float | None:
        target = str(underlying or "").strip().upper()
        instruments = {
            "NIFTY": {"key": "NSE:NIFTY 50", "fallback_symbol": "^NSEI"},
            "SENSEX": {"key": "BSE:SENSEX", "fallback_symbol": "^BSESN"},
        }
        item = instruments.get(target)
        if item is None:
            return None

        if self.zerodha_available:
            try:
                payload = self._get_kite().ltp([item["key"]])
                quote = payload.get(item["key"], {})
                if quote.get("last_price") is not None:
                    return round(float(quote["last_price"]), 2)
            except Exception as exc:
                if _is_token_error(exc):
                    logger.info("Zerodha %s LTP skipped: invalid or expired access token.", target)
                else:
                    logger.exception("Failed to fetch Zerodha %s LTP. Falling back to yfinance.", target)

        try:
            return round(float(fetch_latest_price(item["fallback_symbol"])), 2)
        except Exception:
            logger.exception("Failed to fetch fallback %s LTP.", target)
            return None

    def _index_sparkline(self, item: dict[str, Any], limit: int = 36) -> list[dict[str, Any]]:
        now = datetime.now(self.settings.timezone)

        if self.zerodha_available:
            try:
                instrument = get_instrument_spec(item["id"])
                candles = self.historical_index_candles(
                    instrument,
                    now - timedelta(hours=5),
                    now,
                    "5m",
                )
                points = [
                    {
                        "time": candle["date"].isoformat() if hasattr(candle.get("date"), "isoformat") else str(candle.get("date")),
                        "close": round(float(candle["close"]), 2),
                    }
                    for candle in candles[-limit:]
                    if candle.get("close") is not None
                ]
                if points:
                    return points
            except Exception:
                logger.debug("Zerodha sparkline fetch failed for %s.", item.get("name"), exc_info=True)
                return []
            return []

        try:
            frame = yf.download(
                tickers=item["fallback_symbol"],
                interval="5m",
                period="1d",
                progress=False,
                auto_adjust=False,
                threads=False,
            )
            if hasattr(frame.columns, "get_level_values"):
                frame.columns = frame.columns.get_level_values(0)
            frame = frame.dropna()
            return [
                {
                    "time": index.isoformat() if hasattr(index, "isoformat") else str(index),
                    "close": round(float(row["Close"]), 2),
                }
                for index, row in frame.tail(limit).iterrows()
            ]
        except Exception:
            logger.debug("yfinance sparkline fetch failed for %s.", item.get("name"), exc_info=True)
            return []

    def historical_index_candles(
        self,
        instrument,
        from_dt: datetime,
        to_dt: datetime,
        interval: str,
        *,
        use_cache: bool = False,
    ) -> list[dict[str, Any]]:
        if not self.zerodha_available:
            return []

        from_ist = from_dt.astimezone(self.settings.timezone).replace(second=0, microsecond=0)
        to_ist = to_dt.astimezone(self.settings.timezone).replace(second=0, microsecond=0)
        cache_path = (
            self._historical_index_cache_path(instrument, from_ist, to_ist, interval)
            if use_cache
            else None
        )

        if cache_path is not None and cache_path.exists():
            try:
                return self._load_cached_candles(cache_path)
            except Exception:
                logger.warning("Ignoring unreadable index candle cache %s.", cache_path, exc_info=True)

        try:
            candles = self._get_kite().historical_data(
                int(instrument.zerodha_index_token),
                from_ist.strftime("%Y-%m-%d %H:%M:%S"),
                to_ist.strftime("%Y-%m-%d %H:%M:%S"),
                _kite_interval(interval),
                continuous=False,
                oi=False,
            )
            if cache_path is not None and candles:
                self._save_cached_candles(cache_path, candles)
            return candles
        except Exception as exc:
            if _is_token_error(exc):
                logger.info(
                    "Skipped Zerodha %s historical candles for %s: invalid or expired access token.",
                    interval,
                    instrument.label,
                )
            else:
                logger.exception(
                    "Failed to fetch Zerodha %s historical candles for %s from %s to %s.",
                    interval,
                    instrument.label,
                    from_ist,
                    to_ist,
                )
            return []

    def resolve_contract(
        self,
        strike: int,
        option_type: str,
        as_of: datetime,
        exchange: str | None = None,
        underlying: str | None = None,
        max_expiry_gap_days: int | None = None,
    ) -> OptionContract | None:
        if not self.zerodha_available:
            return None

        target_exchange = exchange or self.settings.zerodha_option_exchange
        target_underlying = (underlying or self.settings.zerodha_underlying).upper()

        try:
            rows = self._load_option_instruments(exchange=target_exchange)
        except Exception as exc:
            if _is_token_error(exc):
                logger.info("Zerodha option instruments unavailable: invalid or expired access token. Falling back to synthetic pricing.")
            else:
                logger.exception("Unable to load Zerodha option instruments. Falling back to synthetic pricing.")
            return None

        as_of_date = as_of.date()
        matches: list[dict[str, Any]] = []

        for item in rows:
            if str(item.get("name", "")).upper() != target_underlying:
                continue
            if str(item.get("instrument_type", "")).upper() != option_type.upper():
                continue
            if int(round(float(item.get("strike", 0)))) != int(strike):
                continue

            expiry_date = _parse_expiry(item.get("expiry"))
            if expiry_date is None or expiry_date < as_of_date:
                continue
            if max_expiry_gap_days is not None and (expiry_date - as_of_date).days > max_expiry_gap_days:
                continue

            matches.append(item)

        if not matches:
            logger.warning(
                "No Zerodha option instrument found for %s %s %s. Using synthetic fallback.",
                target_underlying,
                strike,
                option_type,
            )
            return None

        chosen = min(matches, key=lambda item: (_parse_expiry(item.get("expiry")) or as_of_date, item.get("tradingsymbol", "")))
        expiry_value = _parse_expiry(chosen.get("expiry"))
        return OptionContract(
            exchange=str(chosen.get("exchange") or target_exchange),
            tradingsymbol=str(chosen["tradingsymbol"]),
            instrument_token=int(chosen["instrument_token"]),
            strike=int(strike),
            option_type=option_type.upper(),
            expiry=expiry_value.isoformat() if expiry_value is not None else "",
        )

    def find_contract_by_symbol(self, tradingsymbol: str, exchange: str | None = None) -> OptionContract | None:
        if not self.zerodha_available:
            return None

        target_symbol = str(tradingsymbol or "").strip().upper()
        if not target_symbol:
            return None

        try:
            rows = self._load_option_instruments(exchange=exchange)
        except Exception as exc:
            if _is_token_error(exc):
                logger.info("Zerodha option instruments unavailable: invalid or expired access token.")
            else:
                logger.exception("Unable to load Zerodha option instruments for manual contract lookup.")
            return None

        for item in rows:
            if str(item.get("tradingsymbol", "")).strip().upper() != target_symbol:
                continue

            expiry_value = _parse_expiry(item.get("expiry"))
            return OptionContract(
                exchange=str(item.get("exchange") or exchange or self.settings.zerodha_option_exchange),
                tradingsymbol=str(item["tradingsymbol"]),
                instrument_token=int(item["instrument_token"]),
                strike=int(round(float(item.get("strike", 0) or 0))),
                option_type=str(item.get("instrument_type", "")).upper(),
                expiry=expiry_value.isoformat() if expiry_value is not None else "",
            )

        logger.warning("No Zerodha option instrument found for manual symbol %s.", target_symbol)
        return None

    def resolve_contract_input(
        self,
        contract_input: str,
        as_of: datetime,
        exchange: str | None = None,
        underlying: str | None = None,
        max_expiry_gap_days: int | None = None,
    ) -> OptionContract | None:
        normalized = str(contract_input or "").strip().upper().replace(" ", "")
        if not normalized:
            return None

        compact_match = re.fullmatch(r"(\d+)(CE|PE)", normalized)
        if compact_match:
            strike = int(compact_match.group(1))
            option_type = compact_match.group(2)
            return self.resolve_contract(
                strike,
                option_type,
                as_of,
                exchange=exchange,
                underlying=underlying,
                max_expiry_gap_days=max_expiry_gap_days,
            )

        side_match = re.fullmatch(r"(CE|PE)", normalized)
        if side_match:
            target_underlying = (underlying or self.settings.zerodha_underlying).upper()
            spot = self.index_ltp(target_underlying)
            if spot is None:
                logger.warning("Cannot resolve dynamic %s contract because %s LTP is unavailable.", normalized, target_underlying)
                return None
            strike_step = 100 if target_underlying == "SENSEX" else 50
            atm = int(round(float(spot) / strike_step) * strike_step)
            option_type = side_match.group(1)
            strike_offset = int(getattr(self.settings, "option_contract_strike_offset", 0) or 0)
            strike = atm + strike_offset
            logger.info(
                "Resolved dynamic %s %s contract from spot %.2f: ATM=%s offset=%s strike=%s.",
                target_underlying,
                option_type,
                spot,
                atm,
                strike_offset,
                strike,
            )
            return self.resolve_contract(
                strike,
                option_type,
                as_of,
                exchange=exchange,
                underlying=target_underlying,
                max_expiry_gap_days=max_expiry_gap_days,
            )

        return self.find_contract_by_symbol(normalized, exchange)

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

        spot = (
            0.0
            if contract is not None and self.zerodha_available
            else fetch_latest_price(self.settings.symbol)
        )
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
        except Exception as exc:
            if _is_token_error(exc):
                logger.info(
                    "Skipped option candle fetch for %s: invalid or expired Zerodha access token.",
                    contract.tradingsymbol,
                )
            else:
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

    def historical_option_candles(
        self,
        contract: OptionContract,
        from_dt: datetime,
        to_dt: datetime,
        interval: str = "minute",
        *,
        use_cache: bool = False,
    ) -> list[dict[str, Any]]:
        if not self.zerodha_available:
            return []

        from_ist = from_dt.astimezone(self.settings.timezone).replace(second=0, microsecond=0)
        to_ist = to_dt.astimezone(self.settings.timezone).replace(second=0, microsecond=0)
        cache_path = (
            self._historical_option_cache_path(contract, from_ist, to_ist, interval)
            if use_cache
            else None
        )

        if cache_path is not None and cache_path.exists():
            try:
                return self._load_cached_candles(cache_path)
            except Exception:
                logger.warning("Ignoring unreadable candle cache %s.", cache_path, exc_info=True)

        try:
            candles = self._get_kite().historical_data(
                contract.instrument_token,
                from_ist.strftime("%Y-%m-%d %H:%M:%S"),
                to_ist.strftime("%Y-%m-%d %H:%M:%S"),
                interval,
                continuous=False,
                oi=False,
            )
            if cache_path is not None and candles:
                self._save_cached_candles(cache_path, candles)
            return candles
        except Exception as exc:
            if _is_token_error(exc):
                logger.info(
                    "Skipped %s option candle fetch for %s: invalid or expired Zerodha access token.",
                    interval,
                    contract.tradingsymbol,
                )
            else:
                logger.exception(
                    "Failed to fetch %s option candles for %s from %s to %s.",
                    interval,
                    contract.tradingsymbol,
                    from_ist,
                    to_ist,
                )
            return []

    def _get_kite(self):
        if self._kite is None:
            if not self.zerodha_available:
                raise RuntimeError("Zerodha credentials are not available.")
            self._kite = KiteConnect(api_key=self.settings.zerodha_api_key)
            self._kite.set_access_token(self.settings.zerodha_access_token)
        return self._kite

    def _load_option_instruments(self, exchange: str | None = None) -> list[dict[str, Any]]:
        target_exchange = str(exchange or self.settings.zerodha_option_exchange).strip().upper()
        if target_exchange not in self._instrument_rows_by_exchange:
            kite = self._get_kite()
            self._instrument_rows_by_exchange[target_exchange] = kite.instruments(target_exchange)
        return self._instrument_rows_by_exchange[target_exchange]

    def _historical_option_cache_path(
        self,
        contract: OptionContract,
        from_ist: datetime,
        to_ist: datetime,
        interval: str,
    ) -> Path:
        cache_dir = Path(getattr(self.settings, "candle_cache_dir", "logs/candle_cache"))
        safe_symbol = re.sub(r"[^A-Z0-9_-]+", "_", contract.tradingsymbol.upper())
        safe_interval = re.sub(r"[^A-Za-z0-9_-]+", "_", str(interval))
        filename = (
            f"{contract.exchange.upper()}_{contract.instrument_token}_{safe_symbol}_"
            f"{safe_interval}_{from_ist:%Y%m%d%H%M}_{to_ist:%Y%m%d%H%M}.json"
        )
        return cache_dir / "zerodha_options" / filename

    def _historical_index_cache_path(
        self,
        instrument,
        from_ist: datetime,
        to_ist: datetime,
        interval: str,
    ) -> Path:
        cache_dir = Path(getattr(self.settings, "candle_cache_dir", "logs/candle_cache"))
        label = str(getattr(instrument, "label", "") or getattr(instrument, "name", "") or "index")
        safe_label = re.sub(r"[^A-Z0-9_-]+", "_", label.upper())
        safe_interval = re.sub(r"[^A-Za-z0-9_-]+", "_", str(interval))
        filename = (
            f"{safe_label}_{int(instrument.zerodha_index_token)}_"
            f"{safe_interval}_{from_ist:%Y%m%d%H%M}_{to_ist:%Y%m%d%H%M}.json"
        )
        return cache_dir / "zerodha_indices" / filename

    def _load_cached_candles(self, path: Path) -> list[dict[str, Any]]:
        with path.open("r", encoding="utf-8") as handle:
            rows = json.load(handle)

        candles: list[dict[str, Any]] = []
        for row in rows:
            candle = dict(row)
            value = candle.get("date")
            if isinstance(value, str):
                candle["date"] = datetime.fromisoformat(value)
            candles.append(candle)
        return candles

    def _save_cached_candles(self, path: Path, candles: list[dict[str, Any]]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        serializable = []
        for candle in candles:
            row = dict(candle)
            value = row.get("date")
            if hasattr(value, "isoformat"):
                row["date"] = value.isoformat()
            serializable.append(row)

        temp_path = path.with_suffix(path.suffix + ".tmp")
        with temp_path.open("w", encoding="utf-8") as handle:
            json.dump(serializable, handle, ensure_ascii=True)
        temp_path.replace(path)

    def _rest_price(self, contract: OptionContract) -> float | None:
        try:
            quote_key = f"{contract.exchange}:{contract.tradingsymbol}"
            payload = self._get_kite().ltp([quote_key])
            quote = payload.get(quote_key)
            if quote and quote.get("last_price") is not None:
                return round(float(quote["last_price"]), 2)
        except Exception as exc:
            if _is_token_error(exc):
                logger.info(
                    "Skipped Zerodha REST LTP fetch for %s: invalid or expired access token.",
                    contract.tradingsymbol,
                )
            else:
                logger.exception("Zerodha REST LTP fetch failed for %s.", contract.tradingsymbol)
        return None

    def _stream_price(self, contract: OptionContract, wait_seconds: float) -> float | None:
        if not self.settings.zerodha_enable_websocket or KiteTicker is None:
            return None

        self._ensure_websocket()

        with self._lock:
            token_already_subscribed = contract.instrument_token in self._subscribed_tokens

        if not token_already_subscribed:
            if not self._subscribe(contract.instrument_token):
                return None

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

        if not self._ws_connected.wait(timeout=self.settings.zerodha_quote_timeout_seconds):
            logger.info("Zerodha ticker connection not ready yet; using REST fallback for this quote.")

    def _subscribe(self, instrument_token: int) -> bool:
        with self._lock:
            self._subscribed_tokens.add(instrument_token)
            ticker = self._ticker

        if ticker is None:
            return False

        if not self._ws_connected.wait(timeout=self.settings.zerodha_quote_timeout_seconds):
            logger.info(
                "Skipped Zerodha ticker subscription for token %s because WebSocket is not connected yet. Using REST fallback.",
                instrument_token,
            )
            return False

        try:
            ticker.subscribe([instrument_token])
            ticker.set_mode(ticker.MODE_LTP, [instrument_token])
            return True
        except AttributeError as exc:
            if "sendMessage" in str(exc):
                logger.info(
                    "Skipped Zerodha ticker subscription for token %s because WebSocket transport is not ready. Using REST fallback.",
                    instrument_token,
                )
            else:
                logger.warning("Failed to subscribe Zerodha ticker for token %s: %s", instrument_token, exc)
            return False
        except Exception:
            logger.exception("Failed to subscribe Zerodha ticker for token %s.", instrument_token)
            return False
