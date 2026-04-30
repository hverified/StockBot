import { useEffect, useRef, useState } from "react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";
const TABLE_COLUMN_STORAGE_PREFIX = "dashboard-columns:";
const OVERVIEW_RANGE_OPTIONS = [
  { id: "today", label: "Today", tradesLabel: "Trades Today" },
  { id: "week", label: "This Week", tradesLabel: "Trades This Week" },
  { id: "month", label: "This Month", tradesLabel: "Trades This Month" },
  { id: "total", label: "Total", tradesLabel: "Trades Total" },
];
const PNL_REPORT_HOURS = Array.from({ length: 8 }, (_, index) => index + 9);
const WEEKDAY_REPORT_DAYS = [
  { index: 1, label: "Monday", shortLabel: "Mon" },
  { index: 2, label: "Tuesday", shortLabel: "Tue" },
  { index: 3, label: "Wednesday", shortLabel: "Wed" },
  { index: 4, label: "Thursday", shortLabel: "Thu" },
  { index: 5, label: "Friday", shortLabel: "Fri" },
];
const BACKTEST_INSTRUMENT_OPTIONS = [
  { id: "NIFTY", label: "NIFTY 50" },
  { id: "SENSEX", label: "SENSEX" },
];
const BACKTEST_SIGNAL_MODE_OPTIONS = [
  { id: "both", label: "Both ST" },
  { id: "st_10_1", label: "ST (10,1)" },
];
const BACKTEST_STOP_LOSS_MODES = [
  { id: "signal_low", label: "Signal low" },
  { id: "percent", label: "SL %" },
];
const BACKTEST_ENTRY_TIMING_OPTIONS = [
  { id: "signal_close", label: "Signal close" },
  { id: "next_minute", label: "+1 min" },
];
const OPTION_BACKTEST_EXCHANGES = ["NFO", "BFO"];
const OPTION_BACKTEST_ENTRY_SIGNALS = [
  { id: "BUY", label: "BUY" },
  { id: "SELL", label: "SELL" },
  { id: "BOTH", label: "Both" },
];
const NAV_OPTIONS = [
  { id: "overview", label: "Overview" },
  { id: "oneMinuteBot", label: "1m Bot" },
  { id: "trades", label: "Trades" },
  { id: "signals", label: "Signals" },
  { id: "reports", label: "Reports" },
  { id: "liveTrading", label: "Live Trading" },
  { id: "broker", label: "Broker" },
  { id: "logs", label: "Logs" },
  { id: "optionBacktest", label: "Option Backtest" },
];

function parseIstDate(value) {
  if (!value) return null;
  const native = new Date(value);
  if (!Number.isNaN(native.getTime())) return native;

  const match = String(value).match(
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) (AM|PM) IST$/,
  );
  if (!match) return null;

  const [, year, month, day, hourText, minute, second, meridiem] = match;
  let hour = Number(hourText) % 12;
  if (meridiem === "PM") hour += 12;
  const utcMillis = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    hour - 5,
    Number(minute) - 30,
    Number(second),
  );
  return new Date(utcMillis);
}

function getIstDateParts(value) {
  const parsed = value instanceof Date ? value : parseIstDate(value);
  if (!parsed) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(parsed);

  const lookup = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    hour: Number(lookup.hour),
  };
}

function makeIstDate(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day, -5, -30, 0));
}

function getOverviewRangeStart(rangeId) {
  if (rangeId === "total") return null;

  const todayParts = getIstDateParts(new Date());
  if (!todayParts) return null;

  if (rangeId === "month") {
    return makeIstDate(todayParts.year, todayParts.month, 1);
  }

  const todayStart = makeIstDate(
    todayParts.year,
    todayParts.month,
    todayParts.day,
  );
  if (rangeId === "week") {
    const todayCalendarDate = new Date(
      Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day),
    );
    const day = todayCalendarDate.getUTCDay();
    const mondayOffset = day === 0 ? 6 : day - 1;
    const mondayCalendarDate = new Date(
      todayCalendarDate.getTime() - mondayOffset * 24 * 60 * 60 * 1000,
    );
    return makeIstDate(
      mondayCalendarDate.getUTCFullYear(),
      mondayCalendarDate.getUTCMonth() + 1,
      mondayCalendarDate.getUTCDate(),
    );
  }

  return todayStart;
}

function getTradeExitTime(trade) {
  return trade.exit_time ?? trade.exitTime;
}

function getTradePnl(trade) {
  return Number(trade.net_pnl ?? trade.netPnl ?? 0);
}

function getTradeOptionType(trade) {
  const optionType = String(trade.option_type ?? trade.optionType ?? "").toUpperCase();
  return optionType === "CE" || optionType === "PE" ? optionType : "OTHER";
}

function roundCurrencyNumber(value) {
  return Math.round(Number(value ?? 0) * 100) / 100;
}

function buildHourlyPnlReport(trades, rangeId = "total") {
  const buckets = PNL_REPORT_HOURS.map((hour) => ({
    hour,
    label: `${String(hour).padStart(2, "0")}:00`,
    wins: 0,
    losses: 0,
    pnl: 0,
  }));

  for (const trade of filterTradesForRange(trades, rangeId)) {
    const exitDate = parseIstDate(getTradeExitTime(trade));
    const parts = getIstDateParts(exitDate);
    if (!parts || parts.hour < 9 || parts.hour > 16) continue;

    const bucket = buckets.find((item) => item.hour === parts.hour);
    if (!bucket) continue;

    const status = String(trade.status ?? "").toUpperCase();
    if (status === "WIN") bucket.wins += 1;
    if (status === "LOSS") bucket.losses += 1;
    bucket.pnl += getTradePnl(trade);
  }

  return buckets.map((bucket) => ({
    ...bucket,
    pnl: Math.round(bucket.pnl * 100) / 100,
  }));
}

function filterTradesForRange(trades, rangeId) {
  const rangeStart = getOverviewRangeStart(rangeId);
  return trades.filter((trade) => {
    const exitDate = parseIstDate(getTradeExitTime(trade));
    if (!exitDate) return false;
    return !rangeStart || exitDate >= rangeStart;
  });
}

function buildReportMetrics(trades, rangeId = "total") {
  const filteredTrades = filterTradesForRange(trades, rangeId);
  const totalTrades = filteredTrades.length;
  const wins = filteredTrades.filter(
    (trade) => String(trade.status ?? "").toUpperCase() === "WIN",
  );
  const losses = filteredTrades.filter(
    (trade) => String(trade.status ?? "").toUpperCase() === "LOSS",
  );
  const pnlValues = filteredTrades.map((trade) => getTradePnl(trade));
  const grossProfit = wins.reduce(
    (sum, trade) => sum + Math.max(0, getTradePnl(trade)),
    0,
  );
  const grossLoss = Math.abs(
    losses.reduce(
      (sum, trade) => sum + Math.min(0, getTradePnl(trade)),
      0,
    ),
  );
  const totalPnl = pnlValues.reduce((sum, value) => sum + value, 0);
  const averageWin = wins.length ? grossProfit / wins.length : 0;
  const averageLoss = losses.length ? grossLoss / losses.length : 0;

  return {
    totalTrades,
    totalPnl,
    winRate: totalTrades ? (wins.length / totalTrades) * 100 : 0,
    profitFactor: grossLoss
      ? grossProfit / grossLoss
      : grossProfit
        ? Infinity
        : 0,
    averageWin,
    averageLoss,
    bestTrade: pnlValues.length ? Math.max(...pnlValues) : 0,
    worstTrade: pnlValues.length ? Math.min(...pnlValues) : 0,
    expectancy: totalTrades ? totalPnl / totalTrades : 0,
  };
}

function buildWeekdayPnlReport(trades, rangeId = "total") {
  const buckets = WEEKDAY_REPORT_DAYS.map((day) => ({
    ...day,
    trades: 0,
    wins: 0,
    losses: 0,
    pnl: 0,
  }));

  for (const trade of filterTradesForRange(trades, rangeId)) {
    const exitDate = parseIstDate(getTradeExitTime(trade));
    if (!exitDate) continue;

    const parts = getIstDateParts(exitDate);
    if (!parts) continue;

    const calendarDate = new Date(
      Date.UTC(parts.year, parts.month - 1, parts.day),
    );
    const weekday = calendarDate.getUTCDay();
    const bucket = buckets.find((item) => item.index === weekday);
    if (!bucket) continue;

    const status = String(trade.status ?? "").toUpperCase();
    bucket.trades += 1;
    if (status === "WIN") bucket.wins += 1;
    if (status === "LOSS") bucket.losses += 1;
    bucket.pnl += getTradePnl(trade);
  }

  return buckets.map((bucket) => ({
    ...bucket,
    pnl: Math.round(bucket.pnl * 100) / 100,
  }));
}

function buildOptionTypeReport(trades, rangeId = "total") {
  const buckets = ["CE", "PE"].map((optionType) => ({
    optionType,
    trades: 0,
    wins: 0,
    losses: 0,
    pnl: 0,
    grossProfit: 0,
    grossLoss: 0,
    bestTrade: null,
    worstTrade: null,
  }));

  for (const trade of filterTradesForRange(trades, rangeId)) {
    const optionType = getTradeOptionType(trade);
    const bucket = buckets.find((item) => item.optionType === optionType);
    if (!bucket) continue;

    const pnl = getTradePnl(trade);
    const status = String(trade.status ?? "").toUpperCase();
    bucket.trades += 1;
    bucket.pnl += pnl;
    bucket.bestTrade = bucket.bestTrade === null ? pnl : Math.max(bucket.bestTrade, pnl);
    bucket.worstTrade = bucket.worstTrade === null ? pnl : Math.min(bucket.worstTrade, pnl);
    if (status === "WIN") bucket.wins += 1;
    if (status === "LOSS") bucket.losses += 1;
    if (pnl > 0) bucket.grossProfit += pnl;
    if (pnl < 0) bucket.grossLoss += Math.abs(pnl);
  }

  return buckets.map((bucket) => ({
    ...bucket,
    pnl: roundCurrencyNumber(bucket.pnl),
    averagePnl: bucket.trades ? roundCurrencyNumber(bucket.pnl / bucket.trades) : 0,
    winRate: bucket.trades ? (bucket.wins / bucket.trades) * 100 : 0,
    profitFactor: bucket.grossLoss
      ? bucket.grossProfit / bucket.grossLoss
      : bucket.grossProfit
        ? Infinity
        : 0,
    bestTrade: roundCurrencyNumber(bucket.bestTrade ?? 0),
    worstTrade: roundCurrencyNumber(bucket.worstTrade ?? 0),
  }));
}

function getStatusTone(status) {
  if (status === "alert_sent" || status === "sample_alert_sent") return "good";
  if (status === "error") return "bad";
  if (status === "duplicate") return "warn";
  if (status === "skipped") return "warn";
  return "neutral";
}

function formatDateTime(value) {
  if (!value) return "Not available";
  const parsed = parseIstDate(value);
  if (!parsed) return String(value);
  return parsed.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "medium",
    hour12: false,
    timeZone: "Asia/Kolkata",
  });
}

function formatTimeOnly(value) {
  if (!value) return "Not available";
  const parsed = parseIstDate(value);
  if (!parsed) return String(value);
  return parsed.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  });
}

function formatTableDateTime(value) {
  if (!value) return "Not available";
  const parsed = parseIstDate(value);
  if (!parsed) return String(value);
  return parsed.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  });
}

function formatSignal(signal) {
  if (!signal) return "No signal";
  const isBuy = signal === "BUY";
  return (
    <span className="signal-text">
      <span
        className={`signal-dot signal-dot--${isBuy ? "buy" : "sell"}`}
        aria-hidden="true"
      />
      <span>{isBuy ? "BUY" : "SELL"}</span>
    </span>
  );
}

function formatLogSignal(signal) {
  if (!signal || String(signal).trim().toUpperCase() === "NO_SIGNAL")
    return "-";
  return formatSignal(signal);
}

function formatSnakeLabel(value) {
  if (!value) return "Not available";
  return String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatStopLossSource(value) {
  if (!value) return "Not available";
  if (value === "option_signal_candle_low") return "Option signal candle low";
  if (value === "fallback_underlying_signal_candle_pct")
    return "Underlying % fallback";
  return formatSnakeLabel(value);
}

function formatCurrency(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "Not available";
  }

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function formatRelativePct(value, baseValue) {
  const numericValue = Number(value);
  const numericBase = Number(baseValue);
  if (
    !Number.isFinite(numericValue) ||
    !Number.isFinite(numericBase) ||
    numericBase === 0
  ) {
    return "";
  }
  const pct = (numericValue / numericBase) * 100;
  const sign = pct > 0 ? "+" : "";
  return ` (${sign}${pct.toFixed(2)}%)`;
}

function PnlValue({ value, baseValue = null, className = "" }) {
  const tone = getPnlTone(Number(value ?? 0));
  const relativePct = formatRelativePct(value, baseValue);
  return (
    <span
      className={`pnl-value pnl-value--${tone}${className ? ` ${className}` : ""}`}
    >
      {formatCurrency(value)}
      {relativePct ? (
        <span className="pnl-value__pct">{relativePct}</span>
      ) : null}
    </span>
  );
}

function formatCount(value) {
  if (value === null || value === undefined) return "0";
  return String(value);
}

function getPnlTone(value) {
  if (value > 0) return "good";
  if (value < 0) return "bad";
  return "neutral";
}

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "Not available";
  }

  return Number(value).toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  });
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "0.00%";
  }

  return `${Number(value).toFixed(2)}%`;
}

function formatRatio(value) {
  if (value === Infinity) return "∞";
  if (value === null || value === undefined || Number.isNaN(Number(value)))
    return "0.00";
  return Number(value).toFixed(2);
}

function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}

function getTodayInIst() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
  }).format(new Date());
}

function MetricCard({ label, value, tone = "neutral", valueClassName = "" }) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <p className="metric-label">{label}</p>
      <p
        className={`metric-value${valueClassName ? ` ${valueClassName}` : ""}`}
      >
        {value}
      </p>
    </article>
  );
}

