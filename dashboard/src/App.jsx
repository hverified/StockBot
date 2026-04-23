import { useEffect, useState } from "react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";
const TABLE_COLUMN_STORAGE_PREFIX = "dashboard-columns:";
const OVERVIEW_RANGE_OPTIONS = [
  { id: "today", label: "Today", tradesLabel: "Trades Today" },
  { id: "week", label: "This Week", tradesLabel: "Trades This Week" },
  { id: "month", label: "This Month", tradesLabel: "Trades This Month" },
  { id: "total", label: "Total", tradesLabel: "Trades Total" },
];

function parseIstDate(value) {
  if (!value) return null;
  const native = new Date(value);
  if (!Number.isNaN(native.getTime())) return native;

  const match = String(value).match(
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) (AM|PM) IST$/
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
    Number(second)
  );
  return new Date(utcMillis);
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
      <span className={`signal-dot signal-dot--${isBuy ? "buy" : "sell"}`} aria-hidden="true" />
      <span>{isBuy ? "BUY" : "SELL"}</span>
    </span>
  );
}

function formatLogSignal(signal) {
  if (!signal || String(signal).trim().toUpperCase() === "NO_SIGNAL") return "-";
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
  if (value === "fallback_underlying_signal_candle_pct") return "Underlying % fallback";
  return formatSnakeLabel(value);
}

function formatSkipReason(value) {
  if (!value) return "Not available";
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
  if (!Number.isFinite(numericValue) || !Number.isFinite(numericBase) || numericBase === 0) {
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
    <span className={`pnl-value pnl-value--${tone}${className ? ` ${className}` : ""}`}>
      {formatCurrency(value)}
      {relativePct ? <span className="pnl-value__pct">{relativePct}</span> : null}
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
      <p className={`metric-value${valueClassName ? ` ${valueClassName}` : ""}`}>{value}</p>
    </article>
  );
}

function MarketQuoteCard({ quote }) {
  const change = Number(quote.change ?? 0);
  const tone = getPnlTone(change);
  const sign = change > 0 ? "+" : "";

  return (
    <article className={`metric-card metric-card--${tone}`}>
      <p className="metric-label">{quote.name}</p>
      <p className="metric-value">{formatNumber(quote.ltp)}</p>
      <p className={`quote-change quote-change--${tone}`}>
        {quote.change === null || quote.change === undefined || quote.changePct === null || quote.changePct === undefined
          ? "Change not available"
          : `${sign}${formatNumber(quote.change)} (${sign}${formatNumber(quote.changePct)}%)`}
      </p>
    </article>
  );
}

function formatLogNumber(value) {
  if (value === null || value === undefined || value === "") return "-";
  const numericValue = Number(value);
  if (Number.isNaN(numericValue)) return value;
  return numericValue.toFixed(2);
}

