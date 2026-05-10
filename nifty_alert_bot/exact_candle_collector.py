from __future__ import annotations

import logging
from datetime import datetime, time

from nifty_alert_bot.config import kite_interval
from nifty_alert_bot.exact_candle_repository import ExactCandleRepository
from nifty_alert_bot.instruments import get_instrument_spec
from nifty_alert_bot.option_price_provider import OptionPriceProvider


logger = logging.getLogger(__name__)


def _parse_csv_ints(value: str) -> list[int]:
    offsets = []
    for item in str(value or "").split(","):
        item = item.strip()
        if not item:
            continue
        try:
            offsets.append(int(item))
        except ValueError:
            logger.warning("Ignoring invalid strike offset %s.", item)
    return offsets


def _parse_option_types(value: str) -> list[str]:
    option_types = []
    for item in str(value or "").split(","):
        item = item.strip().upper()
        if item in {"CE", "PE"}:
            option_types.append(item)
    return option_types or ["PE", "CE"]


def collect_exact_option_candles(
    settings,
    now: datetime,
    instrument_ids: list[str] | tuple[str, ...] | None = None,
) -> dict[str, int]:
    if not settings.enable_exact_candle_storage:
        return {}

    repository = ExactCandleRepository(
        settings.mongodb_uri,
        settings.mongodb_database,
        settings.mongodb_option_candles_collection,
    )
    price_provider = OptionPriceProvider(settings)
    totals: dict[str, int] = {}
    try:
        requested_instruments = {item.upper() for item in instrument_ids} if instrument_ids else None
        for instrument_id, offsets_value in (
            ("NIFTY", settings.nifty_store_strike_offsets),
            ("SENSEX", settings.sensex_store_strike_offsets),
        ):
            if requested_instruments is not None and instrument_id not in requested_instruments:
                continue
            instrument = get_instrument_spec(instrument_id)
            spot = price_provider.index_ltp(instrument.id)
            if spot is None:
                logger.info("Skipped exact candle storage for %s because spot LTP is unavailable.", instrument.id)
                continue

            atm = int(round(float(spot) / instrument.strike_step) * instrument.strike_step)
            from_dt = datetime.combine(now.date(), time.min, tzinfo=settings.timezone)
            for offset in _parse_csv_ints(offsets_value):
                strike = atm + offset
                for option_type in _parse_option_types(settings.store_option_types):
                    contract = price_provider.resolve_contract(
                        strike,
                        option_type,
                        now,
                        exchange=instrument.zerodha_option_exchange,
                        underlying=instrument.zerodha_underlying,
                        max_expiry_gap_days=7,
                        allow_cached=False,
                    )
                    if contract is None:
                        continue
                    interval = kite_interval("1m")
                    candles = price_provider.historical_option_candles(
                        contract,
                        from_dt,
                        now,
                        interval=interval,
                        use_cache=False,
                    )
                    saved = repository.save_candles(
                        underlying=instrument.id,
                        contract=contract,
                        interval=interval,
                        candles=candles,
                        source="zerodha_historical",
                        strike_offset=offset,
                    )
                    totals[contract.tradingsymbol] = saved
        return totals
    finally:
        price_provider.close()
        repository.close()
