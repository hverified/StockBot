# NIFTY Trading Alert Bot

Python bot that:

- fetches 5-minute NIFTY candles
- calculates TradingView-style Supertrend `(10,1)` and `(10,3)`
- sends Telegram BUY/SELL alerts with emoji formatting
- avoids duplicate alerts
- runs continuously on a fixed IST schedule
- exposes a dashboard API for a React frontend
- stores bot state and alert history in MongoDB
- stores paper trades in a dedicated MongoDB collection
- keeps intraday run logs locally and archives them to MongoDB after session close
- includes a paper-trading execution engine for Supertrend signals

## Files

- `main.py` - app entry point
- `nifty_alert_bot/config.py` - environment configuration
- `nifty_alert_bot/data.py` - candle fetcher
- `nifty_alert_bot/indicators.py` - ATR and Supertrend logic
- `nifty_alert_bot/notifier.py` - Telegram sender
- `nifty_alert_bot/state.py` - duplicate alert tracking
- `nifty_alert_bot/scheduler.py` - run-time scheduler
- `nifty_alert_bot/logging_utils.py` - console and file logging
- `nifty_alert_bot/bot.py` - live run, one-shot run, and sample alert CLI
- `dashboard_api.py` - FastAPI endpoint for dashboard data
- `dashboard/` - React dashboard app
- `nifty_alert_bot/run_log_store.py` - local run-log buffer and MongoDB archive
- `nifty_alert_bot/paper_trading.py` - paper-trading execution logic and lifecycle

## Setup

1. Activate your existing virtual environment.

```bash
source venv/bin/activate
```

2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Create your env file:

```bash
cp .env.example .env
```

4. Update `.env` with:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `MONGODB_URI`

Optional:

- `MONGODB_DATABASE` defaults to `nifty_alert_bot`
- `MONGODB_COLLECTION` defaults to `bot_state`
- `MONGODB_LOGS_COLLECTION` defaults to `run_logs_archive`
- `MONGODB_PAPER_TRADES_COLLECTION` defaults to `paper_trades`
- `NIFTY_SYMBOL` defaults to `^NSEI`
- `NIFTY_INTERVAL` defaults to `5m`
- `NIFTY_PERIOD` defaults to `5d`
- `TIMEZONE` defaults to `Asia/Kolkata`
- `SCHEDULE_START_IST` defaults to `09:55`
- `SCHEDULE_END_IST` defaults to `13:30`
- `SCHEDULE_INTERVAL_MINUTES` defaults to `5`
- `SCHEDULE_BUFFER_SECONDS` defaults to `10`
- `PAPER_TRADE_CAPITAL` defaults to `100000`
- `PAPER_TRADE_LOT_SIZE` defaults to `75`
- `PAPER_TRADE_SLIPPAGE_PCT` defaults to `0.75`
- `PAPER_TRADE_TARGET_PCT` defaults to `8`
- `PAPER_TRADE_MAX_SL_PCT` defaults to `8`
- `PAPER_TRADE_MONITOR_SECONDS` defaults to `5`
- `PAPER_TRADE_ENTRY_SECOND` defaults to `55`
- `ZERODHA_API_KEY` optional, enables broker option quotes when set
- `ZERODHA_API_SECRET` required for generating a fresh access token
- `ZERODHA_ACCESS_TOKEN` optional, enables broker option quotes when set
- `ZERODHA_REDIRECT_URL` defaults to `http://127.0.0.1:8000/kite/callback`
- `ZERODHA_OPTION_EXCHANGE` defaults to `NFO`
- `ZERODHA_UNDERLYING` defaults to `NIFTY`
- `ZERODHA_ENABLE_WEBSOCKET` defaults to `true`
- `ZERODHA_QUOTE_TIMEOUT_SECONDS` defaults to `2.0`
- `STATE_FILE` defaults to `bot_state.json`
- `RUN_LOGS_DIR` defaults to `logs/run_logs`
- `LOG_FILE` defaults to `logs/nifty_alert_bot.log`

## Run

Start everything together:

```bash
./run_all.sh
```

This launches:

- the live bot runner
- the dashboard API on `http://127.0.0.1:8000`
- the React dashboard on `http://127.0.0.1:5173`

