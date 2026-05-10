export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";
export const TABLE_COLUMN_STORAGE_PREFIX = "dashboard-columns:";
export const DEFAULT_TABLE_PAGE_SIZE = 10;
export const TABLE_PAGE_SIZE_OPTIONS = [10, 25, 50];
export const OVERVIEW_RANGE_OPTIONS = [
  { id: "today", label: "Today", tradesLabel: "Trades Today" },
  { id: "week", label: "This Week", tradesLabel: "Trades This Week" },
  { id: "month", label: "This Month", tradesLabel: "Trades This Month" },
  { id: "total", label: "Total", tradesLabel: "Trades Total" },
];
export const PNL_REPORT_HOURS = Array.from(
  { length: 8 },
  (_, index) => index + 9,
);
export const WEEKDAY_REPORT_DAYS = [
  { index: 1, label: "Monday", shortLabel: "Mon" },
  { index: 2, label: "Tuesday", shortLabel: "Tue" },
  { index: 3, label: "Wednesday", shortLabel: "Wed" },
  { index: 4, label: "Thursday", shortLabel: "Thu" },
  { index: 5, label: "Friday", shortLabel: "Fri" },
];
export const BACKTEST_INSTRUMENT_OPTIONS = [
  { id: "NIFTY", label: "NIFTY 50" },
  { id: "SENSEX", label: "SENSEX" },
];
export const BACKTEST_SIGNAL_MODE_OPTIONS = [
  { id: "both", label: "Both ST" },
  { id: "st_10_1", label: "ST (10,1)" },
];
export const BACKTEST_STOP_LOSS_MODES = [
  { id: "signal_low", label: "Signal low" },
  { id: "percent", label: "SL %" },
];
export const BACKTEST_ENTRY_TIMING_OPTIONS = [
  { id: "signal_close", label: "Signal close" },
  { id: "next_minute", label: "+1 min" },
];
export const OPTION_BACKTEST_EXCHANGES = ["NFO", "BFO"];
export const OPTION_BACKTEST_ENTRY_SIGNALS = [
  { id: "BUY", label: "BUY" },
  { id: "SELL", label: "SELL" },
  { id: "BOTH", label: "Both" },
];
export const STRATEGY_FILTER_OPTIONS = [
  { id: "all", label: "All" },
  { id: "niftyFiveMinute", label: "NIFTY 5m" },
  { id: "sensexFiveMinute", label: "SENSEX 5m" },
];
export const NAV_OPTIONS = [
  { id: "overview", label: "Overview" },
  { id: "niftyFiveMinuteBot", label: "NIFTY 5m Bot" },
  { id: "sensexFiveMinuteBot", label: "SENSEX 5m Bot" },
  { id: "balance", label: "Balance" },
  { id: "trades", label: "Trades" },
  { id: "signals", label: "Signals" },
  { id: "reports", label: "Reports" },
  { id: "liveTrading", label: "Live Trading" },
  { id: "broker", label: "Broker" },
  { id: "logs", label: "Logs" },
  { id: "niftyFiveMinuteBacktest", label: "5m Option Backtest" },
  { id: "optionBacktest", label: "Option Backtest" },
];
export const THEME_OPTIONS = [
  { id: "warm", label: "Warm" },
  { id: "cool", label: "Cool" },
  { id: "nature", label: "Nature" },
  { id: "finance", label: "Finance" },
  { id: "sunset", label: "Sunset" },
  { id: "neon", label: "Neon" },
  { id: "dark-pro", label: "Dark Pro" },
  { id: "midnight", label: "Midnight" },
  { id: "ice", label: "Ice" },
  { id: "luxe", label: "Luxe" },
  { id: "amber", label: "Amber" },
];
export const DAILY_SETUP_KEYS = {
  niftyOneMinuteBot: "option_contracts_1m",
  sensexOneMinuteBot: "option_contracts_1m_sensex",
  niftyFiveMinuteBot: "option_contracts_5m",
  sensexFiveMinuteBot: "option_contracts_5m_sensex",
};
export const DEFAULT_DAILY_SETUP_FORM = {
  contractMode: "dynamic",
  contract1: "",
  contract2: "",
  entrySignal: "BUY",
  scheduleStart: "09:20",
  scheduleEnd: "15:00",
  startingBalance: "100000",
  targetPct: "3",
  maxSignalCandlePct: "10",
  minSignalCandlePct: "0",
  strikeOffset: "0",
  stopLossMode: "signal_low",
  stopLossPct: "8",
};

