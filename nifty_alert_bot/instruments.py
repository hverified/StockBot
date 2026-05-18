from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class InstrumentSpec:
    id: str
    label: str
    yfinance_symbol: str
    zerodha_index_exchange: str
    zerodha_index_tradingsymbol: str
    zerodha_index_token: int
    zerodha_underlying: str
    zerodha_option_exchange: str
    lot_size: int
    strike_step: int


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


def _build_specs() -> dict[str, InstrumentSpec]:
    return {
        "NIFTY": InstrumentSpec(
            id="NIFTY",
            label="NIFTY 50",
            yfinance_symbol=os.getenv("NIFTY_SYMBOL", "^NSEI").strip() or "^NSEI",
            zerodha_index_exchange=os.getenv("NIFTY_INDEX_EXCHANGE", "NSE").strip()
            or "NSE",
            zerodha_index_tradingsymbol=os.getenv("NIFTY_INDEX_TRADINGSYMBOL", "NIFTY 50").strip()
            or "NIFTY 50",
            zerodha_index_token=_env_int("NIFTY_INDEX_TOKEN", 256265),
            zerodha_underlying=os.getenv("NIFTY_ZERODHA_UNDERLYING", "NIFTY").strip()
            or "NIFTY",
            zerodha_option_exchange=os.getenv("NIFTY_OPTION_EXCHANGE", "NFO").strip()
            or "NFO",
            lot_size=_env_int("NIFTY_LOT_SIZE", _env_int("PAPER_TRADE_LOT_SIZE", 65)),
            strike_step=_env_int("NIFTY_STRIKE_STEP", 50),
        ),
        "BANKNIFTY": InstrumentSpec(
            id="BANKNIFTY",
            label="BANK NIFTY",
            yfinance_symbol=os.getenv("BANKNIFTY_SYMBOL", "^NSEBANK").strip()
            or "^NSEBANK",
            zerodha_index_exchange=os.getenv("BANKNIFTY_INDEX_EXCHANGE", "NSE").strip()
            or "NSE",
            zerodha_index_tradingsymbol=os.getenv("BANKNIFTY_INDEX_TRADINGSYMBOL", "NIFTY BANK").strip()
            or "NIFTY BANK",
            zerodha_index_token=_env_int("BANKNIFTY_INDEX_TOKEN", 260105),
            zerodha_underlying=os.getenv("BANKNIFTY_ZERODHA_UNDERLYING", "BANKNIFTY").strip()
            or "BANKNIFTY",
            zerodha_option_exchange=os.getenv("BANKNIFTY_OPTION_EXCHANGE", "NFO").strip()
            or "NFO",
            lot_size=_env_int("BANKNIFTY_LOT_SIZE", 30),
            strike_step=_env_int("BANKNIFTY_STRIKE_STEP", 100),
        ),
        "SENSEX": InstrumentSpec(
            id="SENSEX",
            label="SENSEX",
            yfinance_symbol=os.getenv("SENSEX_SYMBOL", "^BSESN").strip() or "^BSESN",
            zerodha_index_exchange=os.getenv("SENSEX_INDEX_EXCHANGE", "BSE").strip()
            or "BSE",
            zerodha_index_tradingsymbol=os.getenv("SENSEX_INDEX_TRADINGSYMBOL", "SENSEX").strip()
            or "SENSEX",
            zerodha_index_token=_env_int("SENSEX_INDEX_TOKEN", 265),
            zerodha_underlying=os.getenv("SENSEX_ZERODHA_UNDERLYING", "SENSEX").strip()
            or "SENSEX",
            zerodha_option_exchange=os.getenv("SENSEX_OPTION_EXCHANGE", "BFO").strip()
            or "BFO",
            lot_size=_env_int("SENSEX_LOT_SIZE", 20),
            strike_step=_env_int("SENSEX_STRIKE_STEP", 100),
        ),
    }


def get_instrument_spec(instrument: str | None) -> InstrumentSpec:
    specs = _build_specs()
    key = (instrument or "NIFTY").strip().upper()
    if key not in specs:
        supported = ", ".join(sorted(specs))
        raise ValueError(f"Unsupported instrument '{instrument}'. Supported instruments: {supported}.")
    return specs[key]


def list_instrument_specs() -> list[InstrumentSpec]:
    return list(_build_specs().values())