function MarketQuoteCard({ quote }) {
  const change = Number(quote.change ?? 0);
  const tone = getPnlTone(change);
  const sign = change > 0 ? "+" : "";
  const sparkline = Array.isArray(quote.sparkline) ? quote.sparkline : [];
  const prices = sparkline
    .map((point) => Number(point.close))
    .filter((value) => Number.isFinite(value));
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const maxPrice = prices.length ? Math.max(...prices) : 0;
  const priceRange = maxPrice - minPrice || 1;
  const sparklinePath = prices
    .map((price, index) => {
      const x = prices.length === 1 ? 100 : (index / (prices.length - 1)) * 100;
      const y = 34 - ((price - minPrice) / priceRange) * 28;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <article className={`metric-card metric-card--${tone} quote-card`}>
      <div className="quote-card-layout">
        <div>
          <p className="metric-label">{quote.name}</p>
          <p className="metric-value">{formatNumber(quote.ltp)}</p>
          <p className={`quote-change quote-change--${tone}`}>
            {quote.change === null ||
            quote.change === undefined ||
            quote.changePct === null ||
            quote.changePct === undefined
              ? "Change not available"
              : `${sign}${formatNumber(quote.change)} (${sign}${formatNumber(quote.changePct)}%)`}
          </p>
        </div>
        <div className={`quote-sparkline quote-sparkline--${tone}`}>
          {sparklinePath ? (
            <svg
              viewBox="0 0 100 40"
              preserveAspectRatio="none"
              role="img"
              aria-label={`${quote.name} intraday mini chart`}
            >
              <path className="quote-sparkline__area" d={`${sparklinePath} L 100 40 L 0 40 Z`} />
              <path className="quote-sparkline__line" d={sparklinePath} />
            </svg>
          ) : (
            <span>No chart</span>
          )}
        </div>
      </div>
    </article>
  );
}

function HourlyPnlReport({ buckets, showPnl }) {
  const maxCount = Math.max(
    1,
    ...buckets.flatMap((bucket) => [bucket.wins, bucket.losses]),
  );
  const totalWins = buckets.reduce((sum, bucket) => sum + bucket.wins, 0);
  const totalLosses = buckets.reduce((sum, bucket) => sum + bucket.losses, 0);
  const totalPnl = buckets.reduce((sum, bucket) => sum + bucket.pnl, 0);

  return (
    <div className="pnl-report">
      <div className="pnl-report__summary">
        <span>
          Wins <strong>{totalWins}</strong>
        </span>
        <span>
          Losses <strong>{totalLosses}</strong>
        </span>
        {showPnl ? (
          <span>
            Total PnL <PnlValue value={totalPnl} />
          </span>
        ) : null}
      </div>

      <div
        className="pnl-report__chart"
        role="img"
        aria-label="Hourly win loss and PnL report from 09:00 to 16:00 IST"
      >
        <div className="pnl-report__y-axis">
          <span>{maxCount}</span>
          <span>{Math.max(0, Math.round(maxCount / 2))}</span>
          <span>0</span>
        </div>
        <div className="pnl-report__plot">
          {buckets.map((bucket) => {
            const winHeight = `${Math.max(4, (bucket.wins / maxCount) * 100)}%`;
            const lossHeight = `${Math.max(4, (bucket.losses / maxCount) * 100)}%`;
            return (
              <div key={bucket.hour} className="pnl-report__hour">
                <div className="pnl-report__bars">
                  <div
                    className="pnl-report__bar-wrap"
                    title={`${bucket.label} Wins: ${bucket.wins}`}
                  >
                    <span className="pnl-report__count">{bucket.wins}</span>
                    <span
                      className="pnl-report__bar pnl-report__bar--win"
                      style={{ height: winHeight }}
                    />
                  </div>
                  <div
                    className="pnl-report__bar-wrap"
                    title={`${bucket.label} Losses: ${bucket.losses}`}
                  >
                    <span className="pnl-report__count">{bucket.losses}</span>
                    <span
                      className="pnl-report__bar pnl-report__bar--loss"
                      style={{ height: lossHeight }}
                    />
                  </div>
                </div>
                {showPnl ? (
                  <div
                    className={`pnl-report__hour-pnl pnl-report__hour-pnl--${getPnlTone(bucket.pnl)}`}
                  >
                    {formatCurrency(bucket.pnl)}
                  </div>
                ) : null}
                <div className="pnl-report__x-label">{bucket.label}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="pnl-report__legend">
        <span>
          <i className="pnl-report__legend-dot pnl-report__legend-dot--win" />{" "}
          Wins
        </span>
        <span>
          <i className="pnl-report__legend-dot pnl-report__legend-dot--loss" />{" "}
          Losses
        </span>
      </div>
    </div>
  );
}

function WeekdayPnlReport({ buckets }) {
  const maxAbsPnl = Math.max(
    1,
    ...buckets.map((bucket) => Math.abs(bucket.pnl)),
  );

  return (
    <div className="weekday-report">
      {buckets.map((bucket) => {
        const tone = getPnlTone(bucket.pnl);
        const width = `${Math.max(4, (Math.abs(bucket.pnl) / maxAbsPnl) * 100)}%`;
        return (
          <article key={bucket.index} className="weekday-report__row">
            <div className="weekday-report__label">
              <strong>{bucket.label}</strong>
              <span>
                {bucket.trades} trades · {bucket.wins}W / {bucket.losses}L
              </span>
            </div>
            <div className="weekday-report__bar-track">
              <span
                className={`weekday-report__bar weekday-report__bar--${tone}`}
                style={{ width }}
              />
            </div>
            <div className="weekday-report__value">
              <PnlValue value={bucket.pnl} />
            </div>
          </article>
        );
      })}
    </div>
  );
}

function OptionTypeReport({ buckets }) {
  return (
    <div className="option-type-report">
      {buckets.map((bucket) => {
        const tone = getPnlTone(bucket.pnl);
        const totalDecided = bucket.wins + bucket.losses;
        return (
          <article
            key={bucket.optionType}
            className={`option-type-report__card option-type-report__card--${tone}`}
          >
            <div className="option-type-report__header">
              <span className={`option-type-badge option-type-badge--${bucket.optionType.toLowerCase()}`}>
                {bucket.optionType}
              </span>
              <PnlValue value={bucket.pnl} />
            </div>
            <div className="option-type-report__stats">
              <span>
                <strong>{bucket.trades}</strong>
                Trades
              </span>
              <span>
                <strong>
                  {bucket.wins}W / {bucket.losses}L
                </strong>
                Results
              </span>
              <span>
                <strong>{formatPercent(bucket.winRate)}</strong>
                Win rate
              </span>
              <span>
                <strong>{formatRatio(bucket.profitFactor)}</strong>
                Profit factor
              </span>
              <span>
                <strong>
                  <PnlValue value={bucket.averagePnl} />
                </strong>
                Avg PnL
              </span>
              <span>
                <strong>
                  <PnlValue value={bucket.bestTrade} />
                </strong>
                Best
              </span>
              <span>
                <strong>
                  <PnlValue value={bucket.worstTrade} />
                </strong>
                Worst
              </span>
              <span>
                <strong>{totalDecided}</strong>
                Closed
              </span>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function formatLogNumber(value) {
  if (value === null || value === undefined || value === "") return "-";
  const numericValue = Number(value);
  if (Number.isNaN(numericValue)) return value;
  return numericValue.toFixed(2);
}

function loadSelectedColumns(storageKey, columns) {
  const defaultIds = columns
    .filter((column) => column.defaultVisible !== false)
    .map((column) => column.id);
  try {
    const raw = window.localStorage.getItem(
      `${TABLE_COLUMN_STORAGE_PREFIX}${storageKey}`,
    );
    if (!raw) return defaultIds;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaultIds;
    const allowedIds = new Set(columns.map((column) => column.id));
    const filtered = parsed.filter((value) => allowedIds.has(value));
    return filtered.length ? filtered : defaultIds;
  } catch {
    return defaultIds;
  }
}

function ColumnPicker({
  label,
  columns,
  selected,
  onToggle,
  onReset,
  direction = "down",
}) {
  return (
    <details className={`column-picker column-picker--${direction}`}>
      <summary className="column-picker__summary">Columns</summary>
      <div className="column-picker__panel">
        <p className="column-picker__title">{label}</p>
        <div className="column-picker__options">
          {columns.map((column) => {
            const checked = selected.includes(column.id);
            return (
              <label key={column.id} className="column-picker__option">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(column.id)}
                />
                <span>{column.label}</span>
              </label>
            );
          })}
        </div>
        <button
          type="button"
          className="column-picker__reset"
          onClick={onReset}
        >
          Reset
        </button>
      </div>
    </details>
  );
}

function formatTrend(value) {
  if (value === 1 || value === "1") return { icon: "▲", tone: "good" };
  if (value === -1 || value === "-1") return { icon: "▼", tone: "bad" };
  return { icon: "-", tone: "neutral" };
}

function getLogContractSignals(log) {
  return Array.isArray(log?.contract_signals) ? log.contract_signals : [];
}

function getLogContractLabel(item) {
  return item?.input ?? item?.resolved_symbol ?? "Contract";
}

function ContractSignalList({ items, renderValue }) {
  if (!items.length) return null;
  return (
    <div className="log-contract-list">
      {items.map((item) => (
        <span
          key={`${getLogContractLabel(item)}-${item?.candle_time ?? item?.close ?? ""}`}
          className="log-contract-chip"
        >
          <span className="log-contract-chip__label">
            {getLogContractLabel(item)}
          </span>
          <span className="log-contract-chip__value">{renderValue(item)}</span>
        </span>
      ))}
    </div>
  );
}

export function App() {
  const [activeView, setActiveView] = useState("oneMinuteBot");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [theme, setTheme] = useState(
    () => window.localStorage.getItem("dashboard-theme") ?? "dark",
  );
  const [data, setData] = useState(null);
  const [logs, setLogs] = useState([]);
  const [logsSource, setLogsSource] = useState("none");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(true);
  const [logsStreamStatus, setLogsStreamStatus] = useState("idle");
  const [actionMessage, setActionMessage] = useState("");
  const [triggeringSignal, setTriggeringSignal] = useState("");
  const [deletingTradeId, setDeletingTradeId] = useState("");
  const [selectedDate, setSelectedDate] = useState(getTodayInIst());
  const [streamStatus, setStreamStatus] = useState("connecting");
  const [zerodhaAuthBusy, setZerodhaAuthBusy] = useState(false);
  const [contractForm, setContractForm] = useState({
    contract1: "",
    contract2: "",
    entrySignal: "BUY",
    scheduleStart: "09:20",
    scheduleEnd: "15:00",
    startingBalance: "100000",
    targetPct: "3",
    maxSignalCandlePct: "10",
    stopLossMode: "signal_low",
    stopLossPct: "8",
  });
  const [setupEditorOpen, setSetupEditorOpen] = useState(false);
  const [addMoneyAmount, setAddMoneyAmount] = useState("");
  const [contractSaving, setContractSaving] = useState(false);
  const [overviewRange, setOverviewRange] = useState(
    () => window.localStorage.getItem("overview-range") ?? "today",
  );
  const [showHourlyPnl, setShowHourlyPnl] = useState(
    () => window.localStorage.getItem("show-hourly-pnl") === "true",
  );
  const [backtestForm, setBacktestForm] = useState({
    instrument: "NIFTY",
    signalMode: "both",
    startDate: getTodayInIst(),
    endDate: getTodayInIst(),
    balance: "100000",
    targetPct: "8",
    stopLossPct: "8",
    stopLossMode: "signal_low",
    capStopLoss: true,
    requireVwap: false,
    entryTiming: "next_minute",
    entryTime: "09:30",
    exitTime: "15:10",
  });
  const [backtestResult, setBacktestResult] = useState(null);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestExportLoading, setBacktestExportLoading] = useState(false);
  const [optionBacktestForm, setOptionBacktestForm] = useState({
    exchange: "NFO",
    optionSymbol: "",
    optionSymbol2: "",
    interval: "1m",
    signalMode: "both",
    entrySignal: "BUY",
    startDate: getTodayInIst(),
    endDate: getTodayInIst(),
    balance: "100000",
    lotSize: "75",
    targetPct: "3",
    stopLossPct: "8",
    stopLossMode: "signal_low",
    capStopLoss: true,
    entryTiming: "next_minute",
    entryTime: "09:30",
    exitTime: "15:10",
  });
  const [optionBacktestResult, setOptionBacktestResult] = useState(null);
  const [optionBacktestLoading, setOptionBacktestLoading] = useState(false);
  const [liveActionBusy, setLiveActionBusy] = useState("");
  const contractFormDirtyRef = useRef(false);
  const hydratedContractSignatureRef = useRef("");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("dashboard-theme", theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem("overview-range", overviewRange);
  }, [overviewRange]);

  useEffect(() => {
    window.localStorage.setItem("show-hourly-pnl", String(showHourlyPnl));
  }, [showHourlyPnl]);

  useEffect(() => {
    const effectiveContracts = data?.strategyConfig?.effectiveContracts;
    if (!effectiveContracts) return;
    const signature = JSON.stringify({
      contract1: effectiveContracts.contract1 ?? "",
      contract2: effectiveContracts.contract2 ?? "",
      scheduleStart: data?.schedule?.start ?? "09:20",
      scheduleEnd: data?.schedule?.end ?? "15:00",
      startingBalance: data?.paperTrading?.startingBalance ?? data?.paperTrading?.capitalBase ?? 100000,
      entrySignal: "BUY",
      targetPct: data?.strategyConfig?.optionTargetPct ?? 3,
      maxSignalCandlePct: data?.strategyConfig?.maxSignalCandlePct ?? 10,
      stopLossMode: data?.strategyConfig?.stopLossMode ?? "signal_low",
      stopLossPct: data?.strategyConfig?.stopLossPct ?? 8,
      updatedAt: data?.strategyConfig?.dailyContracts?.updated_at ?? "",
    });
    if (contractFormDirtyRef.current) return;
    if (hydratedContractSignatureRef.current === signature) return;
    hydratedContractSignatureRef.current = signature;

    setContractForm({
      contract1: effectiveContracts.contract1 ?? "",
      contract2: effectiveContracts.contract2 ?? "",
      scheduleStart: data?.schedule?.start ?? "09:20",
      scheduleEnd: data?.schedule?.end ?? "15:00",
      startingBalance: String(data?.paperTrading?.startingBalance ?? data?.paperTrading?.capitalBase ?? 100000),
      entrySignal: "BUY",
      targetPct: String(data?.strategyConfig?.optionTargetPct ?? 3),
      maxSignalCandlePct: String(data?.strategyConfig?.maxSignalCandlePct ?? 10),
      stopLossMode: data?.strategyConfig?.stopLossMode ?? "signal_low",
      stopLossPct: String(data?.strategyConfig?.stopLossPct ?? 8),
    });
  }, [
    data?.strategyConfig?.date,
    data?.strategyConfig?.effectiveContracts?.contract1,
    data?.strategyConfig?.effectiveContracts?.contract2,
    data?.strategyConfig?.optionTargetPct,
    data?.strategyConfig?.maxSignalCandlePct,
    data?.strategyConfig?.stopLossMode,
    data?.strategyConfig?.stopLossPct,
    data?.paperTrading?.startingBalance,
    data?.paperTrading?.capitalBase,
    data?.schedule?.start,
    data?.schedule?.end,
  ]);

  useEffect(() => {
    let active = true;
    let eventSource;

    async function loadDashboardSnapshot(showLoader = false) {
      if (showLoader) setLoading(true);

      try {
        const response = await fetch(apiUrl("/api/dashboard"));
        if (!response.ok) {
          throw new Error(`Dashboard API failed with ${response.status}`);
        }

        const payload = await response.json();
        if (active) {
          setData(payload);
          setError("");
        }
      } catch (fetchError) {
        if (active) {
          setError(
            fetchError instanceof Error
              ? fetchError.message
              : "Unable to load dashboard data.",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    loadDashboardSnapshot(true);

    eventSource = new EventSource(apiUrl("/api/dashboard/stream"));
    eventSource.onopen = () => {
      if (active) {
        setStreamStatus("live");
        setError("");
      }
    };
    eventSource.onmessage = (event) => {
      if (!active) return;
      try {
        setData(JSON.parse(event.data));
        setLoading(false);
        setStreamStatus("live");
      } catch {
        setStreamStatus("degraded");
      }
    };
    eventSource.onerror = () => {
      if (!active) return;
      setStreamStatus("reconnecting");
      loadDashboardSnapshot(false);
    };

    return () => {
      active = false;
      eventSource?.close();
    };
  }, []);

  useEffect(() => {
    let active = true;
    const eventSource = new EventSource(apiUrl("/api/market-quotes/stream"));

    eventSource.onmessage = (event) => {
      if (!active) return;
      try {
        const payload = JSON.parse(event.data);
        setData((current) => ({
          ...(current ?? {}),
          generatedAt: payload.generatedAt ?? current?.generatedAt,
          marketQuotes: payload.marketQuotes ?? current?.marketQuotes ?? [],
        }));
      } catch {
        // Keep the main dashboard stream as fallback.
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      if (!active) return;
      const intervalId = window.setInterval(async () => {
        try {
          const response = await fetch(apiUrl("/api/dashboard"));
          if (!response.ok) return;
          const payload = await response.json();
          setData((current) => ({
            ...(current ?? {}),
            generatedAt: payload.generatedAt ?? current?.generatedAt,
            marketQuotes: payload.marketQuotes ?? current?.marketQuotes ?? [],
          }));
        } catch {
          // Ignore transient quote refresh failures.
        }
      }, 1000);
      eventSource.intervalId = intervalId;
    };

    return () => {
      active = false;
      if (eventSource.intervalId) window.clearInterval(eventSource.intervalId);
      eventSource.close();
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestToken = params.get("request_token");
    const loginStatus = params.get("status");

    if (!requestToken || loginStatus !== "success") {
      return undefined;
    }

    let active = true;

    async function exchangeToken() {
      setZerodhaAuthBusy(true);
      setActionMessage("");
      setError("");

      try {
        const response = await fetch(apiUrl("/api/zerodha/exchange"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            requestToken,
            saveToEnv: true,
          }),
        });

        if (!response.ok) {
          throw new Error(`Zerodha exchange failed with ${response.status}`);
        }

        const payload = await response.json();
        if (active) {
          setActionMessage(
            payload.message
              ? `${payload.message} Restart the bot process to use the new token.`
              : "Zerodha access token saved. Restart the bot process to use it.",
          );
        }

        const cleanUrl = `${window.location.pathname}${window.location.hash || ""}`;
        window.history.replaceState({}, document.title, cleanUrl);
      } catch (exchangeError) {
        if (active) {
          setError(
            exchangeError instanceof Error
              ? exchangeError.message
              : "Unable to exchange Zerodha request token.",
          );
        }
      } finally {
        if (active) {
          setZerodhaAuthBusy(false);
        }
      }
    }

    exchangeToken();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    let eventSource;

    async function loadLogsSnapshot() {
      setLogsLoading(true);
      try {
        const response = await fetch(apiUrl(`/api/logs?date=${selectedDate}`));
        if (!response.ok) {
          throw new Error(`Run logs API failed with ${response.status}`);
        }

        const payload = await response.json();
        if (active) {
          setLogs(payload.logs ?? []);
          setLogsSource(payload.source ?? "none");
        }
      } catch (fetchError) {
        if (active) {
          setError(
            fetchError instanceof Error
              ? fetchError.message
              : "Unable to load run logs.",
          );
          setLogsStreamStatus("degraded");
        }
      } finally {
        if (active) {
          setLogsLoading(false);
        }
      }
    }

    loadLogsSnapshot();

    if (activeView === "logs") {
      setLogsStreamStatus("connecting");
      eventSource = new EventSource(
        apiUrl(`/api/logs/stream?date=${selectedDate}`),
      );
      eventSource.onopen = () => {
        if (active) setLogsStreamStatus("live");
      };
      eventSource.onmessage = (event) => {
        if (!active) return;
        try {
          const payload = JSON.parse(event.data);
          setLogs(payload.logs ?? []);
          setLogsSource(payload.source ?? "none");
          setLogsLoading(false);
          setLogsStreamStatus("live");
        } catch {
          setLogsStreamStatus("degraded");
        }
      };
      eventSource.onerror = () => {
        if (!active) return;
        setLogsStreamStatus("reconnecting");
        loadLogsSnapshot();
      };
    } else {
      setLogsStreamStatus("idle");
    }

    return () => {
      active = false;
      eventSource?.close();
    };
  }, [activeView, selectedDate]);

  async function triggerSampleAlert(signal) {
    setTriggeringSignal(signal);
    setActionMessage("");
    setError("");

    try {
      const response = await fetch(apiUrl("/api/sample-alert"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ signal }),
      });

      if (!response.ok) {
        throw new Error(`Sample alert request failed with ${response.status}`);
      }

      const payload = await response.json();
      setActionMessage(payload.message ?? `Sample ${signal} alert triggered.`);

      const dashboardResponse = await fetch(apiUrl("/api/dashboard"));
      if (!dashboardResponse.ok) {
        throw new Error(
          `Dashboard refresh failed with ${dashboardResponse.status}`,
        );
      }

      setData(await dashboardResponse.json());

      const logsResponse = await fetch(
        apiUrl(`/api/logs?date=${selectedDate}`),
      );
      if (logsResponse.ok) {
        const logsPayload = await logsResponse.json();
        setLogs(logsPayload.logs ?? []);
        setLogsSource(logsPayload.source ?? "none");
      }
    } catch (triggerError) {
      setError(
        triggerError instanceof Error
          ? triggerError.message
          : "Unable to trigger sample alert.",
      );
    } finally {
      setTriggeringSignal("");
      setLoading(false);
    }
  }

  function updateBacktestField(field, value) {
    setBacktestForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function updateOptionBacktestField(field, value) {
    setOptionBacktestForm((current) => ({
      ...current,
      [field]: value,
      ...(field === "exchange" && value === "BFO"
        ? { lotSize: current.lotSize === "75" ? "20" : current.lotSize }
        : {}),
      ...(field === "exchange" && value === "NFO"
        ? { lotSize: current.lotSize === "20" ? "75" : current.lotSize }
        : {}),
    }));
  }

  function updateContractField(field, value) {
    const normalizedValue =
      field === "contract1" || field === "contract2"
        ? value.toUpperCase().replace(/\s+/g, "")
        : value;
    contractFormDirtyRef.current = true;
    setContractForm((current) => ({
      ...current,
      [field]: normalizedValue,
    }));
  }

  async function saveStrategyContracts(event) {
    event.preventDefault();
    setContractSaving(true);
    setActionMessage("");
    setError("");

    try {
      const response = await fetch(apiUrl("/api/strategy/contracts"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...contractForm,
          startingBalance: Number(contractForm.startingBalance),
          targetPct: Number(contractForm.targetPct),
          maxSignalCandlePct: Number(contractForm.maxSignalCandlePct),
          stopLossPct: Number(contractForm.stopLossPct),
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(
          payload.detail ?? `Contract save failed with ${response.status}`,
        );
      }

      const payload = await response.json();
      setActionMessage(payload.message ?? "Contracts saved for today.");
      contractFormDirtyRef.current = false;
      hydratedContractSignatureRef.current = "";

      const dashboardResponse = await fetch(apiUrl("/api/dashboard"));
      if (dashboardResponse.ok) {
        setData(await dashboardResponse.json());
      }
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save contracts.",
      );
    } finally {
      setContractSaving(false);
    }
  }

  async function addPaperBalance(event) {
    event.preventDefault();
    const amount = Number(addMoneyAmount);
    if (!amount || amount <= 0) {
      setError("Enter an amount greater than 0.");
      return;
    }

    setActionMessage("");
    setError("");
    try {
      const response = await fetch(apiUrl("/api/paper-balance/add"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ amount }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.detail ?? `Balance update failed with ${response.status}`);
      }
      const payload = await response.json();
      setActionMessage(payload.message ?? "Paper balance updated.");
      setAddMoneyAmount("");
      const dashboardResponse = await fetch(apiUrl("/api/dashboard"));
      if (dashboardResponse.ok) setData(await dashboardResponse.json());
    } catch (balanceError) {
      setError(
        balanceError instanceof Error
          ? balanceError.message
          : "Unable to add money.",
      );
    }
  }

  async function deleteTrade(tradeId) {
    if (!tradeId || deletingTradeId) return;
    const confirmed = window.confirm(
      "Delete this trade from dashboard history and calculations?",
    );
    if (!confirmed) return;

    setDeletingTradeId(tradeId);
    setActionMessage("");
    setError("");

    try {
      const response = await fetch(
        apiUrl(`/api/paper-trades/${encodeURIComponent(tradeId)}`),
        { method: "DELETE" },
      );

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(
          payload.detail ?? `Trade delete failed with ${response.status}`,
        );
      }

      const payload = await response.json();
      setActionMessage(payload.message ?? "Trade deleted.");

      const dashboardResponse = await fetch(apiUrl("/api/dashboard"));
      if (dashboardResponse.ok) {
        setData(await dashboardResponse.json());
      }
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete trade.",
      );
    } finally {
      setDeletingTradeId("");
    }
  }

  async function runBacktest(event) {
    event.preventDefault();
    setBacktestLoading(true);
    setActionMessage("");
    setError("");

    try {
      const response = await fetch(apiUrl("/api/backtest"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          instrument: backtestForm.instrument,
          signalMode: backtestForm.signalMode,
          startDate: backtestForm.startDate,
          endDate: backtestForm.endDate,
          balance: Number(backtestForm.balance),
          targetPct: Number(backtestForm.targetPct),
          stopLossPct: Number(backtestForm.stopLossPct),
          stopLossMode: backtestForm.stopLossMode,
          capStopLoss: Boolean(backtestForm.capStopLoss),
          entryTiming: backtestForm.entryTiming,
          entryTime: backtestForm.entryTime,
          exitTime: backtestForm.exitTime,
        }),
      });

      if (!response.ok) {
        throw new Error(`Backtest failed with ${response.status}`);
      }

      setBacktestResult(await response.json());
    } catch (backtestError) {
      setError(
        backtestError instanceof Error
          ? backtestError.message
          : "Unable to run backtest.",
      );
    } finally {
      setBacktestLoading(false);
    }
  }

  async function exportBacktestCsv() {
    if (!backtestResult?.trades?.length) {
      setError("Run a backtest with trades before exporting CSV.");
      return;
    }

    setBacktestExportLoading(true);
    setActionMessage("");
    setError("");

    try {
      const response = await fetch(apiUrl("/api/backtest/export"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ result: backtestResult }),
      });

      if (!response.ok) {
        throw new Error(`Backtest CSV export failed with ${response.status}`);
      }

      const payload = await response.json();
      setActionMessage(payload.message ?? "Backtest CSV saved.");
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : "Unable to export backtest CSV.",
      );
    } finally {
      setBacktestExportLoading(false);
    }
  }

  async function exportOptionBacktestReportCsv() {
    if (!optionBacktestResult) {
      setError("Run an option backtest before saving the report CSV.");
      return;
    }

    setBacktestExportLoading(true);
    setActionMessage("");
    setError("");

    try {
      const response = await fetch(apiUrl("/api/backtest/export"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          result: optionBacktestResult,
          reportType: "option_summary",
        }),
      });

      if (!response.ok) {
        throw new Error(`Option report CSV export failed with ${response.status}`);
      }

      const payload = await response.json();
      setActionMessage(payload.message ?? "Option report CSV saved.");
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : "Unable to export option report CSV.",
      );
    } finally {
      setBacktestExportLoading(false);
    }
  }

  async function runOptionContractBacktest(event) {
    event.preventDefault();
    setOptionBacktestLoading(true);
    setActionMessage("");
    setError("");

    try {
      const response = await fetch(apiUrl("/api/backtest/option-contract"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          exchange: optionBacktestForm.exchange,
          optionSymbol: optionBacktestForm.optionSymbol.trim().toUpperCase(),
          optionSymbol2: optionBacktestForm.optionSymbol2.trim().toUpperCase(),
          interval: optionBacktestForm.interval,
          signalMode: optionBacktestForm.signalMode,
          entrySignal: optionBacktestForm.entrySignal,
          startDate: optionBacktestForm.startDate,
          endDate: optionBacktestForm.endDate,
          balance: Number(optionBacktestForm.balance),
          lotSize: Number(optionBacktestForm.lotSize),
          targetPct: Number(optionBacktestForm.targetPct),
          stopLossPct: Number(optionBacktestForm.stopLossPct),
          stopLossMode: optionBacktestForm.stopLossMode,
          capStopLoss: Boolean(optionBacktestForm.capStopLoss),
          requireVwap: Boolean(optionBacktestForm.requireVwap),
          entryTiming: optionBacktestForm.entryTiming,
          entryTime: optionBacktestForm.entryTime,
          exitTime: optionBacktestForm.exitTime,
        }),
      });

      if (!response.ok) {
        throw new Error(`Option backtest failed with ${response.status}`);
      }

      setOptionBacktestResult(await response.json());
    } catch (backtestError) {
      setError(
        backtestError instanceof Error
          ? backtestError.message
          : "Unable to run option contract backtest.",
      );
    } finally {
      setOptionBacktestLoading(false);
    }
  }

  const recentAlerts = data?.recentAlerts ?? [];
  const status = data?.status ?? {};
  const schedule = data?.schedule ?? {};
  const strategyConfig = data?.strategyConfig ?? {};
  const marketQuotes = data?.marketQuotes ?? [];
  const paperTrading = data?.paperTrading ?? {};
  const liveTrading = data?.liveTrading ?? {};
  const liveTradingStatus = liveTrading.status ?? {};
  const liveOrders = liveTrading.orders ?? [];
  const liveTrades = liveTrading.trades ?? [];
  const livePositions = liveTrading.positions ?? {};
  const liveMargins = liveTrading.margins ?? {};
  const liveBalance = liveTrading.balance ?? {};
  const oneMinuteLiveSetup = strategyConfig.strategySetups?.option_contracts_1m ?? {};
  const dailySetupSavedToday = Boolean(strategyConfig.usesDailyContracts);
  const dailySetupSavedAt = strategyConfig.dailyContracts?.updated_at;
  const dailySetupEditorOpen = setupEditorOpen || !dailySetupSavedToday;
  const activeTrade = paperTrading.activeTrade ?? null;
  const activeTrades = paperTrading.activeTrades ?? (activeTrade ? [activeTrade] : []);
  const tradeHistory = paperTrading.tradeHistory ?? [];
  const summaryByRange = paperTrading.summaryByRange ?? {};
  const dailySummary = paperTrading.dailySummary ?? {};
  const zerodha = data?.zerodha ?? {};
  const selectedRangeSummary = summaryByRange[overviewRange] ??
    summaryByRange.today ?? {
      runningPnl: paperTrading.runningPnl ?? 0,
      realizedPnl: paperTrading.realizedPnl ?? 0,
      unrealizedPnl: activeTrade?.unrealizedPnl ?? 0,
      tradeCount: dailySummary.tradeCount ?? 0,
      winCount: dailySummary.winCount ?? 0,
      lossCount: dailySummary.lossCount ?? 0,
    };
  const selectedRangeMeta =
    OVERVIEW_RANGE_OPTIONS.find((option) => option.id === overviewRange) ??
    OVERVIEW_RANGE_OPTIONS[0];
  const winsLosses = `${formatCount(selectedRangeSummary.winCount)} / ${formatCount(selectedRangeSummary.lossCount)}`;
  const hourlyPnlReport = buildHourlyPnlReport(tradeHistory, overviewRange);
  const reportMetrics = buildReportMetrics(tradeHistory, overviewRange);
  const weekdayPnlReport = buildWeekdayPnlReport(tradeHistory, overviewRange);
  const optionTypeReport = buildOptionTypeReport(tradeHistory, overviewRange);
  const backtestTrades = backtestResult?.trades ?? [];
  const backtestHourlyPnlReport = buildHourlyPnlReport(backtestTrades, "total");
  const backtestWeekdayPnlReport = buildWeekdayPnlReport(backtestTrades, "total");
  const optionBacktestTrades = optionBacktestResult?.trades ?? [];
  const optionBacktestHourlyPnlReport = buildHourlyPnlReport(optionBacktestTrades, "total");
  const optionBacktestWeekdayPnlReport = buildWeekdayPnlReport(optionBacktestTrades, "total");
  const logCounts = logs.reduce(
    (counts, log) => {
      const statusValue = String(log.status ?? "unknown").toLowerCase();
      counts.total += 1;
      if (statusValue === "error") counts.errors += 1;
      if (statusValue === "skipped" || statusValue === "duplicate")
        counts.skipped += 1;
      if (
        statusValue === "alert_sent" ||
        statusValue.includes("win") ||
        statusValue.includes("loss")
      )
        counts.actions += 1;
      return counts;
    },
    { total: 0, errors: 0, skipped: 0, actions: 0 },
  );
  const openTradeLabel = activeTrade ? (
    <span className="open-trade-label">
      {formatSignal(activeTrade.signal)}
      <span className="open-trade-label__sep">·</span>
      <span>
        {activeTrade.option_symbol ?? activeTrade.optionSymbol ?? "Contract"}
      </span>
    </span>
  ) : (
    "No active trade"
  );

  const isOneMinuteOptionTrade = (trade) =>
    String(trade?.strategy_mode ?? trade?.strategyMode ?? "").toLowerCase() ===
    "option_contracts";
  const oneMinuteOptionTrades = tradeHistory.filter(isOneMinuteOptionTrade);
  const oneMinuteActiveTrades = activeTrades.filter(isOneMinuteOptionTrade);

  function buildBotPageSummary(trades, currentActiveTrades) {
    const rangeTrades = filterTradesForRange(trades, overviewRange);
    const realizedPnl = rangeTrades.reduce(
      (sum, trade) => sum + getTradePnl(trade),
      0,
    );
    const unrealizedPnl = currentActiveTrades.reduce(
      (sum, trade) => sum + Number(trade.unrealizedPnl ?? 0),
      0,
    );
    const winCount = rangeTrades.filter(
      (trade) => String(trade.status ?? "").toUpperCase() === "WIN",
    ).length;
    const lossCount = rangeTrades.filter(
      (trade) => String(trade.status ?? "").toUpperCase() === "LOSS",
    ).length;
    return {
      runningPnl: roundCurrencyNumber(realizedPnl + unrealizedPnl),
      realizedPnl: roundCurrencyNumber(realizedPnl),
      unrealizedPnl: roundCurrencyNumber(unrealizedPnl),
      tradeCount: rangeTrades.length,
      winCount,
      lossCount,
    };
  }

  const oneMinuteBotSummary = buildBotPageSummary(
    oneMinuteOptionTrades,
    oneMinuteActiveTrades,
  );
  const signalAlertColumns = [
    { id: "signal", label: "Signal" },
    { id: "optionSymbol", label: "Contract" },
    { id: "close", label: "Close" },
    { id: "st_10_1", label: "ST (10,1)" },
    { id: "st_10_3", label: "ST (10,3)" },
    { id: "candleTime", label: "Candle Time" },
    { id: "alertTime", label: "Alert Time" },
  ];
  const tradeHistoryColumns = [
    { id: "signal", label: "Signal" },
    { id: "option_symbol", label: "Contract" },
    { id: "entry_time", label: "Entry Time" },
    { id: "exit_time", label: "Exit Time" },
    { id: "quantity", label: "Qty" },
    { id: "capital_used", label: "Capital" },
    { id: "entry_price", label: "Entry" },
    { id: "exit_price", label: "Exit" },
    { id: "stop_loss_price", label: "SL" },
    { id: "stop_loss_source", label: "SL Source" },
    { id: "target_price", label: "Target" },
    { id: "net_pnl", label: "Net PnL" },
    { id: "status", label: "Status" },
    { id: "actions", label: "Actions" },
  ];
  const runLogColumns = [
    { id: "run_at", label: "Run Time" },
    { id: "strategy_mode", label: "Mode" },
    { id: "option_symbol", label: "Contract" },
    { id: "status", label: "Status" },
    { id: "signal", label: "Signal" },
    { id: "close", label: "Close" },
    { id: "st_10_1", label: "ST (10,1)" },
    { id: "st_10_3", label: "ST (10,3)" },
    { id: "st_10_1_trend", label: "Fast Trend" },
    { id: "st_10_3_trend", label: "Slow Trend" },
    { id: "message", label: "Message" },
  ];

  const [selectedSignalAlertColumns, setSelectedSignalAlertColumns] = useState(
    () => loadSelectedColumns("signal-alerts", signalAlertColumns),
  );
  const [selectedTradeHistoryColumns, setSelectedTradeHistoryColumns] =
    useState(() => loadSelectedColumns("trade-history", tradeHistoryColumns));
  const [selectedRunLogColumns, setSelectedRunLogColumns] = useState(() =>
    loadSelectedColumns("run-logs", runLogColumns),
  );

  useEffect(() => {
    window.localStorage.setItem(
      `${TABLE_COLUMN_STORAGE_PREFIX}signal-alerts`,
      JSON.stringify(selectedSignalAlertColumns),
    );
  }, [selectedSignalAlertColumns]);

  useEffect(() => {
    window.localStorage.setItem(
      `${TABLE_COLUMN_STORAGE_PREFIX}trade-history`,
      JSON.stringify(selectedTradeHistoryColumns),
    );
  }, [selectedTradeHistoryColumns]);

  useEffect(() => {
    window.localStorage.setItem(
      `${TABLE_COLUMN_STORAGE_PREFIX}run-logs`,
      JSON.stringify(selectedRunLogColumns),
    );
  }, [selectedRunLogColumns]);

  function toggleColumn(columnId, selected, setSelected, columns) {
    setSelected((current) => {
      const isSelected = current.includes(columnId);
      if (isSelected) {
        if (current.length === 1) return current;
        return current.filter((id) => id !== columnId);
      }
      const ordered = columns.map((column) => column.id);
      return ordered.filter((id) => id === columnId || current.includes(id));
    });
  }

  const visibleSignalAlertColumns = signalAlertColumns.filter((column) =>
    selectedSignalAlertColumns.includes(column.id),
  );
  const visibleTradeHistoryColumns = tradeHistoryColumns.filter((column) =>
    selectedTradeHistoryColumns.includes(column.id),
  );
  const visibleRunLogColumns = runLogColumns.filter((column) =>
    selectedRunLogColumns.includes(column.id),
  );
  const activeNavOption =
    NAV_OPTIONS.find((option) => option.id === activeView) ?? NAV_OPTIONS[0];

  function changeActiveView(viewId) {
    setActiveView(viewId);
    setMobileMenuOpen(false);
  }

  function connectZerodha() {
    if (!zerodha.loginUrl) {
      setError("ZERODHA_API_KEY is not configured in the backend.");
      return;
    }
    window.location.href = zerodha.loginUrl;
  }

  async function refreshDashboardData() {
    const response = await fetch(apiUrl("/api/dashboard"));
    if (!response.ok) {
      throw new Error(`Dashboard refresh failed with ${response.status}`);
    }
    setData(await response.json());
  }

  async function refreshLiveTradingData() {
    const response = await fetch(apiUrl("/api/live-trading"));
    if (!response.ok) {
      throw new Error(`Live trading refresh failed with ${response.status}`);
    }
    const livePayload = await response.json();
    setData((current) => ({
      ...(current ?? {}),
      liveTrading: livePayload,
    }));
  }

  async function toggleLiveTrading(enabled) {
    setLiveActionBusy("toggle");
    setError("");
    setActionMessage("");
    try {
      const response = await fetch(apiUrl("/api/live-trading/toggle"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.detail ?? `Live trading toggle failed with ${response.status}`);
      }
      setActionMessage(enabled ? "Live trading enabled." : "Live trading disabled.");
      await refreshLiveTradingData();
    } catch (liveError) {
      setError(liveError instanceof Error ? liveError.message : "Unable to update live trading.");
    } finally {
      setLiveActionBusy("");
    }
  }

  async function cancelLiveOrder(orderId) {
    setLiveActionBusy(`cancel-${orderId}`);
    setError("");
    setActionMessage("");
    try {
      const response = await fetch(apiUrl(`/api/live-trading/orders/${orderId}`), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variety: "regular" }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.detail ?? `Order cancel failed with ${response.status}`);
      }
      setActionMessage(`Live order cancelled: ${orderId}`);
      await refreshLiveTradingData();
    } catch (liveError) {
      setError(liveError instanceof Error ? liveError.message : "Unable to cancel live order.");
    } finally {
      setLiveActionBusy("");
    }
  }

  function toggleTheme() {
    setTheme((currentTheme) => (currentTheme === "dark" ? "light" : "dark"));
  }

  function renderBotPage({
    eyebrow,
    title,
    subtitle,
    scheduleLabel,
    trades,
    currentActiveTrades,
    summary,
    showContracts,
  }) {
    const firstActiveTrade = currentActiveTrades[0] ?? null;
    return (
      <section className="section-block">
        <div className="section-heading">
          <p className="eyebrow">{eyebrow}</p>
          <h2 className="section-title">{title}</h2>
          <p className="section-copy">{subtitle}</p>
        </div>

        <div
          className="range-switcher"
          role="tablist"
          aria-label={`${title} range`}
        >
          {OVERVIEW_RANGE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`range-chip ${overviewRange === option.id ? "range-chip--active" : ""}`}
              onClick={() => setOverviewRange(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <section className="metrics-grid">
          <MetricCard label="Schedule" value={scheduleLabel} />
          <MetricCard
            label="Running PnL"
            value={
              <PnlValue
                value={summary.runningPnl}
                baseValue={paperTrading.capitalBase}
              />
            }
            tone={getPnlTone(summary.runningPnl)}
          />
          <MetricCard
            label="Realized PnL"
            value={
              <PnlValue
                value={summary.realizedPnl}
                baseValue={paperTrading.capitalBase}
              />
            }
            tone={getPnlTone(summary.realizedPnl)}
          />
          <MetricCard
            label="Unrealized PnL"
            value={
              <PnlValue
                value={summary.unrealizedPnl}
                baseValue={paperTrading.capitalBase}
              />
            }
            tone={getPnlTone(summary.unrealizedPnl)}
          />
          <MetricCard label={selectedRangeMeta.tradesLabel} value={formatCount(summary.tradeCount)} />
          <MetricCard
            label="Wins / Losses"
            value={`${formatCount(summary.winCount)} / ${formatCount(summary.lossCount)}`}
          />
          {showContracts ? (
            <MetricCard
              label="Cash Balance"
              value={<PnlValue value={paperTrading.cashBalance ?? paperTrading.capitalBase} />}
              tone={getPnlTone(paperTrading.cashBalance ?? paperTrading.capitalBase)}
            />
          ) : null}
        </section>

        {showContracts ? (
          <section className="content-grid">
          <article className="panel">
            <div className="panel-header">
              <div>
                <p className="panel-title">Option Contracts</p>
                <p className="panel-subtitle">
                  Daily contracts used by the 1-minute option bot.
                </p>
              </div>
            </div>
            <dl className="status-list">
              <div>
                <dt>Contract 1</dt>
                <dd>{strategyConfig.effectiveContracts?.contract1 || "-"}</dd>
              </div>
              <div>
                <dt>Contract 2</dt>
                <dd>{strategyConfig.effectiveContracts?.contract2 || "-"}</dd>
              </div>
              <div>
                <dt>Saved Today</dt>
                <dd>{strategyConfig.usesDailyContracts ? "Yes" : "No"}</dd>
              </div>
            </dl>
          </article>
          <article className="panel">
            <div className="panel-header">
              <div>
                <p className="panel-title">Add Paper Money</p>
                <p className="panel-subtitle">
                  Increase the live paper balance used for the next trade.
                </p>
              </div>
            </div>
            <form className="backtest-form" onSubmit={addPaperBalance}>
              <label className="form-field">
                Amount
                <input
                  type="number"
                  min="1"
                  value={addMoneyAmount}
                  onChange={(event) => setAddMoneyAmount(event.target.value)}
                  placeholder="10000"
                />
              </label>
              <button type="submit" className="action-button">
                Add Money
              </button>
            </form>
          </article>
          </section>
        ) : null}

        <section className="content-grid">
          <article className="panel">
            <div className="panel-header">
              <div>
                <p className="panel-title">Current Active Trade</p>
                <p className="panel-subtitle">
                  Active trade state for this bot only.
                </p>
              </div>
            </div>
            {firstActiveTrade ? (
              <dl className="status-list">
                <div>
                  <dt>Contract</dt>
                  <dd>{firstActiveTrade.option_symbol ?? "Not available"}</dd>
                </div>
                <div>
                  <dt>Signal</dt>
                  <dd>{formatSignal(firstActiveTrade.signal)}</dd>
                </div>
                <div>
                  <dt>Entry Time</dt>
                  <dd>{formatDateTime(firstActiveTrade.entry_time)}</dd>
                </div>
                <div>
                  <dt>Entry</dt>
                  <dd>{formatCurrency(firstActiveTrade.entry_price)}</dd>
                </div>
                <div>
                  <dt>Live</dt>
                  <dd>{formatCurrency(firstActiveTrade.livePrice)}</dd>
                </div>
                <div>
                  <dt>Unrealized</dt>
                  <dd>
                    <PnlValue
                      value={firstActiveTrade.unrealizedPnl}
                      baseValue={firstActiveTrade.capital_used}
                    />
                  </dd>
                </div>
                <div>
                  <dt>SL</dt>
                  <dd>{formatCurrency(firstActiveTrade.stop_loss_price)}</dd>
                </div>
                <div>
                  <dt>Target</dt>
                  <dd>{formatCurrency(firstActiveTrade.target_price)}</dd>
                </div>
              </dl>
            ) : (
              <div className="trade-empty-state" aria-label="No active trade">
                <div className="trade-empty-state__icon" aria-hidden="true">
                  <span className="trade-empty-state__dot" />
                  <span className="trade-empty-state__dot" />
                  <span className="trade-empty-state__dot" />
                </div>
              </div>
            )}
          </article>

          <article className="panel">
            <div className="panel-header">
              <div>
                <p className="panel-title">Bot Summary</p>
                <p className="panel-subtitle">
                  Filtered performance for the selected range.
                </p>
              </div>
            </div>
            <dl className="status-list">
              <div>
                <dt>Trades</dt>
                <dd>{formatCount(summary.tradeCount)}</dd>
              </div>
              <div>
                <dt>Wins / Losses</dt>
                <dd>
                  {formatCount(summary.winCount)} / {formatCount(summary.lossCount)}
                </dd>
              </div>
              <div>
                <dt>Active Trades</dt>
                <dd>{formatCount(currentActiveTrades.length)}</dd>
              </div>
              <div>
                <dt>Strategy Mode</dt>
                <dd>{showContracts ? "Option contracts" : "Index signal"}</dd>
              </div>
            </dl>
          </article>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="panel-title">Trade History</p>
              <p className="panel-subtitle">
                Completed trades generated by this bot.
              </p>
            </div>
          </div>
          {trades.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Signal</th>
                    <th>Contract</th>
                    <th>Entry</th>
                    <th>Exit</th>
                    <th>Entry Price</th>
                    <th>Exit Price</th>
                    <th>SL</th>
                    <th>Target</th>
                    <th>Net PnL</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((trade) => (
                    <tr key={trade.trade_id}>
                      <td>{formatSignal(trade.signal)}</td>
                      <td>{trade.option_symbol ?? "Not available"}</td>
                      <td>{formatTableDateTime(trade.entry_time)}</td>
                      <td>{formatTableDateTime(trade.exit_time)}</td>
                      <td>{formatCurrency(trade.entry_price)}</td>
                      <td>{formatCurrency(trade.exit_price)}</td>
                      <td>{formatCurrency(trade.stop_loss_price)}</td>
                      <td>{formatCurrency(trade.target_price)}</td>
                      <td>
                        <PnlValue
                          value={trade.net_pnl}
                          baseValue={trade.capital_used}
                        />
                      </td>
                      <td>{trade.status ?? "Closed"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty-copy">
              Completed trades for this bot will appear here after the first exit.
            </p>
          )}
        </section>
      </section>
    );
  }

  return (
    <main className="shell">
      <section className="top-nav">
        <div className="brand-mark" aria-label="NIFTY Signal Dashboard">
          <img src="/app-icon.svg" alt="" />
          <span>1m Option Bot</span>
        </div>
        <div className="nav-group">
          {NAV_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`nav-chip ${activeView === option.id ? "nav-chip--active" : ""}`}
              onClick={() => changeActiveView(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="mobile-nav-select-wrap">
          <button
            type="button"
            className="mobile-nav-trigger"
            aria-haspopup="listbox"
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((isOpen) => !isOpen)}
          >
            <span className="mobile-nav-trigger__meta">Section</span>
            <span className="mobile-nav-trigger__label">{activeNavOption.label}</span>
            <span className="mobile-nav-trigger__chevron" aria-hidden="true">⌄</span>
          </button>
          {mobileMenuOpen ? (
            <div className="mobile-nav-menu" role="listbox" aria-label="Dashboard section">
              {NAV_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={activeView === option.id}
                  className={`mobile-nav-option ${activeView === option.id ? "mobile-nav-option--active" : ""}`}
                  onClick={() => changeActiveView(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <button type="button" className="theme-toggle" onClick={toggleTheme}>
          {theme === "dark" ? "Light Mode" : "Dark Mode"}
        </button>
      </section>

      <section className="hero">
        <div>
          <p className="eyebrow">NIFTY Signal Control Room</p>
          <h1>Live 1-minute option paper trading dashboard.</h1>
          <p className="hero-copy">
            {activeView === "overview"
              ? "A compact daily view for market quotes, selected contracts, active trade state, and PnL."
              : activeView === "oneMinuteBot"
                ? "Dedicated view for the 1-minute two-contract option bot, including its own active trade and PnL."
              : activeView === "trades"
                ? "Review completed paper trades with entry, exit, risk, and net PnL details."
                : activeView === "signals"
                  ? "Inspect live signal alerts and trigger sample alerts when you need to test delivery."
              : activeView === "reports"
                ? "Review hourly paper-trade performance with win/loss distribution and optional PnL overlays."
                  : activeView === "broker"
                    ? "Manage Zerodha connection state and confirm the live data bridge is ready."
                    : activeView === "liveTrading"
                      ? "Turn live trading on or off, place guarded orders, and track Zerodha order state."
                    : activeView === "optionBacktest"
                        ? "Backtest Supertrend directly on a manual option contract using Zerodha option candles."
                        : "Inspect every bot run with Supertrend values, signal state, and per-run messages, filtered date by date."}
          </p>
        </div>
        <div className="hero-badge">
          <span>
            {activeView === "overview"
              ? "Feed"
              : activeView === "oneMinuteBot"
                ? "Bot"
              : activeView === "trades"
                ? "History"
                : activeView === "signals"
                  ? "Alerts"
              : activeView === "reports"
                ? "Report range"
                : activeView === "broker"
                  ? "Zerodha"
                  : activeView === "liveTrading"
                    ? "Live"
                  : "Selected date"}
          </span>
          <strong>
            {activeView === "overview"
              ? streamStatus
              : activeView === "oneMinuteBot"
                ? "1m options"
              : activeView === "trades"
                ? `${formatCount(tradeHistory.length)} trades`
                : activeView === "signals"
                  ? `${formatCount(recentAlerts.length)} alerts`
              : activeView === "reports"
                ? selectedRangeMeta.label
                : activeView === "broker"
                  ? zerodha.health?.ok
                    ? "Working"
                    : "Check needed"
                  : activeView === "liveTrading"
                    ? liveTradingStatus.enabled
                      ? "Enabled"
                      : "Disabled"
                  : activeView === "optionBacktest"
                      ? "Manual contract"
                      : selectedDate}
          </strong>
        </div>
      </section>

      {error ? <div className="banner banner--error">{error}</div> : null}
      {actionMessage ? (
        <div className="banner banner--success">{actionMessage}</div>
      ) : null}
      {loading ? <div className="banner">Loading dashboard data...</div> : null}

      {activeView === "overview" ? (
        <>
          <section id="market-overview" className="section-block">
            <div className="section-heading">
              <p className="eyebrow">Session Snapshot</p>
              <h2 className="section-title">Market overview</h2>
            </div>

            <div
              className="range-switcher"
              role="tablist"
              aria-label="Market overview range"
            >
              {OVERVIEW_RANGE_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`range-chip ${overviewRange === option.id ? "range-chip--active" : ""}`}
                  onClick={() => setOverviewRange(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <section className="metrics-grid market-overview-grid">
              {marketQuotes.map((quote) => (
                <MarketQuoteCard key={quote.name} quote={quote} />
              ))}
              <MetricCard
                label="Last Run Status"
                value={status.lastRunStatus ?? "idle"}
                tone={getStatusTone(status.lastRunStatus)}
              />
              <MetricCard
                label="Next Run (IST)"
                value={formatDateTime(schedule.nextRunAt)}
              />
              <MetricCard
                label="Running PnL"
                value={
                  <PnlValue
                    value={selectedRangeSummary.runningPnl ?? 0}
                    baseValue={paperTrading.capitalBase}
                  />
                }
                tone={getPnlTone(selectedRangeSummary.runningPnl ?? 0)}
              />
              <MetricCard
                label={selectedRangeMeta.tradesLabel}
                value={formatCount(selectedRangeSummary.tradeCount)}
              />
              <MetricCard label="Wins / Losses" value={winsLosses} />
              <MetricCard
                label="Open Trade"
                value={openTradeLabel}
                tone={activeTrade ? "warn" : "neutral"}
              />
            </section>
          </section>

          <section id="strategy-contracts" className="section-block">
            <div className="section-heading">
              <p className="eyebrow">Daily Setup</p>
              <h2 className="section-title">Option contracts for today</h2>
            </div>

            <article className="panel">
              <div className="panel-header">
                <div>
                  <p className="panel-title">Contract inputs</p>
                  <p className="panel-subtitle">
                    {dailySetupSavedToday
                      ? "Today's setup is saved. Edit the fields below and save again to update the same setup."
                      : "Today's setup is not set. Save Contract 1 and Contract 2 before the bot starts scanning."}
                  </p>
                </div>
              </div>

              <div className={`setup-status ${dailySetupSavedToday ? "setup-status--saved" : "setup-status--missing"}`}>
                <div>
                  <p className="setup-status__title">
                    {dailySetupSavedToday ? "Today's 1m setup is saved" : "Today's 1m setup is not set"}
                  </p>
                  <p className="setup-status__copy">
                    {dailySetupSavedToday
                      ? `Editing this form will update the setup for ${strategyConfig.date ?? "today"}.`
                      : "The bot will not use daily contract inputs until this setup is saved for today."}
                  </p>
                </div>
                <span className="setup-status__pill">
                  {dailySetupSavedToday ? "Saved" : "Not set"}
                </span>
              </div>

              <div className="setup-editor-toggle-row">
                <button
                  type="button"
                  className="action-button action-button--secondary"
                  onClick={() => setSetupEditorOpen((isOpen) => !isOpen)}
                >
                  {dailySetupEditorOpen
                    ? "Hide Update Section"
                    : dailySetupSavedToday
                      ? "Edit Setup"
                      : "Add Setup"}
                </button>
              </div>

              {dailySetupEditorOpen ? (
              <form className="backtest-form contract-form" onSubmit={saveStrategyContracts}>
                <label className="form-field">
                  Contract 1
                  <input
                    type="text"
                    value={contractForm.contract1}
                    placeholder="24000PE"
                    onChange={(event) =>
                      updateContractField("contract1", event.target.value)
                    }
                  />
                </label>
                <label className="form-field">
                  Contract 2
                  <input
                    type="text"
                    value={contractForm.contract2}
                    placeholder="24100CE"
                    onChange={(event) =>
                      updateContractField("contract2", event.target.value)
                    }
                  />
                </label>
                <label className="form-field">
                  Entry Signal
                  <input type="text" value="BUY only" readOnly />
                </label>
                <label className="form-field">
                  Start Time
                  <input
                    type="time"
                    value={contractForm.scheduleStart}
                    onChange={(event) =>
                      updateContractField("scheduleStart", event.target.value)
                    }
                  />
                </label>
                <label className="form-field">
                  End Time
                  <input
                    type="time"
                    value={contractForm.scheduleEnd}
                    onChange={(event) =>
                      updateContractField("scheduleEnd", event.target.value)
                    }
                  />
                </label>
                <label className="form-field">
                  Starting Balance
                  <input
                    type="number"
                    min="1"
                    value={contractForm.startingBalance}
                    onChange={(event) =>
                      updateContractField("startingBalance", event.target.value)
                    }
                  />
                </label>
                <label className="form-field">
                  Target %
                  <input
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={contractForm.targetPct}
                    onChange={(event) =>
                      updateContractField("targetPct", event.target.value)
                    }
                  />
                </label>
                <label className="form-field">
                  Max Body %
                  <input
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={contractForm.maxSignalCandlePct}
                    onChange={(event) =>
                      updateContractField("maxSignalCandlePct", event.target.value)
                    }
                  />
                </label>
                <label className="form-field">
                  SL Mode
                  <select
                    value={contractForm.stopLossMode}
                    onChange={(event) =>
                      updateContractField("stopLossMode", event.target.value)
                    }
                  >
                    <option value="signal_low">Signal Low</option>
                    <option value="percent">Fixed %</option>
                  </select>
                </label>
                <label className="form-field">
                  SL %
                  <input
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={contractForm.stopLossPct}
                    onChange={(event) =>
                      updateContractField("stopLossPct", event.target.value)
                    }
                  />
                </label>
                <button
                  type="submit"
                  className="action-button"
                  disabled={contractSaving}
                >
                  {contractSaving ? "Saving..." : dailySetupSavedToday ? "Update Today's Setup" : "Save for Today"}
                </button>
              </form>
              ) : null}

              <dl className="status-list contract-status-list">
                <div>
                  <dt>Strategy Mode</dt>
                  <dd>{formatSnakeLabel(strategyConfig.mode ?? "index")}</dd>
                </div>
                <div>
                  <dt>Valid Date</dt>
                  <dd>{strategyConfig.date ?? "Not available"}</dd>
                </div>
                <div>
                  <dt>Saved Today</dt>
                  <dd>{dailySetupSavedToday ? "Yes" : "No"}</dd>
                </div>
                <div>
                  <dt>Last Saved</dt>
                  <dd>{dailySetupSavedAt ? formatDateTime(dailySetupSavedAt) : "Not set today"}</dd>
                </div>
                <div>
                  <dt>Effective Contracts</dt>
                  <dd>
                    {strategyConfig.effectiveContracts?.contract1 || "-"} /{" "}
                    {strategyConfig.effectiveContracts?.contract2 || "-"}
                  </dd>
                </div>
                <div>
                  <dt>Entry Signal</dt>
                  <dd>{strategyConfig.entrySignal ?? "Not set"}</dd>
                </div>
                <div>
                  <dt>Window</dt>
                  <dd>{strategyConfig.scheduleStart ?? schedule.start ?? "-"} - {strategyConfig.scheduleEnd ?? schedule.end ?? "-"}</dd>
                </div>
                <div>
                  <dt>Target / SL</dt>
                  <dd>
                    {strategyConfig.optionTargetPct ?? "-"}% /{" "}
                    {formatSnakeLabel(strategyConfig.stopLossMode ?? "not_set")}
                    {strategyConfig.stopLossMode === "percent" ? ` ${strategyConfig.stopLossPct ?? "-"}%` : ""}
                  </dd>
                </div>
                <div>
                  <dt>Max Body</dt>
                  <dd>{strategyConfig.maxSignalCandlePct ?? "-"}%</dd>
                </div>
                <div>
                  <dt>Starting Balance</dt>
                  <dd>{formatCurrency(strategyConfig.dailyContracts?.starting_balance ?? paperTrading.startingBalance ?? paperTrading.capitalBase)}</dd>
                </div>
              </dl>

              {!["option_contracts", "both"].includes(strategyConfig.mode) ? (
                <p className="panel-note">
                  Set <code>STRATEGY_MODE=option_contracts</code> in `.env`
                  for the live bot to use these dashboard contracts.
                </p>
              ) : null}
            </article>
          </section>

          <section id="paper-trading" className="section-block">
            <div className="section-heading">
              <p className="eyebrow">Paper Trading</p>
              <h2 className="section-title">Position and performance</h2>
            </div>

            <section className="content-grid">
              <article className="panel">
                <div className="panel-header">
                  <div>
                    <p className="panel-title">Current Active Trade</p>
                    <p className="panel-subtitle">
                      Live paper position state restored across restarts.
                    </p>
                  </div>
                </div>

                {activeTrade ? (
                  <dl className="status-list">
                    <div>
                      <dt>Contract</dt>
                      <dd>{activeTrade.option_symbol ?? "Not available"}</dd>
                    </div>
                    <div>
                      <dt>Signal</dt>
                      <dd>{formatSignal(activeTrade.signal)}</dd>
                    </div>
                    <div>
                      <dt>Entry Time</dt>
                      <dd>{formatDateTime(activeTrade.entry_time)}</dd>
                    </div>
                    <div>
                      <dt>Quantity</dt>
                      <dd>{activeTrade.quantity ?? "Not available"}</dd>
                    </div>
                    <div>
                      <dt>Capital Used</dt>
                      <dd>{formatCurrency(activeTrade.capital_used)}</dd>
                    </div>
                    <div>
                      <dt>Entry Price</dt>
                      <dd>{formatCurrency(activeTrade.entry_price)}</dd>
                    </div>
                    <div>
                      <dt>Live Price</dt>
                      <dd>{formatCurrency(activeTrade.livePrice)}</dd>
                    </div>
                    <div>
                      <dt>Unrealized PnL</dt>
                      <dd>
                        <PnlValue
                          value={activeTrade.unrealizedPnl}
                          baseValue={activeTrade.capital_used}
                        />
                      </dd>
                    </div>
                    <div>
                      <dt>SL</dt>
                      <dd>{formatCurrency(activeTrade.stop_loss_price)}</dd>
                    </div>
                    <div>
                      <dt>SL Source</dt>
                      <dd>
                        {formatStopLossSource(activeTrade.stop_loss_source)}
                      </dd>
                    </div>
                    <div>
                      <dt>Target</dt>
                      <dd>{formatCurrency(activeTrade.target_price)}</dd>
                    </div>
                  </dl>
                ) : (
                  <div
                    className="trade-empty-state"
                    aria-label="No active trade"
                  >
                    <div className="trade-empty-state__icon" aria-hidden="true">
                      <span className="trade-empty-state__dot" />
                      <span className="trade-empty-state__dot" />
                      <span className="trade-empty-state__dot" />
                    </div>
                  </div>
                )}
              </article>

              <article className="panel">
                <div className="panel-header">
                  <div>
                    <p className="panel-title">Daily Summary</p>
                    <p className="panel-subtitle">
                      Paper-trading performance snapshot for the current IST
                      session.
                    </p>
                  </div>
                </div>

                <dl className="status-list">
                  <div>
                    <dt>Trade Date</dt>
                    <dd>{dailySummary.tradeDate ?? "Not available"}</dd>
                  </div>
                  <div>
                    <dt>Realized PnL</dt>
                    <dd>
                      <PnlValue
                        value={paperTrading.realizedPnl ?? 0}
                        baseValue={paperTrading.capitalBase}
                      />
                    </dd>
                  </div>
                  <div>
                    <dt>Trades</dt>
                    <dd>{formatCount(dailySummary.tradeCount)}</dd>
                  </div>
                  <div>
                    <dt>Wins / Losses</dt>
                    <dd>
                      {formatCount(dailySummary.winCount)} /{" "}
                      {formatCount(dailySummary.lossCount)}
                    </dd>
                  </div>
                  <div>
                    <dt>Day Stopped</dt>
                    <dd>{dailySummary.dayStopped ? "Yes" : "No"}</dd>
                  </div>
                  <div>
                    <dt>Stop Reason</dt>
                    <dd>{dailySummary.dayStopReason ?? "Not triggered"}</dd>
                  </div>
                </dl>
              </article>
            </section>
          </section>

          {false ? (
          <section id="system-history" className="section-block">
            <div className="section-heading">
              <p className="eyebrow">System</p>
              <h2 className="section-title">Broker connection and history</h2>
            </div>

            <section className="content-grid">
              <article className="panel">
                <div className="panel-header">
                  <div>
                    <p className="panel-title">Zerodha Connection</p>
                    <p className="panel-subtitle">
                      Login flow for generating and saving the Kite access
                      token.
                    </p>
                  </div>
                </div>

                <div className="action-row">
                  <button
                    type="button"
                    className="action-button"
                    onClick={connectZerodha}
                    disabled={zerodhaAuthBusy || !zerodha.apiKeyConfigured}
                  >
                    {zerodhaAuthBusy ? "Connecting..." : "Connect Zerodha"}
                  </button>
                </div>

                <dl className="status-list">
                  <div>
                    <dt>API Key</dt>
                    <dd>
                      {zerodha.apiKeyConfigured ? "Configured" : "Missing"}
                    </dd>
                  </div>
                  <div>
                    <dt>API Secret</dt>
                    <dd>
                      {zerodha.apiSecretConfigured ? "Configured" : "Missing"}
                    </dd>
                  </div>
                  <div>
                    <dt>Access Token</dt>
                    <dd>
                      {zerodha.accessTokenConfigured ? "Configured" : "Missing"}
                    </dd>
                  </div>
                  <div>
                    <dt>Health Check</dt>
                    <dd>
                      {zerodha.health?.ok
                        ? "Working"
                        : (zerodha.health?.message ?? "Not checked")}
                    </dd>
                  </div>
                  <div>
                    <dt>Redirect URL</dt>
                    <dd>{zerodha.redirectUrl ?? "Not available"}</dd>
                  </div>
                  <div>
                    <dt>Last Session Update</dt>
                    <dd>{formatDateTime(zerodha.session?.updatedAt)}</dd>
                  </div>
                  <div>
                    <dt>Last User</dt>
                    <dd>
                      {zerodha.session?.userName ??
                        zerodha.session?.userId ??
                        "Not available"}
                    </dd>
                  </div>
                </dl>
              </article>

              <article className="panel">
                <div className="panel-header">
                  <div>
                    <p className="panel-title">Signal Alerts</p>
                    <p className="panel-subtitle">
                      Live alert history from the shared bot state. Sample
                      alerts can be triggered here too.
                    </p>
                  </div>
                  <ColumnPicker
                    label="Signal Alerts"
                    columns={signalAlertColumns}
                    selected={selectedSignalAlertColumns}
                    onToggle={(columnId) =>
                      toggleColumn(
                        columnId,
                        selectedSignalAlertColumns,
                        setSelectedSignalAlertColumns,
                        signalAlertColumns,
                      )
                    }
                    onReset={() =>
                      setSelectedSignalAlertColumns(
                        signalAlertColumns.map((column) => column.id),
                      )
                    }
                  />
                </div>

                <div className="action-row">
                  <button
                    type="button"
                    className="action-button action-button--buy"
                    onClick={() => triggerSampleAlert("BUY")}
                    disabled={triggeringSignal !== ""}
                  >
                    {triggeringSignal === "BUY"
                      ? "Sending BUY..."
                      : "Send Sample BUY"}
                  </button>
                  <button
                    type="button"
                    className="action-button action-button--sell"
                    onClick={() => triggerSampleAlert("SELL")}
                    disabled={triggeringSignal !== ""}
                  >
                    {triggeringSignal === "SELL"
                      ? "Sending SELL..."
                      : "Send Sample SELL"}
                  </button>
                </div>

                {recentAlerts.length ? (
                  <div className="table-wrap">
                    <table className="table-alerts table-auto-fit">
                      <thead>
                        <tr>
                          {visibleSignalAlertColumns.map((column) => (
                            <th key={column.id}>{column.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {recentAlerts.map((alert) => (
                          <tr
                            key={`${alert.alertTime}-${alert.signal}-${alert.close}`}
                          >
                            {visibleSignalAlertColumns.map((column) => {
                              if (column.id === "signal")
                                return (
                                  <td key={column.id}>
                                    {formatSignal(alert.signal)}
                                  </td>
                                );
                              if (column.id === "optionSymbol")
                                return (
                                  <td key={column.id}>
                                    {alert.optionSymbol ?? alert.symbol ?? "-"}
                                  </td>
                                );
                              if (column.id === "close")
                                return (
                                  <td key={column.id}>
                                    {alert.close?.toFixed(2)}
                                  </td>
                                );
                              if (column.id === "st_10_1")
                                return (
                                  <td key={column.id}>
                                    {alert.st_10_1?.toFixed(2)}
                                  </td>
                                );
                              if (column.id === "st_10_3")
                                return (
                                  <td key={column.id}>
                                    {alert.st_10_3?.toFixed(2)}
                                  </td>
                                );
                              if (column.id === "candleTime")
                                return (
                                  <td key={column.id}>
                                    {formatTableDateTime(alert.candleTime)}
                                  </td>
                                );
                              if (column.id === "alertTime")
                                return (
                                  <td key={column.id}>
                                    {formatTableDateTime(alert.alertTime)}
                                  </td>
                                );
                              return <td key={column.id}>-</td>;
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="empty-copy">
                    Recent alerts will appear here once the bot sends or tests a
                    signal.
                  </p>
                )}
              </article>
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <p className="panel-title">Trade History</p>
                  <p className="panel-subtitle">
                    Completed paper trades with entry, exit, capital, and net
                    PnL.
                  </p>
                </div>
                <ColumnPicker
                  label="Trade History"
                  columns={tradeHistoryColumns}
                  selected={selectedTradeHistoryColumns}
                  onToggle={(columnId) =>
                    toggleColumn(
                      columnId,
                      selectedTradeHistoryColumns,
                      setSelectedTradeHistoryColumns,
                      tradeHistoryColumns,
                    )
                  }
                  onReset={() =>
                    setSelectedTradeHistoryColumns(
                      tradeHistoryColumns.map((column) => column.id),
                    )
                  }
                  direction="up"
                />
              </div>

              {tradeHistory.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        {visibleTradeHistoryColumns.map((column) => (
                          <th key={column.id}>{column.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tradeHistory.map((trade) => (
                        <tr key={trade.trade_id}>
                          {visibleTradeHistoryColumns.map((column) => {
                            if (column.id === "signal")
                              return (
                                <td key={column.id}>
                                  {formatSignal(trade.signal)}
                                </td>
                              );
                            if (column.id === "option_symbol")
                              return (
                                <td key={column.id}>
                                  {trade.option_symbol ?? "Not available"}
                                </td>
                              );
                            if (column.id === "entry_time")
                              return (
                                <td key={column.id}>
                                  {formatTableDateTime(trade.entry_time)}
                                </td>
                              );
                            if (column.id === "exit_time")
                              return (
                                <td key={column.id}>
                                  {formatTableDateTime(trade.exit_time)}
                                </td>
                              );
                            if (column.id === "quantity")
                              return (
                                <td key={column.id}>{trade.quantity ?? "-"}</td>
                              );
                            if (column.id === "capital_used")
                              return (
                                <td key={column.id}>
                                  {formatCurrency(trade.capital_used)}
                                </td>
                              );
                            if (column.id === "entry_price")
                              return (
                                <td key={column.id}>
                                  {formatCurrency(trade.entry_price)}
                                </td>
                              );
                            if (column.id === "exit_price")
                              return (
                                <td key={column.id}>
                                  {formatCurrency(trade.exit_price)}
                                </td>
                              );
                            if (column.id === "stop_loss_price")
                              return (
                                <td key={column.id}>
                                  {formatCurrency(trade.stop_loss_price)}
                                </td>
                              );
                            if (column.id === "stop_loss_source")
                              return (
                                <td key={column.id}>
                                  {formatStopLossSource(trade.stop_loss_source)}
                                </td>
                              );
                            if (column.id === "target_price")
                              return (
                                <td key={column.id}>
                                  {formatCurrency(trade.target_price)}
                                </td>
                              );
                            if (column.id === "net_pnl")
                              return (
                                <td key={column.id}>
                                  <PnlValue
                                    value={trade.net_pnl}
                                    baseValue={trade.capital_used}
                                  />
                                </td>
                              );
                            if (column.id === "status")
                              return (
                                <td key={column.id}>
                                  {trade.status ?? "Closed"}
                                </td>
                              );
                            return <td key={column.id}>-</td>;
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="empty-copy">
                  Completed paper trades will appear here after the first exit.
                </p>
              )}
            </section>
          </section>
          ) : null}
        </>
      ) : activeView === "oneMinuteBot" ? (
        renderBotPage({
          eyebrow: "1-Minute Option Bot",
          title: "1m option-contract execution",
          subtitle:
            "Focused view for the two-contract option strategy running on 1-minute candles.",
          scheduleLabel: "Every 1 min at +3s",
          trades: oneMinuteOptionTrades,
          currentActiveTrades: oneMinuteActiveTrades,
          summary: oneMinuteBotSummary,
          showContracts: true,
        })
      ) : activeView === "trades" ? (
        <section className="section-block">
          <div className="section-heading">
            <p className="eyebrow">Paper Trading</p>
            <h2 className="section-title">Trade history</h2>
          </div>

          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="panel-title">Completed Trades</p>
                <p className="panel-subtitle">
                  Entry, exit, risk levels, capital, and net PnL for completed
                  paper trades.
                </p>
              </div>
              <ColumnPicker
                label="Trade History"
                columns={tradeHistoryColumns}
                selected={selectedTradeHistoryColumns}
                onToggle={(columnId) =>
                  toggleColumn(
                    columnId,
                    selectedTradeHistoryColumns,
                    setSelectedTradeHistoryColumns,
                    tradeHistoryColumns,
                  )
                }
                onReset={() =>
                  setSelectedTradeHistoryColumns(
                    tradeHistoryColumns.map((column) => column.id),
                  )
                }
              />
            </div>

            {tradeHistory.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {visibleTradeHistoryColumns.map((column) => (
                        <th key={column.id}>{column.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tradeHistory.map((trade) => (
                      <tr key={trade.trade_id}>
                        {visibleTradeHistoryColumns.map((column) => {
                          if (column.id === "signal")
                            return (
                              <td key={column.id}>
                                {formatSignal(trade.signal)}
                              </td>
                            );
                          if (column.id === "option_symbol")
                            return (
                              <td key={column.id}>
                                {trade.option_symbol ?? "Not available"}
                              </td>
                            );
                          if (column.id === "entry_time")
                            return (
                              <td key={column.id}>
                                {formatTableDateTime(trade.entry_time)}
                              </td>
                            );
                          if (column.id === "exit_time")
                            return (
                              <td key={column.id}>
                                {formatTableDateTime(trade.exit_time)}
                              </td>
                            );
                          if (column.id === "quantity")
                            return <td key={column.id}>{trade.quantity ?? "-"}</td>;
                          if (column.id === "capital_used")
                            return (
                              <td key={column.id}>
                                {formatCurrency(trade.capital_used)}
                              </td>
                            );
                          if (column.id === "entry_price")
                            return (
                              <td key={column.id}>
                                {formatCurrency(trade.entry_price)}
                              </td>
                            );
                          if (column.id === "exit_price")
                            return (
                              <td key={column.id}>
                                {formatCurrency(trade.exit_price)}
                              </td>
                            );
                          if (column.id === "stop_loss_price")
                            return (
                              <td key={column.id}>
                                {formatCurrency(trade.stop_loss_price)}
                              </td>
                            );
                          if (column.id === "stop_loss_source")
                            return (
                              <td key={column.id}>
                                {formatStopLossSource(trade.stop_loss_source)}
                              </td>
                            );
                          if (column.id === "target_price")
                            return (
                              <td key={column.id}>
                                {formatCurrency(trade.target_price)}
                              </td>
                            );
                          if (column.id === "net_pnl")
                            return (
                              <td key={column.id}>
                                <PnlValue
                                  value={trade.net_pnl}
                                  baseValue={trade.capital_used}
                                />
                              </td>
                            );
                          if (column.id === "status")
                            return <td key={column.id}>{trade.status ?? "Closed"}</td>;
                          if (column.id === "actions")
                            return (
                              <td key={column.id}>
                                <button
                                  type="button"
                                  className="table-action-button table-action-button--danger"
                                  onClick={() => deleteTrade(trade.trade_id)}
                                  disabled={deletingTradeId === trade.trade_id}
                                >
                                  {deletingTradeId === trade.trade_id
                                    ? "Deleting..."
                                    : "Delete"}
                                </button>
                              </td>
                            );
                          return <td key={column.id}>-</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty-copy">
                Completed paper trades will appear here after the first exit.
              </p>
            )}
          </section>
        </section>
      ) : activeView === "signals" ? (
        <section className="section-block">
          <div className="section-heading">
            <p className="eyebrow">Signals</p>
            <h2 className="section-title">Signal alerts</h2>
          </div>

          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="panel-title">Recent Signal Alerts</p>
                <p className="panel-subtitle">
                  Live alert history from bot state, with sample alert test
                  controls.
                </p>
              </div>
              <ColumnPicker
                label="Signal Alerts"
                columns={signalAlertColumns}
                selected={selectedSignalAlertColumns}
                onToggle={(columnId) =>
                  toggleColumn(
                    columnId,
                    selectedSignalAlertColumns,
                    setSelectedSignalAlertColumns,
                    signalAlertColumns,
                  )
                }
                onReset={() =>
                  setSelectedSignalAlertColumns(
                    signalAlertColumns.map((column) => column.id),
                  )
                }
              />
            </div>

            <div className="action-row">
              <button
                type="button"
                className="action-button action-button--buy"
                onClick={() => triggerSampleAlert("BUY")}
                disabled={triggeringSignal !== ""}
              >
                {triggeringSignal === "BUY" ? "Sending BUY..." : "Send Sample BUY"}
              </button>
              <button
                type="button"
                className="action-button action-button--sell"
                onClick={() => triggerSampleAlert("SELL")}
                disabled={triggeringSignal !== ""}
              >
                {triggeringSignal === "SELL" ? "Sending SELL..." : "Send Sample SELL"}
              </button>
            </div>

            {recentAlerts.length ? (
              <div className="table-wrap">
                <table className="table-alerts table-auto-fit">
                  <thead>
                    <tr>
                      {visibleSignalAlertColumns.map((column) => (
                        <th key={column.id}>{column.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {recentAlerts.map((alert) => (
                      <tr key={`${alert.alertTime}-${alert.signal}-${alert.close}`}>
                        {visibleSignalAlertColumns.map((column) => {
                          if (column.id === "signal")
                            return (
                              <td key={column.id}>{formatSignal(alert.signal)}</td>
                            );
                          if (column.id === "optionSymbol")
                            return (
                              <td key={column.id}>
                                {alert.optionSymbol ?? alert.symbol ?? "-"}
                              </td>
                            );
                          if (column.id === "close")
                            return <td key={column.id}>{alert.close?.toFixed(2)}</td>;
                          if (column.id === "st_10_1")
                            return <td key={column.id}>{alert.st_10_1?.toFixed(2)}</td>;
                          if (column.id === "st_10_3")
                            return <td key={column.id}>{alert.st_10_3?.toFixed(2)}</td>;
                          if (column.id === "candleTime")
                            return (
                              <td key={column.id}>
                                {formatTableDateTime(alert.candleTime)}
                              </td>
                            );
                          if (column.id === "alertTime")
                            return (
                              <td key={column.id}>
                                {formatTableDateTime(alert.alertTime)}
                              </td>
                            );
                          return <td key={column.id}>-</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty-copy">
                Recent alerts will appear here once the bot sends or tests a
                signal.
              </p>
            )}
          </section>
        </section>
      ) : activeView === "liveTrading" ? (
        <section className="section-block">
          <div className="section-heading">
            <p className="eyebrow">Live Trading</p>
            <h2 className="section-title">Zerodha order control</h2>
          </div>

          <section className="metrics-grid">
            <MetricCard
              label="Live Trading"
              value={liveTradingStatus.enabled ? "Enabled" : "Disabled"}
              tone={liveTradingStatus.enabled ? "bad" : "neutral"}
            />
            <MetricCard
              label="Zerodha Ready"
              value={liveTradingStatus.zerodhaReady ? "Ready" : "Not ready"}
              tone={liveTradingStatus.zerodhaReady ? "good" : "warn"}
            />
            <MetricCard
              label="Available Cash"
              value={liveBalance.cash == null ? "Not available" : formatCurrency(liveBalance.cash)}
              tone={liveBalance.cash == null ? "neutral" : "good"}
            />
            <MetricCard
              label="Live Balance"
              value={liveBalance.liveBalance == null ? "Not available" : formatCurrency(liveBalance.liveBalance)}
            />
            <MetricCard label="Orders" value={formatCount(liveOrders.length)} />
            <MetricCard label="Trades" value={formatCount(liveTrades.length)} />
          </section>

          <section className="content-grid">
            <article className="panel">
              <div className="panel-header">
                <div>
                  <p className="panel-title">Safety Switch</p>
                  <p className="panel-subtitle">
                    When enabled, the 1m bot uses the same daily setup and sends real Zerodha orders at the paper-trade entry and exit points.
                  </p>
                </div>
              </div>
              <div className="action-row">
                <button
                  type="button"
                  className={`action-button ${liveTradingStatus.enabled ? "action-button--sell" : "action-button--buy"}`}
                  onClick={() => toggleLiveTrading(!liveTradingStatus.enabled)}
                  disabled={liveActionBusy === "toggle"}
                >
                  {liveActionBusy === "toggle"
                    ? "Updating..."
                    : liveTradingStatus.enabled
                      ? "Turn Off Live Trading"
                      : "Turn On Live Trading"}
                </button>
                <button type="button" className="action-button action-button--secondary" onClick={refreshLiveTradingData}>
                  Refresh Broker Data
                </button>
              </div>
              <dl className="status-list">
                <div>
                  <dt>Last Update</dt>
                  <dd>{formatDateTime(liveTradingStatus.updatedAt)}</dd>
                </div>
                <div>
                  <dt>Last Action</dt>
                  <dd>{formatSnakeLabel(liveTradingStatus.lastAction ?? "none")}</dd>
                </div>
                <div>
                  <dt>Broker Error</dt>
                  <dd>{liveTrading.error ?? "None"}</dd>
                </div>
                <div>
                  <dt>Strategy Source</dt>
                  <dd>1m daily setup</dd>
                </div>
                <div>
                  <dt>Contracts</dt>
                  <dd>
                    {[oneMinuteLiveSetup.effectiveContracts?.contract1, oneMinuteLiveSetup.effectiveContracts?.contract2]
                      .filter(Boolean)
                      .join(" / ") || "Not set"}
                  </dd>
                </div>
                <div>
                  <dt>Entry Signal</dt>
                  <dd>{oneMinuteLiveSetup.entrySignal ?? "BUY"}</dd>
                </div>
                <div>
                  <dt>Target / SL</dt>
                  <dd>
                    {oneMinuteLiveSetup.targetPct ?? strategyConfig.optionTargetPct ?? "-"}% /{" "}
                    {formatSnakeLabel(oneMinuteLiveSetup.stopLossMode ?? strategyConfig.stopLossMode ?? "signal_low")}
                  </dd>
                </div>
              </dl>
            </article>

          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="panel-title">Order Book</p>
                <p className="panel-subtitle">Fetched from Zerodha order APIs.</p>
              </div>
            </div>
            {liveOrders.length ? (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Order ID</th><th>Time</th><th>Symbol</th><th>Side</th><th>Qty</th><th>Type</th><th>Status</th><th>Avg Price</th><th>Actions</th></tr></thead>
                  <tbody>
                    {liveOrders.map((order) => (
                      <tr key={order.order_id}>
                        <td>{order.order_id}</td>
                        <td>{formatTableDateTime(order.order_timestamp ?? order.exchange_timestamp)}</td>
                        <td>{order.tradingsymbol}</td>
                        <td>{formatSignal(order.transaction_type)}</td>
                        <td>{order.quantity}</td>
                        <td>{order.order_type}</td>
                        <td>{order.status}</td>
                        <td>{formatCurrency(order.average_price)}</td>
                        <td><button type="button" className="table-action-button table-action-button--danger" disabled={!liveTradingStatus.enabled || liveActionBusy === `cancel-${order.order_id}`} onClick={() => cancelLiveOrder(order.order_id)}>{liveActionBusy === `cancel-${order.order_id}` ? "Cancelling..." : "Cancel"}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty-copy">No Zerodha orders available.</p>
            )}
          </section>

          <section className="content-grid">
            <article className="panel"><div className="panel-header"><div><p className="panel-title">Positions</p><p className="panel-subtitle">Open positions from Zerodha.</p></div></div><pre className="json-preview">{JSON.stringify(livePositions, null, 2)}</pre></article>
            <article className="panel"><div className="panel-header"><div><p className="panel-title">Margins</p><p className="panel-subtitle">Margin snapshot from Zerodha.</p></div></div><pre className="json-preview">{JSON.stringify(liveMargins, null, 2)}</pre></article>
          </section>
        </section>
      ) : activeView === "broker" ? (
        <section className="section-block">
          <div className="section-heading">
            <p className="eyebrow">Broker</p>
            <h2 className="section-title">Zerodha connection</h2>
          </div>

          <section className="content-grid">
            <article className="panel">
              <div className="panel-header">
                <div>
                  <p className="panel-title">Connection Status</p>
                  <p className="panel-subtitle">
                    Login flow for generating and saving the Kite access token.
                  </p>
                </div>
              </div>

              <div className="action-row">
                <button
                  type="button"
                  className="action-button"
                  onClick={connectZerodha}
                  disabled={zerodhaAuthBusy || !zerodha.apiKeyConfigured}
                >
                  {zerodhaAuthBusy ? "Connecting..." : "Connect Zerodha"}
                </button>
              </div>

              <dl className="status-list">
                <div>
                  <dt>API Key</dt>
                  <dd>{zerodha.apiKeyConfigured ? "Configured" : "Missing"}</dd>
                </div>
                <div>
                  <dt>API Secret</dt>
                  <dd>{zerodha.apiSecretConfigured ? "Configured" : "Missing"}</dd>
                </div>
                <div>
                  <dt>Access Token</dt>
                  <dd>
                    {zerodha.accessTokenConfigured ? "Configured" : "Missing"}
                  </dd>
                </div>
                <div>
                  <dt>Health Check</dt>
                  <dd>
                    {zerodha.health?.ok
                      ? "Working"
                      : (zerodha.health?.message ?? "Not checked")}
                  </dd>
                </div>
                <div>
                  <dt>Redirect URL</dt>
                  <dd>{zerodha.redirectUrl ?? "Not available"}</dd>
                </div>
                <div>
                  <dt>Last Session Update</dt>
                  <dd>{formatDateTime(zerodha.session?.updatedAt)}</dd>
                </div>
                <div>
                  <dt>Last User</dt>
                  <dd>
                    {zerodha.session?.userName ??
                      zerodha.session?.userId ??
                      "Not available"}
                  </dd>
                </div>
              </dl>
            </article>

            <article className="panel">
              <div className="panel-header">
                <div>
                  <p className="panel-title">Runtime Settings</p>
                  <p className="panel-subtitle">
                    Quick reference for the active bot schedule and contract
                    mode.
                  </p>
                </div>
              </div>

              <dl className="status-list">
                <div>
                  <dt>Strategy Mode</dt>
                  <dd>{formatSnakeLabel(strategyConfig.mode ?? "index")}</dd>
                </div>
                <div>
                  <dt>Schedule</dt>
                  <dd>
                    {schedule.start ?? "-"} to {schedule.end ?? "-"} IST
                  </dd>
                </div>
                <div>
                  <dt>Interval</dt>
                  <dd>{formatCount(schedule.intervalMinutes)} minutes</dd>
                </div>
                <div>
                  <dt>Buffer</dt>
                  <dd>+{formatCount(schedule.bufferSeconds)} seconds</dd>
                </div>
                <div>
                  <dt>Weekend Runs</dt>
                  <dd>{schedule.forceWeekendRuns ? "Allowed" : "Disabled"}</dd>
                </div>
                <div>
                  <dt>Effective Contracts</dt>
                  <dd>
                    {strategyConfig.effectiveContracts?.contract1 || "-"} /{" "}
                    {strategyConfig.effectiveContracts?.contract2 || "-"}
                  </dd>
                </div>
              </dl>
            </article>
          </section>
        </section>
      ) : activeView === "reports" ? (
        <section className="section-block">
          <div className="section-heading">
            <p className="eyebrow">Reports</p>
            <h2 className="section-title">Performance reports</h2>
          </div>

          <div
            className="range-switcher"
            role="tablist"
            aria-label="Reports range"
          >
            {OVERVIEW_RANGE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`range-chip ${overviewRange === option.id ? "range-chip--active" : ""}`}
                onClick={() => setOverviewRange(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <section className="report-metrics-grid">
            <MetricCard
              label="Net PnL"
              value={<PnlValue value={reportMetrics.totalPnl} />}
              tone={getPnlTone(reportMetrics.totalPnl)}
            />
            <MetricCard
              label="Trades"
              value={formatCount(reportMetrics.totalTrades)}
            />
            <MetricCard
              label="Win Rate"
              value={formatPercent(reportMetrics.winRate)}
              tone={
                reportMetrics.winRate >= 50
                  ? "good"
                  : reportMetrics.totalTrades
                    ? "bad"
                    : "neutral"
              }
            />
            <MetricCard
              label="Profit Factor"
              value={formatRatio(reportMetrics.profitFactor)}
              tone={
                reportMetrics.profitFactor >= 1
                  ? "good"
                  : reportMetrics.totalTrades
                    ? "bad"
                    : "neutral"
              }
            />
            <MetricCard
              label="Avg Win"
              value={<PnlValue value={reportMetrics.averageWin} />}
              tone="good"
            />
            <MetricCard
              label="Avg Loss"
              value={<PnlValue value={-reportMetrics.averageLoss} />}
              tone={reportMetrics.averageLoss ? "bad" : "neutral"}
            />
            <MetricCard
              label="Best Trade"
              value={<PnlValue value={reportMetrics.bestTrade} />}
              tone={getPnlTone(reportMetrics.bestTrade)}
            />
            <MetricCard
              label="Worst Trade"
              value={<PnlValue value={reportMetrics.worstTrade} />}
              tone={getPnlTone(reportMetrics.worstTrade)}
            />
            <MetricCard
              label="Expectancy"
              value={<PnlValue value={reportMetrics.expectancy} />}
              tone={getPnlTone(reportMetrics.expectancy)}
            />
          </section>

          <section className="panel pnl-report-panel">
            <div className="panel-header">
              <div>
                <p className="panel-title">Hourly PnL Report</p>
                <p className="panel-subtitle">
                  Win/loss distribution by exit hour from 09:00 to 16:00 IST for
                  the selected range.
                </p>
              </div>
              <label className="toggle-control">
                <input
                  type="checkbox"
                  checked={showHourlyPnl}
                  onChange={(event) => setShowHourlyPnl(event.target.checked)}
                />
                <span>Show hourly PnL</span>
              </label>
            </div>
            <HourlyPnlReport
              buckets={hourlyPnlReport}
              showPnl={showHourlyPnl}
            />
          </section>

          <section className="panel pnl-report-panel">
            <div className="panel-header">
              <div>
                <p className="panel-title">Weekday PnL Report</p>
                <p className="panel-subtitle">
                  Net PnL grouped by weekday from Monday to Friday for the
                  selected range.
                </p>
              </div>
            </div>
            <WeekdayPnlReport buckets={weekdayPnlReport} />
          </section>

          <section className="panel pnl-report-panel">
            <div className="panel-header">
              <div>
                <p className="panel-title">CE / PE Trade Details</p>
                <p className="panel-subtitle">
                  Option-type breakdown for the selected range.
                </p>
              </div>
            </div>
            <OptionTypeReport buckets={optionTypeReport} />
          </section>
        </section>
      ) : activeView === "backtest" ? (
        <section className="section-block">
          <div className="section-heading">
            <p className="eyebrow">Backtesting</p>
            <h2 className="section-title">Strategy simulator</h2>
          </div>

          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="panel-title">Backtest Inputs</p>
                <p className="panel-subtitle">
                  Uses the same Supertrend signal rules, with Zerodha option
                  1-minute candles when available and synthetic fallback
                  pricing otherwise.
                </p>
              </div>
            </div>

            <form className="backtest-form" onSubmit={runBacktest}>
              <label className="form-field">
                <span>Instrument</span>
                <select
                  value={backtestForm.instrument}
                  onChange={(event) =>
                    updateBacktestField("instrument", event.target.value)
                  }
                  required
                >
                  {BACKTEST_INSTRUMENT_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-field segmented-field">
                <span>Signal Rule</span>
                <div
                  className="segmented-toggle"
                  role="group"
                  aria-label="Backtest signal rule"
                >
                  {BACKTEST_SIGNAL_MODE_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`segmented-toggle__button ${
                        backtestForm.signalMode === option.id
                          ? "segmented-toggle__button--active"
                          : ""
                      }`}
                      onClick={() =>
                        updateBacktestField("signalMode", option.id)
                      }
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="form-field">
                <span>Entry Day</span>
                <input
                  type="date"
                  value={backtestForm.startDate}
                  onChange={(event) =>
                    updateBacktestField("startDate", event.target.value)
                  }
                  required
                />
              </label>
              <label className="form-field">
                <span>Exit Day</span>
                <input
                  type="date"
                  value={backtestForm.endDate}
                  onChange={(event) =>
                    updateBacktestField("endDate", event.target.value)
                  }
                  required
                />
              </label>
              <label className="form-field">
                <span>Balance Invested</span>
                <input
                  type="number"
                  min="75"
                  step="1"
                  value={backtestForm.balance}
                  onChange={(event) =>
                    updateBacktestField("balance", event.target.value)
                  }
                  required
                />
              </label>
              <label className="form-field">
                <span>Target %</span>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={backtestForm.targetPct}
                  onChange={(event) =>
                    updateBacktestField("targetPct", event.target.value)
                  }
                  required
                />
              </label>
              <label className="form-field">
                <span>Stop Loss %</span>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={backtestForm.stopLossPct}
                  onChange={(event) =>
                    updateBacktestField("stopLossPct", event.target.value)
                  }
                  required
                />
              </label>
              <div className="form-field segmented-field">
                <span>Stop Loss Rule</span>
                <div className="segmented-toggle" role="group" aria-label="Stop loss rule">
                  {BACKTEST_STOP_LOSS_MODES.map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      className={`segmented-toggle__button ${
                        backtestForm.stopLossMode === mode.id
                          ? "segmented-toggle__button--active"
                          : ""
                      }`}
                      onClick={() => updateBacktestField("stopLossMode", mode.id)}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="form-field segmented-field">
                <span>Entry Trigger</span>
                <div
                  className="segmented-toggle"
                  role="group"
                  aria-label="Entry trigger timing"
                >
                  {BACKTEST_ENTRY_TIMING_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`segmented-toggle__button ${
                        backtestForm.entryTiming === option.id
                          ? "segmented-toggle__button--active"
                          : ""
                      }`}
                      onClick={() =>
                        updateBacktestField("entryTiming", option.id)
                      }
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="form-field">
                <span>Entry Time</span>
                <input
                  type="time"
                  value={backtestForm.entryTime}
                  onChange={(event) =>
                    updateBacktestField("entryTime", event.target.value)
                  }
                  required
                />
              </label>
              <label className="form-field">
                <span>Exit Time</span>
                <input
                  type="time"
                  value={backtestForm.exitTime}
                  onChange={(event) =>
                    updateBacktestField("exitTime", event.target.value)
                  }
                  required
                />
              </label>
              <label
                className={`toggle-switch-field ${
                  backtestForm.capStopLoss ? "toggle-switch-field--on" : ""
                } ${
                  backtestForm.stopLossMode === "percent"
                    ? "toggle-switch-field--disabled"
                    : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={backtestForm.capStopLoss}
                  disabled={backtestForm.stopLossMode === "percent"}
                  onChange={(event) =>
                    updateBacktestField("capStopLoss", event.target.checked)
                  }
                />
                <span className="toggle-switch" aria-hidden="true">
                  <span className="toggle-switch__knob" />
                </span>
                <span>Cap signal low</span>
                <strong>
                  {backtestForm.stopLossMode === "percent"
                    ? "N/A"
                    : backtestForm.capStopLoss
                      ? "ON"
                      : "OFF"}
                </strong>
              </label>
              <button
                type="submit"
                className="action-button action-button--buy"
                disabled={backtestLoading}
              >
                {backtestLoading ? "Running..." : "Run Backtest"}
              </button>
            </form>
          </section>

          {backtestResult ? (
            <>
              <section className="report-metrics-grid">
                <MetricCard
                  label="Net PnL"
                  value={
                    <PnlValue value={backtestResult.summary?.netPnl ?? 0} />
                  }
                  tone={getPnlTone(backtestResult.summary?.netPnl ?? 0)}
                />
                <MetricCard
                  label="Trades"
                  value={formatCount(backtestResult.summary?.tradeCount)}
                />
                <MetricCard
                  label="Wins / Losses"
                  value={`${formatCount(backtestResult.summary?.wins)} / ${formatCount(backtestResult.summary?.losses)}`}
                />
                <MetricCard
                  label="Win Rate"
                  value={formatPercent(backtestResult.summary?.winRate)}
                />
                <MetricCard
                  label="Profit Factor"
                  value={formatRatio(backtestResult.summary?.profitFactor)}
                />
                <MetricCard
                  label="Expectancy"
                  value={
                    <PnlValue value={backtestResult.summary?.expectancy ?? 0} />
                  }
                  tone={getPnlTone(backtestResult.summary?.expectancy ?? 0)}
                />
                <MetricCard
                  label="Best Trade"
                  value={
                    <PnlValue value={backtestResult.summary?.bestTrade ?? 0} />
                  }
                  tone={getPnlTone(backtestResult.summary?.bestTrade ?? 0)}
                />
                <MetricCard
                  label="Worst Trade"
                  value={
                    <PnlValue value={backtestResult.summary?.worstTrade ?? 0} />
                  }
                  tone={getPnlTone(backtestResult.summary?.worstTrade ?? 0)}
                />
                <MetricCard
                  label="Signal Rule"
                  value={formatSnakeLabel(backtestResult.data?.signalMode)}
                />
                <MetricCard
                  label="Selected Signals"
                  value={formatCount(backtestResult.data?.selectedSignalCount)}
                />
                <MetricCard
                  label="Fast / Both Signals"
                  value={`${formatCount(backtestResult.data?.fastSignalCount)} / ${formatCount(backtestResult.data?.bothSignalCount)}`}
                />
                <MetricCard
                  label="Signal Candles"
                  value={formatCount(
                    backtestResult.data?.signalCandleCount ??
                      backtestResult.data?.candleCount,
                  )}
                />
                <MetricCard
                  label="1m Candles"
                  value={formatCount(backtestResult.data?.executionCandleCount)}
                />
                <MetricCard
                  label="Instrument"
                  value={backtestResult.data?.instrumentLabel ?? "Not available"}
                />
                <MetricCard
                  label="Lot / Strike Step"
                  value={`${formatCount(backtestResult.data?.lotSize)} / ${formatCount(backtestResult.data?.strikeStep)}`}
                />
                <MetricCard
                  label="Pricing"
                  value={formatSnakeLabel(backtestResult.data?.pricingModel)}
                />
                <MetricCard
                  label="Signal Data"
                  value={formatSnakeLabel(backtestResult.data?.signalDataSource)}
                />
                <MetricCard
                  label="1m Data"
                  value={formatSnakeLabel(
                    backtestResult.data?.executionDataSource,
                  )}
                />
              </section>

              <section className="panel pnl-report-panel">
                <div className="panel-header">
                  <div>
                    <p className="panel-title">Backtest Hourly PnL Report</p>
                    <p className="panel-subtitle">
                      Win/loss distribution by backtest exit hour from 09:00 to
                      16:00 IST.
                    </p>
                  </div>
                  <label className="toggle-control">
                    <input
                      type="checkbox"
                      checked={showHourlyPnl}
                      onChange={(event) =>
                        setShowHourlyPnl(event.target.checked)
                      }
                    />
                    <span>Show hourly PnL</span>
                  </label>
                </div>
                <HourlyPnlReport
                  buckets={backtestHourlyPnlReport}
                  showPnl={showHourlyPnl}
                />
              </section>

              <section className="panel pnl-report-panel">
                <div className="panel-header">
                  <div>
                    <p className="panel-title">Backtest Weekday PnL Report</p>
                    <p className="panel-subtitle">
                      Net PnL grouped by weekday for the selected backtest
                      period.
                    </p>
                  </div>
                </div>
                <WeekdayPnlReport buckets={backtestWeekdayPnlReport} />
              </section>

              <section className="panel">
                <div className="panel-header">
                  <div>
                    <p className="panel-title">Backtest Trades</p>
                    <p className="panel-subtitle">
                      Simulated entries and exits from the selected historical
                      period.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="action-button"
                    onClick={exportBacktestCsv}
                    disabled={
                      backtestExportLoading || !backtestResult.trades?.length
                    }
                  >
                    {backtestExportLoading ? "Saving CSV..." : "Save CSV"}
                  </button>
                </div>
                {backtestResult.trades?.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Signal</th>
                          <th>Signal Rule</th>
                          <th>Entry</th>
                          <th>Entry Trigger</th>
                          <th>Exit</th>
                          <th>Instrument</th>
                          <th>Strike</th>
                          <th>Qty</th>
                          <th>Market Entry</th>
                          <th>Exec Entry</th>
                          <th>Market Exit</th>
                          <th>Exec Exit</th>
                          <th>SL</th>
                          <th>SL Rule</th>
                          <th>Target</th>
                          <th>Net PnL</th>
                          <th>Status</th>
                          <th>Exit Reason</th>
                          <th>Source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {backtestResult.trades.map((trade) => (
                          <tr
                            key={`${trade.entryTime}-${trade.signal}-${trade.strike}`}
                          >
                            <td>{formatSignal(trade.signal)}</td>
                            <td>{formatSnakeLabel(trade.signalMode)}</td>
                            <td>{formatTableDateTime(trade.entryTime)}</td>
                            <td>{formatSnakeLabel(trade.entryTiming)}</td>
                            <td>{formatTableDateTime(trade.exitTime)}</td>
                            <td>{trade.instrument ?? backtestResult.data?.instrument}</td>
                            <td>
                              {trade.strike} {trade.optionType}
                            </td>
                            <td>{trade.quantity}</td>
                            <td>
                              {formatCurrency(
                                trade.baseEntryPrice ?? trade.entryPrice,
                              )}
                            </td>
                            <td>{formatCurrency(trade.entryPrice)}</td>
                            <td>
                              {formatCurrency(
                                trade.baseExitPrice ?? trade.exitPrice,
                              )}
                            </td>
                            <td>{formatCurrency(trade.exitPrice)}</td>
                            <td>{formatCurrency(trade.stopLoss)}</td>
                            <td>
                              {trade.stopLossMode === "percent"
                                ? "SL %"
                                : formatStopLossSource(trade.stopLossSource)}
                            </td>
                            <td>{formatCurrency(trade.target)}</td>
                            <td>
                              <PnlValue
                                value={trade.netPnl}
                                baseValue={trade.capitalUsed}
                              />
                            </td>
                            <td>{trade.status}</td>
                            <td>{formatSnakeLabel(trade.exitReason)}</td>
                            <td>{formatSnakeLabel(trade.executionSource)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="empty-copy">
                    No backtest trades were generated for this configuration.
                  </p>
                )}
              </section>
            </>
          ) : null}
        </section>
      ) : activeView === "optionBacktest" ? (
        <section className="section-block">
          <div className="section-heading">
            <p className="eyebrow">Option Backtesting</p>
            <h2 className="section-title">Manual contract simulator</h2>
          </div>

          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="panel-title">Option Contract Inputs</p>
                <p className="panel-subtitle">
                  Calculates Supertrend directly on one or two selected option
                  contracts from Zerodha, matching the live two-contract scan.
                </p>
              </div>
            </div>

            <form className="backtest-form" onSubmit={runOptionContractBacktest}>
              <label className="form-field">
                <span>Exchange</span>
                <select
                  value={optionBacktestForm.exchange}
                  onChange={(event) =>
                    updateOptionBacktestField("exchange", event.target.value)
                  }
                  required
                >
                  {OPTION_BACKTEST_EXCHANGES.map((exchange) => (
                    <option key={exchange} value={exchange}>
                      {exchange}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>Contract 1</span>
                <input
                  type="text"
                  value={optionBacktestForm.optionSymbol}
                  placeholder="24000PE or NIFTY26APR24200PE"
                  onChange={(event) =>
                    updateOptionBacktestField("optionSymbol", event.target.value)
                  }
                  required
                />
              </label>
              <label className="form-field">
                <span>Contract 2</span>
                <input
                  type="text"
                  value={optionBacktestForm.optionSymbol2}
                  placeholder="24100CE or NIFTY26APR24100CE"
                  onChange={(event) =>
                    updateOptionBacktestField("optionSymbol2", event.target.value)
                  }
                />
              </label>
              <div className="form-field segmented-field">
                <span>Candle Timeframe</span>
                <div className="segmented-toggle" role="group" aria-label="Option candle timeframe">
                  {["1m", "5m"].map((interval) => (
                    <button
                      key={interval}
                      type="button"
                      className={`segmented-toggle__button ${
                        optionBacktestForm.interval === interval
                          ? "segmented-toggle__button--active"
                          : ""
                      }`}
                      onClick={() =>
                        updateOptionBacktestField("interval", interval)
                      }
                    >
                      {interval}
                    </button>
                  ))}
                </div>
              </div>
              <div className="form-field segmented-field">
                <span>Signal Rule</span>
                <div className="segmented-toggle" role="group" aria-label="Option signal rule">
                  {BACKTEST_SIGNAL_MODE_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`segmented-toggle__button ${
                        optionBacktestForm.signalMode === option.id
                          ? "segmented-toggle__button--active"
                          : ""
                      }`}
                      onClick={() =>
                        updateOptionBacktestField("signalMode", option.id)
                      }
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="form-field segmented-field">
                <span>Entry Signal</span>
                <div className="segmented-toggle" role="group" aria-label="Option entry signal">
                  {OPTION_BACKTEST_ENTRY_SIGNALS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`segmented-toggle__button ${
                        optionBacktestForm.entrySignal === option.id
                          ? "segmented-toggle__button--active"
                          : ""
                      }`}
                      onClick={() =>
                        updateOptionBacktestField("entrySignal", option.id)
                      }
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="form-field">
                <span>Entry Day</span>
                <input
                  type="date"
                  value={optionBacktestForm.startDate}
                  onChange={(event) =>
                    updateOptionBacktestField("startDate", event.target.value)
                  }
                  required
                />
              </label>
              <label className="form-field">
                <span>Exit Day</span>
                <input
                  type="date"
                  value={optionBacktestForm.endDate}
                  onChange={(event) =>
                    updateOptionBacktestField("endDate", event.target.value)
                  }
                  required
                />
              </label>
              <label className="form-field">
                <span>Balance</span>
                <input
                  type="number"
                  min="1"
                  value={optionBacktestForm.balance}
                  onChange={(event) =>
                    updateOptionBacktestField("balance", event.target.value)
                  }
                  required
                />
              </label>
              <label className="form-field">
                <span>Lot Size</span>
                <input
                  type="number"
                  min="1"
                  value={optionBacktestForm.lotSize}
                  onChange={(event) =>
                    updateOptionBacktestField("lotSize", event.target.value)
                  }
                  required
                />
              </label>
              <label className="form-field">
                <span>Target %</span>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={optionBacktestForm.targetPct}
                  onChange={(event) =>
                    updateOptionBacktestField("targetPct", event.target.value)
                  }
                  required
                />
              </label>
              <label className="form-field">
                <span>Stop Loss %</span>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={optionBacktestForm.stopLossPct}
                  onChange={(event) =>
                    updateOptionBacktestField("stopLossPct", event.target.value)
                  }
                  required
                />
              </label>
              <div className="form-field segmented-field">
                <span>Stop Loss Rule</span>
                <div className="segmented-toggle" role="group" aria-label="Option stop loss rule">
                  {BACKTEST_STOP_LOSS_MODES.map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      className={`segmented-toggle__button ${
                        optionBacktestForm.stopLossMode === mode.id
                          ? "segmented-toggle__button--active"
                          : ""
                      }`}
                      onClick={() =>
                        updateOptionBacktestField("stopLossMode", mode.id)
                      }
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="form-field segmented-field">
                <span>Entry Trigger</span>
                <div className="segmented-toggle" role="group" aria-label="Option entry trigger">
                  {BACKTEST_ENTRY_TIMING_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`segmented-toggle__button ${
                        optionBacktestForm.entryTiming === option.id
                          ? "segmented-toggle__button--active"
                          : ""
                      }`}
                      onClick={() =>
                        updateOptionBacktestField("entryTiming", option.id)
                      }
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="form-field">
                <span>Entry Time</span>
                <input
                  type="time"
                  value={optionBacktestForm.entryTime}
                  onChange={(event) =>
                    updateOptionBacktestField("entryTime", event.target.value)
                  }
                  required
                />
              </label>
              <label className="form-field">
                <span>Exit Time</span>
                <input
                  type="time"
                  value={optionBacktestForm.exitTime}
                  onChange={(event) =>
                    updateOptionBacktestField("exitTime", event.target.value)
                  }
                  required
                />
              </label>
              <label
                className={`toggle-switch-field ${
                  optionBacktestForm.capStopLoss ? "toggle-switch-field--on" : ""
                } ${
                  optionBacktestForm.stopLossMode === "percent"
                    ? "toggle-switch-field--disabled"
                    : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={optionBacktestForm.capStopLoss}
                  disabled={optionBacktestForm.stopLossMode === "percent"}
                  onChange={(event) =>
                    updateOptionBacktestField("capStopLoss", event.target.checked)
                  }
                />
                <span className="toggle-switch" aria-hidden="true">
                  <span className="toggle-switch__knob" />
                </span>
                <span>Cap signal low</span>
                <strong>
                  {optionBacktestForm.stopLossMode === "percent"
                    ? "N/A"
                    : optionBacktestForm.capStopLoss
                      ? "ON"
                      : "OFF"}
                </strong>
              </label>
              <label
                className={`toggle-switch-field ${
                  optionBacktestForm.requireVwap ? "toggle-switch-field--on" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={optionBacktestForm.requireVwap}
                  onChange={(event) =>
                    updateOptionBacktestField("requireVwap", event.target.checked)
                  }
                />
                <span className="toggle-switch" aria-hidden="true">
                  <span className="toggle-switch__knob" />
                </span>
                <span>Below VWAP</span>
                <strong>{optionBacktestForm.requireVwap ? "ON" : "OFF"}</strong>
              </label>
              <button
                type="submit"
                className="action-button action-button--buy"
                disabled={optionBacktestLoading}
              >
                {optionBacktestLoading ? "Running..." : "Run Option Backtest"}
              </button>
            </form>
          </section>

          {optionBacktestResult ? (
            <>
              <section className="panel pnl-report-panel">
                <div className="panel-header">
                  <div>
                    <p className="panel-title">Option Backtest Report</p>
                    <p className="panel-subtitle">
                      Save date, contracts, CE/PE trades, and CE/PE PnL as a local CSV.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="action-button"
                    onClick={exportOptionBacktestReportCsv}
                    disabled={backtestExportLoading}
                  >
                    {backtestExportLoading ? "Saving CSV..." : "Save Report CSV"}
                  </button>
                </div>
              </section>

              <section className="report-metrics-grid option-backtest-metrics">
                <MetricCard
                  label="Net PnL"
                  value={<PnlValue value={optionBacktestResult.summary?.netPnl ?? 0} />}
                  tone={getPnlTone(optionBacktestResult.summary?.netPnl ?? 0)}
                />
                <MetricCard label="Trades" value={formatCount(optionBacktestResult.summary?.tradeCount)} />
                <MetricCard
                  label="Wins / Losses"
                  value={`${formatCount(optionBacktestResult.summary?.wins)} / ${formatCount(optionBacktestResult.summary?.losses)}`}
                />
                <MetricCard label="Win Rate" value={formatPercent(optionBacktestResult.summary?.winRate)} />
                <MetricCard
                  label="Contracts"
                  value={(optionBacktestResult.data?.contracts || []).join(" / ") || "-"}
                />
                <MetricCard label="Timeframe" value={optionBacktestResult.data?.signalInterval || optionBacktestResult.data?.interval || "-"} />
                <MetricCard label="Signal Rule" value={formatSnakeLabel(optionBacktestResult.data?.signalMode)} />
                <MetricCard
                  label="VWAP Filter"
                  value={optionBacktestResult.request?.require_vwap ? "ON" : "OFF"}
                />
                <MetricCard label="Selected Signals" value={formatCount(optionBacktestResult.data?.selectedSignalCount)} />
                <MetricCard
                  label="Fast / Both Signals"
                  value={`${formatCount(optionBacktestResult.data?.fastSignalCount)} / ${formatCount(optionBacktestResult.data?.bothSignalCount)}`}
                />
                <MetricCard label="Signal Data" value={formatSnakeLabel(optionBacktestResult.data?.signalDataSource)} />
                <MetricCard label="1m Data" value={formatSnakeLabel(optionBacktestResult.data?.executionDataSource)} />
              </section>

              <section className="panel pnl-report-panel">
                <div className="panel-header">
                  <div>
                    <p className="panel-title">Option Hourly PnL Report</p>
                    <p className="panel-subtitle">
                      Win/loss distribution by option-contract exit hour.
                    </p>
                  </div>
                  <label className="toggle-control">
                    <input
                      type="checkbox"
                      checked={showHourlyPnl}
                      onChange={(event) => setShowHourlyPnl(event.target.checked)}
                    />
                    <span>Show hourly PnL</span>
                  </label>
                </div>
                <HourlyPnlReport buckets={optionBacktestHourlyPnlReport} showPnl={showHourlyPnl} />
              </section>

              {optionBacktestResult.data?.contractStats?.length ? (
                <section className="panel">
                  <div className="panel-header">
                    <div>
                      <p className="panel-title">Contract Breakdown</p>
                      <p className="panel-subtitle">
                        Signals, executed trades, and skipped entries per tested contract.
                      </p>
                    </div>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Contract</th>
                          <th>Signals</th>
                          <th>Fast / Both</th>
                          <th>Trades</th>
                          <th>Skipped</th>
                          <th>Net PnL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {optionBacktestResult.data.contractStats.map((contract) => (
                          <tr key={contract.optionSymbol}>
                            <td>{contract.optionSymbol}</td>
                            <td>{formatCount(contract.selectedSignals)}</td>
                            <td>
                              {formatCount(contract.fastSignals)} / {formatCount(contract.bothSignals)}
                            </td>
                            <td>{formatCount(contract.trades)}</td>
                            <td>{formatCount(contract.skipped)}</td>
                            <td>
                              <PnlValue value={contract.netPnl} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}

              <section className="panel pnl-report-panel">
                <div className="panel-header">
                  <div>
                    <p className="panel-title">Option Weekday PnL Report</p>
                    <p className="panel-subtitle">
                      Net PnL grouped by weekday for this option contract.
                    </p>
                  </div>
                </div>
                <WeekdayPnlReport buckets={optionBacktestWeekdayPnlReport} />
              </section>

              <section className="panel">
                <div className="panel-header">
                  <div>
                    <p className="panel-title">Option Backtest Trades</p>
                    <p className="panel-subtitle">
                      Trades generated from the option contract Supertrend.
                    </p>
                  </div>
                </div>
                {optionBacktestResult.trades?.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Signal</th>
                          <th>Entry</th>
                          <th>Exit</th>
                          <th>Contract</th>
                          <th>Qty</th>
                          <th>Exec Entry</th>
                          <th>Exec Exit</th>
                          <th>SL</th>
                          <th>Target</th>
                          <th>Net PnL</th>
                          <th>Status</th>
                          <th>Exit Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {optionBacktestResult.trades.map((trade) => (
                          <tr key={`${trade.entryTime}-${trade.signal}-${trade.optionSymbol}`}>
                            <td>{formatSignal(trade.signal)}</td>
                            <td>{formatTableDateTime(trade.entryTime)}</td>
                            <td>{formatTableDateTime(trade.exitTime)}</td>
                            <td>{trade.optionSymbol}</td>
                            <td>{trade.quantity}</td>
                            <td>{formatCurrency(trade.entryPrice)}</td>
                            <td>{formatCurrency(trade.exitPrice)}</td>
                            <td>{formatCurrency(trade.stopLoss)}</td>
                            <td>{formatCurrency(trade.target)}</td>
                            <td>
                              <PnlValue value={trade.netPnl} baseValue={trade.capitalUsed} />
                            </td>
                            <td>{trade.status}</td>
                            <td>{formatSnakeLabel(trade.exitReason)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="empty-copy">
                    No option-contract trades were generated for this configuration.
                  </p>
                )}
              </section>
            </>
          ) : null}
        </section>
      ) : (
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="panel-title">Run Logs</p>
              <p className="panel-subtitle">
                Live run stream with signal state, Supertrend values, and
                execution messages.
                {logsSource === "text_log"
                  ? " Showing fallback entries from nifty_alert_bot.log for this date."
                  : ""}
              </p>
            </div>
            <div className="panel-tools">
              <div className="log-filter">
                <label htmlFor="log-date" className="metric-label">
                  Select date
                </label>
                <input
                  id="log-date"
                  type="date"
                  className="date-input"
                  value={selectedDate}
                  onChange={(event) => setSelectedDate(event.target.value)}
                />
              </div>
              <ColumnPicker
                label="Run Logs"
                columns={runLogColumns}
                selected={selectedRunLogColumns}
                onToggle={(columnId) =>
                  toggleColumn(
                    columnId,
                    selectedRunLogColumns,
                    setSelectedRunLogColumns,
                    runLogColumns,
                  )
                }
                onReset={() =>
                  setSelectedRunLogColumns(
                    runLogColumns.map((column) => column.id),
                  )
                }
              />
            </div>
          </div>

          <section className="log-summary-grid">
            <MetricCard
              label="Stream"
              value={logsStreamStatus}
              tone={logsStreamStatus === "live" ? "good" : "warn"}
            />
            <MetricCard
              label="Total Runs"
              value={formatCount(logCounts.total)}
            />
            <MetricCard
              label="Actions"
              value={formatCount(logCounts.actions)}
              tone={logCounts.actions ? "good" : "neutral"}
            />
            <MetricCard
              label="Errors"
              value={formatCount(logCounts.errors)}
              tone={logCounts.errors ? "bad" : "neutral"}
            />
          </section>

          {logsLoading ? (
            <p className="empty-copy">Loading run logs...</p>
          ) : logs.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {visibleRunLogColumns.map((column) => (
                      <th key={column.id}>{column.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={`${log.run_at}-${log.status}-${log.message}`}>
                      {visibleRunLogColumns.map((column) => {
                        const contractSignals = getLogContractSignals(log);
                        if (column.id === "run_at")
                          return (
                            <td key={column.id}>
                              {formatTimeOnly(log.run_at)}
                            </td>
                          );
                        if (column.id === "strategy_mode")
                          return (
                            <td key={column.id}>
                              {formatSnakeLabel(log.strategy_mode ?? "index")}
                            </td>
                          );
                        if (column.id === "option_symbol") {
                          if (contractSignals.length) {
                            return (
                              <td key={column.id}>
                                <ContractSignalList
                                  items={contractSignals}
                                  renderValue={(item) =>
                                    item.signal
                                      ? formatLogSignal(item.signal)
                                      : formatSnakeLabel(item.status ?? "-")
                                  }
                                />
                              </td>
                            );
                          }
                          return (
                            <td key={column.id}>
                              {log.option_symbol ?? log.contractInput ?? "-"}
                            </td>
                          );
                        }
                        if (column.id === "status") {
                          return (
                            <td key={column.id}>
                              <span
                                className={`status-pill status-pill--${getStatusTone(log.status)}`}
                              >
                                {log.status ?? "unknown"}
                              </span>
                            </td>
                          );
                        }
                        if (column.id === "signal")
                          return (
                            <td key={column.id}>
                              {contractSignals.length ? (
                                <ContractSignalList
                                  items={contractSignals}
                                  renderValue={(item) =>
                                    formatLogSignal(item.signal)
                                  }
                                />
                              ) : (
                                formatLogSignal(log.signal)
                              )}
                            </td>
                          );
                        if (column.id === "close")
                          return (
                            <td key={column.id}>
                              {contractSignals.length ? (
                                <ContractSignalList
                                  items={contractSignals}
                                  renderValue={(item) =>
                                    formatLogNumber(item.close)
                                  }
                                />
                              ) : (
                                formatLogNumber(log.close)
                              )}
                            </td>
                          );
                        if (column.id === "st_10_1")
                          return (
                            <td key={column.id}>
                              {contractSignals.length ? (
                                <ContractSignalList
                                  items={contractSignals}
                                  renderValue={(item) =>
                                    formatLogNumber(item.st_10_1)
                                  }
                                />
                              ) : (
                                formatLogNumber(log.st_10_1)
                              )}
                            </td>
                          );
                        if (column.id === "st_10_3")
                          return (
                            <td key={column.id}>
                              {contractSignals.length ? (
                                <ContractSignalList
                                  items={contractSignals}
                                  renderValue={(item) =>
                                    formatLogNumber(item.st_10_3)
                                  }
                                />
                              ) : (
                                formatLogNumber(log.st_10_3)
                              )}
                            </td>
                          );
                        if (column.id === "st_10_1_trend") {
                          const trend = formatTrend(log.st_10_1_trend);
                          if (contractSignals.length) {
                            return (
                              <td key={column.id}>
                                <ContractSignalList
                                  items={contractSignals}
                                  renderValue={(item) => {
                                    const itemTrend = formatTrend(
                                      item.st_10_1_trend,
                                    );
                                    return (
                                      <span
                                        className={`trend-cell trend-cell--${itemTrend.tone}`}
                                      >
                                        {itemTrend.icon}
                                      </span>
                                    );
                                  }}
                                />
                              </td>
                            );
                          }
                          return (
                            <td
                              key={column.id}
                              className={`trend-cell trend-cell--${trend.tone}`}
                            >
                              {trend.icon}
                            </td>
                          );
                        }
                        if (column.id === "st_10_3_trend") {
                          const trend = formatTrend(log.st_10_3_trend);
                          if (contractSignals.length) {
                            return (
                              <td key={column.id}>
                                <ContractSignalList
                                  items={contractSignals}
                                  renderValue={(item) => {
                                    const itemTrend = formatTrend(
                                      item.st_10_3_trend,
                                    );
                                    return (
                                      <span
                                        className={`trend-cell trend-cell--${itemTrend.tone}`}
                                      >
                                        {itemTrend.icon}
                                      </span>
                                    );
                                  }}
                                />
                              </td>
                            );
                          }
                          return (
                            <td
                              key={column.id}
                              className={`trend-cell trend-cell--${trend.tone}`}
                            >
                              {trend.icon}
                            </td>
                          );
                        }
                        if (column.id === "message")
                          return (
                            <td key={column.id} className="message-cell">
                              {log.message ?? "-"}
                            </td>
                          );
                        return <td key={column.id}>-</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty-copy">No run logs found for {selectedDate}.</p>
          )}
        </section>
      )}
    </main>
  );
}