export function parseIstDate(value) {
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

export function getIstDateParts(value) {
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

export function makeIstDate(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day, -5, -30, 0));
}

export function getOverviewRangeStart(rangeId) {
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

export function getTradeExitTime(trade) {
  return trade.exit_time ?? trade.exitTime;
}

export function getTradePnl(trade) {
  return Number(trade.net_pnl ?? trade.netPnl ?? 0);
}

export function getTradeOptionType(trade) {
  const optionType = String(
    trade.option_type ?? trade.optionType ?? "",
  ).toUpperCase();
  return optionType === "CE" || optionType === "PE" ? optionType : "OTHER";
}

export function roundCurrencyNumber(value) {
  return Math.round(Number(value ?? 0) * 100) / 100;
}

export function filterTradesForRange(trades, rangeId) {
  const rangeStart = getOverviewRangeStart(rangeId);
  return trades.filter((trade) => {
    const exitDate = parseIstDate(getTradeExitTime(trade));
    if (!exitDate) return false;
    return !rangeStart || exitDate >= rangeStart;
  });
}

export function buildHourlyPnlReport(trades, rangeId = "total") {
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

export function buildReportMetrics(trades, rangeId = "total") {
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
    losses.reduce((sum, trade) => sum + Math.min(0, getTradePnl(trade)), 0),
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

export function buildTradeSummaryForRange(trades, activeTrades, rangeId) {
  const rangeTrades = filterTradesForRange(trades, rangeId);
  const rangeStart = getOverviewRangeStart(rangeId);
  const unrealizedPnl = activeTrades.reduce((sum, trade) => {
    const entryDate = parseIstDate(trade.entry_time ?? trade.entryTime);
    if (rangeStart && (!entryDate || entryDate < rangeStart)) return sum;
    return sum + Number(trade.unrealizedPnl ?? 0);
  }, 0);
  const realizedPnl = rangeTrades.reduce(
    (sum, trade) => sum + getTradePnl(trade),
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

export function buildWeekdayPnlReport(trades, rangeId = "total") {
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

export function buildOptionTypeReport(trades, rangeId = "total") {
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
    bucket.bestTrade =
      bucket.bestTrade === null ? pnl : Math.max(bucket.bestTrade, pnl);
    bucket.worstTrade =
      bucket.worstTrade === null ? pnl : Math.min(bucket.worstTrade, pnl);
    if (status === "WIN") bucket.wins += 1;
    if (status === "LOSS") bucket.losses += 1;
    if (pnl > 0) bucket.grossProfit += pnl;
    if (pnl < 0) bucket.grossLoss += Math.abs(pnl);
  }

  return buckets.map((bucket) => ({
    ...bucket,
    pnl: roundCurrencyNumber(bucket.pnl),
    averagePnl: bucket.trades
      ? roundCurrencyNumber(bucket.pnl / bucket.trades)
      : 0,
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

export function getStatusTone(status) {
  if (status === "entry" || status === "alert_sent" || status === "sample_alert_sent") return "good";
  if (status === "error") return "bad";
  if (status === "duplicate") return "warn";
  if (status === "skipped") return "warn";
  return "neutral";
}

export function formatDateTime(value) {
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

export function formatTimeOnly(value) {
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

export function formatTableDateTime(value) {
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

export function formatSignal(signal) {
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

export function formatLogSignal(signal) {
  if (!signal || String(signal).trim().toUpperCase() === "NO_SIGNAL")
    return "-";
  return formatSignal(signal);
}

export function formatSnakeLabel(value) {
  if (!value) return "Not available";
  return String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatStopLossSource(value) {
  if (!value) return "Not available";
  if (value === "option_signal_candle_low") return "Option signal candle low";
  if (value === "fallback_underlying_signal_candle_pct")
    return "Underlying % fallback";
  return formatSnakeLabel(value);
}

export function formatCurrency(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "Not available";
  }

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value));
}

export function formatRelativePct(value, baseValue) {
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

export function getPnlTone(value) {
  if (value > 0) return "good";
  if (value < 0) return "bad";
  return "neutral";
}

export function PnlValue({ value, baseValue = null, className = "" }) {
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

export function formatCount(value) {
  if (value === null || value === undefined) return "0";
  return String(value);
}

export function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "Not available";
  }

  return Number(value).toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  });
}

export function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "0.00%";
  }

  return `${Number(value).toFixed(2)}%`;
}

export function formatRatio(value) {
  if (value === Infinity) return "∞";
  if (value === null || value === undefined || Number.isNaN(Number(value)))
    return "0.00";
  return Number(value).toFixed(2);
}

export function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}

export function getTodayInIst() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
  }).format(new Date());
}

export function formatIstClock(value) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(value);
}

export function formatIstClockDate(value) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(value);
}

export function MetricCard({
  label,
  value,
  tone = "neutral",
  valueClassName = "",
}) {
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

export function MarketQuoteCard({ quote }) {
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
        <div className="quote-card__header">
          <div>
            <p className="metric-label">{quote.name}</p>
            <p className="quote-card__caption">Live index</p>
          </div>
          <span
            className={`quote-status-dot quote-status-dot--${tone}`}
            aria-hidden="true"
          />
        </div>
        <div className="quote-card__price-row">
          <p className="metric-value quote-card__price">
            {formatNumber(quote.ltp)}
          </p>
          <p className={`quote-change quote-change--${tone}`}>
            {quote.change === null ||
            quote.change === undefined ||
            quote.changePct === null ||
            quote.changePct === undefined
              ? "N/A"
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
              <path
                className="quote-sparkline__area"
                d={`${sparklinePath} L 100 40 L 0 40 Z`}
              />
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

export function HourlyPnlReport({ buckets, showPnl }) {
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

export function WeekdayPnlReport({ buckets }) {
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

export function OptionTypeReport({ buckets }) {
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
              <span
                className={`option-type-badge option-type-badge--${bucket.optionType.toLowerCase()}`}
              >
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

export function formatLogNumber(value) {
  if (value === null || value === undefined || value === "") return "-";
  const numericValue = Number(value);
  if (Number.isNaN(numericValue)) return value;
  return numericValue.toFixed(2);
}

export function loadSelectedColumns(storageKey, columns) {
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

export function ColumnPicker({
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

export function PaginationControls({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}) {
  if (total <= pageSize && pageSize === DEFAULT_TABLE_PAGE_SIZE) return null;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = total ? (safePage - 1) * pageSize + 1 : 0;
  const end = Math.min(total, safePage * pageSize);

  return (
    <div className="table-pagination">
      <span className="table-pagination__count">
        {start}-{end} of {total}
      </span>
      <label className="table-pagination__size">
        <span>Rows</span>
        <select
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
        >
          {TABLE_PAGE_SIZE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <div className="table-pagination__buttons">
        <button
          type="button"
          onClick={() => onPageChange(safePage - 1)}
          disabled={safePage <= 1}
        >
          Prev
        </button>
        <span>
          {safePage}/{totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(safePage + 1)}
          disabled={safePage >= totalPages}
        >
          Next
        </button>
      </div>
    </div>
  );
}

export function formatTrend(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (
    value === 1 ||
    value === "1" ||
    normalized === "bullish" ||
    normalized === "buy" ||
    normalized === "up" ||
    normalized === "green"
  ) {
    return { icon: "↑", tone: "good" };
  }
  if (
    value === -1 ||
    value === "-1" ||
    normalized === "bearish" ||
    normalized === "sell" ||
    normalized === "down" ||
    normalized === "red"
  ) {
    return { icon: "↓", tone: "bad" };
  }
  return { icon: "-", tone: "neutral" };
}

export function TrendBadge({ value }) {
  const trend = formatTrend(value);
  return (
    <span className={`trend-cell trend-cell--${trend.tone}`}>
      {trend.icon}
    </span>
  );
}

export function getLogContractSignals(log) {
  return Array.isArray(log?.contract_signals) ? log.contract_signals : [];
}

export function formatCompactOptionSymbol(value) {
  const symbol = String(value ?? "")
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!symbol) return "";
  const match = symbol.match(/(\d{5})(CE|PE)$/);
  if (!match) return symbol;
  const prefix = symbol.includes("SENSEX") ? "S" : "N";
  return `${prefix}-${match[1]}${match[2]}`;
}

export function getLogContractLabel(item) {
  const symbol = item?.resolved_symbol ?? item?.input;
  return symbol ? formatCompactOptionSymbol(symbol) : "Contract";
}

export function ContractSignalList({ items, renderValue }) {
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
