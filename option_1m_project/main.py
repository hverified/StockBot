from __future__ import annotations

import os
import sys
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parent
PARENT_DIR = PROJECT_DIR.parent
sys.path.insert(0, str(PARENT_DIR))


def apply_option_1m_defaults() -> None:
    os.environ.setdefault("STRATEGY_MODE", "option_contracts")
    os.environ.setdefault("MONGODB_DATABASE", "option_1m_bot")
    os.environ.setdefault("OPTION_CONTRACT_INTERVAL", "1m")
    os.environ.setdefault("OPTION_CONTRACT_TARGET_PCT", "3")
    os.environ.setdefault("OPTION_CONTRACT_SIGNAL_MODE", "both")
    os.environ.setdefault("OPTION_CONTRACT_ENTRY_SIGNAL", "BUY")
    os.environ.setdefault("SCHEDULE_INTERVAL_MINUTES", "1")
    os.environ.setdefault("SCHEDULE_BUFFER_SECONDS", "2")
    os.environ.setdefault("PAPER_TRADE_ENTRY_SECOND", "2")
    os.environ.setdefault("OPTION_CONTRACT_STOP_LOSS_MODE", "signal_low")
    os.environ.setdefault("OPTION_CONTRACT_STOP_LOSS_PCT", "8")
    os.environ.setdefault("LOG_FILE", "logs/option_1m_bot.log")
    os.environ.setdefault("RUN_LOGS_DIR", "logs/run_logs")


apply_option_1m_defaults()

from nifty_alert_bot.bot import main  # noqa: E402


if __name__ == "__main__":
    main()
