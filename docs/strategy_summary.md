# Trading Strategy Summary

This document describes the current strategy used by the NIFTY 1m bot, the SENSEX 1m bot, and the Option Backtest module.

## 1. Strategy At A Glance

The system is built around a direct option-candle Supertrend strategy.

Instead of generating signals from the index chart and then trading options, the 1-minute strategy reads the option contract candles themselves. This means the signal, stop loss, target, and Supertrend reversal exit are all based on the traded option instrument.

The app currently supports two independent paper-trading lanes:

| Bot | Exchange | Underlying | Lot Size | Strategy Key |
| --- | --- | --- | --- | --- |
| NIFTY 1m Bot | NFO | NIFTY | 65 | `option_contracts_1m` |
| SENSEX 1m Bot | BFO | SENSEX | 20 | `option_contracts_1m_sensex` |

Both bots can run at the same time. A NIFTY trade and a SENSEX trade are independent because each lane has its own setup, state, balance, active trade, and trade history.

## 2. Daily Setup

Each bot needs a daily setup before trading.

The setup is saved for the current trading day and should be reviewed each morning.

| Input | Meaning |
| --- | --- |
| Contract 1 | Option side to watch, usually `CE` or `PE` |
| Contract 2 | Optional second option side |
| Entry Signal | Which Supertrend signal is allowed, usually `BUY` |
| Trade Window | Start and end time for allowing new entries |
| Starting Balance | Paper balance used for quantity calculation |
| Target % | Profit target from entry price |
| Max Signal Candle % | Skip trade if signal candle body is too large |
| Strike Offset | Constant offset added to nearest ATM strike |
| Stop Loss Mode | Signal candle stop loss or fixed percent stop loss |
| Stop Loss % | Fixed stop loss percent, or cap percent when applicable |

### Dynamic Contract Selection

The bot does not require a fixed strike like `24000PE`.

Instead, daily setup uses option sides:

```text
Contract 1 = PE
Contract 2 = CE
```

At runtime, the bot checks the latest spot price, rounds it to the nearest ATM strike, applies the configured strike offset, and resolves the live option contract.

Examples:

| Underlying | Spot | Nearest ATM | Offset | Side | Selected Contract Label |
| --- | ---: | ---: | ---: | --- | --- |
| NIFTY | 23721 | 23700 | 0 | PE | `N-23700PE` |
| NIFTY | 23721 | 23700 | 100 | CE | `N-23800CE` |
| SENSEX | 76080 | 76100 | -200 | PE | `S-75900PE` |

Contract 1 has priority when both configured contracts produce a valid signal at the same execution time.

## 3. Signal Rules

The strategy uses option candles and Supertrend indicators.

| Rule | Current Behavior |
| --- | --- |
| Candle timeframe | 1-minute option candles |
| Indicator 1 | Supertrend `(10, 1)` |
| Indicator 2 | Supertrend `(10, 3)` |
| Default signal mode | Both Supertrends must agree |
| Signal timing | Signal is confirmed only after candle close |
| Baseline behavior | Initial scan is used as baseline; bot waits for the next fresh signal |
| Duplicate handling | Same-candle duplicate signals are ignored |

The bot avoids entering just because the latest candle is already bullish or bearish when the app starts. It waits for a fresh signal after the baseline scan.

## 4. Entry Rules

Only one simulated trade can be active per bot lane.

NIFTY can have one active NIFTY trade, and SENSEX can have one active SENSEX trade at the same time.

| Rule | Behavior |
| --- | --- |
| Entry source | Option candle Supertrend signal |
| Entry timing | Signal candle close + configured entry second, currently `+2 seconds` |
| Contract priority | Contract 1 before Contract 2 |
| Quantity | Based on available paper cash and lot size |
| Cooldown | No cooldown is currently applied |
| Trade window | New entries only inside the configured setup window |
| Weekend behavior | Saturday/Sunday disabled unless force flag is enabled |

Quantity is calculated using available paper balance:

```text
raw_quantity = floor(available_balance / entry_price)
quantity = raw_quantity adjusted down to lot size
```

If quantity is less than one lot, the trade is skipped.

## 5. Trade Filters

Before entering, the bot checks whether the signal candle is acceptable.

### Signal Candle Body Filter

The signal candle body is calculated using open-close range:

```text
body_pct = abs(close - open) / open * 100
```

If this is greater than the configured max signal candle percent, the trade is skipped.

This avoids entering after a very stretched candle.

### Daily Profit Lock

If daily profit exceeds the configured threshold, new entries are stopped for the day.

Current default:

```text
PAPER_TRADE_DAILY_PROFIT_STOP_PCT = 15
```

Existing active trades can still be monitored and exited. The lock only blocks new entries.

## 6. Stop Loss Rules

The bot supports two stop loss modes.

| Mode | Behavior |
| --- | --- |
| Signal candle | Uses the option signal candle low for long BUY trades |
| Fixed percent | Uses a fixed percent from entry price |

For the default BUY-only style:

```text
stop_loss = low of the entry signal option candle
```

If the stop loss is wider than the configured max SL percent, it is capped.

Example:

```text
entry = 200
signal candle low = 175
raw SL distance = 12.5%
max SL = 8%
final SL = 184
```

This keeps risk bounded even when the signal candle low is too far away.

