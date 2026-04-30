# 1m Option Contract Bot

Separate project wrapper for the 1-minute option-contract strategy.

It uses the shared trading engine from the parent repository, but runs with its
own defaults:

- `STRATEGY_MODE=option_contracts`
- `OPTION_CONTRACT_INTERVAL=1m`
- `SCHEDULE_INTERVAL_MINUTES=1`
- `SCHEDULE_BUFFER_SECONDS=2`
- `PAPER_TRADE_ENTRY_SECOND=2`
- `MONGODB_DATABASE=option_1m_bot`

## Setup

```bash
cd option_1m_project
cp .env.example .env
```

Edit `.env` and set:

- Telegram token/chat id
- MongoDB URI
- Zerodha key/secret/access token
- `OPTION_CONTRACT_1`
- `OPTION_CONTRACT_2`

Install dashboard dependencies if needed:

```bash
cd dashboard
npm install
cd ..
```

## Run

```bash
./run_all.sh
```

Defaults:

- API: `http://localhost:8100`
- React dashboard: `http://localhost:5174`
- Mongo database: `option_1m_bot`

## Notes

This project is intentionally scoped to the 1-minute option-contract bot. The
older combined dashboard remains in the parent project.