Stop all services with `Ctrl+C`.

For LAN or ngrok access, `run_all.sh` now binds the API and dashboard to `0.0.0.0`, and the dashboard proxies `/api/*` requests to the local FastAPI server so remote browsers do not try to call their own `127.0.0.1`.

Run only the live bot:

```bash
python3 main.py --mode live
```

This runs only on weekdays at:

- `09:55:10 IST`
- `10:00:10 IST`
- `10:05:10 IST`
- continues every 5 minutes
- last run at `13:30:10 IST`

## Test Modes

Run one live scan immediately:

```bash
python3 main.py --mode once
```

Send a sample BUY alert:

```bash
python3 main.py --mode sample-alert --signal BUY
```

Send a sample SELL alert:

```bash
python3 main.py --mode sample-alert --signal SELL
```

## Dashboard

Start the dashboard API:

```bash
uvicorn dashboard_api:app --reload
```

Start the React dashboard:

```bash
cd dashboard
npm install
npm run dev
```

The dashboard will read from `http://127.0.0.1:8000/api/dashboard` by default.
It now also opens an SSE stream on `/api/dashboard/stream` so overview data updates live without fixed 30-second polling.

## Zerodha Login Flow

Two supported setups:

- Recommended backend callback:
  - set `ZERODHA_REDIRECT_URL=http://127.0.0.1:8000/kite/callback`
  - set the same redirect URL in Kite Connect
  - click `Connect Zerodha` in the dashboard
  - after login, FastAPI exchanges the `request_token` and saves `ZERODHA_ACCESS_TOKEN` into `.env`

- Existing Vite redirect:
  - keep the Kite redirect URL as `http://localhost:5173`
  - click `Connect Zerodha` in the dashboard
  - after login, the dashboard detects `request_token` in the URL, calls `/api/zerodha/exchange`, and saves `ZERODHA_ACCESS_TOKEN` into `.env`

In both cases, restart the bot process after the token is saved so the live paper-trading engine picks it up.

To confirm Zerodha is working:

- open the dashboard and check the `Zerodha Connection` panel
- `Health Check` should show `Working`
- `NIFTY 50` and `SENSEX` quote cards should show source `zerodha_rest`
- or open `http://127.0.0.1:8000/api/zerodha/health`

## What the dashboard shows

- bot status and last run message
- next scheduled IST execution time
- latest alert sent
- recent live alert history

The bot writes per-run structured logs locally during the session and archives them to MongoDB after the session close. The dashboard reads today's logs from local files and older archived dates from MongoDB.

## How it works

- The bot fetches recent 5-minute candles for `^NSEI`.
- It computes Supertrend `(10,1)` and `(10,3)` using Wilder ATR smoothing to better match TradingView-style behavior.
- A `BUY` signal is generated when both Supertrend trends turn bullish on a closed candle.
- A `SELL` signal is generated when both Supertrend trends turn bearish on a closed candle.
- Signals are routed into a paper-trading engine that:
  - enters only between `09:55 IST` and `13:30 IST`
  - keeps only one active trade at a time
  - waits one full candle after exit before allowing a new trade
  - buys the nearest ITM CE for `BUY` and nearest ITM PE for `SELL`
  - sizes quantity from `~₹100,000` capital and NIFTY lot size `75`
  - skips trades if stop-loss percentage is above `8%`
  - exits on stop-loss, target, or session close
  - prefers Zerodha option LTP for entry and exit monitoring when `ZERODHA_API_KEY` and `ZERODHA_ACCESS_TOKEN` are set
  - falls back to the synthetic option pricing model if Zerodha credentials, instruments, or live quotes are unavailable
- The bot checks the most recent closed candle and stores the last sent signal locally so it does not send duplicates.
- The live runner sleeps until the next scheduled IST slot instead of polling every minute.
- Logs are written to both the terminal and `logs/nifty_alert_bot.log`.
- Structured run logs are buffered in `logs/run_logs/*.jsonl` during the day and archived to MongoDB after session close.
- Paper trades and paper-trade events are stored in MongoDB in the `paper_trades` collection by default.

## Notes

- `yfinance` data can be delayed depending on market/data-source conditions.
- The bot uses the latest closed candle, not the still-forming candle.