## 7. Target Rules

Target is calculated from entry price.

```text
target = entry_price * (1 + target_pct / 100)
```

For the 1m option strategy, the default target is usually:

```text
OPTION_CONTRACT_TARGET_PCT = 3
```

The target percent can be changed from daily setup.

## 8. Exit Rules

The bot monitors the active option trade until one exit condition is met.

| Exit Condition | Behavior |
| --- | --- |
| Stop loss hit | Exit when option price reaches SL |
| Target hit | Exit when option price reaches target |
| Supertrend reversal | Exit when Supertrend `(10,1)` reverses direction |
| Session close | Exit when trading session ends |

For Supertrend reversal:

```text
If Supertrend (10,1) changes direction on a candle,
exit at the close of that reversal candle.
```

Only one exit is applied. Once a trade exits, it is marked completed and saved.

## 9. Paper Trading Accounting

Paper trades simulate a realistic lifecycle.

Each trade stores:

| Field | Meaning |
| --- | --- |
| Entry price | Simulated option entry price |
| Exit price | Simulated option exit price |
| Quantity | Lot-adjusted quantity |
| Capital used | Entry price × quantity |
| Stop loss | Final SL after cap, if applicable |
| Target | Final target price |
| Gross PnL | Raw trade profit/loss |
| Charges | Approximate brokerage and charges |
| Net PnL | Gross PnL minus charges |
| Status | WIN or LOSS |
| Exit reason | Target, stop loss, Supertrend flip, or session close |

Balances are tracked separately for NIFTY and SENSEX.

After each completed trade:

```text
new_cash_balance = old_cash_balance + net_pnl
```

This means position sizing uses the updated balance over the day.

## 10. Option Backtest Strategy

The Option Backtest module lets you test the same option-candle strategy historically.

It is designed to answer:

> If I had traded these option sides using the same Supertrend rules, what would the trade history and PnL look like?

### Backtest Inputs

| Input | Meaning |
| --- | --- |
| Exchange | `NFO` for NIFTY, `BFO` for SENSEX |
| Contract 1 | `CE` or `PE` |
| Contract 2 | Optional second side |
| Start Date | First backtest date |
| End Date | Last backtest date |
| Balance | Capital used for quantity calculation |
| Lot Size | Lot size for the instrument |
| Target % | Target from entry price |
| Stop Loss % | Fixed SL or cap |
| Strike Offset | Offset from nearest ATM |
| Stop Loss Mode | Signal low or fixed percent |
| Entry Timing | Signal close or next minute |
| Trade Window | Intraday time window |
| VWAP Filter | Optional filter for BUY entries |

### Dynamic Historical Contract Selection

For `CE` or `PE` inputs, the backtest uses historical spot candles to resolve the strike each minute.

Process:

1. Fetch 1-minute spot candles for the selected date range.
2. Round each candle close to nearest ATM strike.
3. Apply strike offset.
4. Resolve the nearest valid option expiry for that candle date.
5. Fetch option candles for the resolved contracts.
6. Cache fetched candles locally for future reuse.

This prevents the backtest from incorrectly using only today’s latest contract for past dates.

Important limitation:

Zerodha does not reliably provide expired option candles after expiry. If an old expired contract was not previously cached, the backtest may not be able to fetch it.

### Backtest Signal And Entry

The backtest runs Supertrend on option candles.

| Rule | Behavior |
| --- | --- |
| Signal source | Option candles |
| Signal mode | Both Supertrends by default |
| Entry timing | Signal close or next-minute mode |
| Entry price | Uses 1-minute option candle execution price |
| One active trade | New signals are skipped while trade is active |

### Backtest Stop Loss And Target

The backtest follows the same risk model:

```text
target = entry_price + target_pct
stop_loss = signal candle low
```

If stop loss cap is enabled:

```text
If signal low is too far,
cap SL to configured Stop Loss %
```

### Backtest Exit Logic

The backtest exits on the first event that occurs:

1. Stop loss hit
2. Target hit
3. Supertrend `(10,1)` reversal
4. Session close

When target or SL is touched inside a 1-minute candle, the backtest uses the configured target/SL price instead of waiting for candle close.

## 11. Reports And Dashboard Output

The dashboard separates NIFTY and SENSEX results and also provides combined visibility.

Important report sections:

| Report | Purpose |
| --- | --- |
| Trade History | Completed trades with entry, exit, SL, target, and PnL |
| Current Active Trade | Open trade being monitored |
| Running PnL | Realized/unrealized strategy performance |
| Daily Summary | Trades, wins, losses, and realized PnL |
| Hourly Report | Wins/losses and PnL by exit hour |
| Weekday Report | PnL grouped Monday to Friday |
| CE/PE Breakdown | Option-type PnL and win/loss split |
| Contract Breakdown | Per-contract signals, trades, skips, and PnL |
| Run Logs | Per-run signal state and Supertrend values |

## 12. Mental Model

The strategy is easiest to understand in one line:

```text
Trade the option that is showing fresh Supertrend strength,
enter immediately after confirmation,
protect with signal-candle risk,
take quick target,
and exit if fast Supertrend reverses.
```

NIFTY and SENSEX use the same idea, but they are intentionally separated so one market does not affect the other market’s balance, active trade, or reports.