function loadSelectedColumns(storageKey, columns) {
  const defaultIds = columns.filter((column) => column.defaultVisible !== false).map((column) => column.id);
  try {
    const raw = window.localStorage.getItem(`${TABLE_COLUMN_STORAGE_PREFIX}${storageKey}`);
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

function ColumnPicker({ label, columns, selected, onToggle, onReset, direction = "down" }) {
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
        <button type="button" className="column-picker__reset" onClick={onReset}>
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

export function App() {
  const [activeView, setActiveView] = useState("overview");
  const [theme, setTheme] = useState(() => window.localStorage.getItem("dashboard-theme") ?? "dark");
  const [data, setData] = useState(null);
  const [logs, setLogs] = useState([]);
  const [logsSource, setLogsSource] = useState("none");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(true);
  const [logsStreamStatus, setLogsStreamStatus] = useState("idle");
  const [actionMessage, setActionMessage] = useState("");
  const [triggeringSignal, setTriggeringSignal] = useState("");
  const [selectedDate, setSelectedDate] = useState(getTodayInIst());
  const [streamStatus, setStreamStatus] = useState("connecting");
  const [zerodhaAuthBusy, setZerodhaAuthBusy] = useState(false);
  const [overviewRange, setOverviewRange] = useState(() => window.localStorage.getItem("overview-range") ?? "today");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("dashboard-theme", theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem("overview-range", overviewRange);
  }, [overviewRange]);

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
          setError(fetchError instanceof Error ? fetchError.message : "Unable to load dashboard data.");
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
              : "Zerodha access token saved. Restart the bot process to use it."
          );
        }

        const cleanUrl = `${window.location.pathname}${window.location.hash || ""}`;
        window.history.replaceState({}, document.title, cleanUrl);
      } catch (exchangeError) {
        if (active) {
          setError(exchangeError instanceof Error ? exchangeError.message : "Unable to exchange Zerodha request token.");
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
          setError(fetchError instanceof Error ? fetchError.message : "Unable to load run logs.");
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
      eventSource = new EventSource(apiUrl(`/api/logs/stream?date=${selectedDate}`));
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
        throw new Error(`Dashboard refresh failed with ${dashboardResponse.status}`);
      }

      setData(await dashboardResponse.json());

      const logsResponse = await fetch(apiUrl(`/api/logs?date=${selectedDate}`));
      if (logsResponse.ok) {
        const logsPayload = await logsResponse.json();
        setLogs(logsPayload.logs ?? []);
        setLogsSource(logsPayload.source ?? "none");
      }
    } catch (triggerError) {
      setError(triggerError instanceof Error ? triggerError.message : "Unable to trigger sample alert.");
    } finally {
      setTriggeringSignal("");
      setLoading(false);
    }
  }

  const recentAlerts = data?.recentAlerts ?? [];
  const status = data?.status ?? {};
  const schedule = data?.schedule ?? {};
  const marketQuotes = data?.marketQuotes ?? [];
  const paperTrading = data?.paperTrading ?? {};
  const activeTrade = paperTrading.activeTrade ?? null;
  const tradeHistory = paperTrading.tradeHistory ?? [];
  const recentSkippedTrades = paperTrading.recentSkippedTrades ?? [];
  const summaryByRange = paperTrading.summaryByRange ?? {};
  const dailySummary = paperTrading.dailySummary ?? {};
  const zerodha = data?.zerodha ?? {};
  const selectedRangeSummary = summaryByRange[overviewRange] ?? summaryByRange.today ?? {
    runningPnl: paperTrading.runningPnl ?? 0,
    realizedPnl: paperTrading.realizedPnl ?? 0,
    unrealizedPnl: activeTrade?.unrealizedPnl ?? 0,
    tradeCount: dailySummary.tradeCount ?? 0,
    winCount: dailySummary.winCount ?? 0,
    lossCount: dailySummary.lossCount ?? 0,
  };
  const selectedRangeMeta = OVERVIEW_RANGE_OPTIONS.find((option) => option.id === overviewRange) ?? OVERVIEW_RANGE_OPTIONS[0];
  const winsLosses = `${formatCount(selectedRangeSummary.winCount)} / ${formatCount(selectedRangeSummary.lossCount)}`;
  const logCounts = logs.reduce(
    (counts, log) => {
      const statusValue = String(log.status ?? "unknown").toLowerCase();
      counts.total += 1;
      if (statusValue === "error") counts.errors += 1;
      if (statusValue === "skipped" || statusValue === "duplicate") counts.skipped += 1;
      if (statusValue === "alert_sent" || statusValue.includes("win") || statusValue.includes("loss")) counts.actions += 1;
      return counts;
    },
    { total: 0, errors: 0, skipped: 0, actions: 0 }
  );
  const openTradeLabel = activeTrade
    ? (
      <span className="open-trade-label">
        {formatSignal(activeTrade.signal)}
        <span className="open-trade-label__sep">·</span>
        <span>{activeTrade.option_symbol ?? activeTrade.optionSymbol ?? "Contract"}</span>
      </span>
    )
    : "No active trade";

  const signalAlertColumns = [
    { id: "signal", label: "Signal" },
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
  ];
  const skippedTradeColumns = [
    { id: "timestamp", label: "Time" },
    { id: "signal", label: "Signal" },
    { id: "contract", label: "Contract" },
    { id: "entryPrice", label: "Buy Price" },
    { id: "stopLossPrice", label: "Stop Loss" },
    { id: "stopLossSource", label: "SL Source" },
    { id: "skipReason", label: "Skip Reason" },
    { id: "message", label: "Message" },
  ];
  const runLogColumns = [
    { id: "run_at", label: "Run Time" },
    { id: "status", label: "Status" },
    { id: "signal", label: "Signal" },
    { id: "close", label: "Close" },
    { id: "st_10_1", label: "ST (10,1)" },
    { id: "st_10_3", label: "ST (10,3)" },
    { id: "st_10_1_trend", label: "Fast Trend" },
    { id: "st_10_3_trend", label: "Slow Trend" },
    { id: "message", label: "Message" },
  ];

  const [selectedSignalAlertColumns, setSelectedSignalAlertColumns] = useState(() =>
    loadSelectedColumns("signal-alerts", signalAlertColumns)
  );
  const [selectedTradeHistoryColumns, setSelectedTradeHistoryColumns] = useState(() =>
    loadSelectedColumns("trade-history", tradeHistoryColumns)
  );
  const [selectedSkippedTradeColumns, setSelectedSkippedTradeColumns] = useState(() =>
    loadSelectedColumns("skipped-trades", skippedTradeColumns)
  );
  const [selectedRunLogColumns, setSelectedRunLogColumns] = useState(() =>
    loadSelectedColumns("run-logs", runLogColumns)
  );

  useEffect(() => {
    window.localStorage.setItem(
      `${TABLE_COLUMN_STORAGE_PREFIX}signal-alerts`,
      JSON.stringify(selectedSignalAlertColumns)
    );
  }, [selectedSignalAlertColumns]);

  useEffect(() => {
    window.localStorage.setItem(
      `${TABLE_COLUMN_STORAGE_PREFIX}trade-history`,
      JSON.stringify(selectedTradeHistoryColumns)
    );
  }, [selectedTradeHistoryColumns]);

  useEffect(() => {
    window.localStorage.setItem(
      `${TABLE_COLUMN_STORAGE_PREFIX}skipped-trades`,
      JSON.stringify(selectedSkippedTradeColumns)
    );
  }, [selectedSkippedTradeColumns]);

  useEffect(() => {
    window.localStorage.setItem(
      `${TABLE_COLUMN_STORAGE_PREFIX}run-logs`,
      JSON.stringify(selectedRunLogColumns)
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

  const visibleSignalAlertColumns = signalAlertColumns.filter((column) => selectedSignalAlertColumns.includes(column.id));
  const visibleTradeHistoryColumns = tradeHistoryColumns.filter((column) => selectedTradeHistoryColumns.includes(column.id));
  const visibleSkippedTradeColumns = skippedTradeColumns.filter((column) => selectedSkippedTradeColumns.includes(column.id));
  const visibleRunLogColumns = runLogColumns.filter((column) => selectedRunLogColumns.includes(column.id));

  function connectZerodha() {
    if (!zerodha.loginUrl) {
      setError("ZERODHA_API_KEY is not configured in the backend.");
      return;
    }
    window.location.href = zerodha.loginUrl;
  }

  function toggleTheme() {
    setTheme((currentTheme) => (currentTheme === "dark" ? "light" : "dark"));
  }

  return (
    <main className="shell">
      <section className="top-nav">
        <div className="nav-group">
          <button
            type="button"
            className={`nav-chip ${activeView === "overview" ? "nav-chip--active" : ""}`}
            onClick={() => setActiveView("overview")}
          >
            Overview
          </button>
          <button
            type="button"
            className={`nav-chip ${activeView === "logs" ? "nav-chip--active" : ""}`}
            onClick={() => setActiveView("logs")}
          >
            Run Logs
          </button>
        </div>

        <button type="button" className="theme-toggle" onClick={toggleTheme}>
          {theme === "dark" ? "Light Mode" : "Dark Mode"}
        </button>
      </section>

      <section className="hero">
        <div>
          <p className="eyebrow">NIFTY Signal Control Room</p>
          <h1>Live NIFTY paper trading and signal dashboard.</h1>
          <p className="hero-copy">
            {activeView === "overview"
              ? "Track NIFTY and SENSEX quotes, Supertrend signals, paper-trade positions, Zerodha status, and daily PnL in one place."
              : "Inspect every bot run with Supertrend values, signal state, and per-run messages, filtered date by date."}
          </p>
        </div>
        <div className="hero-badge">
          <span>{activeView === "overview" ? "Feed" : "Selected date"}</span>
          <strong>{activeView === "overview" ? streamStatus : selectedDate}</strong>
        </div>
      </section>

      {error ? <div className="banner banner--error">{error}</div> : null}
      {actionMessage ? <div className="banner banner--success">{actionMessage}</div> : null}
      {loading ? <div className="banner">Loading dashboard data...</div> : null}

      {activeView === "overview" ? (
        <>
          <section className="section-jump-bar">
            <button type="button" className="section-jump-chip" onClick={() => document.getElementById("market-overview")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              Market Overview
            </button>
            <button type="button" className="section-jump-chip" onClick={() => document.getElementById("paper-trading")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              Paper Trading
            </button>
            <button type="button" className="section-jump-chip" onClick={() => document.getElementById("system-history")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              System
            </button>
          </section>

          <section id="market-overview" className="section-block">
            <div className="section-heading">
              <p className="eyebrow">Session Snapshot</p>
              <h2 className="section-title">Market overview</h2>
            </div>

            <div className="range-switcher" role="tablist" aria-label="Market overview range">
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
            {marketQuotes.map((quote) => (
              <MarketQuoteCard key={quote.name} quote={quote} />
            ))}
            <MetricCard
              label="Last Run Status"
              value={status.lastRunStatus ?? "idle"}
              tone={getStatusTone(status.lastRunStatus)}
            />
            <MetricCard label="Next Run (IST)" value={formatDateTime(schedule.nextRunAt)} />
            <MetricCard
              label="Running PnL"
              value={<PnlValue value={selectedRangeSummary.runningPnl ?? 0} baseValue={paperTrading.capitalBase} />}
              tone={getPnlTone(selectedRangeSummary.runningPnl ?? 0)}
            />
            <MetricCard label={selectedRangeMeta.tradesLabel} value={formatCount(selectedRangeSummary.tradeCount)} />
            <MetricCard label="Wins / Losses" value={winsLosses} />
            <MetricCard label="Open Trade" value={openTradeLabel} tone={activeTrade ? "warn" : "neutral"} />
          </section>
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
                    <p className="panel-subtitle">Live paper position state restored across restarts.</p>
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
                      <dd><PnlValue value={activeTrade.unrealizedPnl} baseValue={activeTrade.capital_used} /></dd>
                    </div>
                    <div>
                      <dt>SL</dt>
                      <dd>{formatCurrency(activeTrade.stop_loss_price)}</dd>
                    </div>
                    <div>
                      <dt>SL Source</dt>
                      <dd>{formatStopLossSource(activeTrade.stop_loss_source)}</dd>
                    </div>
                    <div>
                      <dt>Target</dt>
                      <dd>{formatCurrency(activeTrade.target_price)}</dd>
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
                    <p className="panel-title">Daily Summary</p>
                    <p className="panel-subtitle">Paper-trading performance snapshot for the current IST session.</p>
                  </div>
                </div>

                <dl className="status-list">
                  <div>
                    <dt>Trade Date</dt>
                    <dd>{dailySummary.tradeDate ?? "Not available"}</dd>
                  </div>
                  <div>
                    <dt>Realized PnL</dt>
                    <dd><PnlValue value={paperTrading.realizedPnl ?? 0} baseValue={paperTrading.capitalBase} /></dd>
                  </div>
                  <div>
                    <dt>Trades</dt>
                    <dd>{formatCount(dailySummary.tradeCount)}</dd>
                  </div>
                  <div>
                    <dt>Wins / Losses</dt>
                    <dd>{formatCount(dailySummary.winCount)} / {formatCount(dailySummary.lossCount)}</dd>
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
                    <p className="panel-subtitle">Login flow for generating and saving the Kite access token.</p>
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
                    <dd>{zerodha.accessTokenConfigured ? "Configured" : "Missing"}</dd>
                  </div>
                  <div>
                    <dt>Health Check</dt>
                    <dd>{zerodha.health?.ok ? "Working" : zerodha.health?.message ?? "Not checked"}</dd>
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
                    <dd>{zerodha.session?.userName ?? zerodha.session?.userId ?? "Not available"}</dd>
                  </div>
                </dl>
              </article>

              <article className="panel">
                <div className="panel-header">
                  <div>
                    <p className="panel-title">Signal Alerts</p>
                    <p className="panel-subtitle">Live alert history from the shared bot state. Sample alerts can be triggered here too.</p>
                  </div>
                  <ColumnPicker
                    label="Signal Alerts"
                    columns={signalAlertColumns}
                    selected={selectedSignalAlertColumns}
                    onToggle={(columnId) => toggleColumn(columnId, selectedSignalAlertColumns, setSelectedSignalAlertColumns, signalAlertColumns)}
                    onReset={() => setSelectedSignalAlertColumns(signalAlertColumns.map((column) => column.id))}
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
                              if (column.id === "signal") return <td key={column.id}>{formatSignal(alert.signal)}</td>;
                              if (column.id === "close") return <td key={column.id}>{alert.close?.toFixed(2)}</td>;
                              if (column.id === "st_10_1") return <td key={column.id}>{alert.st_10_1?.toFixed(2)}</td>;
                              if (column.id === "st_10_3") return <td key={column.id}>{alert.st_10_3?.toFixed(2)}</td>;
                              if (column.id === "candleTime") return <td key={column.id}>{formatTableDateTime(alert.candleTime)}</td>;
                              if (column.id === "alertTime") return <td key={column.id}>{formatTableDateTime(alert.alertTime)}</td>;
                              return <td key={column.id}>-</td>;
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="empty-copy">Recent alerts will appear here once the bot sends or tests a signal.</p>
                )}
              </article>
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <p className="panel-title">Trade History</p>
                  <p className="panel-subtitle">Completed paper trades with entry, exit, capital, and net PnL.</p>
                </div>
                <ColumnPicker
                  label="Trade History"
                  columns={tradeHistoryColumns}
                  selected={selectedTradeHistoryColumns}
                  onToggle={(columnId) => toggleColumn(columnId, selectedTradeHistoryColumns, setSelectedTradeHistoryColumns, tradeHistoryColumns)}
                  onReset={() => setSelectedTradeHistoryColumns(tradeHistoryColumns.map((column) => column.id))}
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
                            if (column.id === "signal") return <td key={column.id}>{formatSignal(trade.signal)}</td>;
                            if (column.id === "option_symbol") return <td key={column.id}>{trade.option_symbol ?? "Not available"}</td>;
                            if (column.id === "entry_time") return <td key={column.id}>{formatTableDateTime(trade.entry_time)}</td>;
                            if (column.id === "exit_time") return <td key={column.id}>{formatTableDateTime(trade.exit_time)}</td>;
                            if (column.id === "quantity") return <td key={column.id}>{trade.quantity ?? "-"}</td>;
                            if (column.id === "capital_used") return <td key={column.id}>{formatCurrency(trade.capital_used)}</td>;
                            if (column.id === "entry_price") return <td key={column.id}>{formatCurrency(trade.entry_price)}</td>;
                            if (column.id === "exit_price") return <td key={column.id}>{formatCurrency(trade.exit_price)}</td>;
                            if (column.id === "stop_loss_price") return <td key={column.id}>{formatCurrency(trade.stop_loss_price)}</td>;
                            if (column.id === "stop_loss_source") return <td key={column.id}>{formatStopLossSource(trade.stop_loss_source)}</td>;
                            if (column.id === "target_price") return <td key={column.id}>{formatCurrency(trade.target_price)}</td>;
                            if (column.id === "net_pnl") return <td key={column.id}><PnlValue value={trade.net_pnl} baseValue={trade.capital_used} /></td>;
                            if (column.id === "status") return <td key={column.id}>{trade.status ?? "Closed"}</td>;
                            return <td key={column.id}>-</td>;
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="empty-copy">Completed paper trades will appear here after the first exit.</p>
              )}
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <p className="panel-title">Recent Skipped Trades</p>
                  <p className="panel-subtitle">Latest skipped entries with clear reasons from the paper-trade log.</p>
                </div>
                <ColumnPicker
                  label="Recent Skipped Trades"
                  columns={skippedTradeColumns}
                  selected={selectedSkippedTradeColumns}
                  onToggle={(columnId) => toggleColumn(columnId, selectedSkippedTradeColumns, setSelectedSkippedTradeColumns, skippedTradeColumns)}
                  onReset={() => setSelectedSkippedTradeColumns(skippedTradeColumns.map((column) => column.id))}
                  direction="up"
                />
              </div>

              {recentSkippedTrades.length ? (
                <div className="table-wrap">
                  <table className="table-skipped-trades">
                    <thead>
                      <tr>
                        {visibleSkippedTradeColumns.map((column) => (
                          <th key={column.id}>{column.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {recentSkippedTrades.map((trade) => (
                        <tr key={`${trade.timestamp}-${trade.skipReason}-${trade.optionSymbol ?? trade.signal}`}>
                          {visibleSkippedTradeColumns.map((column) => {
                            if (column.id === "timestamp") return <td key={column.id} className="cell-nowrap">{formatTableDateTime(trade.timestamp)}</td>;
                            if (column.id === "signal") return <td key={column.id} className="cell-nowrap">{formatSignal(trade.signal)}</td>;
                            if (column.id === "contract") {
                              return (
                                <td key={column.id} className="cell-nowrap">
                                  {trade.optionSymbol ?? (trade.strike && trade.optionType ? `${trade.strike} ${trade.optionType}` : "-")}
                                </td>
                              );
                            }
                            if (column.id === "entryPrice") return <td key={column.id} className="cell-nowrap">{formatCurrency(trade.entryPrice)}</td>;
                            if (column.id === "stopLossPrice") return <td key={column.id} className="cell-nowrap">{formatCurrency(trade.stopLossPrice)}</td>;
                            if (column.id === "stopLossSource") return <td key={column.id}>{formatStopLossSource(trade.stopLossSource)}</td>;
                            if (column.id === "skipReason") {
                              return (
                                <td key={column.id} className="cell-nowrap">
                                  <span className="inline-badge inline-badge--warn">{formatSkipReason(trade.skipReason)}</span>
                                </td>
                              );
                            }
                            if (column.id === "message") return <td key={column.id} className="message-cell">{trade.message ?? "-"}</td>;
                            return <td key={column.id}>-</td>;
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="empty-copy">Skipped trade decisions will appear here when a setup is rejected.</p>
              )}
            </section>
          </section>
        </>
      ) : (
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="panel-title">Run Logs</p>
              <p className="panel-subtitle">
                Live run stream with signal state, Supertrend values, and execution messages.
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
                onToggle={(columnId) => toggleColumn(columnId, selectedRunLogColumns, setSelectedRunLogColumns, runLogColumns)}
                onReset={() => setSelectedRunLogColumns(runLogColumns.map((column) => column.id))}
              />
            </div>
          </div>

          <section className="log-summary-grid">
            <MetricCard label="Stream" value={logsStreamStatus} tone={logsStreamStatus === "live" ? "good" : "warn"} />
            <MetricCard label="Total Runs" value={formatCount(logCounts.total)} />
            <MetricCard label="Actions" value={formatCount(logCounts.actions)} tone={logCounts.actions ? "good" : "neutral"} />
            <MetricCard label="Errors" value={formatCount(logCounts.errors)} tone={logCounts.errors ? "bad" : "neutral"} />
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
                        if (column.id === "run_at") return <td key={column.id}>{formatTimeOnly(log.run_at)}</td>;
                        if (column.id === "status") {
                          return (
                            <td key={column.id}>
                              <span className={`status-pill status-pill--${getStatusTone(log.status)}`}>{log.status ?? "unknown"}</span>
                            </td>
                          );
                        }
                        if (column.id === "signal") return <td key={column.id}>{formatLogSignal(log.signal)}</td>;
                        if (column.id === "close") return <td key={column.id}>{formatLogNumber(log.close)}</td>;
                        if (column.id === "st_10_1") return <td key={column.id}>{formatLogNumber(log.st_10_1)}</td>;
                        if (column.id === "st_10_3") return <td key={column.id}>{formatLogNumber(log.st_10_3)}</td>;
                        if (column.id === "st_10_1_trend") {
                          const trend = formatTrend(log.st_10_1_trend);
                          return <td key={column.id} className={`trend-cell trend-cell--${trend.tone}`}>{trend.icon}</td>;
                        }
                        if (column.id === "st_10_3_trend") {
                          const trend = formatTrend(log.st_10_3_trend);
                          return <td key={column.id} className={`trend-cell trend-cell--${trend.tone}`}>{trend.icon}</td>;
                        }
                        if (column.id === "message") return <td key={column.id} className="message-cell">{log.message ?? "-"}</td>;
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
