import { useEffect, useRef, useState } from "react";
import {
  BACKTEST_ENTRY_TIMING_OPTIONS,
  BACKTEST_INSTRUMENT_OPTIONS,
  BACKTEST_SIGNAL_MODE_OPTIONS,
  BACKTEST_STOP_LOSS_MODES,
  ColumnPicker,
  DAILY_SETUP_KEYS,
  DEFAULT_DAILY_SETUP_FORM,
  DEFAULT_TABLE_PAGE_SIZE,
  EXPIRY_OFFSET_OPTIONS,
  HourlyPnlReport,
  MarketQuoteCard,
  MetricCard,
  NAV_OPTIONS,
  OVERVIEW_RANGE_OPTIONS,
  OptionTypeReport,
  PnlValue,
  STRATEGY_FILTER_OPTIONS,
  TABLE_COLUMN_STORAGE_PREFIX,
  THEME_OPTIONS,
  TrendBadge,
  WeekdayPnlReport,
  apiUrl,
  buildHourlyPnlReport,
  buildOptionTypeReport,
  buildReportMetrics,
  buildTradeSummaryForRange,
  buildWeekdayPnlReport,
  filterTradesForRange,
  formatCompactOptionSymbol,
  formatCount,
  formatCurrency,
  formatDateTime,
  formatIstClock,
  formatIstClockDate,
  formatLogNumber,
  formatLogSignal,
  formatNumber,
  formatPercent,
  formatRatio,
  formatSignal,
  formatSnakeLabel,
  formatStopLossSource,
  formatTableDateTime,
  formatTimeOnly,
  getLogContractSignals,
  getPnlTone,
  getStatusTone,
  getTodayInIst,
  getTradePnl,
  loadSelectedColumns,
  parseIstDate,
  PaginationControls,
  roundCurrencyNumber,
} from "./lib/dashboardUtils.jsx";

const DHAN_NIFTY_LOT_SIZE = 65;

export function App() {
  const [activeView, setActiveView] = useState("overview");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [clockNow, setClockNow] = useState(() => new Date());
  const [theme, setTheme] = useState(() => {
    const savedTheme = window.localStorage.getItem("dashboard-theme");
    return ["warm", "cool", "finance"].includes(savedTheme)
      ? savedTheme
      : "warm";
  });
  const [data, setData] = useState(null);
  const [logs, setLogs] = useState([]);
  const [logsSource, setLogsSource] = useState("none");
  const [logsMeta, setLogsMeta] = useState({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(true);
  const [logsStreamStatus, setLogsStreamStatus] = useState("idle");
  const [actionMessage, setActionMessage] = useState("");
  const [triggeringSignal, setTriggeringSignal] = useState("");
  const [deletingTradeId, setDeletingTradeId] = useState("");
  const [deleteTradeCandidate, setDeleteTradeCandidate] = useState(null);
  const [selectedDate, setSelectedDate] = useState(getTodayInIst());
  const [streamStatus, setStreamStatus] = useState("connecting");
  const [zerodhaAuthBusy, setZerodhaAuthBusy] = useState(false);
  const [zerodhaConfirmOpen, setZerodhaConfirmOpen] = useState(false);
  const [dhanMasterBusy, setDhanMasterBusy] = useState(false);
  const [candleStorageBusy, setCandleStorageBusy] = useState(false);
  const [candleStorageResult, setCandleStorageResult] = useState(null);
  const [dhanMasterResult, setDhanMasterResult] = useState(null);
  const [liveTradingConfirmOpen, setLiveTradingConfirmOpen] = useState(false);
  const [contractForms, setContractForms] = useState({
    option_contracts_1m: { ...DEFAULT_DAILY_SETUP_FORM },
    option_contracts_1m_sensex: {
      ...DEFAULT_DAILY_SETUP_FORM,
      startingBalance: "100000",
    },
    option_contracts_5m: {
      ...DEFAULT_DAILY_SETUP_FORM,
      targetPct: "8",
      minSignalCandlePct: "2",
      strikeOffset: "100",
      expiryOffset: "0",
    },
    option_contracts_5m_v2: {
      ...DEFAULT_DAILY_SETUP_FORM,
      targetPct: "8",
      minSignalCandlePct: "2",
      strikeOffset: "100",
      expiryOffset: "0",
      requireVwap: false,
      minVolumeMultiplier: "0",
      volumeLookback: "20",
      maxEntryGapPct: "0",
      trailingStopPct: "0",
      maxTradesPerDay: "0",
    },
    dhan_nifty_5m_live: {
      ...DEFAULT_DAILY_SETUP_FORM,
      contract1: "PE",
      targetPct: "8",
      minSignalCandlePct: "2",
      strikeOffset: "100",
      expiryOffset: "0",
      startingBalance: "100000",
    },
  });
  const [setupEditorOpen, setSetupEditorOpen] = useState({});
  const [addMoneyAmounts, setAddMoneyAmounts] = useState({});
  const [contractSaving, setContractSaving] = useState(false);
  const [overviewRange, setOverviewRange] = useState(
    () => window.localStorage.getItem("overview-range") ?? "today",
  );
  const [tradeStrategyFilter, setTradeStrategyFilter] = useState(() => {
    const saved = window.localStorage.getItem("trade-strategy-filter");
    return saved === "oneMinute" ||
      saved === "niftyOneMinute" ||
      saved === "sensexOneMinute"
      ? "all"
      : (saved ?? "all");
  });
  const [reportStrategyFilter, setReportStrategyFilter] = useState(() => {
    const saved = window.localStorage.getItem("report-strategy-filter");
    return saved === "oneMinute" ||
      saved === "niftyOneMinute" ||
      saved === "sensexOneMinute"
      ? "all"
      : (saved ?? "all");
  });
  const [logStrategyFilter, setLogStrategyFilter] = useState(() => {
    const saved = window.localStorage.getItem("log-strategy-filter");
    return saved === "oneMinute" ||
      saved === "niftyOneMinute" ||
      saved === "sensexOneMinute"
      ? "niftyFiveMinute"
      : (saved ?? "niftyFiveMinute");
  });
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
  const [niftyFiveMinuteBacktestForm, setNiftyFiveMinuteBacktestForm] =
    useState({
      instrument: "NIFTY",
      mode: "dynamic",
      contract1: "",
      contract2: "",
      contractSide: "PE",
      startDate: getTodayInIst(),
      endDate: getTodayInIst(),
      balance: "100000",
      targetPct: "8",
      maxBodyPct: "8",
      minBodyPct: "2",
      stopLossPct: "8",
      strikeOffset: "100",
      expiryOffset: "0",
      entryTime: "09:30",
      exitTime: "15:10",
      requireVwap: false,
      minVolumeMultiplier: "0",
      volumeLookback: "20",
      maxEntryGapPct: "0",
      trailingStopPct: "0",
      maxTradesPerDay: "0",
    });
  const [niftyFiveMinuteBacktestResult, setNiftyFiveMinuteBacktestResult] =
    useState(null);
  const [niftyFiveMinuteBacktestLoading, setNiftyFiveMinuteBacktestLoading] =
    useState(false);
  const [backtestGroups, setBacktestGroups] = useState(() => {
    try {
      return JSON.parse(
        window.localStorage.getItem("backtest-trade-groups") ?? "[]",
      );
    } catch {
      return [];
    }
  });
  const [newBacktestGroupName, setNewBacktestGroupName] = useState("");
  const [newBacktestGroupDescription, setNewBacktestGroupDescription] =
    useState("");
  const [selectedBacktestGroupId, setSelectedBacktestGroupId] = useState("");
  const [activeBacktestGroupId, setActiveBacktestGroupId] = useState("");
  const [backtestGroupAddFeedback, setBacktestGroupAddFeedback] =
    useState(null);
  const [liveActionBusy, setLiveActionBusy] = useState("");
  const [liveSetupMarket, setLiveSetupMarket] = useState("NIFTY");
  const [dhanManualEntryForm, setDhanManualEntryForm] = useState({
    transactionType: "BUY",
    optionType: "PE",
    strike: "",
    quantity: "65",
    expiry: "",
  });
  const lastTradeRefreshLogKeyRef = useRef("");
  const tradeRefreshInFlightRef = useRef(false);
  const dirtyContractStrategiesRef = useRef(new Set());
  const hydratedSetupSignaturesRef = useRef({});

  function hasUsefulObjectValue(value) {
    if (!value || typeof value !== "object") return false;
    return Object.values(value).some((item) => {
      if (item === null || item === undefined || item === "") return false;
      if (Array.isArray(item)) return item.length > 0;
      if (typeof item === "object") return Object.keys(item).length > 0;
      return true;
    });
  }

  function mergeLiveSnapshot(
    previousSnapshot,
    nextSnapshot,
    { preserveBalance = false } = {},
  ) {
    if (!previousSnapshot) return nextSnapshot;
    if (!nextSnapshot) return previousSnapshot;
    const hasHeavyData =
      (Array.isArray(nextSnapshot.orders) && nextSnapshot.orders.length > 0) ||
      (Array.isArray(nextSnapshot.trades) && nextSnapshot.trades.length > 0) ||
      (Array.isArray(nextSnapshot.positions) && nextSnapshot.positions.length > 0) ||
      (Array.isArray(nextSnapshot.activePositions) && nextSnapshot.activePositions.length > 0) ||
      hasUsefulObjectValue(nextSnapshot.balance) ||
      hasUsefulObjectValue(nextSnapshot.funds) ||
      hasUsefulObjectValue(nextSnapshot.margins);

    if (hasHeavyData) {
      return nextSnapshot;
    }

    const mergedSnapshot = {
      ...previousSnapshot,
      ...nextSnapshot,
      status: nextSnapshot.status ?? previousSnapshot.status,
      instrumentMaster:
        nextSnapshot.instrumentMaster ?? previousSnapshot.instrumentMaster,
      error: nextSnapshot.error ?? previousSnapshot.error,
    };
    if (preserveBalance) {
      mergedSnapshot.balance = previousSnapshot.balance ?? nextSnapshot.balance;
      mergedSnapshot.funds = previousSnapshot.funds ?? nextSnapshot.funds;
    }
    return mergedSnapshot;
  }

  function mergeDashboardPayload(previousPayload, nextPayload) {
    if (!previousPayload) return nextPayload;
    return {
      ...nextPayload,
      liveTrading: mergeLiveSnapshot(
        previousPayload.liveTrading,
        nextPayload.liveTrading,
      ),
      dhanLiveTrading: mergeLiveSnapshot(
        previousPayload.dhanLiveTrading,
        nextPayload.dhanLiveTrading,
        { preserveBalance: true },
      ),
    };
  }

  function mergeDhanLiveTradingPayload(
    currentPayload,
    nextSnapshot,
    { preserveBalance = false, preserveHistory = false } = {},
  ) {
    const previousSnapshot = (currentPayload ?? {}).dhanLiveTrading ?? {};
    const mergedSnapshot = {
      ...previousSnapshot,
      ...nextSnapshot,
      status: nextSnapshot.status ?? previousSnapshot.status,
      instrumentMaster:
        nextSnapshot.instrumentMaster ?? previousSnapshot.instrumentMaster,
      error: nextSnapshot.error ?? previousSnapshot.error,
    };

    if (preserveBalance) {
      mergedSnapshot.balance = hasUsefulObjectValue(nextSnapshot.balance)
        ? nextSnapshot.balance
        : previousSnapshot.balance;
      mergedSnapshot.funds = hasUsefulObjectValue(nextSnapshot.funds)
        ? nextSnapshot.funds
        : previousSnapshot.funds;
    }

    if (preserveHistory) {
      mergedSnapshot.orders =
        Array.isArray(nextSnapshot.orders) && nextSnapshot.orders.length
          ? nextSnapshot.orders
          : previousSnapshot.orders;
      mergedSnapshot.trades =
        Array.isArray(nextSnapshot.trades) && nextSnapshot.trades.length
          ? nextSnapshot.trades
          : previousSnapshot.trades;
    }

    return {
      ...(currentPayload ?? {}),
      dhanLiveTrading: mergedSnapshot,
    };
  }

  function firstNumericValue(payload, keys) {
    for (const key of keys) {
      const value = Number(payload?.[key]);
      if (Number.isFinite(value)) return value;
    }
    return null;
  }

  function applyDhanLtpQuoteToSnapshot(previousSnapshot, quote) {
    const securityId = String(quote?.securityId ?? "");
    if (!securityId) return previousSnapshot;
    const updatePosition = (position) => {
      const positionSecurityId = String(
        position.securityId ?? position.security_id ?? "",
      );
      if (positionSecurityId !== securityId) return position;

      const quantity = Number(
        position.netQuantity ?? position.netQty ?? position.quantity ?? 0,
      );
      const ltp = Number(quote.ltp);
      const averagePrice = firstNumericValue(position, [
        "averagePrice",
        "buyAvg",
        "buyAvgPrice",
        "costPrice",
        "avgPrice",
      ]);
      let pnl = Number(quote.pnl);
      if (!Number.isFinite(pnl) && Number.isFinite(ltp) && averagePrice != null) {
        pnl =
          quantity >= 0
            ? (ltp - averagePrice) * quantity
            : (averagePrice - ltp) * Math.abs(quantity);
      }

      return {
        ...position,
        ltp: Number.isFinite(ltp) ? ltp : position.ltp,
        lastTradedPrice: Number.isFinite(ltp)
          ? ltp
          : position.lastTradedPrice,
        pnl: Number.isFinite(pnl) ? Number(pnl.toFixed(2)) : position.pnl,
        unrealizedProfit: Number.isFinite(pnl)
          ? Number(pnl.toFixed(2))
          : position.unrealizedProfit,
        quoteSource: quote.source ?? "dhan_websocket",
      };
    };

    return {
      ...previousSnapshot,
      activePositions: (previousSnapshot.activePositions ?? []).map(updatePosition),
      positions: (previousSnapshot.positions ?? []).map(updatePosition),
    };
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("dashboard-theme", theme);
  }, [theme]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setClockNow(new Date());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("overview-range", overviewRange);
  }, [overviewRange]);

  useEffect(() => {
    window.localStorage.setItem("trade-strategy-filter", tradeStrategyFilter);
  }, [tradeStrategyFilter]);

  useEffect(() => {
    window.localStorage.setItem("report-strategy-filter", reportStrategyFilter);
  }, [reportStrategyFilter]);

  useEffect(() => {
    window.localStorage.setItem("log-strategy-filter", logStrategyFilter);
  }, [logStrategyFilter]);

  useEffect(() => {
    window.localStorage.setItem("show-hourly-pnl", String(showHourlyPnl));
  }, [showHourlyPnl]);

  useEffect(() => {
    window.localStorage.setItem(
      "backtest-trade-groups",
      JSON.stringify(backtestGroups),
    );
  }, [backtestGroups]);

  useEffect(() => {
    const setups = data?.strategyConfig?.strategySetups;
    if (!setups) return;

    setContractForms((current) => {
      const next = { ...current };
      let changed = false;
      for (const strategyKey of Object.values(DAILY_SETUP_KEYS)) {
        const setup = setups[strategyKey];
        if (!setup) continue;
        const signature = JSON.stringify({
          contract1: setup.effectiveContracts?.contract1 ?? "",
          contract2: setup.effectiveContracts?.contract2 ?? "",
          contractMode: setup.contractMode ?? "dynamic",
          scheduleStart: setup.scheduleStart ?? "09:20",
          scheduleEnd: setup.scheduleEnd ?? "15:00",
          startingBalance:
            setup.startingBalance ??
            data?.paperTradingByStrategy?.[strategyKey]?.capitalBase ??
            data?.paperTrading?.capitalBase ??
            100000,
          entrySignal: setup.entrySignal ?? "BUY",
          targetPct: setup.targetPct ?? 3,
          maxSignalCandlePct: setup.maxSignalCandlePct ?? 8,
          minSignalCandlePct: setup.minSignalCandlePct ?? 0,
          strikeOffset: setup.strikeOffset ?? 0,
          expiryOffset: setup.expiryOffset ?? 0,
          stopLossMode: setup.stopLossMode ?? "signal_low",
          stopLossPct: setup.stopLossPct ?? 8,
          requireVwap: Boolean(setup.requireVwap),
          minVolumeMultiplier: setup.minVolumeMultiplier ?? 0,
          volumeLookback: setup.volumeLookback ?? 20,
          maxEntryGapPct: setup.maxEntryGapPct ?? 0,
          trailingStopPct: setup.trailingStopPct ?? 0,
          maxTradesPerDay: setup.maxTradesPerDay ?? 0,
          updatedAt: setup.dailyContracts?.updated_at ?? "",
        });

        if (dirtyContractStrategiesRef.current.has(strategyKey)) continue;
        if (hydratedSetupSignaturesRef.current[strategyKey] === signature)
          continue;

        hydratedSetupSignaturesRef.current[strategyKey] = signature;
        next[strategyKey] = {
          ...DEFAULT_DAILY_SETUP_FORM,
          contract1: setup.effectiveContracts?.contract1 ?? "",
          contract2: setup.effectiveContracts?.contract2 ?? "",
          contractMode: setup.contractMode ?? "dynamic",
          scheduleStart: setup.scheduleStart ?? "09:20",
          scheduleEnd: setup.scheduleEnd ?? "15:00",
          startingBalance: String(
            setup.startingBalance ??
              data?.paperTradingByStrategy?.[strategyKey]?.capitalBase ??
              data?.paperTrading?.capitalBase ??
              100000,
          ),
          entrySignal: setup.entrySignal ?? "BUY",
          targetPct: String(setup.targetPct ?? 3),
          maxSignalCandlePct: String(setup.maxSignalCandlePct ?? 8),
          minSignalCandlePct: String(setup.minSignalCandlePct ?? 0),
          strikeOffset: String(setup.strikeOffset ?? 0),
          expiryOffset: String(setup.expiryOffset ?? 0),
          stopLossMode: setup.stopLossMode ?? "signal_low",
          stopLossPct: String(setup.stopLossPct ?? 8),
          requireVwap: Boolean(setup.requireVwap),
          minVolumeMultiplier: String(setup.minVolumeMultiplier ?? 0),
          volumeLookback: String(setup.volumeLookback ?? 20),
          maxEntryGapPct: String(setup.maxEntryGapPct ?? 0),
          trailingStopPct: String(setup.trailingStopPct ?? 0),
          maxTradesPerDay: String(setup.maxTradesPerDay ?? 0),
        };
        changed = true;
      }
      return changed ? next : current;
    });
  }, [
    data?.strategyConfig?.date,
    data?.paperTradingByStrategy,
    data?.paperTrading?.capitalBase,
    data?.strategyConfig?.strategySetups,
  ]);

  useEffect(() => {
    let active = true;
    let eventSource;

    async function loadDashboardSnapshot(showLoader = false, lightweight = false) {
      if (showLoader) setLoading(true);

      try {
        const response = await fetch(
          apiUrl(`/api/dashboard${lightweight ? "?lightweight=true" : ""}`),
        );
        if (!response.ok) {
          throw new Error(`Dashboard API failed with ${response.status}`);
        }

        const payload = await response.json();
        if (active) {
          setData((current) => mergeDashboardPayload(current, payload));
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

    function connectDashboardStream() {
      if (!active || eventSource) return;

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
          setData((current) =>
            mergeDashboardPayload(current, JSON.parse(event.data)),
          );
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
    }

    loadDashboardSnapshot(true, true).finally(() => {
      loadDashboardSnapshot(false, false).finally(connectDashboardStream);
    });

    return () => {
      active = false;
      eventSource?.close();
    };
  }, []);

  useEffect(() => {
    if (!["overview", "niftyFiveMinuteBot", "niftyFiveMinuteBotV2"].includes(activeView)) {
      return undefined;
    }

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
        // Keep the main dashboard stream as the fallback source.
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      if (!active) return;
      const intervalId = window.setInterval(async () => {
        try {
          const response = await fetch(apiUrl("/api/market-quotes"));
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
      }, 10000);
      eventSource.intervalId = intervalId;
    };

    return () => {
      active = false;
      if (eventSource.intervalId) window.clearInterval(eventSource.intervalId);
      eventSource.close();
    };
  }, [activeView]);

  useEffect(() => {
    if (activeView !== "dhanLiveTrading") return undefined;

    const eventSource = new EventSource(
      apiUrl("/api/dhan-live-trading/positions/stream"),
    );

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === "positions" && payload.snapshot) {
          setData((current) =>
            mergeDhanLiveTradingPayload(current, payload.snapshot, {
              preserveBalance: true,
              preserveHistory: true,
            }),
          );
          return;
        }
        if (payload.type === "ltp" && payload.quote) {
          setData((current) => ({
            ...(current ?? {}),
            dhanLiveTrading: applyDhanLtpQuoteToSnapshot(
              (current ?? {}).dhanLiveTrading ?? {},
              payload.quote,
            ),
          }));
          return;
        }
        if (payload.type === "error" && payload.message) {
          setData((current) =>
            mergeDhanLiveTradingPayload(
              current,
              { error: payload.message },
              { preserveBalance: true, preserveHistory: true },
            ),
          );
        }
      } catch {
        // Ignore malformed stream events; the manual refresh button remains available.
      }
    };

    eventSource.onerror = () => {
      setData((current) =>
        mergeDhanLiveTradingPayload(
          current,
          { error: "Dhan LTP stream reconnecting..." },
          { preserveBalance: true, preserveHistory: true },
        ),
      );
    };

    return () => eventSource.close();
  }, [activeView]);

  useEffect(() => {
    let active = true;
    const today = getTodayInIst();
    const eventSource = new EventSource(apiUrl(`/api/logs/stream?date=${today}`));
    const refreshStatuses = new Set(["open", "win", "loss", "trend_update"]);

    eventSource.onmessage = async (event) => {
      if (!active) return;

      try {
        const payload = JSON.parse(event.data);
        const logRows = Array.isArray(payload.logs) ? payload.logs : [];
        const latestTradeLog = [...logRows].reverse().find((log) => {
          const status = String(log?.status ?? "").toLowerCase();
          return refreshStatuses.has(status);
        });

        if (!latestTradeLog) return;

        const logKey = [
          latestTradeLog.run_at,
          latestTradeLog.status,
          latestTradeLog.trade_id,
          latestTradeLog.active_trade_id,
          latestTradeLog.option_symbol,
        ]
          .filter(Boolean)
          .join("::");

        if (!logKey || lastTradeRefreshLogKeyRef.current === logKey) return;
        lastTradeRefreshLogKeyRef.current = logKey;
        if (tradeRefreshInFlightRef.current) return;

        tradeRefreshInFlightRef.current = true;
        try {
          await refreshDashboardData();
        } finally {
          tradeRefreshInFlightRef.current = false;
        }
      } catch {
        // The main dashboard stream remains the fallback if log SSE parsing fails.
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      active = false;
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
          setLogsMeta({
            dhanLiveCachedCandle: payload.dhanLiveCachedCandle ?? null,
          });
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
          setLogsMeta({
            dhanLiveCachedCandle: payload.dhanLiveCachedCandle ?? null,
          });
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

      const dashboardPayload = await dashboardResponse.json();
      setData((current) => mergeDashboardPayload(current, dashboardPayload));

      const logsResponse = await fetch(
        apiUrl(`/api/logs?date=${selectedDate}`),
      );
      if (logsResponse.ok) {
        const logsPayload = await logsResponse.json();
        setLogs(logsPayload.logs ?? []);
        setLogsSource(logsPayload.source ?? "none");
        setLogsMeta({
          dhanLiveCachedCandle: logsPayload.dhanLiveCachedCandle ?? null,
        });
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

  function updateNiftyFiveMinuteBacktestField(field, value) {
    setNiftyFiveMinuteBacktestForm((current) => ({
      ...current,
      [field]:
        field === "contract1" || field === "contract2"
          ? value.toUpperCase().replace(/\s+/g, "")
          : value,
    }));
  }

  function updateContractField(strategyKey, field, value) {
    const normalizedValue =
      field === "contract1" || field === "contract2"
        ? value.toUpperCase().replace(/\s+/g, "")
        : value;
    dirtyContractStrategiesRef.current.add(strategyKey);
    setContractForms((current) => ({
      ...current,
      [strategyKey]: {
        ...(current[strategyKey] ?? DEFAULT_DAILY_SETUP_FORM),
        [field]: normalizedValue,
      },
    }));
  }

  function updateLiveOptionSide(side) {
    const contract1 = side === "BOTH" ? "PE" : side;
    const contract2 = side === "BOTH" ? "CE" : "";
    updateContractField(liveSetupStrategyKey, "contract1", contract1);
    updateContractField(liveSetupStrategyKey, "contract2", contract2);
  }

  function buildBacktestTradeId(trade) {
    return [
      trade.optionSymbol,
      trade.candleTime,
      trade.entryTime,
      trade.exitTime,
      trade.netPnl,
    ]
      .filter((value) => value !== null && value !== undefined)
      .join("::");
  }

  function normalizeBacktestTradeForGroup(trade) {
    const optionSymbol = String(trade.optionSymbol ?? "").toUpperCase();
    const optionType = optionSymbol.endsWith("CE")
      ? "CE"
      : optionSymbol.endsWith("PE")
        ? "PE"
        : trade.optionType;
    return {
      ...trade,
      id: buildBacktestTradeId(trade),
      option_type: optionType,
      optionType,
      option_symbol: trade.optionSymbol,
      entry_time: trade.entryTime,
      exit_time: trade.exitTime,
      net_pnl: trade.netPnl,
      capital_used: trade.capitalUsed,
      addedAt: new Date().toISOString(),
      source: "5m_option_backtest",
      backtestInstrument:
        niftyFiveMinuteBacktestResult?.data?.underlying ?? "OPTION",
    };
  }

  function createBacktestGroup(event) {
    event.preventDefault();
    const name = newBacktestGroupName.trim();
    if (!name) {
      setError("Enter a group name first.");
      return;
    }
    const description = newBacktestGroupDescription.trim();
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const group = {
      id,
      name,
      description,
      createdAt: new Date().toISOString(),
      trades: [],
    };
    setBacktestGroups((current) => [group, ...current]);
    setNewBacktestGroupName("");
    setNewBacktestGroupDescription("");
    setSelectedBacktestGroupId(id);
    setActiveBacktestGroupId(id);
    setActionMessage(`Backtest group "${name}" created.`);
  }

  function addTradesToBacktestGroup(tradesToAdd) {
    if (!selectedBacktestGroupId) {
      setError("Create or select a backtest group first.");
      return;
    }
    const normalizedTrades = tradesToAdd.map(normalizeBacktestTradeForGroup);
    const targetGroup = backtestGroups.find(
      (group) => group.id === selectedBacktestGroupId,
    );
    if (!targetGroup) {
      setError("Selected backtest group was not found.");
      return;
    }
    const existingIds = new Set(
      (targetGroup?.trades ?? []).map(
        (trade) => trade.id ?? buildBacktestTradeId(trade),
      ),
    );
    const newTrades = normalizedTrades.filter((trade) => {
      if (existingIds.has(trade.id)) return false;
      existingIds.add(trade.id);
      return true;
    });
    const feedbackMessage = newTrades.length
      ? `Added ${formatCount(newTrades.length)} trade${newTrades.length === 1 ? "" : "s"} to ${targetGroup.name}.`
      : `Already added to ${targetGroup.name}.`;
    setBacktestGroupAddFeedback({
      key: normalizedTrades.length === 1 ? normalizedTrades[0].id : "all",
      message: feedbackMessage,
      status: newTrades.length ? "success" : "neutral",
    });
    setBacktestGroups((current) =>
      current.map((group) => {
        if (group.id !== selectedBacktestGroupId) return group;
        return {
          ...group,
          trades: [...(group.trades ?? []), ...newTrades],
          updatedAt: new Date().toISOString(),
        };
      }),
    );
    setActionMessage(
      newTrades.length ? feedbackMessage : "Those trades are already in the selected group.",
    );
    setError("");
  }

  function deleteBacktestGroup(groupId) {
    setBacktestGroups((current) => current.filter((group) => group.id !== groupId));
    if (selectedBacktestGroupId === groupId) setSelectedBacktestGroupId("");
    if (activeBacktestGroupId === groupId) setActiveBacktestGroupId("");
  }

  function deleteTradeFromBacktestGroup(groupId, tradeId) {
    if (!groupId || !tradeId) return;
    setBacktestGroups((current) =>
      current.map((group) => {
        if (group.id !== groupId) return group;
        return {
          ...group,
          trades: (group.trades ?? []).filter(
            (trade) => (trade.id ?? buildBacktestTradeId(trade)) !== tradeId,
          ),
          updatedAt: new Date().toISOString(),
        };
      }),
    );
    setActionMessage("Trade removed from backtest group.");
  }

  function fillStartingBalanceFromCash(strategyKey) {
    const strategyPaperTrading =
      data?.paperTradingByStrategy?.[strategyKey] ?? paperTrading;
    const balanceLeft = Number(
      strategyPaperTrading.cashBalance ??
        strategyPaperTrading.capitalBase ??
        100000,
    );
    if (!Number.isFinite(balanceLeft) || balanceLeft <= 0) return;
    updateContractField(
      strategyKey,
      "startingBalance",
      String(Math.floor(balanceLeft)),
    );
  }

  function getPaperPnlBase(strategyPaperTrading) {
    const base = Number(
      strategyPaperTrading?.startingBalance ??
        strategyPaperTrading?.capitalBase ??
        0,
    );
    return Number.isFinite(base) && base > 0 ? base : null;
  }

  async function saveStrategyContracts(
    event,
    strategyKey = DAILY_SETUP_KEYS.niftyOneMinuteBot,
  ) {
    event.preventDefault();
    setContractSaving(true);
    setActionMessage("");
    setError("");
    const contractForm = contractForms[strategyKey] ?? DEFAULT_DAILY_SETUP_FORM;

    try {
      const response = await fetch(apiUrl("/api/strategy/contracts"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          strategyKey,
          ...contractForm,
          startingBalance: Number(contractForm.startingBalance),
          targetPct: Number(contractForm.targetPct),
          maxSignalCandlePct: Number(contractForm.maxSignalCandlePct),
          minSignalCandlePct: Number(contractForm.minSignalCandlePct),
          strikeOffset: Number(contractForm.strikeOffset),
          expiryOffset: Number(contractForm.expiryOffset),
          stopLossPct: Number(contractForm.stopLossPct),
          requireVwap: Boolean(contractForm.requireVwap),
          minVolumeMultiplier: Number(contractForm.minVolumeMultiplier),
          volumeLookback: Number(contractForm.volumeLookback),
          maxEntryGapPct: Number(contractForm.maxEntryGapPct),
          trailingStopPct: Number(contractForm.trailingStopPct),
          maxTradesPerDay: Number(contractForm.maxTradesPerDay),
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
      dirtyContractStrategiesRef.current.delete(strategyKey);
      hydratedSetupSignaturesRef.current[strategyKey] = "";

      const dashboardResponse = await fetch(apiUrl("/api/dashboard"));
      if (dashboardResponse.ok) {
        const dashboardPayload = await dashboardResponse.json();
        setData((current) => mergeDashboardPayload(current, dashboardPayload));
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

  async function addPaperBalance(
    event,
    strategyKey = DAILY_SETUP_KEYS.niftyOneMinuteBot,
  ) {
    event.preventDefault();
    const addMoneyAmount = addMoneyAmounts[strategyKey] ?? "";
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
        body: JSON.stringify({ amount, strategyKey }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(
          payload.detail ?? `Balance update failed with ${response.status}`,
        );
      }
      const payload = await response.json();
      setActionMessage(payload.message ?? "Paper balance updated.");
      setAddMoneyAmounts((current) => ({ ...current, [strategyKey]: "" }));
      setData((current) => {
        if (!current) return current;
        const strategyPayload =
          current.paperTradingByStrategy?.[strategyKey] ?? {};
        return {
          ...current,
          paperTradingByStrategy: {
            ...(current.paperTradingByStrategy ?? {}),
            [strategyKey]: {
              ...strategyPayload,
              cashBalance: payload.cashBalance,
              startingBalance: payload.startingBalance,
              balanceAdjustments:
                payload.balanceAdjustments ??
                strategyPayload.balanceAdjustments ??
                [],
            },
          },
        };
      });
      const dashboardResponse = await fetch(apiUrl("/api/dashboard"));
      if (dashboardResponse.ok) {
        const dashboardPayload = await dashboardResponse.json();
        setData((current) => mergeDashboardPayload(current, dashboardPayload));
      }
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
        const dashboardPayload = await dashboardResponse.json();
        setData((current) => mergeDashboardPayload(current, dashboardPayload));
      }
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete trade.",
      );
    } finally {
      setDeletingTradeId("");
      setDeleteTradeCandidate(null);
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

  function csvCell(value) {
    if (value === null || value === undefined) return "";
    const stringValue = String(value);
    if (/[",\n\r]/.test(stringValue)) {
      return `"${stringValue.replaceAll('"', '""')}"`;
    }
    return stringValue;
  }

  function downloadCsvFile(filename, rows) {
    const csv = rows
      .map((row) => row.map((value) => csvCell(value)).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }

  function exportNiftyFiveMinuteBacktestTradesCsv() {
    if (!niftyFiveMinuteBacktestTrades.length) {
      setError("Run the 5m option backtest with trades before downloading CSV.");
      return;
    }

    const instrument =
      niftyFiveMinuteBacktestResult?.data?.underlying?.toLowerCase() ?? "option";
    const rows = [
      [
        "Contract",
        "Signal Candle",
        "Entry Time",
        "Exit Time",
        "Entry Price",
        "Exit Price",
        "Stop Loss",
        "Target",
        "Stop Loss Source",
        "Body %",
        "Quantity",
        "Capital Used",
        "Gross PnL",
        "Charges",
        "Net PnL",
        "Status",
        "Exit Reason",
      ],
      ...niftyFiveMinuteBacktestTrades.map((trade) => [
        formatCompactOptionSymbol(trade.optionSymbol),
        formatTableDateTime(trade.candleTime),
        formatTableDateTime(trade.entryTime),
        formatTableDateTime(trade.exitTime),
        trade.entryPrice,
        trade.exitPrice,
        trade.stopLoss,
        trade.target,
        formatSnakeLabel(trade.stopLossSource),
        trade.signalCandleBodyPct,
        trade.quantity,
        trade.capitalUsed,
        trade.grossPnl,
        trade.charges,
        trade.netPnl,
        trade.status,
        formatSnakeLabel(trade.exitReason),
      ]),
    ];

    downloadCsvFile(
      `${instrument}_5m_backtest_trades_${getTodayInIst()}.csv`,
      rows,
    );
    setActionMessage("5m backtest trades CSV downloaded.");
  }

  async function runNiftyFiveMinuteBacktest(event) {
    event.preventDefault();
    setNiftyFiveMinuteBacktestLoading(true);
    setActionMessage("");
    setError("");

    try {
      const response = await fetch(apiUrl("/api/backtest/option-5m"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          instrument: niftyFiveMinuteBacktestForm.instrument,
          mode: niftyFiveMinuteBacktestForm.mode,
          contract1: niftyFiveMinuteBacktestForm.contract1
            .trim()
            .toUpperCase(),
          contract2: niftyFiveMinuteBacktestForm.contract2
            .trim()
            .toUpperCase(),
          contractSide: niftyFiveMinuteBacktestForm.contractSide,
          startDate: niftyFiveMinuteBacktestForm.startDate,
          endDate: niftyFiveMinuteBacktestForm.endDate,
          balance: Number(niftyFiveMinuteBacktestForm.balance),
          targetPct: Number(niftyFiveMinuteBacktestForm.targetPct),
          maxBodyPct: Number(niftyFiveMinuteBacktestForm.maxBodyPct),
          minBodyPct: Number(niftyFiveMinuteBacktestForm.minBodyPct),
          stopLossPct: Number(niftyFiveMinuteBacktestForm.stopLossPct),
          strikeOffset: niftyFiveMinuteBacktestForm.strikeOffset,
          expiryOffset: Number(niftyFiveMinuteBacktestForm.expiryOffset),
          entryTime: niftyFiveMinuteBacktestForm.entryTime,
          exitTime: niftyFiveMinuteBacktestForm.exitTime,
          requireVwap: Boolean(niftyFiveMinuteBacktestForm.requireVwap),
          minVolumeMultiplier: Number(
            niftyFiveMinuteBacktestForm.minVolumeMultiplier,
          ),
          volumeLookback: Number(niftyFiveMinuteBacktestForm.volumeLookback),
          maxEntryGapPct: Number(niftyFiveMinuteBacktestForm.maxEntryGapPct),
          trailingStopPct: Number(niftyFiveMinuteBacktestForm.trailingStopPct),
          maxTradesPerDay: Number(niftyFiveMinuteBacktestForm.maxTradesPerDay),
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.detail ?? `5m option backtest failed with ${response.status}`);
      }

      setNiftyFiveMinuteBacktestResult(await response.json());
    } catch (backtestError) {
      setError(
        backtestError instanceof Error
          ? backtestError.message
          : "Unable to run 5m option backtest.",
      );
    } finally {
      setNiftyFiveMinuteBacktestLoading(false);
    }
  }

  const recentAlerts = data?.recentAlerts ?? [];
  const status = data?.status ?? {};
  const schedule = data?.schedule ?? {};
  const strategyConfig = data?.strategyConfig ?? {};
  const marketQuotes = data?.marketQuotes ?? [];
  const paperTradingByStrategy = data?.paperTradingByStrategy ?? {};
  const niftyPaperTrading =
    paperTradingByStrategy.option_contracts_1m ?? data?.paperTrading ?? {};
  const sensexPaperTrading =
    paperTradingByStrategy.option_contracts_1m_sensex ?? {};
  const niftyFiveMinutePaperTrading =
    paperTradingByStrategy.option_contracts_5m ?? {};
  const niftyFiveMinuteV2PaperTrading =
    paperTradingByStrategy.option_contracts_5m_v2 ?? {};
  const dhanLivePaperTrading =
    paperTradingByStrategy.dhan_nifty_5m_live ?? {};
  const paperTrading = niftyPaperTrading;
  const liveTrading = data?.liveTrading ?? {};
  const liveTradingStatus = liveTrading.status ?? {};
  const liveOrders = liveTrading.orders ?? [];
  const liveTrades = liveTrading.trades ?? [];
  const livePositions = liveTrading.positions ?? {};
  const liveMargins = liveTrading.margins ?? {};
  const liveBalance = liveTrading.balance ?? {};
  const dhan = data?.dhan ?? {};
  const dhanLiveTrading = data?.dhanLiveTrading ?? {};
  const dhanLiveStatus = dhanLiveTrading.status ?? {};
  const dhanInstrumentMaster =
    dhanLiveTrading.instrumentMaster ?? dhanMasterResult ?? {};
  const dhanOrders = dhanLiveTrading.orders ?? [];
  const dhanTrades = dhanLiveTrading.trades ?? [];
  const dhanPositions = dhanLiveTrading.positions ?? [];
  const dhanActivePositions =
    dhanLiveTrading.activePositions ??
    dhanPositions.filter((position) => Number(position.netQuantity ?? position.netQty ?? position.quantity ?? 0) !== 0);
  const dhanBalance = dhanLiveTrading.balance ?? {};
  const dhanSetupStrategyKey = DAILY_SETUP_KEYS.dhanNiftyFiveMinuteLive;
  const dhanSelectedSetup =
    strategyConfig.strategySetups?.[dhanSetupStrategyKey] ?? {};
  const dhanSelectedForm =
    contractForms[dhanSetupStrategyKey] ?? DEFAULT_DAILY_SETUP_FORM;
  const dhanSetupSavedToday = Boolean(dhanSelectedSetup.usesDailySetup);
  const dhanSetupSavedAt = dhanSelectedSetup.dailyContracts?.updated_at;
  const dhanSetupEditorOpen =
    setupEditorOpen[dhanSetupStrategyKey] ?? !dhanSetupSavedToday;
  const dhanEnabledStrategyKeys = Array.isArray(
    dhanLiveStatus.enabledStrategyKeys,
  )
    ? dhanLiveStatus.enabledStrategyKeys
    : [];
  const dhanSelectedStrategyEnabled =
    Boolean(dhanLiveStatus.enabled) &&
    dhanEnabledStrategyKeys.includes(dhanSetupStrategyKey);
  const dhanSelectedSide =
    dhanSelectedForm.contract1 === "PE" && dhanSelectedForm.contract2 === "CE"
      ? "BOTH"
      : dhanSelectedForm.contract1 === "CE"
        ? "CE"
        : "PE";
  const dhanSelectedContracts = [
    dhanSelectedSetup.effectiveContracts?.contract1,
    dhanSelectedSetup.effectiveContracts?.contract2,
  ]
    .filter(Boolean)
    .join(" / ");
  const livePositionRows = [
    ...(Array.isArray(livePositions.net) ? livePositions.net : []),
    ...(Array.isArray(livePositions.day) ? livePositions.day : []),
  ].filter(
    (position, index, rows) =>
      position?.tradingsymbol &&
      rows.findIndex(
        (candidate) =>
          candidate?.tradingsymbol === position.tradingsymbol &&
          candidate?.product === position.product,
      ) === index,
  );
  const liveMarginRows = [
    ["Available Cash", liveBalance.cash],
    ["Live Balance", liveBalance.liveBalance],
    ["Opening Balance", liveBalance.openingBalance],
    ["Net Margin", liveBalance.net],
    ["Used Debits", liveBalance.utilisedDebits],
    ["SPAN", liveBalance.span],
    ["Exposure", liveBalance.exposure],
    ["Collateral", liveBalance.collateral],
  ];
  const liveSetupStrategyKey =
    liveSetupMarket === "SENSEX"
      ? DAILY_SETUP_KEYS.sensexOneMinuteBot
      : DAILY_SETUP_KEYS.niftyOneMinuteBot;
  const liveSetupLabel =
    liveSetupMarket === "SENSEX" ? "Sensex 1m bot" : "Nifty 1m bot";
  const liveSelectedSetup =
    strategyConfig.strategySetups?.[liveSetupStrategyKey] ?? {};
  const liveSelectedForm =
    contractForms[liveSetupStrategyKey] ?? DEFAULT_DAILY_SETUP_FORM;
  const liveEnabledStrategyKeys = Array.isArray(
    liveTradingStatus.enabledStrategyKeys,
  )
    ? liveTradingStatus.enabledStrategyKeys
    : [];
  const liveSelectedStrategyEnabled =
    Boolean(liveTradingStatus.enabled) &&
    liveEnabledStrategyKeys.includes(liveSetupStrategyKey);
  const liveSelectedSide =
    liveSelectedForm.contract1 === "PE" && liveSelectedForm.contract2 === "CE"
      ? "BOTH"
      : liveSelectedForm.contract1 === "CE"
        ? "CE"
        : "PE";
  const liveSelectedContracts = [
    liveSelectedSetup.effectiveContracts?.contract1,
    liveSelectedSetup.effectiveContracts?.contract2,
  ]
    .filter(Boolean)
    .join(" / ");
  const activeTrade = paperTrading.activeTrade ?? null;
  const niftyActiveTrades =
    paperTrading.activeTrades ?? (activeTrade ? [activeTrade] : []);
  const niftyTradeHistory = paperTrading.tradeHistory ?? [];
  const rawSensexActiveTrade = sensexPaperTrading.activeTrade ?? null;
  const rawSensexActiveTrades =
    sensexPaperTrading.activeTrades ??
    (rawSensexActiveTrade ? [rawSensexActiveTrade] : []);
  const rawSensexTradeHistory = sensexPaperTrading.tradeHistory ?? [];
  const rawNiftyFiveMinuteActiveTrade =
    niftyFiveMinutePaperTrading.activeTrade ?? null;
  const rawNiftyFiveMinuteActiveTrades =
    niftyFiveMinutePaperTrading.activeTrades ??
    (rawNiftyFiveMinuteActiveTrade ? [rawNiftyFiveMinuteActiveTrade] : []);
  const rawNiftyFiveMinuteTradeHistory =
    niftyFiveMinutePaperTrading.tradeHistory ?? [];
  const rawNiftyFiveMinuteV2ActiveTrade =
    niftyFiveMinuteV2PaperTrading.activeTrade ?? null;
  const rawNiftyFiveMinuteV2ActiveTrades =
    niftyFiveMinuteV2PaperTrading.activeTrades ??
    (rawNiftyFiveMinuteV2ActiveTrade ? [rawNiftyFiveMinuteV2ActiveTrade] : []);
  const rawNiftyFiveMinuteV2TradeHistory =
    niftyFiveMinuteV2PaperTrading.tradeHistory ?? [];
  const rawDhanLiveActiveTrade = dhanLivePaperTrading.activeTrade ?? null;
  const rawDhanLiveActiveTrades =
    dhanLivePaperTrading.activeTrades ??
    (rawDhanLiveActiveTrade ? [rawDhanLiveActiveTrade] : []);
  const rawDhanLiveTradeHistory = dhanLivePaperTrading.tradeHistory ?? [];
  const activeTrades = [
    ...rawNiftyFiveMinuteActiveTrades,
    ...rawNiftyFiveMinuteV2ActiveTrades,
    ...rawDhanLiveActiveTrades,
  ];
  const tradeHistory = [
    ...rawNiftyFiveMinuteTradeHistory,
    ...rawNiftyFiveMinuteV2TradeHistory,
    ...rawDhanLiveTradeHistory,
  ].sort(
    (first, second) =>
      new Date(second.entry_time ?? second.entryTime ?? 0).getTime() -
      new Date(first.entry_time ?? first.entryTime ?? 0).getTime(),
  );
  const dailySummary = paperTrading.dailySummary ?? {};
  const zerodha = data?.zerodha ?? {};
  const combinedCapitalBase =
    Number(getPaperPnlBase(niftyFiveMinutePaperTrading) ?? 0) +
      Number(getPaperPnlBase(niftyFiveMinuteV2PaperTrading) ?? 0) +
      Number(getPaperPnlBase(dhanLivePaperTrading) ?? 0) ||
    Number(getPaperPnlBase(paperTrading) ?? 0);
  const selectedRangeSummary = buildTradeSummaryForRange(
    tradeHistory,
    activeTrades,
    overviewRange,
  );
  const selectedRangeMeta =
    OVERVIEW_RANGE_OPTIONS.find((option) => option.id === overviewRange) ??
    OVERVIEW_RANGE_OPTIONS[0];
  const winsLosses = `${formatCount(selectedRangeSummary.winCount)} / ${formatCount(selectedRangeSummary.lossCount)}`;
  const backtestTrades = backtestResult?.trades ?? [];
  const backtestHourlyPnlReport = buildHourlyPnlReport(backtestTrades, "total");
  const backtestWeekdayPnlReport = buildWeekdayPnlReport(
    backtestTrades,
    "total",
  );
  const niftyFiveMinuteBacktestTrades =
    niftyFiveMinuteBacktestResult?.trades ?? [];
  const niftyFiveMinuteBacktestSkipped =
    niftyFiveMinuteBacktestResult?.skipped ?? [];
  const niftyFiveMinuteBacktestData = niftyFiveMinuteBacktestResult?.data ?? {};
  const niftyFiveMinuteRawBuySignals = Number(
    niftyFiveMinuteBacktestData.freshBuyArrowCount ??
      niftyFiveMinuteBacktestData.rawBuySignalCount ??
      0,
  );
  const niftyFiveMinuteAcceptedSignals = Number(
    niftyFiveMinuteBacktestData.bodyAcceptedSignalCount ?? 0,
  );
  const niftyFiveMinuteExecutedTrades = Number(
    niftyFiveMinuteBacktestData.executedTradeCount ??
      niftyFiveMinuteBacktestResult?.summary?.tradeCount ??
      0,
  );
  const niftyFiveMinuteBodyPassRate = niftyFiveMinuteRawBuySignals
    ? (niftyFiveMinuteAcceptedSignals / niftyFiveMinuteRawBuySignals) * 100
    : 0;
  const niftyFiveMinuteTradeConversion = niftyFiveMinuteRawBuySignals
    ? (niftyFiveMinuteExecutedTrades / niftyFiveMinuteRawBuySignals) * 100
    : 0;
  const niftyFiveMinuteTopSkipReason =
    Object.entries(niftyFiveMinuteBacktestData.skippedReasonCounts ?? {})
      .sort((first, second) => Number(second[1]) - Number(first[1]))
      .at(0) ?? null;
  const niftyFiveMinuteAdvancedFilters =
    niftyFiveMinuteBacktestData.advancedFilters ?? {};
  const niftyFiveMinuteActiveAdvancedFilters = [
    niftyFiveMinuteAdvancedFilters.requireVwap ? "VWAP" : null,
    Number(niftyFiveMinuteAdvancedFilters.minVolumeMultiplier) > 0
      ? "Volume"
      : null,
    Number(niftyFiveMinuteAdvancedFilters.maxEntryGapPct) > 0
      ? "Gap"
      : null,
    Number(niftyFiveMinuteAdvancedFilters.trailingStopPct) > 0
      ? "Trail"
      : null,
    Number(niftyFiveMinuteAdvancedFilters.maxTradesPerDay) > 0 ? "Cap" : null,
  ].filter(Boolean);
  const niftyFiveMinuteHourlyPnlReport = buildHourlyPnlReport(
    niftyFiveMinuteBacktestTrades,
    "total",
  );
  const niftyFiveMinuteWeekdayPnlReport = buildWeekdayPnlReport(
    niftyFiveMinuteBacktestTrades,
    "total",
  );
  const activeBacktestGroup =
    backtestGroups.find((group) => group.id === activeBacktestGroupId) ?? null;
  const selectedBacktestGroup =
    backtestGroups.find((group) => group.id === selectedBacktestGroupId) ??
    null;
  const selectedBacktestGroupTradeIds = new Set(
    (selectedBacktestGroup?.trades ?? []).map(
      (trade) => trade.id ?? buildBacktestTradeId(trade),
    ),
  );
  const allBacktestTradesAddedToSelectedGroup =
    Boolean(selectedBacktestGroupId) &&
    niftyFiveMinuteBacktestTrades.length > 0 &&
    niftyFiveMinuteBacktestTrades.every((trade) =>
      selectedBacktestGroupTradeIds.has(buildBacktestTradeId(trade)),
    );
  const activeBacktestGroupTrades = [
    ...(activeBacktestGroup?.trades ?? []),
  ].sort((first, second) => {
    const firstDate =
      parseIstDate(first.candleTime) ??
      parseIstDate(first.entryTime) ??
      parseIstDate(first.exitTime);
    const secondDate =
      parseIstDate(second.candleTime) ??
      parseIstDate(second.entryTime) ??
      parseIstDate(second.exitTime);
    return (firstDate?.getTime() ?? 0) - (secondDate?.getTime() ?? 0);
  });
  const activeBacktestGroupMetrics = buildReportMetrics(
    activeBacktestGroupTrades,
    "total",
  );
  const activeBacktestGroupHourlyReport = buildHourlyPnlReport(
    activeBacktestGroupTrades,
    "total",
  );
  const activeBacktestGroupWeekdayReport = buildWeekdayPnlReport(
    activeBacktestGroupTrades,
    "total",
  );
  const isNiftyFiveMinuteLog = (log) =>
    String(log?.strategy_key ?? "").toLowerCase() ===
      DAILY_SETUP_KEYS.niftyFiveMinuteBot ||
    (String(log?.interval ?? "").toLowerCase() === "5m" &&
      String(log?.underlying ?? "").toUpperCase() !== "SENSEX" &&
      String(log?.strategy_key ?? "").toLowerCase() !==
        DAILY_SETUP_KEYS.niftyFiveMinuteBotV2);
  const isNiftyFiveMinuteV2Log = (log) =>
    String(log?.strategy_key ?? "").toLowerCase() ===
    DAILY_SETUP_KEYS.niftyFiveMinuteBotV2;
  const isDhanLiveLog = (log) =>
    String(log?.strategy_key ?? "").toLowerCase() ===
    DAILY_SETUP_KEYS.dhanNiftyFiveMinuteLive;
  const fiveMinuteLogs = logs.filter(
    (log) =>
      isNiftyFiveMinuteLog(log) ||
      isNiftyFiveMinuteV2Log(log) ||
      isDhanLiveLog(log),
  );
  const filteredLogs =
    logStrategyFilter === "niftyFiveMinute"
      ? logs.filter(isNiftyFiveMinuteLog)
      : logStrategyFilter === "niftyFiveMinuteV2"
        ? logs.filter(isNiftyFiveMinuteV2Log)
        : logStrategyFilter === "dhanLive"
          ? logs.filter(isDhanLiveLog)
          : fiveMinuteLogs;
  const selectedLogFilterMeta =
    STRATEGY_FILTER_OPTIONS.find((option) => option.id === logStrategyFilter) ??
    STRATEGY_FILTER_OPTIONS[0];
  const logCounts = filteredLogs.reduce(
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
  const getLatestTrendSnapshot = (logList, predicate) => {
    const sortedLogs = [...logList].sort((first, second) => {
      const firstDate = parseIstDate(first.run_at);
      const secondDate = parseIstDate(second.run_at);
      return (secondDate?.getTime() ?? 0) - (firstDate?.getTime() ?? 0);
    });

    for (const log of sortedLogs) {
      if (!predicate(log)) continue;
      const contractSignals = getLogContractSignals(log);
      const trendSource =
        contractSignals.find(
          (item) =>
            item.st_10_1_trend != null || item.st_10_3_trend != null,
        ) ?? log;
      if (
        trendSource.st_10_1_trend == null &&
        trendSource.st_10_3_trend == null
      ) {
        continue;
      }

      return {
        contract:
          trendSource.resolved_symbol ??
          log.option_symbol ??
          log.contractInput ??
          log.symbol ??
          "Not available",
        fastTrend: trendSource.st_10_1_trend,
        slowTrend: trendSource.st_10_3_trend,
        candleTime: trendSource.candle_time ?? log.candle_time ?? log.run_at,
      };
    }

    return null;
  };
  const latestNiftyTrendLog = getLatestTrendSnapshot(
    logs,
    isNiftyFiveMinuteLog,
  );
  const latestDhanTrendLog = getLatestTrendSnapshot(logs, isDhanLiveLog);
  const dhanLiveCachedCandle = logsMeta.dhanLiveCachedCandle ?? null;
  const combinedOpenTrade = activeTrades[0] ?? null;
  const openTradeLabel = combinedOpenTrade ? (
    <span className="open-trade-label">
      {formatSignal(combinedOpenTrade.signal)}
      <span className="open-trade-label__sep">·</span>
      <span>
        {combinedOpenTrade.option_symbol ??
          combinedOpenTrade.optionSymbol ??
          "Contract"}
      </span>
      {activeTrades.length > 1 ? (
        <>
          <span className="open-trade-label__sep">·</span>
          <span>{activeTrades.length} open</span>
        </>
      ) : null}
    </span>
  ) : (
    "No active trade"
  );

  const isOneMinuteOptionTrade = (trade) =>
    String(trade?.strategy_mode ?? trade?.strategyMode ?? "").toLowerCase() ===
    "option_contracts";
  const isNiftyOptionTrade = (trade) => {
    const strategyKey = trade?.strategy_key ?? trade?.strategyKey;
    if (strategyKey) return strategyKey === DAILY_SETUP_KEYS.niftyOneMinuteBot;
    return isOneMinuteOptionTrade(trade);
  };
  const isSensexOptionTrade = (trade) =>
    (trade?.strategy_key ?? trade?.strategyKey) ===
      DAILY_SETUP_KEYS.sensexOneMinuteBot ||
    String(trade?.underlying ?? "").toUpperCase() === "SENSEX";
  const isNiftyFiveMinuteOptionTrade = (trade) =>
    (trade?.strategy_key ?? trade?.strategyKey) ===
    DAILY_SETUP_KEYS.niftyFiveMinuteBot;
  const isNiftyFiveMinuteV2OptionTrade = (trade) =>
    (trade?.strategy_key ?? trade?.strategyKey) ===
    DAILY_SETUP_KEYS.niftyFiveMinuteBotV2;
  const isDhanLiveTrade = (trade) =>
    (trade?.strategy_key ?? trade?.strategyKey) ===
      DAILY_SETUP_KEYS.dhanNiftyFiveMinuteLive ||
    String(trade?.live_broker ?? trade?.liveBroker ?? "").toLowerCase() ===
      "dhan";
  const oneMinuteOptionTrades = tradeHistory.filter(isNiftyOptionTrade);
  const oneMinuteActiveTrades = niftyActiveTrades.filter(isNiftyOptionTrade);
  const sensexTradeHistory = rawSensexTradeHistory;
  const sensexActiveTrades = rawSensexActiveTrades;
  const sensexOneMinuteOptionTrades =
    sensexTradeHistory.filter(isSensexOptionTrade);
  const sensexOneMinuteActiveTrades =
    sensexActiveTrades.filter(isSensexOptionTrade);
  const niftyFiveMinuteOptionTrades = rawNiftyFiveMinuteTradeHistory.filter(
    isNiftyFiveMinuteOptionTrade,
  );
  const niftyFiveMinuteActiveTrades = rawNiftyFiveMinuteActiveTrades.filter(
    isNiftyFiveMinuteOptionTrade,
  );
  const niftyFiveMinuteV2OptionTrades =
    rawNiftyFiveMinuteV2TradeHistory.filter(isNiftyFiveMinuteV2OptionTrade);
  const niftyFiveMinuteV2ActiveTrades =
    rawNiftyFiveMinuteV2ActiveTrades.filter(isNiftyFiveMinuteV2OptionTrade);
  const dhanLiveOptionTrades = rawDhanLiveTradeHistory.filter(isDhanLiveTrade);
  const dhanLiveActiveTrades = rawDhanLiveActiveTrades.filter(isDhanLiveTrade);
  const filterTradesByStrategy = (filterId) => {
    if (filterId === "niftyOneMinute") return oneMinuteOptionTrades;
    if (filterId === "sensexOneMinute") return sensexOneMinuteOptionTrades;
    if (filterId === "niftyFiveMinute") return niftyFiveMinuteOptionTrades;
    if (filterId === "niftyFiveMinuteV2") return niftyFiveMinuteV2OptionTrades;
    if (filterId === "dhanLive") return dhanLiveOptionTrades;
    return tradeHistory;
  };
  const filteredTradeHistory = filterTradesByStrategy(tradeStrategyFilter);
  const reportTrades = filterTradesByStrategy(reportStrategyFilter);
  const selectedTradeFilterMeta =
    STRATEGY_FILTER_OPTIONS.find(
      (option) => option.id === tradeStrategyFilter,
    ) ?? STRATEGY_FILTER_OPTIONS[0];
  const selectedReportFilterMeta =
    STRATEGY_FILTER_OPTIONS.find(
      (option) => option.id === reportStrategyFilter,
    ) ?? STRATEGY_FILTER_OPTIONS[0];
  const hourlyPnlReport = buildHourlyPnlReport(reportTrades, overviewRange);
  const reportMetrics = buildReportMetrics(reportTrades, overviewRange);
  const reportRangeTrades = filterTradesForRange(reportTrades, overviewRange);
  const reportWinCount = reportRangeTrades.filter(
    (trade) => String(trade.status ?? "").toUpperCase() === "WIN",
  ).length;
  const reportLossCount = reportRangeTrades.filter(
    (trade) => String(trade.status ?? "").toUpperCase() === "LOSS",
  ).length;
  const weekdayPnlReport = buildWeekdayPnlReport(reportTrades, overviewRange);
  const optionTypeReport = buildOptionTypeReport(reportTrades, overviewRange);

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
  const sensexOneMinuteBotSummary = buildBotPageSummary(
    sensexOneMinuteOptionTrades,
    sensexOneMinuteActiveTrades,
  );
  const niftyFiveMinuteBotSummary = buildBotPageSummary(
    niftyFiveMinuteOptionTrades,
    niftyFiveMinuteActiveTrades,
  );
  const niftyFiveMinuteV2BotSummary = buildBotPageSummary(
    niftyFiveMinuteV2OptionTrades,
    niftyFiveMinuteV2ActiveTrades,
  );
  const overviewBotCards = [
    {
      label: "NIFTY 5m V1",
      strategyKey: DAILY_SETUP_KEYS.niftyFiveMinuteBot,
      paperTrading: niftyFiveMinutePaperTrading,
      activeTrades: niftyFiveMinuteActiveTrades,
      summary: niftyFiveMinuteBotSummary,
      trendLog: latestNiftyTrendLog,
      setup:
        strategyConfig.strategySetups?.[DAILY_SETUP_KEYS.niftyFiveMinuteBot] ??
        {},
    },
    {
      label: "NIFTY 5m V2",
      strategyKey: DAILY_SETUP_KEYS.niftyFiveMinuteBotV2,
      paperTrading: niftyFiveMinuteV2PaperTrading,
      activeTrades: niftyFiveMinuteV2ActiveTrades,
      summary: niftyFiveMinuteV2BotSummary,
      trendLog: latestNiftyTrendLog,
      setup:
        strategyConfig.strategySetups?.[
          DAILY_SETUP_KEYS.niftyFiveMinuteBotV2
        ] ?? {},
    },
  ];
  const balanceCards = [
    {
      label: "NIFTY 5m V1 Bank Balance",
      shortLabel: "N",
      strategyKey: DAILY_SETUP_KEYS.niftyFiveMinuteBot,
      paperTrading: niftyFiveMinutePaperTrading,
      activeTrades: niftyFiveMinuteActiveTrades,
      summary: niftyFiveMinuteBotSummary,
    },
    {
      label: "NIFTY 5m V2 Bank Balance",
      shortLabel: "V2",
      strategyKey: DAILY_SETUP_KEYS.niftyFiveMinuteBotV2,
      paperTrading: niftyFiveMinuteV2PaperTrading,
      activeTrades: niftyFiveMinuteV2ActiveTrades,
      summary: niftyFiveMinuteV2BotSummary,
    },
  ];
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
  const requiredRunLogColumnIds = [
    "close",
    "st_10_1",
    "st_10_3",
    "st_10_1_trend",
    "st_10_3_trend",
  ];
  const loadRunLogColumns = () => {
    const selected = loadSelectedColumns("run-logs", runLogColumns);
    return Array.from(new Set([...selected, ...requiredRunLogColumnIds]));
  };
  const liveOrderColumns = [
    { id: "order_id", label: "Order ID" },
    { id: "time", label: "Time" },
    { id: "tradingsymbol", label: "Symbol" },
    { id: "side", label: "Side" },
    { id: "quantity", label: "Qty" },
    { id: "order_type", label: "Type" },
    { id: "status", label: "Status" },
    { id: "average_price", label: "Avg Price" },
    { id: "actions", label: "Actions" },
  ];
  const backtestTradeColumns = [
    { id: "signal", label: "Signal" },
    { id: "signalMode", label: "Signal Rule" },
    { id: "entryTime", label: "Entry" },
    { id: "entryTiming", label: "Entry Trigger" },
    { id: "exitTime", label: "Exit" },
    { id: "instrument", label: "Instrument" },
    { id: "strike", label: "Strike" },
    { id: "quantity", label: "Qty" },
    { id: "baseEntryPrice", label: "Market Entry" },
    { id: "entryPrice", label: "Exec Entry" },
    { id: "baseExitPrice", label: "Market Exit" },
    { id: "exitPrice", label: "Exec Exit" },
    { id: "stopLoss", label: "SL" },
    { id: "stopLossRule", label: "SL Rule" },
    { id: "target", label: "Target" },
    { id: "netPnl", label: "Net PnL" },
    { id: "status", label: "Status" },
    { id: "exitReason", label: "Exit Reason" },
    { id: "executionSource", label: "Source" },
  ];
  const [selectedSignalAlertColumns, setSelectedSignalAlertColumns] = useState(
    () => loadSelectedColumns("signal-alerts", signalAlertColumns),
  );
  const [selectedTradeHistoryColumns, setSelectedTradeHistoryColumns] =
    useState(() => loadSelectedColumns("trade-history", tradeHistoryColumns));
  const [selectedRunLogColumns, setSelectedRunLogColumns] = useState(() =>
    loadRunLogColumns(),
  );
  const [selectedLiveOrderColumns, setSelectedLiveOrderColumns] = useState(() =>
    loadSelectedColumns("live-orders", liveOrderColumns),
  );
  const [selectedBacktestTradeColumns, setSelectedBacktestTradeColumns] =
    useState(() =>
      loadSelectedColumns("backtest-trades", backtestTradeColumns),
    );
  const [tablePages, setTablePages] = useState({});
  const [tablePageSizes, setTablePageSizes] = useState({});

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

  useEffect(() => {
    window.localStorage.setItem(
      `${TABLE_COLUMN_STORAGE_PREFIX}live-orders`,
      JSON.stringify(selectedLiveOrderColumns),
    );
  }, [selectedLiveOrderColumns]);

  useEffect(() => {
    window.localStorage.setItem(
      `${TABLE_COLUMN_STORAGE_PREFIX}backtest-trades`,
      JSON.stringify(selectedBacktestTradeColumns),
    );
  }, [selectedBacktestTradeColumns]);

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

  function getTablePagination(tableKey, totalRows) {
    const pageSize = tablePageSizes[tableKey] ?? DEFAULT_TABLE_PAGE_SIZE;
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const page = Math.min(Math.max(tablePages[tableKey] ?? 1, 1), totalPages);
    return {
      page,
      pageSize,
      startIndex: (page - 1) * pageSize,
      endIndex: page * pageSize,
      controls: {
        page,
        pageSize,
        total: totalRows,
        onPageChange: (nextPage) =>
          setTablePages((current) => ({ ...current, [tableKey]: nextPage })),
        onPageSizeChange: (nextPageSize) => {
          setTablePageSizes((current) => ({
            ...current,
            [tableKey]: nextPageSize,
          }));
          setTablePages((current) => ({ ...current, [tableKey]: 1 }));
        },
      },
    };
  }

  function paginateRows(tableKey, rows) {
    const pagination = getTablePagination(tableKey, rows.length);
    return {
      rows: rows.slice(pagination.startIndex, pagination.endIndex),
      pagination,
    };
  }

  function renderContractMetric(item, field) {
    if (item?.[field] !== null && item?.[field] !== undefined) {
      return formatLogNumber(item[field]);
    }
    return formatSnakeLabel(item?.status ?? "no_data");
  }

  function getRunLogTrendTone(value) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (value === 1 || value === "1" || normalized === "bullish" || normalized === "up" || normalized === "green") {
      return "good";
    }
    if (value === -1 || value === "-1" || normalized === "bearish" || normalized === "down" || normalized === "red") {
      return "bad";
    }
    return "neutral";
  }

  function getRunLogBodyTone(item) {
    const open = Number(item?.open);
    const close = Number(item?.close);
    if (!Number.isFinite(open) || !Number.isFinite(close) || open === close) {
      return "neutral";
    }
    return close > open ? "good" : "bad";
  }

  function isRunLogColumnVisible(columnId) {
    return selectedRunLogColumns.includes(columnId);
  }

  function getRunLogContractItems(log) {
    const contractSignals = getLogContractSignals(log);
    if (contractSignals.length) return contractSignals;

    const optionSymbol = log.option_symbol ?? log.contractInput ?? log.symbol;
    return [
      {
        input: optionSymbol,
        resolved_symbol: optionSymbol,
        status: log.status,
        signal: log.signal,
        open: log.open,
        high: log.high,
        low: log.low,
        close: log.close,
        st_10_1: log.st_10_1,
        st_10_3: log.st_10_3,
        st_10_1_trend: log.st_10_1_trend,
        st_10_3_trend: log.st_10_3_trend,
        strike: log.strike,
        strike_offset: log.strike_offset,
        expiry: log.expiry,
        signal_candle_body_pct: log.signal_candle_body_pct,
        signal_candle_range_pct: log.signal_candle_range_pct,
        candle_time: log.candle_time,
      },
    ];
  }

  function getRunLogContractMarket(item) {
    const symbol = String(item?.resolved_symbol ?? item?.input ?? "").toUpperCase();
    return symbol.includes("SENSEX") ? "sensex" : "nifty";
  }

  const visibleSignalAlertColumns = signalAlertColumns.filter((column) =>
    selectedSignalAlertColumns.includes(column.id),
  );
  const visibleTradeHistoryColumns = tradeHistoryColumns.filter((column) =>
    selectedTradeHistoryColumns.includes(column.id),
  );
  const visibleLiveOrderColumns = liveOrderColumns.filter((column) =>
    selectedLiveOrderColumns.includes(column.id),
  );
  const visibleBacktestTradeColumns = backtestTradeColumns.filter((column) =>
    selectedBacktestTradeColumns.includes(column.id),
  );
  const overviewAlertsTable = paginateRows("overview-alerts", recentAlerts);
  const signalsTable = paginateRows("signal-alerts", recentAlerts);
  const overviewTradeHistoryTable = paginateRows(
    "overview-trades",
    tradeHistory,
  );
  const tradeHistoryTable = paginateRows("trade-history", filteredTradeHistory);
  const liveOrdersTable = paginateRows("live-orders", liveOrders);
  const backtestTradesTable = paginateRows("backtest-trades", backtestTrades);
  const backtestGroupTradesTable = paginateRows(
    "backtest-group-trades",
    activeBacktestGroupTrades,
  );
  const runLogsTable = paginateRows("run-logs", filteredLogs);
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
    setZerodhaConfirmOpen(true);
  }

  function confirmZerodhaConnect() {
    if (!zerodha.loginUrl) {
      setZerodhaConfirmOpen(false);
      setError("ZERODHA_API_KEY is not configured in the backend.");
      return;
    }
    setZerodhaAuthBusy(true);
    window.location.href = zerodha.loginUrl;
  }

  async function runOptionCandleStorage(instrument = "ALL") {
    setCandleStorageBusy(true);
    setCandleStorageResult(null);
    setError("");
    setActionMessage("");
    try {
      const response = await fetch(apiUrl("/api/option-candles/store"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ instrument }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          payload.detail ?? `Option candle storage failed with ${response.status}`,
        );
      }
      setCandleStorageResult(payload);
      setActionMessage(payload.message ?? "Option candle storage completed.");
    } catch (storageError) {
      setError(
        storageError instanceof Error
          ? storageError.message
          : "Unable to store option candles.",
      );
    } finally {
      setCandleStorageBusy(false);
    }
  }

  async function cacheDhanInstrumentMaster(force = false) {
    setDhanMasterBusy(true);
    setError("");
    setActionMessage("");
    try {
      const response = await fetch(apiUrl("/api/dhan/instrument-master/cache"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ force }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          payload.detail ??
            `Dhan instrument master cache failed with ${response.status}`,
        );
      }
      setDhanMasterResult(payload);
      setData((current) => ({
        ...(current ?? {}),
        dhanLiveTrading: {
          ...((current ?? {}).dhanLiveTrading ?? {}),
          instrumentMaster: payload,
        },
      }));
      setActionMessage(
        payload.downloaded
          ? "Dhan instrument master downloaded and cached for today."
          : "Dhan instrument master is already cached for today.",
      );
    } catch (cacheError) {
      setError(
        cacheError instanceof Error
          ? cacheError.message
          : "Unable to cache Dhan instrument master.",
      );
    } finally {
      setDhanMasterBusy(false);
    }
  }

  async function refreshDashboardData() {
    const response = await fetch(apiUrl("/api/dashboard"));
    if (!response.ok) {
      throw new Error(`Dashboard refresh failed with ${response.status}`);
    }
    const payload = await response.json();
    setData((current) => mergeDashboardPayload(current, payload));
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

  async function refreshDhanLiveTradingData({
    positionsOnly = false,
    silent = false,
  } = {}) {
    if (!silent) {
      setLiveActionBusy("dhan-refresh");
      setError("");
    }
    try {
      const response = await fetch(
        apiUrl(
          `/api/dhan-live-trading${positionsOnly ? "?positionsOnly=true" : ""}`,
        ),
      );
      if (!response.ok) {
        throw new Error(`Dhan live refresh failed with ${response.status}`);
      }
      const dhanPayload = await response.json();
      setData((current) =>
        positionsOnly
          ? mergeDhanLiveTradingPayload(current, dhanPayload, {
              preserveBalance: true,
              preserveHistory: true,
            })
          : {
              ...(current ?? {}),
              dhanLiveTrading: dhanPayload,
            },
      );
    } catch (refreshError) {
      if (!silent) {
        setError(
          refreshError instanceof Error
            ? refreshError.message
            : "Unable to refresh Dhan live trading.",
        );
      }
    } finally {
      if (!silent) {
        setLiveActionBusy("");
      }
    }
  }

  async function toggleLiveTrading(enabled) {
    setLiveActionBusy("toggle");
    setError("");
    setActionMessage("");
    try {
      const response = await fetch(apiUrl("/api/live-trading/toggle"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          enabledStrategyKeys: enabled
            ? [liveSetupStrategyKey]
            : liveEnabledStrategyKeys,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(
          payload.detail ??
            `Live trading toggle failed with ${response.status}`,
        );
      }
      setActionMessage(
        enabled ? "Live trading enabled." : "Live trading disabled.",
      );
      setLiveTradingConfirmOpen(false);
      const payload = await response.json().catch(() => ({}));
      setData((current) => ({
        ...(current ?? {}),
        liveTrading: {
          ...((current ?? {}).liveTrading ?? {}),
          status: payload.status ?? {},
        },
      }));
    } catch (liveError) {
      setError(
        liveError instanceof Error
          ? liveError.message
          : "Unable to update live trading.",
      );
    } finally {
      setLiveActionBusy("");
    }
  }

  async function toggleDhanLiveTrading(enabled) {
    setLiveActionBusy("dhan-toggle");
    setError("");
    setActionMessage("");
    try {
      const response = await fetch(apiUrl("/api/dhan-live-trading/toggle"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          enabledStrategyKeys: enabled
            ? [dhanSetupStrategyKey]
            : dhanEnabledStrategyKeys,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(
          payload.detail ?? `Dhan live toggle failed with ${response.status}`,
        );
      }
      setActionMessage(
        enabled ? "Dhan live trading enabled." : "Dhan live trading disabled.",
      );
      const payload = await response.json().catch(() => ({}));
      setData((current) => ({
        ...(current ?? {}),
        dhanLiveTrading: {
          ...((current ?? {}).dhanLiveTrading ?? {}),
          status: payload.status ?? {},
        },
      }));
    } catch (liveError) {
      setError(
        liveError instanceof Error
          ? liveError.message
          : "Unable to update Dhan live trading.",
      );
    } finally {
      setLiveActionBusy("");
    }
  }

  function updateDhanManualEntryField(field, value) {
    setDhanManualEntryForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function placeDhanManualEntry(event) {
    event.preventDefault();
    const strike = Number(dhanManualEntryForm.strike);
    const quantity = Number(dhanManualEntryForm.quantity);
    if (!Number.isFinite(strike) || strike <= 0) {
      setError("Enter a valid NIFTY option strike for Dhan manual entry.");
      return;
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setError("Enter a valid quantity for Dhan manual entry.");
      return;
    }
    if (quantity % DHAN_NIFTY_LOT_SIZE !== 0) {
      setError(`Enter quantity in NIFTY lot multiples of ${DHAN_NIFTY_LOT_SIZE}.`);
      return;
    }
    const confirmed = window.confirm(
      `Place REAL Dhan ${dhanManualEntryForm.transactionType} order for NIFTY ${strike} ${dhanManualEntryForm.optionType}, Qty ${quantity}?`,
    );
    if (!confirmed) return;

    setLiveActionBusy("dhan-manual-entry");
    setError("");
    setActionMessage("");
    try {
      const response = await fetch(apiUrl("/api/dhan-live-trading/manual-entry"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionType: dhanManualEntryForm.transactionType,
          optionType: dhanManualEntryForm.optionType,
          strike,
          quantity,
          expiry: dhanManualEntryForm.expiry || null,
          productType: "INTRADAY",
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(
          payload.detail ?? `Dhan manual entry failed with ${response.status}`,
        );
      }
      const payload = await response.json().catch(() => ({}));
      const symbol =
        payload.security?.tradingSymbol ??
        `NIFTY ${strike} ${dhanManualEntryForm.optionType}`;
      setActionMessage(`Dhan manual ${dhanManualEntryForm.transactionType} placed for ${symbol}.`);
      await refreshDhanLiveTradingData();
    } catch (liveError) {
      setError(
        liveError instanceof Error
          ? liveError.message
          : "Unable to place Dhan manual entry.",
      );
    } finally {
      setLiveActionBusy("");
    }
  }

  async function exitDhanPosition(position) {
    const tradingSymbol =
      position.tradingSymbol ?? position.tradingsymbol ?? position.symbol;
    const securityId = position.securityId ?? position.security_id;
    const quantity = Number(
      position.netQuantity ?? position.netQty ?? position.quantity ?? 0,
    );
    if (!securityId || !tradingSymbol || !quantity) {
      setError("Dhan position is missing symbol, security id, or quantity.");
      return;
    }
    setLiveActionBusy(`dhan-exit-${securityId}`);
    setError("");
    setActionMessage("");
    try {
      const response = await fetch(apiUrl("/api/dhan-live-trading/positions/exit"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          securityId: String(securityId),
          tradingSymbol: String(tradingSymbol),
          exchangeSegment:
            position.exchangeSegment ?? position.exchange_segment ?? "NSE_FNO",
          productType: position.productType ?? position.product ?? "INTRADAY",
          quantity,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(
          payload.detail ?? `Dhan exit failed with ${response.status}`,
        );
      }
      setActionMessage(`Dhan manual exit placed for ${tradingSymbol}.`);
      await refreshDhanLiveTradingData();
    } catch (liveError) {
      setError(
        liveError instanceof Error
          ? liveError.message
          : "Unable to exit Dhan position.",
      );
    } finally {
      setLiveActionBusy("");
    }
  }

  async function cancelLiveOrder(orderId) {
    setLiveActionBusy(`cancel-${orderId}`);
    setError("");
    setActionMessage("");
    try {
      const response = await fetch(
        apiUrl(`/api/live-trading/orders/${orderId}`),
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ variety: "regular" }),
        },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(
          payload.detail ?? `Order cancel failed with ${response.status}`,
        );
      }
      setActionMessage(`Live order cancelled: ${orderId}`);
      await refreshLiveTradingData();
    } catch (liveError) {
      setError(
        liveError instanceof Error
          ? liveError.message
          : "Unable to cancel live order.",
      );
    } finally {
      setLiveActionBusy("");
    }
  }

  function renderBotPage({
    eyebrow,
    title,
    subtitle,
    scheduleLabel,
    strategyKey,
    trades,
    currentActiveTrades,
    summary,
    showContracts,
    botPaperTrading = paperTrading,
  }) {
    const firstActiveTrade = currentActiveTrades[0] ?? null;
    const setupForm = contractForms[strategyKey] ?? DEFAULT_DAILY_SETUP_FORM;
    const setupConfig =
      data?.strategyConfig?.strategySetups?.[strategyKey] ?? {};
    const setupLabel = setupConfig.label ?? "1m option bot";
    const isFiveMinuteSetup = setupLabel.includes("5m");
    const isV2Setup = strategyKey === DAILY_SETUP_KEYS.niftyFiveMinuteBotV2;
    const intervalLabel = isFiveMinuteSetup ? "5m" : "1m";
    const addMoneyAmount = addMoneyAmounts[strategyKey] ?? "";
    const setupTitle = showContracts
      ? `${intervalLabel} daily setup`
      : "5m daily setup";
    const contractPlaceholder1 = "PE";
    const contractPlaceholder2 = "CE";
    const setupSavedToday = Boolean(setupConfig.usesDailySetup);
    const setupSavedAt = setupConfig.dailyContracts?.updated_at;
    const editorOpen = setupEditorOpen[strategyKey] ?? !setupSavedToday;
    const side1 = setupConfig.effectiveContracts?.contract1 || "-";
    const side2 = setupConfig.effectiveContracts?.contract2 || "-";
    const nextExpiry =
      setupConfig.nextExpiry?.label ??
      setupConfig.nextExpiry?.date ??
      "Not available";
    const setupSubtitle = showContracts
      ? setupSavedToday
        ? "Today's setup is saved. Edit the fields below and save again to update the same setup."
        : "Today's setup is not set. Save at least Contract 1 side and risk settings before the bot scans."
      : "Save the trading window, balance, and risk settings used by the 5-minute bot today.";
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

        <section
          className={`panel bot-command-card bot-command-card--${getPnlTone(summary.runningPnl)}`}
        >
          <div className="bot-command-card__top">
            <div>
              <p className="eyebrow">
                {showContracts ? `${intervalLabel} option bot` : "Signal bot"}
              </p>
              <h2>{title}</h2>
              <p className="bot-command-card__subtitle">{scheduleLabel}</p>
            </div>
            <span
              className={`status-pill status-pill--${firstActiveTrade ? "warn" : "neutral"}`}
            >
              {firstActiveTrade
                ? "Active Trade"
                : setupSavedToday
                  ? "Ready"
                  : "Setup Needed"}
            </span>
          </div>

          <div className="bot-command-card__main">
            <div className="bot-command-card__pnl">
              <span>Running PnL</span>
              <strong>
                <PnlValue
                  value={summary.runningPnl}
                  baseValue={getPaperPnlBase(botPaperTrading)}
                />
              </strong>
            </div>
            <dl className="bot-command-card__stats">
              <div>
                <dt>Cash Balance</dt>
                <dd>
                  {formatCurrency(
                    botPaperTrading.cashBalance ?? botPaperTrading.capitalBase,
                  )}
                </dd>
              </div>
              <div>
                <dt>Realized</dt>
                <dd>
                  <PnlValue
                    value={summary.realizedPnl}
                    baseValue={getPaperPnlBase(botPaperTrading)}
                  />
                </dd>
              </div>
              <div>
                <dt>Unrealized</dt>
                <dd>
                  <PnlValue
                    value={summary.unrealizedPnl}
                    baseValue={getPaperPnlBase(botPaperTrading)}
                  />
                </dd>
              </div>
              <div>
                <dt>{selectedRangeMeta.tradesLabel}</dt>
                <dd>{formatCount(summary.tradeCount)}</dd>
              </div>
              <div>
                <dt>Wins / Losses</dt>
                <dd>
                  {formatCount(summary.winCount)} /{" "}
                  {formatCount(summary.lossCount)}
                </dd>
              </div>
              <div>
                <dt>Option Sides</dt>
                <dd>
                  {side1} / {side2}
                </dd>
              </div>
              <div>
                <dt>Next Expiry</dt>
                <dd>{nextExpiry}</dd>
              </div>
              <div>
                <dt>Saved Today</dt>
                <dd>{setupSavedToday ? "Yes" : "No"}</dd>
              </div>
            </dl>
          </div>

          <div className="bot-command-card__footer">
            <div className="bot-command-card__trade">
              <span className="metric-label">Current Active Trade</span>
              {firstActiveTrade ? (
                <div className="bot-command-card__trade-line">
                  {formatSignal(firstActiveTrade.signal)}
                  <strong>
                    {formatCompactOptionSymbol(firstActiveTrade.option_symbol)}
                  </strong>
                  <span>
                    Entry {formatCurrency(firstActiveTrade.entry_price)} · Live{" "}
                    {formatCurrency(firstActiveTrade.livePrice)}
                  </span>
                  <PnlValue
                    value={firstActiveTrade.unrealizedPnl}
                    baseValue={firstActiveTrade.capital_used}
                  />
                </div>
              ) : (
                <span className="muted-cell">No active trade</span>
              )}
            </div>

            {showContracts ? (
              <form
                className="bot-command-card__money-form"
                onSubmit={(event) => addPaperBalance(event, strategyKey)}
              >
                <label className="form-field">
                  Add Paper Money
                  <input
                    type="number"
                    min="1"
                    value={addMoneyAmount}
                    onChange={(event) =>
                      setAddMoneyAmounts((current) => ({
                        ...current,
                        [strategyKey]: event.target.value,
                      }))
                    }
                    placeholder="10000"
                  />
                </label>
                <button type="submit" className="action-button">
                  Add
                </button>
              </form>
            ) : null}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="panel-title">{setupTitle}</p>
            </div>
          </div>

          {showContracts ? (
            <div
              className={`setup-status ${setupSavedToday ? "setup-status--saved" : "setup-status--missing"}`}
            >
              <div>
                <p className="setup-status__title">
                  {setupSavedToday
                    ? `Today's ${intervalLabel} setup is saved`
                    : `Today's ${intervalLabel} setup is not set`}
                </p>
                <p className="setup-status__copy">
                  {setupSavedToday
                    ? `Editing this form will update the setup for ${setupConfig.date ?? "today"}.`
                    : `The ${intervalLabel} bot will not scan until you save its own setup for today.`}
                </p>
              </div>
              <span className="setup-status__pill">
                {setupSavedToday ? "Saved" : "Not set"}
              </span>
            </div>
          ) : null}

          <div className="setup-editor-toggle-row">
            <button
              type="button"
              className="action-button action-button--secondary"
              onClick={() =>
                setSetupEditorOpen((current) => ({
                  ...current,
                  [strategyKey]: !editorOpen,
                }))
              }
            >
              {editorOpen
                ? "Hide Update Section"
                : setupSavedToday
                  ? "Edit Setup"
                  : "Add Setup"}
            </button>
          </div>

          {editorOpen ? (
            <form
              className="backtest-form contract-form"
              onSubmit={(event) => saveStrategyContracts(event, strategyKey)}
            >
              {showContracts ? (
                <>
                  {isFiveMinuteSetup ? (
                    <div className="form-field segmented-field">
                      <span>Contract Mode</span>
                      <div
                        className="segmented-toggle"
                        role="group"
                        aria-label={`${setupLabel} contract mode`}
                      >
                        {[
                          { id: "fixed", label: "Fixed" },
                          { id: "dynamic", label: "Dynamic" },
                        ].map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            className={`segmented-toggle__button ${
                              setupForm.contractMode === option.id
                                ? "segmented-toggle__button--active"
                                : ""
                            }`}
                            onClick={() =>
                              updateContractField(
                                strategyKey,
                                "contractMode",
                                option.id,
                              )
                            }
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <label className="form-field">
                    {isFiveMinuteSetup && setupForm.contractMode === "fixed"
                      ? "Contract 1"
                      : "Contract 1 side"}
                    <input
                      type="text"
                      value={setupForm.contract1}
                      placeholder={
                        isFiveMinuteSetup && setupForm.contractMode === "fixed"
                          ? setupConfig.label?.includes("SENSEX")
                            ? "76000PE"
                            : "24000PE"
                          : contractPlaceholder1
                      }
                      onChange={(event) =>
                        updateContractField(
                          strategyKey,
                          "contract1",
                          event.target.value,
                        )
                      }
                    />
                  </label>
                  <label className="form-field">
                    {isFiveMinuteSetup && setupForm.contractMode === "fixed"
                      ? "Contract 2 (optional)"
                      : "Contract 2 side (optional)"}
                    <input
                      type="text"
                      value={setupForm.contract2}
                      placeholder={
                        isFiveMinuteSetup && setupForm.contractMode === "fixed"
                          ? setupConfig.label?.includes("SENSEX")
                            ? "76200CE"
                            : "24300CE"
                          : contractPlaceholder2
                      }
                      onChange={(event) =>
                        updateContractField(
                          strategyKey,
                          "contract2",
                          event.target.value,
                        )
                      }
                    />
                  </label>
                  {!isFiveMinuteSetup ? (
                    <label className="form-field">
                      Entry Signal
                      <select
                        value={setupForm.entrySignal}
                        onChange={(event) =>
                          updateContractField(
                            strategyKey,
                            "entrySignal",
                            event.target.value,
                          )
                        }
                      >
                        <option value="BUY">BUY</option>
                        <option value="SELL">SELL</option>
                        <option value="BOTH">Both</option>
                      </select>
                    </label>
                  ) : null}
                </>
              ) : null}
              <label className="form-field">
                Start Time
                <input
                  type="time"
                  value={setupForm.scheduleStart}
                  onChange={(event) =>
                    updateContractField(
                      strategyKey,
                      "scheduleStart",
                      event.target.value,
                    )
                  }
                />
              </label>
              <label className="form-field">
                End Time
                <input
                  type="time"
                  value={setupForm.scheduleEnd}
                  onChange={(event) =>
                    updateContractField(
                      strategyKey,
                      "scheduleEnd",
                      event.target.value,
                    )
                  }
                />
              </label>
              <label className="form-field">
                <span className="form-field__label-row">
                  Starting Balance
                  {showContracts ? (
                    <button
                      type="button"
                      className="field-mini-button"
                      onClick={() => fillStartingBalanceFromCash(strategyKey)}
                    >
                      Use balance left
                    </button>
                  ) : null}
                </span>
                <input
                  type="number"
                  min="1"
                  value={setupForm.startingBalance}
                  onChange={(event) =>
                    updateContractField(
                      strategyKey,
                      "startingBalance",
                      event.target.value,
                    )
                  }
                />
              </label>
              <label className="form-field">
                Target %
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={setupForm.targetPct}
                  onChange={(event) =>
                    updateContractField(
                      strategyKey,
                      "targetPct",
                      event.target.value,
                    )
                  }
                />
              </label>
              {showContracts ? (
                <>
                  <label className="form-field">
                    Max Body %
                    <input
                      type="number"
                      min="0.1"
                      step="0.1"
                      value={setupForm.maxSignalCandlePct}
                      onChange={(event) =>
                        updateContractField(
                          strategyKey,
                          "maxSignalCandlePct",
                          event.target.value,
                        )
                      }
                    />
                  </label>
                  <label className="form-field">
                    Min Body %
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={setupForm.minSignalCandlePct}
                      onChange={(event) =>
                        updateContractField(
                          strategyKey,
                          "minSignalCandlePct",
                          event.target.value,
                        )
                      }
                    />
                  </label>
                  <label className="form-field">
                    Strike Offset
                    <input
                      type="number"
                      step={
                        strategyKey === DAILY_SETUP_KEYS.sensexOneMinuteBot
                          ? "100"
                          : "50"
                      }
                      value={setupForm.strikeOffset}
                      placeholder="0, 100, -100"
                      onChange={(event) =>
                        updateContractField(
                          strategyKey,
                          "strikeOffset",
                          event.target.value,
                        )
                      }
                    />
                  </label>
                  <label className="form-field">
                    Expiry
                    <select
                      value={setupForm.expiryOffset}
                      onChange={(event) =>
                        updateContractField(
                          strategyKey,
                          "expiryOffset",
                          event.target.value,
                        )
                      }
                    >
                      {EXPIRY_OFFSET_OPTIONS.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="form-field">
                    SL Mode
                    <select
                      value={setupForm.stopLossMode}
                      onChange={(event) =>
                        updateContractField(
                          strategyKey,
                          "stopLossMode",
                          event.target.value,
                        )
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
                      value={setupForm.stopLossPct}
                      onChange={(event) =>
                        updateContractField(
                          strategyKey,
                          "stopLossPct",
                          event.target.value,
                        )
                      }
                    />
                  </label>
                  {isV2Setup ? (
                    <details className="advanced-backtest-fields" open>
                      <summary>V2 advanced filters</summary>
                      <label className="toggle-control">
                        <input
                          type="checkbox"
                          checked={Boolean(setupForm.requireVwap)}
                          onChange={(event) =>
                            updateContractField(
                              strategyKey,
                              "requireVwap",
                              event.target.checked,
                            )
                          }
                        />
                        <span>Close below VWAP</span>
                      </label>
                      <label className="form-field">
                        Volume Multiplier
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          value={setupForm.minVolumeMultiplier}
                          placeholder="0 disables"
                          onChange={(event) =>
                            updateContractField(
                              strategyKey,
                              "minVolumeMultiplier",
                              event.target.value,
                            )
                          }
                        />
                      </label>
                      <label className="form-field">
                        Volume Lookback
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={setupForm.volumeLookback}
                          onChange={(event) =>
                            updateContractField(
                              strategyKey,
                              "volumeLookback",
                              event.target.value,
                            )
                          }
                        />
                      </label>
                      <label className="form-field">
                        Max Entry Gap %
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          value={setupForm.maxEntryGapPct}
                          placeholder="0 disables"
                          onChange={(event) =>
                            updateContractField(
                              strategyKey,
                              "maxEntryGapPct",
                              event.target.value,
                            )
                          }
                        />
                      </label>
                      <label className="form-field">
                        Trailing SL %
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          value={setupForm.trailingStopPct}
                          placeholder="0 disables"
                          onChange={(event) =>
                            updateContractField(
                              strategyKey,
                              "trailingStopPct",
                              event.target.value,
                            )
                          }
                        />
                      </label>
                      <label className="form-field">
                        Max Trades / Day
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={setupForm.maxTradesPerDay}
                          placeholder="0 disables"
                          onChange={(event) =>
                            updateContractField(
                              strategyKey,
                              "maxTradesPerDay",
                              event.target.value,
                            )
                          }
                        />
                      </label>
                    </details>
                  ) : null}
                </>
              ) : null}
              <button
                type="submit"
                className="action-button"
                disabled={contractSaving}
              >
                {contractSaving
                  ? "Saving..."
                  : setupSavedToday
                    ? "Update Setup"
                    : "Save Setup"}
              </button>
            </form>
          ) : null}

          <dl className="status-list contract-status-list">
            <div>
              <dt>Valid Date</dt>
              <dd>{setupConfig.date ?? "Not available"}</dd>
            </div>
            <div>
              <dt>Saved Today</dt>
              <dd>{setupSavedToday ? "Yes" : "No"}</dd>
            </div>
            {showContracts ? (
              <div>
                <dt>Setup Key</dt>
                <dd>{strategyKey}</dd>
              </div>
            ) : null}
            {showContracts ? (
              <div>
                <dt>Last Saved</dt>
                <dd>
                  {setupSavedAt
                    ? formatDateTime(setupSavedAt)
                    : "Not set today"}
                </dd>
              </div>
            ) : null}
            {showContracts ? (
              <div>
                <dt>Contract Mode</dt>
                <dd>{formatSnakeLabel(setupConfig.contractMode ?? "dynamic")}</dd>
              </div>
            ) : null}
            {showContracts ? (
              <div>
                <dt>Entry Signal</dt>
                <dd>{setupConfig.entrySignal ?? "Not set"}</dd>
              </div>
            ) : null}
            {showContracts ? (
              <div>
                <dt>Target / SL</dt>
                <dd>
                  {setupConfig.targetPct ?? "-"}% /{" "}
                  {formatSnakeLabel(setupConfig.stopLossMode ?? "not_set")}
                  {setupConfig.stopLossMode === "percent"
                    ? ` ${setupConfig.stopLossPct ?? "-"}%`
                    : ""}
                </dd>
              </div>
            ) : null}
            {showContracts ? (
              <div>
                <dt>Body Range</dt>
                <dd>
                  {setupConfig.minSignalCandlePct ?? 0}% -{" "}
                  {setupConfig.maxSignalCandlePct ?? "-"}%
                </dd>
              </div>
            ) : null}
            {showContracts ? (
              <div>
                <dt>Strike Offset</dt>
                <dd>{setupConfig.strikeOffset ?? 0}</dd>
              </div>
            ) : null}
            {showContracts ? (
              <div>
                <dt>Expiry</dt>
                <dd>
                  {EXPIRY_OFFSET_OPTIONS.find(
                    (option) =>
                      option.id === String(setupConfig.expiryOffset ?? "0"),
                  )?.label ?? "Nearest expiry"}
                </dd>
              </div>
            ) : null}
            {isV2Setup ? (
              <div>
                <dt>Advanced Filters</dt>
                <dd>
                  {[
                    setupConfig.requireVwap ? "VWAP" : null,
                    Number(setupConfig.minVolumeMultiplier) > 0
                      ? `Vol ${setupConfig.minVolumeMultiplier}x`
                      : null,
                    Number(setupConfig.maxEntryGapPct) > 0
                      ? `Gap ${setupConfig.maxEntryGapPct}%`
                      : null,
                    Number(setupConfig.trailingStopPct) > 0
                      ? `Trail ${setupConfig.trailingStopPct}%`
                      : null,
                    Number(setupConfig.maxTradesPerDay) > 0
                      ? `Cap ${setupConfig.maxTradesPerDay}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" / ") || "Off"}
                </dd>
              </div>
            ) : null}
            <div>
              <dt>Starting Balance</dt>
              <dd>{formatCurrency(setupConfig.startingBalance)}</dd>
            </div>
            <div>
              <dt>Window</dt>
              <dd>
                {setupConfig.scheduleStart ?? "-"} -{" "}
                {setupConfig.scheduleEnd ?? "-"}
              </dd>
            </div>
            {showContracts ? (
              <div>
                <dt>Option Sides</dt>
                <dd>
                  {setupConfig.effectiveContracts?.contract1 || "-"} /{" "}
                  {setupConfig.effectiveContracts?.contract2 || "-"}
                </dd>
              </div>
            ) : null}
          </dl>
        </section>
      </section>
    );
  }

  return (
    <main className="shell">
      <section className="top-nav">
        <div className="brand-mark" aria-label="Tradewise">
          <img src="/app-icon.svg" alt="" />
          <span>Tradewise</span>
        </div>
        <div className="top-clock" aria-label="Current IST time">
          <span className="top-clock__date">
            {formatIstClockDate(clockNow)}
          </span>
          <span className="top-clock__divider" aria-hidden="true" />
          <span className="top-clock__time">{formatIstClock(clockNow)}</span>
        </div>
        <div className="profile-menu-wrap">
          <button
            type="button"
            className="profile-menu-trigger"
            aria-haspopup="listbox"
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((isOpen) => !isOpen)}
          >
            <span className="profile-menu-trigger__avatar" aria-hidden="true">
              T
            </span>
            <span className="profile-menu-trigger__text">
              <span className="profile-menu-trigger__meta">Menu</span>
              <span className="profile-menu-trigger__label">
                {activeNavOption.label}
              </span>
            </span>
            <span className="profile-menu-trigger__chevron" aria-hidden="true">
              ⌄
            </span>
          </button>
          {mobileMenuOpen ? (
            <div
              className="profile-menu-pane"
              role="listbox"
              aria-label="Dashboard section"
            >
              {NAV_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={activeView === option.id}
                  className={`profile-menu-option ${activeView === option.id ? "profile-menu-option--active" : ""}`}
                  onClick={() => changeActiveView(option.id)}
                >
                  {option.label}
                </button>
              ))}
              <div className="profile-theme-switcher" aria-label="Theme">
                {THEME_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`profile-theme-chip ${
                      theme === option.id ? "profile-theme-chip--active" : ""
                    }`}
                    onClick={() => setTheme(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="hero">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>{activeNavOption.label}</h1>
        </div>
        <div className="hero-badge">
          <span>
            {activeView === "overview"
              ? "Feed"
              : activeView === "niftyOneMinuteBot" ||
                  activeView === "sensexOneMinuteBot" ||
                  activeView === "niftyFiveMinuteBot" ||
                  activeView === "niftyFiveMinuteBotV2"
                ? "Bot"
                : activeView === "trades"
                  ? "History"
                  : activeView === "signals"
                    ? "Alerts"
                    : activeView === "reports"
                      ? "Report range"
                      : activeView === "backtestGroups"
                        ? "Saved set"
                      : activeView === "broker"
                        ? "Zerodha"
                        : activeView === "liveTrading"
                          ? "Live"
                          : "Selected date"}
          </span>
          <strong>
            {activeView === "overview"
              ? streamStatus
              : activeView === "niftyFiveMinuteBot"
                ? "NIFTY 5m V1"
                : activeView === "niftyFiveMinuteBotV2"
                  ? "NIFTY 5m V2"
                  : activeView === "trades"
                    ? `${formatCount(tradeHistory.length)} trades`
                    : activeView === "signals"
                      ? `${formatCount(recentAlerts.length)} alerts`
                      : activeView === "reports"
                        ? selectedRangeMeta.label
                        : activeView === "backtestGroups"
                          ? `${formatCount(activeBacktestGroupTrades.length)} trades`
                        : activeView === "broker"
                          ? zerodha.health?.ok
                            ? "Working"
                            : "Check needed"
                          : activeView === "liveTrading"
                            ? liveTradingStatus.enabled
                              ? "Enabled"
                              : "Disabled"
                            : selectedDate}
          </strong>
        </div>
      </section>

      {error ? <div className="banner banner--error">{error}</div> : null}
      {actionMessage ? (
        <div className="banner banner--success">{actionMessage}</div>
      ) : null}
      {loading ? <div className="banner">Loading dashboard data...</div> : null}
      {zerodhaConfirmOpen ? (
        <div className="confirm-overlay" role="presentation">
          <section
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="zerodha-confirm-title"
          >
            <div className="confirm-dialog__icon" aria-hidden="true">
              Z
            </div>
            <div>
              <p className="eyebrow">Broker Login</p>
              <h2 id="zerodha-confirm-title">Connect Zerodha?</h2>
              <p className="confirm-dialog__copy">
                You’ll leave Tradewise and open Zerodha Kite login. After login,
                Zerodha will redirect you back to the configured callback URL.
              </p>
            </div>
            <dl className="confirm-dialog__details">
              <div>
                <dt>API Key</dt>
                <dd>{zerodha.apiKeyConfigured ? "Configured" : "Missing"}</dd>
              </div>
              <div>
                <dt>Redirect URL</dt>
                <dd>{zerodha.redirectUrl ?? "Not available"}</dd>
              </div>
            </dl>
            <div className="confirm-dialog__actions">
              <button
                type="button"
                className="action-button action-button--ghost"
                onClick={() => setZerodhaConfirmOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="action-button action-button--buy"
                onClick={confirmZerodhaConnect}
                disabled={zerodhaAuthBusy}
              >
                {zerodhaAuthBusy ? "Opening..." : "Continue to Zerodha"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {deleteTradeCandidate ? (
        <div className="confirm-overlay" role="presentation">
          <section
            className="confirm-dialog confirm-dialog--danger"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-trade-confirm-title"
          >
            <div
              className="confirm-dialog__icon confirm-dialog__icon--danger"
              aria-hidden="true"
            >
              !
            </div>
            <div>
              <p className="eyebrow">Delete Trade</p>
              <h2 id="delete-trade-confirm-title">Remove this trade?</h2>
            </div>
            <dl className="confirm-dialog__details">
              <div>
                <dt>Contract</dt>
                <dd>{deleteTradeCandidate.option_symbol ?? "Not available"}</dd>
              </div>
              <div>
                <dt>Net PnL</dt>
                <dd>
                  <PnlValue
                    value={deleteTradeCandidate.net_pnl}
                    baseValue={deleteTradeCandidate.capital_used}
                  />
                </dd>
              </div>
            </dl>
            <div className="confirm-dialog__actions">
              <button
                type="button"
                className="action-button action-button--ghost"
                onClick={() => setDeleteTradeCandidate(null)}
                disabled={deletingTradeId === deleteTradeCandidate.trade_id}
              >
                Cancel
              </button>
              <button
                type="button"
                className="action-button action-button--sell"
                onClick={() => deleteTrade(deleteTradeCandidate.trade_id)}
                disabled={deletingTradeId === deleteTradeCandidate.trade_id}
              >
                {deletingTradeId === deleteTradeCandidate.trade_id
                  ? "Deleting..."
                  : "Delete Trade"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {liveTradingConfirmOpen ? (
        <div className="confirm-overlay" role="presentation">
          <section
            className="confirm-dialog confirm-dialog--live"
            role="dialog"
            aria-modal="true"
            aria-labelledby="live-trading-confirm-title"
          >
            <div
              className="confirm-dialog__icon confirm-dialog__icon--live"
              aria-hidden="true"
            >
              L
            </div>
            <div>
              <p className="eyebrow">Live Trading</p>
              <h2 id="live-trading-confirm-title">Turn on live orders?</h2>
              <p className="confirm-dialog__copy">
                Please confirm the selected setup before Tradewise can place
                real Zerodha orders for this strategy.
              </p>
            </div>
            <dl className="confirm-dialog__details">
              <div>
                <dt>Market</dt>
                <dd>{liveSetupMarket}</dd>
              </div>
              <div>
                <dt>Option Side</dt>
                <dd>
                  {liveSelectedSide === "BOTH" ? "PE / CE" : liveSelectedSide}
                </dd>
              </div>
              <div>
                <dt>Contracts</dt>
                <dd>{liveSelectedContracts || "Not set"}</dd>
              </div>
              <div>
                <dt>Window</dt>
                <dd>
                  {liveSelectedForm.scheduleStart || "-"} to{" "}
                  {liveSelectedForm.scheduleEnd || "-"}
                </dd>
              </div>
              <div>
                <dt>Entry Signal</dt>
                <dd>{liveSelectedForm.entrySignal || "BUY"}</dd>
              </div>
              <div>
                <dt>Target / SL</dt>
                <dd>
                  {liveSelectedForm.targetPct || "-"}% /{" "}
                  {formatSnakeLabel(
                    liveSelectedForm.stopLossMode || "signal_low",
                  )}
                  {liveSelectedForm.stopLossMode === "percent"
                    ? ` ${liveSelectedForm.stopLossPct || "-"}%`
                    : ""}
                </dd>
              </div>
              <div>
                <dt>Max Body</dt>
                <dd>{liveSelectedForm.maxSignalCandlePct || "-"}%</dd>
              </div>
              <div>
                <dt>Offset</dt>
                <dd>{liveSelectedForm.strikeOffset || "0"}</dd>
              </div>
              <div>
                <dt>Expiry</dt>
                <dd>
                  {EXPIRY_OFFSET_OPTIONS.find(
                    (option) =>
                      option.id === String(liveSelectedForm.expiryOffset ?? "0"),
                  )?.label ?? "Nearest expiry"}
                </dd>
              </div>
              <div>
                <dt>Broker Cash</dt>
                <dd>
                  {liveBalance.cash == null
                    ? "Not available"
                    : formatCurrency(liveBalance.cash)}
                </dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>
                  {liveTradingStatus.zerodhaReady
                    ? "Zerodha ready"
                    : "Zerodha not ready"}{" "}
                  ·{" "}
                  {liveSelectedSetup.usesDailySetup
                    ? "Setup saved"
                    : "Setup not saved"}
                </dd>
              </div>
            </dl>
            <div className="confirm-dialog__actions">
              <button
                type="button"
                className="action-button action-button--ghost"
                onClick={() => setLiveTradingConfirmOpen(false)}
                disabled={liveActionBusy === "toggle"}
              >
                Cancel
              </button>
              <button
                type="button"
                className="action-button action-button--buy"
                onClick={() => toggleLiveTrading(true)}
                disabled={liveActionBusy === "toggle"}
              >
                {liveActionBusy === "toggle"
                  ? "Turning on..."
                  : "Confirm & Turn On"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

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

            <section className="market-overview-layout">
              <div className="market-quote-grid">
                {marketQuotes.map((quote) => (
                  <MarketQuoteCard key={quote.name} quote={quote} />
                ))}
              </div>

              <article className="panel bot-command-card overview-summary-card">
                <div className="bot-command-card__top">
                  <div>
                    <p className="eyebrow">Overview Summary</p>
                    <h2>{selectedRangeMeta.label}</h2>
                    <p className="bot-command-card__subtitle">
                      Latest bot status and combined NIFTY/SENSEX paper result.
                    </p>
                  </div>
                  <span
                    className={`status-pill status-pill--${getStatusTone(status.lastRunStatus)}`}
                  >
                    {status.lastRunStatus ?? "idle"}
                  </span>
                </div>

                <div className="bot-command-card__main overview-summary-card__main">
                  <div className="bot-command-card__pnl">
                    <span>Running PnL</span>
                    <strong>
                      <PnlValue
                        value={selectedRangeSummary.runningPnl ?? 0}
                        baseValue={combinedCapitalBase}
                      />
                    </strong>
                    <small>
                      {formatCount(selectedRangeSummary.tradeCount)} trades ·{" "}
                      {winsLosses} W/L
                    </small>
                  </div>
                  <dl className="bot-command-card__stats overview-summary-card__stats">
                    <div>
                      <dt>Next Run</dt>
                      <dd>{formatDateTime(schedule.nextRunAt)}</dd>
                    </div>
                    <div>
                      <dt>{selectedRangeMeta.tradesLabel}</dt>
                      <dd>{formatCount(selectedRangeSummary.tradeCount)}</dd>
                    </div>
                    <div>
                      <dt>Wins / Losses</dt>
                      <dd>{winsLosses}</dd>
                    </div>
                    <div>
                      <dt>Open Trade</dt>
                      <dd>{openTradeLabel}</dd>
                    </div>
                  </dl>
                </div>
              </article>
            </section>
          </section>

          <section id="paper-trading" className="section-block">
            <div className="section-heading">
              <p className="eyebrow">Paper Trading</p>
              <h2 className="section-title">NIFTY and SENSEX bots</h2>
            </div>

            <section className="overview-bot-tables">
              {overviewBotCards.map((bot) => {
                const botActiveTrade = bot.activeTrades[0] ?? null;
                const botDailySummary = bot.paperTrading.dailySummary ?? {};
                const side1 = bot.setup.effectiveContracts?.contract1 || "-";
                const side2 = bot.setup.effectiveContracts?.contract2 || "-";
                const nextExpiry =
                  bot.setup.nextExpiry?.label ??
                  bot.setup.nextExpiry?.date ??
                  "Not available";
                const activeTradeLabel = botActiveTrade ? (
                  <span className="bot-active-trade-cell">
                    {formatSignal(botActiveTrade.signal)}
                    <strong>
                      {formatCompactOptionSymbol(botActiveTrade.option_symbol)}
                    </strong>
                    <span>
                      {formatCurrency(botActiveTrade.entry_price)} /{" "}
                      {formatCurrency(botActiveTrade.livePrice)}
                    </span>
                    <PnlValue
                      value={botActiveTrade.unrealizedPnl}
                        baseValue={botActiveTrade.capital_used}
                      />
                    </span>
                  ) : (
                  <span className="muted-cell">No active trade</span>
                );
                return (
                  <article
                    className="panel bot-command-card overview-bot-command-card"
                    key={bot.strategyKey}
                  >
                    <div className="bot-command-card__top">
                      <div>
                        <p className="eyebrow">
                          {bot.setup.label?.includes("5m")
                            ? "5m Option Bot"
                            : "1m Option Bot"}
                        </p>
                        <h2>{bot.label}</h2>
                        <p className="bot-command-card__subtitle">
                          {side1} / {side2} · Next expiry {nextExpiry}
                        </p>
                      </div>
                      <span
                        className={`status-pill status-pill--${botActiveTrade ? "warn" : "neutral"}`}
                      >
                        {botActiveTrade ? "Active" : "Idle"}
                      </span>
                    </div>

                    <div className="bot-command-card__main">
                      <div className="bot-command-card__pnl">
                        <span>Running PnL</span>
                        <strong>
                          <PnlValue
                            value={bot.summary.runningPnl}
                            baseValue={getPaperPnlBase(bot.paperTrading)}
                          />
                        </strong>
                        <small>
                          {formatCount(bot.summary.tradeCount)} trades ·{" "}
                          {formatCount(bot.summary.winCount)} /{" "}
                          {formatCount(bot.summary.lossCount)} W/L
                        </small>
                      </div>
                      <dl className="bot-command-card__stats overview-bot-card__stats">
                        <div>
                          <dt>Cash Balance</dt>
                          <dd>
                            {formatCurrency(
                              bot.paperTrading.cashBalance ??
                                bot.paperTrading.capitalBase,
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>Realized PnL</dt>
                          <dd>
                              <PnlValue
                                value={bot.summary.realizedPnl}
                                baseValue={getPaperPnlBase(bot.paperTrading)}
                              />
                          </dd>
                        </div>
                        <div>
                          <dt>Trade Date</dt>
                          <dd>{botDailySummary.tradeDate ?? "Not available"}</dd>
                        </div>
                        <div>
                          <dt>Day Stopped</dt>
                          <dd>{botDailySummary.dayStopped ? "Yes" : "No"}</dd>
                        </div>
                        <div className="overview-bot-trend-card">
                          <dt>Latest Trend</dt>
                          <dd>
                            <span className="log-trend-card__row">
                              <span>Fast</span>
                              <TrendBadge value={bot.trendLog?.fastTrend} />
                              <span>Slow</span>
                              <TrendBadge value={bot.trendLog?.slowTrend} />
                            </span>
                            <span className="log-trend-card__contract">
                              {bot.trendLog
                                ? formatCompactOptionSymbol(bot.trendLog.contract)
                                : "Not available"}
                            </span>
                          </dd>
                        </div>
                      </dl>
                    </div>

                    <div className="bot-command-card__footer overview-bot-card__footer">
                      <div className="bot-command-card__trade">
                        <div className="bot-command-card__trade-line">
                          <span className="empty-state-icon" aria-hidden="true">
                            {bot.label.startsWith("NIFTY") ? "N" : "S"}
                          </span>
                          <strong>Active Trade</strong>
                        </div>
                        <span>{activeTradeLabel}</span>
                      </div>
                    </div>
                  </article>
                );
              })}
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
                        {zerodha.accessTokenConfigured
                          ? "Configured"
                          : "Missing"}
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
                    <>
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
                            {overviewAlertsTable.rows.map((alert) => (
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
                                        {alert.optionSymbol ??
                                          alert.symbol ??
                                          "-"}
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
                      <PaginationControls
                        {...overviewAlertsTable.pagination.controls}
                      />
                    </>
                  ) : (
                    <p className="empty-copy">
                      Recent alerts will appear here once the bot sends or tests
                      a signal.
                    </p>
                  )}
                </article>
              </section>

              <section className="panel">
                <div className="panel-header">
                  <div>
                    <p className="panel-title">Trade History</p>
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
                  <>
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
                          {overviewTradeHistoryTable.rows.map((trade) => (
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
                                    <td key={column.id}>
                                      {trade.quantity ?? "-"}
                                    </td>
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
                                      {formatStopLossSource(
                                        trade.stop_loss_source,
                                      )}
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
                    <PaginationControls
                      {...overviewTradeHistoryTable.pagination.controls}
                    />
                  </>
                ) : (
                  <p className="empty-copy">
                    Completed paper trades will appear here after the first
                    exit.
                  </p>
                )}
              </section>
            </section>
          ) : null}
        </>
      ) : activeView === "niftyOneMinuteBot" ? (
        renderBotPage({
          eyebrow: "NIFTY 1-Minute Option Bot",
          title: "NIFTY 1m option-contract execution",
          subtitle:
            "Focused view for the NIFTY two-contract option strategy running on 1-minute candles.",
          scheduleLabel: "Every 1 min at +2s",
          strategyKey: DAILY_SETUP_KEYS.niftyOneMinuteBot,
          trades: oneMinuteOptionTrades,
          currentActiveTrades: oneMinuteActiveTrades,
          summary: oneMinuteBotSummary,
          showContracts: true,
          botPaperTrading: niftyPaperTrading,
        })
      ) : activeView === "sensexOneMinuteBot" ? (
        renderBotPage({
          eyebrow: "SENSEX 1-Minute Option Bot",
          title: "SENSEX 1m option-contract execution",
          subtitle:
            "Separate SENSEX paper-trading lane using the same two-contract 1-minute Supertrend strategy.",
          scheduleLabel: "Every 1 min at +2s",
          strategyKey: DAILY_SETUP_KEYS.sensexOneMinuteBot,
          trades: sensexOneMinuteOptionTrades,
          currentActiveTrades: sensexOneMinuteActiveTrades,
          summary: sensexOneMinuteBotSummary,
          showContracts: true,
          botPaperTrading: sensexPaperTrading,
        })
      ) : activeView === "niftyFiveMinuteBot" ? (
        renderBotPage({
          eyebrow: "NIFTY 5-Minute Option Bot V1",
          title: "NIFTY 5m V1 option-contract execution",
          subtitle:
            "BUY-only Supertrend strategy matching the 5m backtest, with entry at next candle +2s.",
          scheduleLabel: "Every 5 min at +2s",
          strategyKey: DAILY_SETUP_KEYS.niftyFiveMinuteBot,
          trades: niftyFiveMinuteOptionTrades,
          currentActiveTrades: niftyFiveMinuteActiveTrades,
          summary: niftyFiveMinuteBotSummary,
          showContracts: true,
          botPaperTrading: niftyFiveMinutePaperTrading,
        })
      ) : activeView === "niftyFiveMinuteBotV2" ? (
        renderBotPage({
          eyebrow: "NIFTY 5-Minute Option Bot V2",
          title: "NIFTY 5m V2 advanced-filter execution",
          subtitle:
            "Separate NIFTY 5m lane with VWAP, volume, entry-gap, trailing stop, and trade-cap filters.",
          scheduleLabel: "Every 5 min at +2s",
          strategyKey: DAILY_SETUP_KEYS.niftyFiveMinuteBotV2,
          trades: niftyFiveMinuteV2OptionTrades,
          currentActiveTrades: niftyFiveMinuteV2ActiveTrades,
          summary: niftyFiveMinuteV2BotSummary,
          showContracts: true,
          botPaperTrading: niftyFiveMinuteV2PaperTrading,
        })
      ) : activeView === "balance" ? (
        <section className="section-block">
          <div className="section-heading">
            <p className="eyebrow">Paper Trading</p>
            <h2 className="section-title">Balance</h2>
          </div>

          <section className="balance-card-grid">
            {balanceCards.map((card) => {
              const paperBalance = Number(
                card.paperTrading.cashBalance ?? card.paperTrading.capitalBase ?? 0,
              );
              const startingBalance = Number(
                card.paperTrading.startingBalance ??
                  card.paperTrading.capitalBase ??
                  0,
              );
              const activeCapital = card.activeTrades.reduce(
                (sum, trade) => sum + Number(trade.capital_used ?? trade.capitalUsed ?? 0),
                0,
              );
              const adjustments = Array.isArray(card.paperTrading.balanceAdjustments)
                ? card.paperTrading.balanceAdjustments
                : [];
              const addMoneyAmount = addMoneyAmounts[card.strategyKey] ?? "";
              return (
                <article
                  className={`panel bot-command-card bot-command-card--${getPnlTone(card.summary.runningPnl)}`}
                  key={card.strategyKey}
                >
                  <div className="bot-command-card__top">
                    <div>
                      <p className="eyebrow">Separate Paper Bank</p>
                      <h2>{card.label}</h2>
                    </div>
                    <span className="empty-state-icon" aria-hidden="true">
                      {card.shortLabel}
                    </span>
                  </div>

                  <div className="balance-card__body">
                    <div className="balance-hero">
                      <span>Cash Balance</span>
                      <strong>{formatCurrency(paperBalance)}</strong>
                      <div className="balance-hero__meta">
                        <span>Start {formatCurrency(startingBalance)}</span>
                        <span>Active {formatCurrency(activeCapital)}</span>
                      </div>
                    </div>

                    <dl className="balance-metric-list">
                      <div className="balance-metric balance-metric--wide">
                        <dt>Running PnL</dt>
                        <dd>
                          <PnlValue
                            value={card.summary.runningPnl}
                            baseValue={getPaperPnlBase(card.paperTrading)}
                          />
                        </dd>
                      </div>
                      <div className="balance-metric">
                        <dt>Realized PnL</dt>
                        <dd>
                          <PnlValue
                            value={card.summary.realizedPnl}
                            baseValue={getPaperPnlBase(card.paperTrading)}
                          />
                        </dd>
                      </div>
                      <div className="balance-metric">
                        <dt>Unrealized PnL</dt>
                        <dd>
                          <PnlValue
                            value={card.summary.unrealizedPnl}
                            baseValue={getPaperPnlBase(card.paperTrading)}
                          />
                        </dd>
                      </div>
                      <div className="balance-metric">
                        <dt>Trades</dt>
                        <dd>{formatCount(card.summary.tradeCount)}</dd>
                      </div>
                      <div className="balance-metric">
                        <dt>Wins / Losses</dt>
                        <dd>
                          {formatCount(card.summary.winCount)} /{" "}
                          {formatCount(card.summary.lossCount)}
                        </dd>
                      </div>
                      <div className="balance-metric">
                        <dt>Open Trades</dt>
                        <dd>{formatCount(card.activeTrades.length)}</dd>
                      </div>
                    </dl>
                  </div>

                  <div className="bot-command-card__footer balance-card__footer">
                    <form
                      className="bot-command-card__money-form"
                      onSubmit={(event) => addPaperBalance(event, card.strategyKey)}
                    >
                      <label className="form-field">
                        Add Money
                        <input
                          type="number"
                          min="1"
                          value={addMoneyAmount}
                          onChange={(event) =>
                            setAddMoneyAmounts((current) => ({
                              ...current,
                              [card.strategyKey]: event.target.value,
                            }))
                          }
                          placeholder="10000"
                        />
                      </label>
                      <button type="submit" className="action-button">
                        Add
                      </button>
                    </form>

                    <details className="balance-adjustments">
                      <summary>
                        <span>Recent Adjustments</span>
                        <strong>{formatCount(adjustments.length)}</strong>
                      </summary>
                      {adjustments.length ? (
                        <div className="mini-ledger">
                          {adjustments.slice(0, 3).map((adjustment, index) => (
                            <div
                              className="mini-ledger__row"
                              key={`${adjustment.timestamp ?? index}-${index}`}
                            >
                              <span>{formatSnakeLabel(adjustment.type ?? "deposit")}</span>
                              <strong>{formatCurrency(adjustment.amount)}</strong>
                              <small>
                                {formatTableDateTime(adjustment.timestamp)} ·{" "}
                                {formatCurrency(adjustment.balance_after)}
                              </small>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="muted-cell">No balance adjustments yet</span>
                      )}
                    </details>
                  </div>
                </article>
              );
            })}
          </section>
        </section>
      ) : activeView === "trades" ? (
        <section className="section-block">
          <div className="section-heading">
            <p className="eyebrow">Paper Trading</p>
            <h2 className="section-title">Trade history</h2>
          </div>

          <div
            className="range-switcher"
            role="tablist"
            aria-label="Trade history strategy filter"
          >
            {STRATEGY_FILTER_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`range-chip ${tradeStrategyFilter === option.id ? "range-chip--active" : ""}`}
                onClick={() => setTradeStrategyFilter(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="panel-title">
                  Completed Trades · {selectedTradeFilterMeta.label}
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

            {filteredTradeHistory.length ? (
              <>
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
                      {tradeHistoryTable.rows.map((trade) => (
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
                            if (column.id === "actions")
                              return (
                                <td key={column.id}>
                                  <button
                                    type="button"
                                    className="table-action-button table-action-button--danger"
                                    onClick={() =>
                                      setDeleteTradeCandidate(trade)
                                    }
                                    disabled={
                                      deletingTradeId === trade.trade_id
                                    }
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
                <PaginationControls
                  {...tradeHistoryTable.pagination.controls}
                />
              </>
            ) : (
              <p className="empty-copy">
                No completed paper trades found for{" "}
                {selectedTradeFilterMeta.label}.
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
              <>
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
                      {signalsTable.rows.map((alert) => (
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
                <PaginationControls {...signalsTable.pagination.controls} />
              </>
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

          <section className="panel bot-command-card live-command-card">
            <div className="bot-command-card__top">
              <div>
                <p className="eyebrow">Broker execution</p>
                <h2>{liveSetupLabel}</h2>
                <p className="bot-command-card__subtitle">
                  Uses the selected 1m daily setup before placing Zerodha live
                  orders.
                </p>
              </div>
              <span
                className={`setup-status__pill ${
                  liveTradingStatus.enabled && liveSelectedStrategyEnabled
                    ? "setup-status__pill--saved"
                    : ""
                }`}
              >
                {liveTradingStatus.enabled && liveSelectedStrategyEnabled
                  ? "Live On"
                  : liveTradingStatus.enabled
                    ? "Other Strategy On"
                    : "Live Off"}
              </span>
            </div>

            <div className="bot-command-card__main">
              <div className="bot-command-card__pnl">
                <span>Available Cash</span>
                <strong>
                  {liveBalance.cash == null
                    ? "Not available"
                    : formatCurrency(liveBalance.cash)}
                </strong>
                <small>
                  Live balance:{" "}
                  {liveBalance.liveBalance == null
                    ? "Not available"
                    : formatCurrency(liveBalance.liveBalance)}
                </small>
              </div>

              <dl className="bot-command-card__stats live-command-card__stats">
                <div>
                  <dt>Market</dt>
                  <dd>{liveSetupMarket}</dd>
                </div>
                <div>
                  <dt>Zerodha</dt>
                  <dd>
                    {liveTradingStatus.zerodhaReady ? "Ready" : "Not ready"}
                  </dd>
                </div>
                <div>
                  <dt>Orders / Trades</dt>
                  <dd>
                    {formatCount(liveOrders.length)} /{" "}
                    {formatCount(liveTrades.length)}
                  </dd>
                </div>
                <div>
                  <dt>Contracts</dt>
                  <dd>{liveSelectedContracts || "Not set"}</dd>
                </div>
                <div>
                  <dt>Entry Signal</dt>
                  <dd>
                    {liveSelectedSetup.entrySignal ??
                      liveSelectedForm.entrySignal ??
                      "BUY"}
                  </dd>
                </div>
                <div>
                  <dt>Target / SL</dt>
                  <dd>
                    {liveSelectedSetup.targetPct ??
                      liveSelectedForm.targetPct ??
                      "-"}
                    % /{" "}
                    {formatSnakeLabel(
                      liveSelectedSetup.stopLossMode ??
                        liveSelectedForm.stopLossMode ??
                        "signal_low",
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Last Action</dt>
                  <dd>
                    {formatSnakeLabel(liveTradingStatus.lastAction ?? "none")}
                  </dd>
                </div>
                <div>
                  <dt>Broker Error</dt>
                  <dd>{liveTrading.error ?? "None"}</dd>
                </div>
              </dl>
            </div>

            <form
              className="backtest-form live-setup-form"
              onSubmit={(event) =>
                saveStrategyContracts(event, liveSetupStrategyKey)
              }
            >
              <label className="form-field segmented-field">
                Underlying
                <div className="segmented-toggle">
                  {["NIFTY", "SENSEX"].map((market) => (
                    <button
                      key={market}
                      type="button"
                      className={`segmented-toggle__button ${
                        liveSetupMarket === market
                          ? "segmented-toggle__button--active"
                          : ""
                      }`}
                      onClick={() => setLiveSetupMarket(market)}
                    >
                      {market}
                    </button>
                  ))}
                </div>
              </label>
              <label className="form-field segmented-field">
                Option Side
                <div className="segmented-toggle segmented-toggle--three">
                  {["PE", "CE", "BOTH"].map((side) => (
                    <button
                      key={side}
                      type="button"
                      className={`segmented-toggle__button ${
                        liveSelectedSide === side
                          ? "segmented-toggle__button--active"
                          : ""
                      }`}
                      onClick={() => updateLiveOptionSide(side)}
                    >
                      {side === "BOTH" ? "Both" : side}
                    </button>
                  ))}
                </div>
              </label>
              <label className="form-field">
                Start Time
                <input
                  type="time"
                  value={liveSelectedForm.scheduleStart}
                  onChange={(event) =>
                    updateContractField(
                      liveSetupStrategyKey,
                      "scheduleStart",
                      event.target.value,
                    )
                  }
                />
              </label>
              <label className="form-field">
                End Time
                <input
                  type="time"
                  value={liveSelectedForm.scheduleEnd}
                  onChange={(event) =>
                    updateContractField(
                      liveSetupStrategyKey,
                      "scheduleEnd",
                      event.target.value,
                    )
                  }
                />
              </label>
              <label className="form-field">
                Target %
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={liveSelectedForm.targetPct}
                  onChange={(event) =>
                    updateContractField(
                      liveSetupStrategyKey,
                      "targetPct",
                      event.target.value,
                    )
                  }
                />
              </label>
              <label className="form-field">
                Max Body %
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={liveSelectedForm.maxSignalCandlePct}
                  onChange={(event) =>
                    updateContractField(
                      liveSetupStrategyKey,
                      "maxSignalCandlePct",
                      event.target.value,
                    )
                  }
                />
              </label>
              <label className="form-field">
                Strike Offset
                <input
                  type="number"
                  step={
                    liveSetupStrategyKey === DAILY_SETUP_KEYS.sensexOneMinuteBot
                      ? "100"
                      : "50"
                  }
                  value={liveSelectedForm.strikeOffset}
                  placeholder="0, 100, -100"
                  onChange={(event) =>
                    updateContractField(
                      liveSetupStrategyKey,
                      "strikeOffset",
                      event.target.value,
                    )
                  }
                />
              </label>
              <label className="form-field">
                Expiry
                <select
                  value={liveSelectedForm.expiryOffset}
                  onChange={(event) =>
                    updateContractField(
                      liveSetupStrategyKey,
                      "expiryOffset",
                      event.target.value,
                    )
                  }
                >
                  {EXPIRY_OFFSET_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                SL Mode
                <select
                  value={liveSelectedForm.stopLossMode}
                  onChange={(event) =>
                    updateContractField(
                      liveSetupStrategyKey,
                      "stopLossMode",
                      event.target.value,
                    )
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
                  value={liveSelectedForm.stopLossPct}
                  onChange={(event) =>
                    updateContractField(
                      liveSetupStrategyKey,
                      "stopLossPct",
                      event.target.value,
                    )
                  }
                />
              </label>
              <label className="form-field">
                Entry Signal
                <select
                  value={liveSelectedForm.entrySignal}
                  onChange={(event) =>
                    updateContractField(
                      liveSetupStrategyKey,
                      "entrySignal",
                      event.target.value,
                    )
                  }
                >
                  <option value="BUY">BUY</option>
                  <option value="SELL">SELL</option>
                  <option value="BOTH">Both</option>
                </select>
              </label>
              <button
                type="submit"
                className="action-button"
                disabled={contractSaving}
              >
                {contractSaving ? "Saving..." : "Save Live Setup"}
              </button>
            </form>

            <div className="bot-command-card__footer live-command-card__footer">
              <div className="bot-command-card__trade">
                <div className="bot-command-card__trade-line">
                  <span className="empty-state-icon" aria-hidden="true">
                    {liveSelectedSetup.usesDailySetup ? "OK" : "!"}
                  </span>
                  <strong>
                    {liveSelectedSetup.usesDailySetup
                      ? `Setup saved for ${liveSelectedSetup.date ?? "today"}`
                      : "Daily setup is not saved yet"}
                  </strong>
                </div>
                <span className="muted-cell">
                  Last update: {formatDateTime(liveTradingStatus.updatedAt)}
                </span>
              </div>
              <div className="action-row live-command-card__actions">
                <button
                  type="button"
                  className={`action-button ${
                    liveSelectedStrategyEnabled
                      ? "action-button--sell"
                      : "action-button--buy"
                  }`}
                  onClick={() =>
                    liveSelectedStrategyEnabled
                      ? toggleLiveTrading(false)
                      : setLiveTradingConfirmOpen(true)
                  }
                  disabled={liveActionBusy === "toggle"}
                >
                  {liveActionBusy === "toggle"
                    ? "Updating..."
                    : liveSelectedStrategyEnabled
                      ? "Turn Off"
                      : "Turn On"}
                </button>
                <button
                  type="button"
                  className="action-button action-button--secondary"
                  onClick={refreshLiveTradingData}
                >
                  Refresh
                </button>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="panel-title">Order Book</p>
              </div>
              <ColumnPicker
                label="Order Book"
                columns={liveOrderColumns}
                selected={selectedLiveOrderColumns}
                onToggle={(columnId) =>
                  toggleColumn(
                    columnId,
                    selectedLiveOrderColumns,
                    setSelectedLiveOrderColumns,
                    liveOrderColumns,
                  )
                }
                onReset={() =>
                  setSelectedLiveOrderColumns(
                    liveOrderColumns.map((column) => column.id),
                  )
                }
              />
            </div>
            {liveOrders.length ? (
              <>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        {visibleLiveOrderColumns.map((column) => (
                          <th key={column.id}>{column.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {liveOrdersTable.rows.map((order) => (
                        <tr key={order.order_id}>
                          {visibleLiveOrderColumns.map((column) => {
                            if (column.id === "order_id")
                              return <td key={column.id}>{order.order_id}</td>;
                            if (column.id === "time")
                              return (
                                <td key={column.id}>
                                  {formatTableDateTime(
                                    order.order_timestamp ??
                                      order.exchange_timestamp,
                                  )}
                                </td>
                              );
                            if (column.id === "tradingsymbol")
                              return (
                                <td key={column.id}>{order.tradingsymbol}</td>
                              );
                            if (column.id === "side")
                              return (
                                <td key={column.id}>
                                  {formatSignal(order.transaction_type)}
                                </td>
                              );
                            if (column.id === "quantity")
                              return <td key={column.id}>{order.quantity}</td>;
                            if (column.id === "order_type")
                              return (
                                <td key={column.id}>{order.order_type}</td>
                              );
                            if (column.id === "status")
                              return <td key={column.id}>{order.status}</td>;
                            if (column.id === "average_price")
                              return (
                                <td key={column.id}>
                                  {formatCurrency(order.average_price)}
                                </td>
                              );
                            if (column.id === "actions")
                              return (
                                <td key={column.id}>
                                  <button
                                    type="button"
                                    className="table-action-button table-action-button--danger"
                                    disabled={
                                      !liveTradingStatus.enabled ||
                                      liveActionBusy ===
                                        `cancel-${order.order_id}`
                                    }
                                    onClick={() =>
                                      cancelLiveOrder(order.order_id)
                                    }
                                  >
                                    {liveActionBusy ===
                                    `cancel-${order.order_id}`
                                      ? "Cancelling..."
                                      : "Cancel"}
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
                <PaginationControls {...liveOrdersTable.pagination.controls} />
              </>
            ) : (
              <p className="empty-copy">No Zerodha orders available.</p>
            )}
          </section>

          <section className="content-grid">
            <article className="panel">
              <div className="panel-header">
                <div>
                  <p className="panel-title">Positions</p>
                </div>
              </div>
              {livePositionRows.length ? (
                <div className="table-wrap live-position-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Symbol</th>
                        <th>Product</th>
                        <th>Qty</th>
                        <th>Avg</th>
                        <th>LTP</th>
                        <th>PnL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {livePositionRows.map((position) => (
                        <tr
                          key={`${position.tradingsymbol}-${position.product}`}
                        >
                          <td>{position.tradingsymbol}</td>
                          <td>{position.product ?? "-"}</td>
                          <td>{formatCount(position.quantity ?? 0)}</td>
                          <td>{formatCurrency(position.average_price)}</td>
                          <td>{formatCurrency(position.last_price)}</td>
                          <td>
                            <PnlValue
                              value={position.pnl}
                              baseValue={Math.abs(
                                Number(position.average_price ?? 0) *
                                  Number(position.quantity ?? 0),
                              )}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="empty-copy">
                  No open Zerodha positions available.
                </p>
              )}
            </article>
            <article className="panel">
              <div className="panel-header">
                <div>
                  <p className="panel-title">Margins</p>
                </div>
              </div>
              <dl className="live-margin-grid">
                {liveMarginRows.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>
                      {value == null ? "Not available" : formatCurrency(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            </article>
          </section>
        </section>
      ) : activeView === "dhanLiveTrading" ? (
        <section className="section-block">
          <div className="section-heading">
            <p className="eyebrow">Dhan Live</p>
            <h2 className="section-title">Dhan NIFTY 5m execution</h2>
          </div>

          <section className="panel bot-command-card live-command-card">
            <div className="bot-command-card__top">
              <div>
                <p className="eyebrow">Broker execution</p>
                <h2>Dhan NIFTY 5m Bot</h2>
              </div>
              <span
                className={`setup-status__pill ${
                  dhanSelectedStrategyEnabled ? "setup-status__pill--saved" : ""
                }`}
              >
                {dhanSelectedStrategyEnabled ? "Live On" : "Live Off"}
              </span>
            </div>

            <div className="bot-command-card__main">
              <div className="bot-command-card__pnl">
                <span>Available Cash</span>
                <strong>
                  {dhanBalance.cash == null
                    ? "Not available"
                    : formatCurrency(dhanBalance.cash)}
                </strong>
                <small>
                  Withdrawable:{" "}
                  {dhanBalance.withdrawableBalance == null
                    ? "Not available"
                    : formatCurrency(dhanBalance.withdrawableBalance)}
                </small>
              </div>

              <dl className="bot-command-card__stats live-command-card__stats">
                <div>
                  <dt>Active Positions</dt>
                  <dd>{formatCount(dhanActivePositions.length)}</dd>
                </div>
                <div>
                  <dt>Dhan</dt>
                  <dd>{dhanLiveStatus.dhanReady ? "Ready" : "Not ready"}</dd>
                </div>
                <div>
                  <dt>Orders / Trades</dt>
                  <dd>
                    {formatCount(dhanOrders.length)} /{" "}
                    {formatCount(dhanTrades.length)}
                  </dd>
                </div>
                <div>
                  <dt>Contracts</dt>
                  <dd>{dhanSelectedContracts || "Not set"}</dd>
                </div>
                <div>
                  <dt>Target / SL</dt>
                  <dd>
                    {dhanSelectedSetup.targetPct ??
                      dhanSelectedForm.targetPct ??
                      "-"}
                    % /{" "}
                    {formatSnakeLabel(
                      dhanSelectedSetup.stopLossMode ??
                        dhanSelectedForm.stopLossMode ??
                        "signal_low",
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Last Action</dt>
                  <dd>
                    {formatSnakeLabel(dhanLiveStatus.lastAction ?? "none")}
                  </dd>
                </div>
                <div>
                  <dt>Broker Error</dt>
                  <dd>{dhanLiveTrading.error ?? "None"}</dd>
                </div>
              </dl>
            </div>

            <div
              className={`setup-status ${dhanSetupSavedToday ? "setup-status--saved" : "setup-status--missing"}`}
            >
              <div>
                <p className="setup-status__title">
                  {dhanSetupSavedToday
                    ? `Today's Dhan setup is saved`
                    : "Today's Dhan setup is not set"}
                </p>
                <p className="setup-status__copy">
                  {dhanSetupSavedToday
                    ? `Saved for ${dhanSelectedSetup.date ?? "today"}. Edit only when you want to change today's live setup.`
                    : "Dhan live trading will stay off until you save today's setup."}
                </p>
              </div>
              <span className="setup-status__pill">
                {dhanSetupSavedToday ? "Saved" : "Not set"}
              </span>
            </div>

            <dl className="bot-command-card__stats live-command-card__stats dhan-setup-summary">
              <div>
                <dt>Saved At</dt>
                <dd>{formatDateTime(dhanSetupSavedAt)}</dd>
              </div>
              <div>
                <dt>Option Side</dt>
                <dd>
                  {dhanSetupSavedToday
                    ? dhanSelectedContracts || "Not set"
                    : "Not set"}
                </dd>
              </div>
              <div>
                <dt>Window</dt>
                <dd>
                  {dhanSetupSavedToday
                    ? `${dhanSelectedSetup.scheduleStart ?? "-"} - ${
                        dhanSelectedSetup.scheduleEnd ?? "-"
                      }`
                    : "Not set"}
                </dd>
              </div>
              <div>
                <dt>Target</dt>
                <dd>
                  {dhanSetupSavedToday
                    ? `${dhanSelectedSetup.targetPct ?? "-"}%`
                    : "Not set"}
                </dd>
              </div>
              <div>
                <dt>Body Range</dt>
                <dd>
                  {dhanSetupSavedToday
                    ? `${dhanSelectedSetup.minSignalCandlePct ?? "-"}% - ${
                        dhanSelectedSetup.maxSignalCandlePct ?? "-"
                      }%`
                    : "Not set"}
                </dd>
              </div>
              <div>
                <dt>Strike Offset</dt>
                <dd>
                  {dhanSetupSavedToday
                    ? dhanSelectedSetup.strikeOffset ?? "-"
                    : "Not set"}
                </dd>
              </div>
              <div>
                <dt>Expiry</dt>
                <dd>
                  {dhanSetupSavedToday
                    ? EXPIRY_OFFSET_OPTIONS.find(
                        (option) =>
                          option.id ===
                          String(dhanSelectedSetup.expiryOffset ?? 0),
                      )?.label ?? "Nearest"
                    : "Not set"}
                </dd>
              </div>
              <div>
                <dt>SL Rule</dt>
                <dd>
                  {dhanSetupSavedToday
                    ? `${formatSnakeLabel(
                        dhanSelectedSetup.stopLossMode ?? "signal_low",
                      )}${
                        dhanSelectedSetup.stopLossPct
                          ? ` / ${dhanSelectedSetup.stopLossPct}%`
                          : ""
                      }`
                    : "Not set"}
                </dd>
              </div>
            </dl>

            <div className="setup-editor-toggle-row dhan-setup-toggle-row">
              <button
                type="button"
                className="action-button action-button--secondary"
                onClick={() =>
                  setSetupEditorOpen((current) => ({
                    ...current,
                    [dhanSetupStrategyKey]: !dhanSetupEditorOpen,
                  }))
                }
              >
                {dhanSetupEditorOpen
                  ? "Hide Update Section"
                  : dhanSetupSavedToday
                    ? "Edit Setup"
                    : "Add Setup"}
              </button>
            </div>

            {dhanSetupEditorOpen ? (
              <form
                className="backtest-form live-setup-form"
                onSubmit={(event) =>
                  saveStrategyContracts(event, dhanSetupStrategyKey)
                }
              >
              <label className="form-field segmented-field">
                Option Side
                <div className="segmented-toggle segmented-toggle--three">
                  {["PE", "CE", "BOTH"].map((side) => (
                    <button
                      key={side}
                      type="button"
                      className={`segmented-toggle__button ${
                        dhanSelectedSide === side
                          ? "segmented-toggle__button--active"
                          : ""
                      }`}
                      onClick={() => {
                        const nextContracts =
                          side === "BOTH"
                            ? ["PE", "CE"]
                            : [side, ""];
                        updateContractField(
                          dhanSetupStrategyKey,
                          "contract1",
                          nextContracts[0],
                        );
                        updateContractField(
                          dhanSetupStrategyKey,
                          "contract2",
                          nextContracts[1],
                        );
                      }}
                    >
                      {side === "BOTH" ? "Both" : side}
                    </button>
                  ))}
                </div>
              </label>
              <label className="form-field">
                Start Time
                <input
                  type="time"
                  value={dhanSelectedForm.scheduleStart}
                  onChange={(event) =>
                    updateContractField(
                      dhanSetupStrategyKey,
                      "scheduleStart",
                      event.target.value,
                    )
                  }
                />
              </label>
              <label className="form-field">
                End Time
                <input
                  type="time"
                  value={dhanSelectedForm.scheduleEnd}
                  onChange={(event) =>
                    updateContractField(
                      dhanSetupStrategyKey,
                      "scheduleEnd",
                      event.target.value,
                    )
                  }
                />
              </label>
              <label className="form-field">
                Target %
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={dhanSelectedForm.targetPct}
                  onChange={(event) =>
                    updateContractField(
                      dhanSetupStrategyKey,
                      "targetPct",
                      event.target.value,
                    )
                  }
                />
              </label>
              <label className="form-field">
                Max Body %
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={dhanSelectedForm.maxSignalCandlePct}
                  onChange={(event) =>
                    updateContractField(
                      dhanSetupStrategyKey,
                      "maxSignalCandlePct",
                      event.target.value,
                    )
                  }
                />
              </label>
              <label className="form-field">
                Min Body %
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={dhanSelectedForm.minSignalCandlePct}
                  onChange={(event) =>
                    updateContractField(
                      dhanSetupStrategyKey,
                      "minSignalCandlePct",
                      event.target.value,
                    )
                  }
                />
              </label>
              <label className="form-field">
                Strike Offset
                <input
                  type="number"
                  step="50"
                  value={dhanSelectedForm.strikeOffset}
                  onChange={(event) =>
                    updateContractField(
                      dhanSetupStrategyKey,
                      "strikeOffset",
                      event.target.value,
                    )
                  }
                />
              </label>
              <label className="form-field">
                Expiry
                <select
                  value={dhanSelectedForm.expiryOffset}
                  onChange={(event) =>
                    updateContractField(
                      dhanSetupStrategyKey,
                      "expiryOffset",
                      event.target.value,
                    )
                  }
                >
                  {EXPIRY_OFFSET_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                SL Mode
                <select
                  value={dhanSelectedForm.stopLossMode}
                  onChange={(event) =>
                    updateContractField(
                      dhanSetupStrategyKey,
                      "stopLossMode",
                      event.target.value,
                    )
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
                  value={dhanSelectedForm.stopLossPct}
                  onChange={(event) =>
                    updateContractField(
                      dhanSetupStrategyKey,
                      "stopLossPct",
                      event.target.value,
                    )
                  }
                />
              </label>
              <button
                type="submit"
                className="action-button"
                disabled={contractSaving}
              >
                {contractSaving ? "Saving..." : "Save Dhan Setup"}
              </button>
              </form>
            ) : null}

            <div className="bot-command-card__footer live-command-card__footer">
              <div className="bot-command-card__trade">
                <div className="bot-command-card__trade-line">
                  <span className="empty-state-icon" aria-hidden="true">
                    {dhanSetupSavedToday ? "OK" : "!"}
                  </span>
                  <strong>
                    {dhanSetupSavedToday
                      ? `Setup saved for ${dhanSelectedSetup.date ?? "today"}`
                      : "Daily setup is not saved yet"}
                  </strong>
                </div>
                <span className="muted-cell">
                  Last update: {formatDateTime(dhanLiveStatus.updatedAt)}
                </span>
              </div>
              <div className="action-row live-command-card__actions">
                <button
                  type="button"
                  className={`action-button ${
                    dhanSelectedStrategyEnabled
                      ? "action-button--sell"
                      : "action-button--buy"
                  }`}
                  onClick={() => toggleDhanLiveTrading(!dhanSelectedStrategyEnabled)}
                  disabled={liveActionBusy === "dhan-toggle"}
                >
                  {liveActionBusy === "dhan-toggle"
                    ? "Updating..."
                    : dhanSelectedStrategyEnabled
                      ? "Turn Off"
                      : "Turn On"}
                </button>
                <button
                  type="button"
                  className="action-button action-button--secondary"
                  onClick={refreshDhanLiveTradingData}
                  disabled={liveActionBusy === "dhan-refresh"}
                >
                  {liveActionBusy === "dhan-refresh"
                    ? "Refreshing..."
                    : "Refresh"}
                </button>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="panel-title">Manual Dhan Test Order</p>
              </div>
            </div>
            <form
              className="backtest-form live-setup-form"
              onSubmit={placeDhanManualEntry}
            >
              <label className="form-field segmented-field">
                Order Side
                <div className="segmented-toggle">
                  {["BUY", "SELL"].map((side) => (
                    <button
                      key={side}
                      type="button"
                      className={`segmented-toggle__button ${
                        dhanManualEntryForm.transactionType === side
                          ? "segmented-toggle__button--active"
                          : ""
                      }`}
                      onClick={() =>
                        updateDhanManualEntryField("transactionType", side)
                      }
                    >
                      {side}
                    </button>
                  ))}
                </div>
              </label>
              <label className="form-field segmented-field">
                Option
                <div className="segmented-toggle">
                  {["PE", "CE"].map((optionType) => (
                    <button
                      key={optionType}
                      type="button"
                      className={`segmented-toggle__button ${
                        dhanManualEntryForm.optionType === optionType
                          ? "segmented-toggle__button--active"
                          : ""
                      }`}
                      onClick={() =>
                        updateDhanManualEntryField("optionType", optionType)
                      }
                    >
                      {optionType}
                    </button>
                  ))}
                </div>
              </label>
              <label className="form-field">
                Strike
                <input
                  type="number"
                  min="0"
                  step="50"
                  placeholder="23550"
                  value={dhanManualEntryForm.strike}
                  onChange={(event) =>
                    updateDhanManualEntryField("strike", event.target.value)
                  }
                />
              </label>
              <label className="form-field">
                Quantity
                <input
                  type="number"
                  min={DHAN_NIFTY_LOT_SIZE}
                  step={DHAN_NIFTY_LOT_SIZE}
                  value={dhanManualEntryForm.quantity}
                  onChange={(event) =>
                    updateDhanManualEntryField("quantity", event.target.value)
                  }
                />
              </label>
              <label className="form-field">
                Expiry Optional (blank = nearest)
                <input
                  type="date"
                  value={dhanManualEntryForm.expiry}
                  onChange={(event) =>
                    updateDhanManualEntryField("expiry", event.target.value)
                  }
                />
              </label>
              <button
                type="submit"
                className="action-button action-button--buy"
                disabled={
                  !dhanSelectedStrategyEnabled ||
                  liveActionBusy === "dhan-manual-entry"
                }
              >
                {liveActionBusy === "dhan-manual-entry"
                  ? "Placing..."
                  : "Place Manual Entry"}
              </button>
            </form>
            <p className="panel-note">
              This places a real Dhan market order. Use the Active Dhan
              Positions table below to exit the position manually.
            </p>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="panel-title">Active Dhan Positions</p>
              </div>
            </div>
            {dhanActivePositions.length ? (
              <div className="table-wrap live-position-table">
                <table>
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Segment</th>
                      <th>Qty</th>
                      <th>Avg</th>
                      <th>LTP</th>
                      <th>PnL</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dhanActivePositions.map((position) => {
                      const securityId =
                        position.securityId ?? position.security_id;
                      const quantity = Number(
                        position.netQuantity ??
                          position.netQty ??
                          position.quantity ??
                          0,
                      );
                      return (
                        <tr key={`${securityId}-${position.tradingSymbol}`}>
                          <td>
                            {position.tradingSymbol ??
                              position.tradingsymbol ??
                              "-"}
                          </td>
                          <td>{position.exchangeSegment ?? "-"}</td>
                          <td>{formatCount(quantity)}</td>
                          <td>
                            {formatCurrency(
                              position.buyAvg ??
                                position.averagePrice ??
                                position.costPrice,
                            )}
                          </td>
                          <td>
                            {formatCurrency(
                              position.lastTradedPrice ?? position.ltp,
                            )}
                          </td>
                          <td>
                            <PnlValue
                              value={
                                position.unrealizedProfit ??
                                position.unrealisedProfit ??
                                position.pnl ??
                                position.realizedProfit
                              }
                            />
                          </td>
                          <td>
                            <button
                              type="button"
                              className="table-action-button table-action-button--danger"
                              disabled={
                                !dhanSelectedStrategyEnabled ||
                                liveActionBusy === `dhan-exit-${securityId}`
                              }
                              onClick={() => exitDhanPosition(position)}
                            >
                              {liveActionBusy === `dhan-exit-${securityId}`
                                ? "Exiting..."
                                : "Exit"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty-copy">No active Dhan positions available.</p>
            )}
          </section>
        </section>
      ) : activeView === "broker" ? (
        <section className="section-block">
          <div className="section-heading">
            <p className="eyebrow">Broker</p>
            <h2 className="section-title">Broker connections</h2>
          </div>

          <section className="content-grid">
            <article className="panel">
              <div className="panel-header">
                <div>
                  <p className="panel-title">Zerodha Connection</p>
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
              </dl>
            </article>

            <article className="panel">
              <div className="panel-header">
                <div>
                  <p className="panel-title">Dhan Connection</p>
                </div>
              </div>

              <div className="action-row">
                <button
                  type="button"
                  className="action-button"
                  onClick={() => cacheDhanInstrumentMaster(false)}
                  disabled={dhanMasterBusy}
                >
                  {dhanMasterBusy ? "Caching..." : "Cache Instrument Master"}
                </button>
                <button
                  type="button"
                  className="action-button action-button--secondary"
                  onClick={() => cacheDhanInstrumentMaster(true)}
                  disabled={dhanMasterBusy}
                >
                  Refresh Master
                </button>
              </div>

              <dl className="status-list">
                <div>
                  <dt>Client ID</dt>
                  <dd>{dhan.clientIdConfigured ? "Configured" : "Missing"}</dd>
                </div>
                <div>
                  <dt>Access Token</dt>
                  <dd>
                    {dhan.accessTokenConfigured ? "Configured" : "Missing"}
                  </dd>
                </div>
                <div>
                  <dt>Live Status</dt>
                  <dd>{dhanLiveStatus.dhanReady ? "Ready" : "Not ready"}</dd>
                </div>
                <div>
                  <dt>Instrument Master</dt>
                  <dd>
                    {dhanInstrumentMaster.cached
                      ? `${formatCount(dhanInstrumentMaster.filteredRows ?? dhanInstrumentMaster.rows ?? 0)} NIFTY option rows cached`
                      : "Not cached today"}
                  </dd>
                </div>
                <div>
                  <dt>Source Rows</dt>
                  <dd>
                    {dhanInstrumentMaster.sourceRows == null
                      ? "-"
                      : formatCount(dhanInstrumentMaster.sourceRows)}
                  </dd>
                </div>
                <div>
                  <dt>Cached At</dt>
                  <dd>{formatDateTime(dhanInstrumentMaster.updatedAt)}</dd>
                </div>
                <div>
                  <dt>Cache File</dt>
                  <dd>{dhanInstrumentMaster.path ?? "Not available"}</dd>
                </div>
              </dl>
            </article>

            <article className="panel">
              <div className="panel-header">
                <div>
                  <p className="panel-title">Runtime Settings</p>
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

            <article className="panel">
              <div className="panel-header">
                <div>
                  <p className="panel-title">Option Candle Storage</p>
                </div>
              </div>

              <p className="panel-copy">
                Run this manually after market close, ideally around 17:00, to
                save today's NIFTY and SENSEX option candles for backtesting.
              </p>

              <div className="action-row">
                <button
                  type="button"
                  className="action-button"
                  onClick={() => runOptionCandleStorage("ALL")}
                  disabled={candleStorageBusy}
                >
                  {candleStorageBusy ? "Storing..." : "Store Today Candles"}
                </button>
              </div>

              <dl className="status-list">
                <div>
                  <dt>Mode</dt>
                  <dd>Manual only</dd>
                </div>
                <div>
                  <dt>Recommended Time</dt>
                  <dd>17:00</dd>
                </div>
                <div>
                  <dt>Last Result</dt>
                  <dd>
                    {candleStorageResult
                      ? `${formatCount(candleStorageResult.totalCandles ?? 0)} candles`
                      : "Not run this session"}
                  </dd>
                </div>
                <div>
                  <dt>Contracts</dt>
                  <dd>
                    {candleStorageResult
                      ? formatCount(candleStorageResult.totalContracts ?? 0)
                      : "-"}
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
            aria-label="Reports strategy filter"
          >
            {STRATEGY_FILTER_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`range-chip ${reportStrategyFilter === option.id ? "range-chip--active" : ""}`}
                onClick={() => setReportStrategyFilter(option.id)}
              >
                {option.label}
              </button>
            ))}
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

          <section className="panel bot-command-card report-command-card">
            <div className="bot-command-card__top">
              <div>
                <p className="eyebrow">Performance Snapshot</p>
                <h2>{selectedReportFilterMeta.label}</h2>
                <p className="bot-command-card__subtitle">
                  {selectedRangeMeta.label} trading performance across closed paper trades.
                </p>
              </div>
              <span
                className={`setup-status__pill ${
                  reportMetrics.totalPnl >= 0 ? "setup-status__pill--saved" : ""
                }`}
              >
                {reportMetrics.totalTrades
                  ? `${formatCount(reportWinCount)}W / ${formatCount(reportLossCount)}L`
                  : "No Trades"}
              </span>
            </div>

            <div className="bot-command-card__main">
              <div className="bot-command-card__pnl">
                <span>Net PnL</span>
                <strong>
                  <PnlValue value={reportMetrics.totalPnl} />
                </strong>
                <small>
                  {formatCount(reportMetrics.totalTrades)} trades ·{" "}
                  {formatPercent(reportMetrics.winRate)} win rate
                </small>
              </div>

              <dl className="bot-command-card__stats report-command-card__stats">
                <div>
                  <dt>Trades</dt>
                  <dd>{formatCount(reportMetrics.totalTrades)}</dd>
                </div>
                <div>
                  <dt>Win Rate</dt>
                  <dd>{formatPercent(reportMetrics.winRate)}</dd>
                </div>
                <div>
                  <dt>Profit Factor</dt>
                  <dd>{formatRatio(reportMetrics.profitFactor)}</dd>
                </div>
                <div>
                  <dt>Expectancy</dt>
                  <dd>
                    <PnlValue value={reportMetrics.expectancy} />
                  </dd>
                </div>
                <div>
                  <dt>Avg Win</dt>
                  <dd>
                    <PnlValue value={reportMetrics.averageWin} />
                  </dd>
                </div>
                <div>
                  <dt>Avg Loss</dt>
                  <dd>
                    <PnlValue value={-reportMetrics.averageLoss} />
                  </dd>
                </div>
                <div>
                  <dt>Best Trade</dt>
                  <dd>
                    <PnlValue value={reportMetrics.bestTrade} />
                  </dd>
                </div>
                <div>
                  <dt>Worst Trade</dt>
                  <dd>
                    <PnlValue value={reportMetrics.worstTrade} />
                  </dd>
                </div>
              </dl>
            </div>

            <div className="bot-command-card__footer report-command-card__footer">
              <div className="bot-command-card__trade">
                <div className="bot-command-card__trade-line">
                  <span className="empty-state-icon" aria-hidden="true">
                    R
                  </span>
                  <strong>
                    {selectedRangeMeta.label} · {selectedReportFilterMeta.label}
                  </strong>
                </div>
                <span className="muted-cell">
                  Report uses closed trades only, grouped by exit time.
                </span>
              </div>
              <dl className="report-command-card__mini">
                <div>
                  <dt>Wins</dt>
                  <dd>{formatCount(reportWinCount)}</dd>
                </div>
                <div>
                  <dt>Losses</dt>
                  <dd>{formatCount(reportLossCount)}</dd>
                </div>
              </dl>
            </div>
          </section>

          <section className="panel pnl-report-panel">
            <div className="panel-header">
              <div>
                <p className="panel-title">Hourly PnL Report</p>
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
              </div>
            </div>
            <WeekdayPnlReport buckets={weekdayPnlReport} />
          </section>

          <section className="panel pnl-report-panel">
            <div className="panel-header">
              <div>
                <p className="panel-title">CE / PE Trade Details</p>
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
                  min="65"
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
                <div
                  className="segmented-toggle"
                  role="group"
                  aria-label="Stop loss rule"
                >
                  {BACKTEST_STOP_LOSS_MODES.map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      className={`segmented-toggle__button ${
                        backtestForm.stopLossMode === mode.id
                          ? "segmented-toggle__button--active"
                          : ""
                      }`}
                      onClick={() =>
                        updateBacktestField("stopLossMode", mode.id)
                      }
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
              <div className="form-field segmented-field">
                <span>Cap Signal Low</span>
                <div
                  className={`segmented-toggle ${
                    backtestForm.stopLossMode === "percent"
                      ? "segmented-toggle--disabled"
                      : ""
                  }`}
                  role="group"
                  aria-label="Cap signal low"
                >
                  <button
                    type="button"
                    disabled={backtestForm.stopLossMode === "percent"}
                    className={`segmented-toggle__button ${
                      !backtestForm.capStopLoss
                        ? "segmented-toggle__button--active"
                        : ""
                    }`}
                    onClick={() => updateBacktestField("capStopLoss", false)}
                  >
                    Off
                  </button>
                  <button
                    type="button"
                    disabled={backtestForm.stopLossMode === "percent"}
                    className={`segmented-toggle__button ${
                      backtestForm.capStopLoss
                        ? "segmented-toggle__button--active"
                        : ""
                    }`}
                    onClick={() => updateBacktestField("capStopLoss", true)}
                  >
                    On
                  </button>
                </div>
              </div>
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
                  value={
                    backtestResult.data?.instrumentLabel ?? "Not available"
                  }
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
                  value={formatSnakeLabel(
                    backtestResult.data?.signalDataSource,
                  )}
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
                  </div>
                </div>
                <WeekdayPnlReport buckets={backtestWeekdayPnlReport} />
              </section>

              <section className="panel">
                <div className="panel-header">
                  <div>
                    <p className="panel-title">Backtest Trades</p>
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
                  <ColumnPicker
                    label="Backtest Trades"
                    columns={backtestTradeColumns}
                    selected={selectedBacktestTradeColumns}
                    onToggle={(columnId) =>
                      toggleColumn(
                        columnId,
                        selectedBacktestTradeColumns,
                        setSelectedBacktestTradeColumns,
                        backtestTradeColumns,
                      )
                    }
                    onReset={() =>
                      setSelectedBacktestTradeColumns(
                        backtestTradeColumns.map((column) => column.id),
                      )
                    }
                  />
                </div>
                {backtestResult.trades?.length ? (
                  <>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            {visibleBacktestTradeColumns.map((column) => (
                              <th key={column.id}>{column.label}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {backtestTradesTable.rows.map((trade) => (
                            <tr
                              key={`${trade.entryTime}-${trade.signal}-${trade.strike}`}
                            >
                              {visibleBacktestTradeColumns.map((column) => {
                                if (column.id === "signal")
                                  return (
                                    <td key={column.id}>
                                      {formatSignal(trade.signal)}
                                    </td>
                                  );
                                if (column.id === "signalMode")
                                  return (
                                    <td key={column.id}>
                                      {formatSnakeLabel(trade.signalMode)}
                                    </td>
                                  );
                                if (column.id === "entryTime")
                                  return (
                                    <td key={column.id}>
                                      {formatTableDateTime(trade.entryTime)}
                                    </td>
                                  );
                                if (column.id === "entryTiming")
                                  return (
                                    <td key={column.id}>
                                      {formatSnakeLabel(trade.entryTiming)}
                                    </td>
                                  );
                                if (column.id === "exitTime")
                                  return (
                                    <td key={column.id}>
                                      {formatTableDateTime(trade.exitTime)}
                                    </td>
                                  );
                                if (column.id === "instrument")
                                  return (
                                    <td key={column.id}>
                                      {trade.instrument ??
                                        backtestResult.data?.instrument}
                                    </td>
                                  );
                                if (column.id === "strike")
                                  return (
                                    <td key={column.id}>
                                      {trade.strike} {trade.optionType}
                                    </td>
                                  );
                                if (column.id === "quantity")
                                  return (
                                    <td key={column.id}>{trade.quantity}</td>
                                  );
                                if (column.id === "baseEntryPrice")
                                  return (
                                    <td key={column.id}>
                                      {formatCurrency(
                                        trade.baseEntryPrice ??
                                          trade.entryPrice,
                                      )}
                                    </td>
                                  );
                                if (column.id === "entryPrice")
                                  return (
                                    <td key={column.id}>
                                      {formatCurrency(trade.entryPrice)}
                                    </td>
                                  );
                                if (column.id === "baseExitPrice")
                                  return (
                                    <td key={column.id}>
                                      {formatCurrency(
                                        trade.baseExitPrice ?? trade.exitPrice,
                                      )}
                                    </td>
                                  );
                                if (column.id === "exitPrice")
                                  return (
                                    <td key={column.id}>
                                      {formatCurrency(trade.exitPrice)}
                                    </td>
                                  );
                                if (column.id === "stopLoss")
                                  return (
                                    <td key={column.id}>
                                      {formatCurrency(trade.stopLoss)}
                                    </td>
                                  );
                                if (column.id === "stopLossRule")
                                  return (
                                    <td key={column.id}>
                                      {trade.stopLossMode === "percent"
                                        ? "SL %"
                                        : formatStopLossSource(
                                            trade.stopLossSource,
                                          )}
                                    </td>
                                  );
                                if (column.id === "target")
                                  return (
                                    <td key={column.id}>
                                      {formatCurrency(trade.target)}
                                    </td>
                                  );
                                if (column.id === "netPnl")
                                  return (
                                    <td key={column.id}>
                                      <PnlValue
                                        value={trade.netPnl}
                                        baseValue={trade.capitalUsed}
                                      />
                                    </td>
                                  );
                                if (column.id === "status")
                                  return (
                                    <td key={column.id}>{trade.status}</td>
                                  );
                                if (column.id === "exitReason")
                                  return (
                                    <td key={column.id}>
                                      {formatSnakeLabel(trade.exitReason)}
                                    </td>
                                  );
                                if (column.id === "executionSource")
                                  return (
                                    <td key={column.id}>
                                      {formatSnakeLabel(trade.executionSource)}
                                    </td>
                                  );
                                return <td key={column.id}>-</td>;
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <PaginationControls
                      {...backtestTradesTable.pagination.controls}
                    />
                  </>
                ) : (
                  <p className="empty-copy">
                    No backtest trades were generated for this configuration.
                  </p>
                )}
              </section>
            </>
          ) : null}
        </section>
      ) : activeView === "niftyFiveMinuteBacktest" ? (
        <section className="section-block">
          <div className="section-heading">
            <p className="eyebrow">5m Option Backtesting</p>
            <h2 className="section-title">BUY-only Supertrend option test</h2>
          </div>

          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="panel-title">Backtest Strategy</p>
              </div>
            </div>

            <form
              className="backtest-form"
              onSubmit={runNiftyFiveMinuteBacktest}
            >
              <div className="form-field segmented-field">
                <span>Instrument</span>
                <div
                  className="segmented-toggle"
                  role="group"
                  aria-label="5m backtest instrument"
                >
                  {BACKTEST_INSTRUMENT_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`segmented-toggle__button ${
                        niftyFiveMinuteBacktestForm.instrument === option.id
                          ? "segmented-toggle__button--active"
                          : ""
                      }`}
                      onClick={() =>
                        updateNiftyFiveMinuteBacktestField(
                          "instrument",
                          option.id,
                        )
                      }
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-field segmented-field">
                <span>Contract Mode</span>
                <div
                  className="segmented-toggle"
                  role="group"
                  aria-label="5m contract mode"
                >
                  {[
                    { id: "fixed", label: "Fixed" },
                    { id: "dynamic", label: "Dynamic" },
                  ].map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`segmented-toggle__button ${
                        niftyFiveMinuteBacktestForm.mode === option.id
                          ? "segmented-toggle__button--active"
                          : ""
                      }`}
                      onClick={() =>
                        updateNiftyFiveMinuteBacktestField("mode", option.id)
                      }
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {niftyFiveMinuteBacktestForm.mode === "fixed" ? (
                <>
                  <label className="form-field">
                    <span>Contract 1</span>
                    <input
                      type="text"
                      value={niftyFiveMinuteBacktestForm.contract1}
                      placeholder={
                        niftyFiveMinuteBacktestForm.instrument === "SENSEX"
                          ? "76000PE"
                          : niftyFiveMinuteBacktestForm.instrument === "BANKNIFTY"
                            ? "56000PE"
                          : "24000PE"
                      }
                      onChange={(event) =>
                        updateNiftyFiveMinuteBacktestField(
                          "contract1",
                          event.target.value,
                        )
                      }
                      required
                    />
                  </label>
                  <label className="form-field">
                    <span>Contract 2 (optional)</span>
                    <input
                      type="text"
                      value={niftyFiveMinuteBacktestForm.contract2}
                      placeholder={
                        niftyFiveMinuteBacktestForm.instrument === "SENSEX"
                          ? "76200CE"
                          : niftyFiveMinuteBacktestForm.instrument === "BANKNIFTY"
                            ? "56200CE"
                          : "24300CE"
                      }
                      onChange={(event) =>
                        updateNiftyFiveMinuteBacktestField(
                          "contract2",
                          event.target.value,
                        )
                      }
                    />
                  </label>
                </>
              ) : (
                <>
                  <div className="form-field segmented-field">
                    <span>Contract Side</span>
                    <div
                      className="segmented-toggle segmented-toggle--three"
                      role="group"
                      aria-label="5m contract side"
                    >
                      {["PE", "CE", "BOTH"].map((side) => (
                        <button
                          key={side}
                          type="button"
                          className={`segmented-toggle__button ${
                            niftyFiveMinuteBacktestForm.contractSide === side
                              ? "segmented-toggle__button--active"
                              : ""
                          }`}
                          onClick={() =>
                            updateNiftyFiveMinuteBacktestField(
                              "contractSide",
                              side,
                            )
                          }
                        >
                          {side === "BOTH" ? "Both" : side}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="form-field">
                    <span>Strike Offset</span>
                    <input
                      type="number"
                      step={
                        niftyFiveMinuteBacktestForm.instrument === "SENSEX" ||
                        niftyFiveMinuteBacktestForm.instrument === "BANKNIFTY"
                          ? "100"
                          : "50"
                      }
                      value={niftyFiveMinuteBacktestForm.strikeOffset}
                      placeholder="0, 100, -100"
                      onChange={(event) =>
                        updateNiftyFiveMinuteBacktestField(
                          "strikeOffset",
                          event.target.value,
                        )
                      }
                    />
                  </label>
                </>
              )}

              <label className="form-field">
                <span>Expiry</span>
                <select
                  value={niftyFiveMinuteBacktestForm.expiryOffset}
                  onChange={(event) =>
                    updateNiftyFiveMinuteBacktestField(
                      "expiryOffset",
                      event.target.value,
                    )
                  }
                >
                  {EXPIRY_OFFSET_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="form-field">
                <span>Entry Day</span>
                <input
                  type="date"
                  value={niftyFiveMinuteBacktestForm.startDate}
                  onChange={(event) =>
                    updateNiftyFiveMinuteBacktestField(
                      "startDate",
                      event.target.value,
                    )
                  }
                  required
                />
              </label>
              <label className="form-field">
                <span>Exit Day</span>
                <input
                  type="date"
                  value={niftyFiveMinuteBacktestForm.endDate}
                  onChange={(event) =>
                    updateNiftyFiveMinuteBacktestField(
                      "endDate",
                      event.target.value,
                    )
                  }
                  required
                />
              </label>
              <label className="form-field">
                <span>Balance</span>
                <input
                  type="number"
                  min="1"
                  value={niftyFiveMinuteBacktestForm.balance}
                  onChange={(event) =>
                    updateNiftyFiveMinuteBacktestField(
                      "balance",
                      event.target.value,
                    )
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
                  value={niftyFiveMinuteBacktestForm.targetPct}
                  onChange={(event) =>
                    updateNiftyFiveMinuteBacktestField(
                      "targetPct",
                      event.target.value,
                    )
                  }
                  required
                />
              </label>
              <label className="form-field">
                <span>Max Body %</span>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={niftyFiveMinuteBacktestForm.maxBodyPct}
                  onChange={(event) =>
                    updateNiftyFiveMinuteBacktestField(
                      "maxBodyPct",
                      event.target.value,
                    )
                  }
                  required
                />
              </label>
              <label className="form-field">
                <span>Min Body %</span>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={niftyFiveMinuteBacktestForm.minBodyPct}
                  onChange={(event) =>
                    updateNiftyFiveMinuteBacktestField(
                      "minBodyPct",
                      event.target.value,
                    )
                  }
                  required
                />
              </label>
              <label className="form-field">
                <span>Stop Loss %</span>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={niftyFiveMinuteBacktestForm.stopLossPct}
                  onChange={(event) =>
                    updateNiftyFiveMinuteBacktestField(
                      "stopLossPct",
                      event.target.value,
                    )
                  }
                />
              </label>
              <label className="form-field">
                <span>Entry Time</span>
                <input
                  type="time"
                  value={niftyFiveMinuteBacktestForm.entryTime}
                  onChange={(event) =>
                    updateNiftyFiveMinuteBacktestField(
                      "entryTime",
                      event.target.value,
                    )
                  }
                  required
                />
              </label>
              <label className="form-field">
                <span>Exit Time</span>
                <input
                  type="time"
                  value={niftyFiveMinuteBacktestForm.exitTime}
                  onChange={(event) =>
                    updateNiftyFiveMinuteBacktestField(
                      "exitTime",
                      event.target.value,
                    )
                  }
                  required
                />
              </label>
              <details className="advanced-backtest-fields">
                <summary>Advanced filters</summary>
                <label className="toggle-control">
                  <input
                    type="checkbox"
                    checked={niftyFiveMinuteBacktestForm.requireVwap}
                    onChange={(event) =>
                      updateNiftyFiveMinuteBacktestField(
                        "requireVwap",
                        event.target.checked,
                      )
                    }
                  />
                  <span>Close below VWAP</span>
                </label>
                <label className="form-field">
                  <span>Volume Multiplier</span>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={niftyFiveMinuteBacktestForm.minVolumeMultiplier}
                    placeholder="0 disables"
                    onChange={(event) =>
                      updateNiftyFiveMinuteBacktestField(
                        "minVolumeMultiplier",
                        event.target.value,
                      )
                    }
                  />
                </label>
                <label className="form-field">
                  <span>Volume Lookback</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={niftyFiveMinuteBacktestForm.volumeLookback}
                    onChange={(event) =>
                      updateNiftyFiveMinuteBacktestField(
                        "volumeLookback",
                        event.target.value,
                      )
                    }
                  />
                </label>
                <label className="form-field">
                  <span>Max Entry Gap %</span>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={niftyFiveMinuteBacktestForm.maxEntryGapPct}
                    placeholder="0 disables"
                    onChange={(event) =>
                      updateNiftyFiveMinuteBacktestField(
                        "maxEntryGapPct",
                        event.target.value,
                      )
                    }
                  />
                </label>
                <label className="form-field">
                  <span>Trailing SL %</span>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={niftyFiveMinuteBacktestForm.trailingStopPct}
                    placeholder="0 disables"
                    onChange={(event) =>
                      updateNiftyFiveMinuteBacktestField(
                        "trailingStopPct",
                        event.target.value,
                      )
                    }
                  />
                </label>
                <label className="form-field">
                  <span>Max Trades / Day</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={niftyFiveMinuteBacktestForm.maxTradesPerDay}
                    placeholder="0 disables"
                    onChange={(event) =>
                      updateNiftyFiveMinuteBacktestField(
                        "maxTradesPerDay",
                        event.target.value,
                      )
                    }
                  />
                </label>
              </details>
              <button
                type="submit"
                className="action-button action-button--buy"
                disabled={niftyFiveMinuteBacktestLoading}
              >
                {niftyFiveMinuteBacktestLoading
                  ? "Running..."
                  : `Run ${niftyFiveMinuteBacktestForm.instrument} 5m Backtest`}
              </button>
            </form>
          </section>

          {niftyFiveMinuteBacktestResult ? (
            <>
              <section className="report-metrics-grid option-backtest-metrics">
                <MetricCard
                  label="Net PnL"
                  value={
                    <PnlValue
                      value={niftyFiveMinuteBacktestResult.summary?.netPnl ?? 0}
                    />
                  }
                  tone={getPnlTone(
                    niftyFiveMinuteBacktestResult.summary?.netPnl ?? 0,
                  )}
                />
                <MetricCard
                  label="Trades"
                  value={formatCount(
                    niftyFiveMinuteBacktestResult.summary?.tradeCount,
                  )}
                />
                <MetricCard
                  label="Wins / Losses"
                  value={`${formatCount(niftyFiveMinuteBacktestResult.summary?.wins)} / ${formatCount(niftyFiveMinuteBacktestResult.summary?.losses)}`}
                />
                <MetricCard
                  label="Win Rate"
                  value={formatPercent(
                    niftyFiveMinuteBacktestResult.summary?.winRate,
                  )}
                />
                <MetricCard
                  label="Profit Factor"
                  value={formatRatio(
                    niftyFiveMinuteBacktestResult.summary?.profitFactor,
                  )}
                />
                <MetricCard
                  label="Avg Trade"
                  value={
                    <PnlValue
                      value={
                        niftyFiveMinuteBacktestResult.summary?.expectancy ?? 0
                      }
                    />
                  }
                  tone={getPnlTone(
                    niftyFiveMinuteBacktestResult.summary?.expectancy ?? 0,
                  )}
                />
                <MetricCard
                  label="Best / Worst"
                  value={`${formatCurrency(niftyFiveMinuteBacktestResult.summary?.bestTrade ?? 0)} / ${formatCurrency(niftyFiveMinuteBacktestResult.summary?.worstTrade ?? 0)}`}
                />
                <MetricCard
                  label="Signal → Trade"
                  value={`${formatCount(niftyFiveMinuteRawBuySignals)} → ${formatCount(niftyFiveMinuteExecutedTrades)}`}
                />
                <MetricCard
                  label="Trade Conversion"
                  value={formatPercent(niftyFiveMinuteTradeConversion)}
                />
                <MetricCard
                  label="Body Pass Rate"
                  value={formatPercent(niftyFiveMinuteBodyPassRate)}
                />
                <MetricCard
                  label="Green No Arrow"
                  value={formatCount(
                    niftyFiveMinuteBacktestResult.data
                      ?.greenStateButNoFreshSignalCount,
                  )}
                />
                <MetricCard
                  label="Candles Scanned"
                  value={formatCount(
                    niftyFiveMinuteBacktestResult.data?.candleCount,
                  )}
                />
                <MetricCard
                  label="Both Green Candles"
                  value={formatCount(
                    niftyFiveMinuteBacktestResult.data?.bothGreenCandleCount,
                  )}
                />
                <MetricCard
                  label="Accepted Signals"
                  value={formatCount(
                    niftyFiveMinuteBacktestResult.data?.bodyAcceptedSignalCount,
                  )}
                />
                <MetricCard
                  label="Body Rejected"
                  value={formatCount(
                    niftyFiveMinuteBacktestResult.data?.bodyRejectedSignalCount,
                  )}
                />
                <MetricCard
                  label="Skipped"
                  value={formatCount(
                    niftyFiveMinuteBacktestResult.data?.skippedCount,
                  )}
                />
                <MetricCard
                  label="Top Skip Reason"
                  value={
                    niftyFiveMinuteTopSkipReason
                      ? `${formatSnakeLabel(niftyFiveMinuteTopSkipReason[0])} (${formatCount(niftyFiveMinuteTopSkipReason[1])})`
                      : "None"
                  }
                />
                <MetricCard
                  label="Advanced Filters"
                  value={
                    niftyFiveMinuteActiveAdvancedFilters.length
                      ? niftyFiveMinuteActiveAdvancedFilters.join(" / ")
                      : "Off"
                  }
                />
              </section>

              <section className="panel pnl-report-panel">
                <div className="panel-header">
                  <div>
                    <p className="panel-title">
                      {niftyFiveMinuteBacktestResult.data?.underlying ?? "Option"}{" "}
                      5m Hourly PnL Report
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
                  buckets={niftyFiveMinuteHourlyPnlReport}
                  showPnl={showHourlyPnl}
                />
              </section>

              <section className="panel pnl-report-panel">
                <div className="panel-header">
                  <div>
                    <p className="panel-title">
                      {niftyFiveMinuteBacktestResult.data?.underlying ?? "Option"}{" "}
                      5m Weekday PnL Report
                    </p>
                  </div>
                </div>
                <WeekdayPnlReport buckets={niftyFiveMinuteWeekdayPnlReport} />
              </section>

              {Object.keys(
                niftyFiveMinuteBacktestResult.data?.skippedReasonCounts ?? {},
              ).length ? (
                <section className="panel">
                  <div className="panel-header">
                    <div>
                      <p className="panel-title">NIFTY 5m Filter Summary</p>
                    </div>
                  </div>
                  <div className="summary-card-grid compact-summary-grid">
                    {Object.entries(
                      niftyFiveMinuteBacktestResult.data
                        ?.skippedReasonCounts ?? {},
                    ).map(([reason, count]) => (
                      <div className="summary-chip" key={reason}>
                        <span>{formatSnakeLabel(reason)}</span>
                        <strong>{formatCount(count)}</strong>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="panel">
                <div className="panel-header">
                  <div>
                    <p className="panel-title">
                      {niftyFiveMinuteBacktestResult.data?.underlying ?? "Option"}{" "}
                      5m Backtest Trades
                    </p>
                  </div>
                  <button
                    type="button"
                    className="action-button action-button--secondary"
                    onClick={exportNiftyFiveMinuteBacktestTradesCsv}
                    disabled={!niftyFiveMinuteBacktestTrades.length}
                  >
                    Download CSV
                  </button>
                </div>
                <div className="action-row action-row--wrap">
                  <label className="form-field form-field--inline">
                    <span>Target group</span>
                    <select
                      value={selectedBacktestGroupId}
                      onChange={(event) => {
                        setSelectedBacktestGroupId(event.target.value);
                        setBacktestGroupAddFeedback(null);
                      }}
                    >
                      <option value="">Select group</option>
                      {backtestGroups.map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="action-button action-button--ghost"
                    onClick={() =>
                      addTradesToBacktestGroup(niftyFiveMinuteBacktestTrades)
                    }
                    disabled={
                      !niftyFiveMinuteBacktestTrades.length ||
                      !selectedBacktestGroupId ||
                      allBacktestTradesAddedToSelectedGroup
                    }
                  >
                    {allBacktestTradesAddedToSelectedGroup
                      ? "All Added"
                      : backtestGroupAddFeedback?.key === "all"
                        ? "Added"
                        : "Add All To Group"}
                  </button>
                </div>
                {backtestGroupAddFeedback ? (
                  <div
                    className={`group-add-feedback group-add-feedback--${backtestGroupAddFeedback.status}`}
                  >
                    {backtestGroupAddFeedback.message}
                  </div>
                ) : null}
                {niftyFiveMinuteBacktestTrades.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Contract</th>
                          <th>Signal Candle</th>
                          <th>Entry</th>
                          <th>Exit</th>
                          <th>Entry / Exit</th>
                          <th>SL / Target</th>
                          <th>Body %</th>
                          <th>PnL</th>
                          <th>Result</th>
                          <th>Group</th>
                        </tr>
                      </thead>
                      <tbody>
                        {niftyFiveMinuteBacktestTrades.map((trade) => {
                          const tradeId = buildBacktestTradeId(trade);
                          const isTradeAlreadyAdded =
                            selectedBacktestGroupTradeIds.has(tradeId);
                          return (
                          <tr key={`${trade.optionSymbol}-${trade.entryTime}`}>
                            <td>{formatCompactOptionSymbol(trade.optionSymbol)}</td>
                            <td>{formatTableDateTime(trade.candleTime)}</td>
                            <td>{formatTableDateTime(trade.entryTime)}</td>
                            <td>{formatTableDateTime(trade.exitTime)}</td>
                            <td>
                              {formatCurrency(trade.entryPrice)} /{" "}
                              {formatCurrency(trade.exitPrice)}
                            </td>
                            <td>
                              {formatCurrency(trade.stopLoss)} /{" "}
                              {formatCurrency(trade.target)}
                              {trade.stopLossSource ? (
                                <span className="muted-inline">
                                  {" "}
                                  ({formatSnakeLabel(trade.stopLossSource)})
                                </span>
                              ) : null}
                            </td>
                            <td>{formatNumber(trade.signalCandleBodyPct)}%</td>
                            <td>
                              <PnlValue
                                value={trade.netPnl}
                                baseValue={trade.capitalUsed}
                              />
                            </td>
                            <td>
                              <span
                                className={`status-pill status-pill--${getStatusTone(trade.status)}`}
                              >
                                {trade.status} · {formatSnakeLabel(trade.exitReason)}
                              </span>
                            </td>
                            <td>
                              <button
                                type="button"
                                className={`field-mini-button ${
                                  isTradeAlreadyAdded
                                    ? "field-mini-button--success"
                                    : ""
                                }`}
                                onClick={() => addTradesToBacktestGroup([trade])}
                                disabled={!selectedBacktestGroupId || isTradeAlreadyAdded}
                              >
                                {isTradeAlreadyAdded ? "Added" : "Add"}
                              </button>
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="empty-copy">
                    No trades matched the selected NIFTY 5m rules.
                  </p>
                )}
              </section>

              <section className="panel">
                <div className="panel-header">
                  <div>
                    <p className="panel-title">
                      Skipped{" "}
                      {niftyFiveMinuteBacktestResult.data?.underlying ?? "Option"}{" "}
                      5m Signals
                    </p>
                  </div>
                </div>
                {niftyFiveMinuteBacktestSkipped.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Contract</th>
                          <th>Signal Candle</th>
                          <th>Reason</th>
                          <th>Body %</th>
                          <th>Entry</th>
                          <th>Signal Low</th>
                          <th>Fixed SL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {niftyFiveMinuteBacktestSkipped.map((item, index) => (
                          <tr
                            key={`${item.optionSymbol ?? "skip"}-${item.candleTime ?? index}-${index}`}
                          >
                            <td>
                              {item.optionSymbol
                                ? formatCompactOptionSymbol(item.optionSymbol)
                                : "Not available"}
                            </td>
                            <td>{formatTableDateTime(item.candleTime)}</td>
                            <td>
                              <span className="status-pill status-pill--warn">
                                {formatSnakeLabel(item.reason)}
                              </span>
                            </td>
                            <td>
                              {item.signalCandleBodyPct === null ||
                              item.signalCandleBodyPct === undefined
                                ? "Not available"
                                : `${formatNumber(item.signalCandleBodyPct)}%`}
                            </td>
                            <td>{formatCurrency(item.entryPrice)}</td>
                            <td>{formatCurrency(item.signalCandleLow)}</td>
                            <td>{formatCurrency(item.fixedStopLoss)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="empty-copy">
                    No skipped signals for this backtest run.
                  </p>
                )}
              </section>
            </>
          ) : null}
        </section>
      ) : activeView === "backtestGroups" ? (
        <section className="section-block">
          <div className="section-heading">
            <p className="eyebrow">Backtest Groups</p>
            <h2 className="section-title">Grouped trade analytics</h2>
          </div>

          <section className="content-grid">
            <article className="panel">
              <div className="panel-header">
                <div>
                  <p className="panel-title">Create Group</p>
                </div>
              </div>
              <form className="action-row action-row--wrap" onSubmit={createBacktestGroup}>
                <label className="form-field form-field--inline">
                  <span>Group name</span>
                  <input
                    type="text"
                    value={newBacktestGroupName}
                    placeholder="Morning breakout, May test..."
                    onChange={(event) =>
                      setNewBacktestGroupName(event.target.value)
                    }
                  />
                </label>
                <label className="form-field form-field--inline form-field--wide">
                  <span>Description</span>
                  <textarea
                    value={newBacktestGroupDescription}
                    placeholder="What are you testing in this group?"
                    rows={2}
                    onChange={(event) =>
                      setNewBacktestGroupDescription(event.target.value)
                    }
                  />
                </label>
                <button type="submit" className="action-button">
                  Create Group
                </button>
              </form>
            </article>

            <article className="panel">
              <div className="panel-header">
                <div>
                  <p className="panel-title">Groups</p>
                </div>
              </div>
              {backtestGroups.length ? (
                <div className="group-chip-list">
                  {backtestGroups.map((group) => (
                    <button
                      key={group.id}
                      type="button"
                      className={`group-chip ${
                        activeBacktestGroup?.id === group.id
                          ? "group-chip--active"
                          : ""
                      }`}
                      onClick={() =>
                        setActiveBacktestGroupId((current) =>
                          current === group.id ? "" : group.id,
                        )
                      }
                    >
                      <span>
                        {group.name}
                        {group.description ? (
                          <small>{group.description}</small>
                        ) : null}
                      </span>
                      <strong>{formatCount((group.trades ?? []).length)}</strong>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="empty-card">
                  <span className="empty-state-icon" aria-hidden="true">
                    BG
                  </span>
                  <strong>No groups yet</strong>
                  <p>Create a group, then add trades from 5m Option Backtest.</p>
                </div>
              )}
            </article>
          </section>

          {activeBacktestGroup ? (
            <>
              <section className="panel bot-command-card backtest-group-summary-card">
                <div className="bot-command-card__top">
                  <div>
                    <p className="eyebrow">Selected Group</p>
                    <h2>{activeBacktestGroup.name}</h2>
                    <p className="bot-command-card__subtitle">
                      {formatCount(activeBacktestGroupTrades.length)} saved
                      trades
                    </p>
                  </div>
                  <button
                    type="button"
                    className="action-button action-button--ghost"
                    onClick={() => deleteBacktestGroup(activeBacktestGroup.id)}
                  >
                    Delete Group
                  </button>
                </div>

                <div className="bot-command-card__main">
                  <div className="bot-command-card__pnl">
                    <span>Total PnL</span>
                    <strong>
                      <PnlValue value={activeBacktestGroupMetrics.totalPnl} />
                    </strong>
                    <small>
                      {formatCount(activeBacktestGroupMetrics.totalTrades)}{" "}
                      trades · {formatNumber(activeBacktestGroupMetrics.winRate)}
                      % win rate
                    </small>
                  </div>

                  <dl className="bot-command-card__stats backtest-group-summary-card__stats">
                    <div>
                      <dt>Trades</dt>
                      <dd>{formatCount(activeBacktestGroupMetrics.totalTrades)}</dd>
                    </div>
                    <div>
                      <dt>Win Rate</dt>
                      <dd>{formatNumber(activeBacktestGroupMetrics.winRate)}%</dd>
                    </div>
                    <div>
                      <dt>Profit Factor</dt>
                      <dd>
                        {Number.isFinite(activeBacktestGroupMetrics.profitFactor)
                          ? formatNumber(activeBacktestGroupMetrics.profitFactor)
                          : "∞"}
                      </dd>
                    </div>
                    <div>
                      <dt>Expectancy</dt>
                      <dd>
                        <PnlValue value={activeBacktestGroupMetrics.expectancy} />
                      </dd>
                    </div>
                    <div>
                      <dt>Best Trade</dt>
                      <dd>
                        <PnlValue value={activeBacktestGroupMetrics.bestTrade} />
                      </dd>
                    </div>
                    <div>
                      <dt>Worst Trade</dt>
                      <dd>
                        <PnlValue value={activeBacktestGroupMetrics.worstTrade} />
                      </dd>
                    </div>
                  </dl>
                </div>

                <div className="backtest-group-description-card">
                  <span>Description</span>
                  <p>
                    {activeBacktestGroup.description ||
                      "No description added for this group yet."}
                  </p>
                </div>
              </section>

              <section className="content-grid">
                <article className="panel pnl-report-panel">
                  <div className="panel-header">
                    <div>
                      <p className="panel-title">Hourly PnL Report</p>
                    </div>
                  </div>
                  <HourlyPnlReport
                    buckets={activeBacktestGroupHourlyReport}
                    showPnl={showHourlyPnl}
                  />
                </article>
                <article className="panel pnl-report-panel">
                  <div className="panel-header">
                    <div>
                      <p className="panel-title">Weekday PnL Report</p>
                    </div>
                  </div>
                  <WeekdayPnlReport
                    buckets={activeBacktestGroupWeekdayReport}
                  />
                </article>
              </section>

              <section className="panel">
                <div className="panel-header">
                  <div>
                    <p className="panel-title">Grouped Trades</p>
                  </div>
                </div>
                {activeBacktestGroupTrades.length ? (
                  <>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Contract</th>
                            <th>Signal</th>
                            <th>Entry</th>
                            <th>Exit</th>
                            <th>Entry / Exit</th>
                            <th>PnL</th>
                            <th>Result</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {backtestGroupTradesTable.rows.map((trade) => {
                            const tradeId =
                              trade.id ?? buildBacktestTradeId(trade);
                            return (
                            <tr key={tradeId}>
                              <td>
                                {formatCompactOptionSymbol(trade.optionSymbol)}
                              </td>
                              <td>{formatTableDateTime(trade.candleTime)}</td>
                              <td>{formatTableDateTime(trade.entryTime)}</td>
                              <td>{formatTableDateTime(trade.exitTime)}</td>
                              <td>
                                {formatCurrency(trade.entryPrice)} /{" "}
                                {formatCurrency(trade.exitPrice)}
                              </td>
                              <td>
                                <PnlValue
                                  value={trade.netPnl}
                                  baseValue={trade.capitalUsed}
                                />
                              </td>
                              <td>
                                <span
                                  className={`status-pill status-pill--${getStatusTone(trade.status)}`}
                                >
                                  {trade.status} · {formatSnakeLabel(trade.exitReason)}
                                </span>
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="table-action-button table-action-button--danger"
                                  onClick={() =>
                                    deleteTradeFromBacktestGroup(
                                      activeBacktestGroup.id,
                                      tradeId,
                                    )
                                  }
                                >
                                  Delete
                                </button>
                              </td>
                            </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <PaginationControls {...backtestGroupTradesTable.pagination.controls} />
                  </>
                ) : (
                  <p className="empty-copy">
                    This group is empty. Add trades from the 5m Option Backtest
                    table.
                  </p>
                )}
              </section>
            </>
          ) : backtestGroups.length ? (
            <div className="empty-card">
              <span className="empty-state-icon" aria-hidden="true">
                R
              </span>
              <strong>Select a group</strong>
              <p>Choose a group above to view its analytics and saved trades.</p>
            </div>
          ) : null}
        </section>
      ) : (
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="panel-title">Run Logs</p>
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

          <div
            className="range-switcher"
            role="tablist"
            aria-label="Run logs strategy filter"
          >
            {STRATEGY_FILTER_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`range-chip ${logStrategyFilter === option.id ? "range-chip--active" : ""}`}
                onClick={() => setLogStrategyFilter(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <section className="panel bot-command-card log-command-card">
            <div className="bot-command-card__top">
              <div>
                <p className="eyebrow">Run Log Snapshot</p>
                <h2>{selectedLogFilterMeta.label}</h2>
                <p className="bot-command-card__subtitle">
                  {selectedDate} · stream {logsStreamStatus}
                </p>
              </div>
              <span
                className={`setup-status__pill ${
                  logsStreamStatus === "live" ? "setup-status__pill--saved" : ""
                }`}
              >
                {logsStreamStatus}
              </span>
            </div>

            <div className="bot-command-card__main">
              <div className="bot-command-card__pnl">
                <span>Total Runs</span>
                <strong>{formatCount(logCounts.total)}</strong>
                <small>
                  {formatCount(logCounts.actions)} actions ·{" "}
                  {formatCount(logCounts.errors)} errors
                </small>
              </div>

              <dl className="bot-command-card__stats log-command-card__stats">
                <div>
                  <dt>Actions</dt>
                  <dd>{formatCount(logCounts.actions)}</dd>
                </div>
                <div>
                  <dt>Skipped</dt>
                  <dd>{formatCount(logCounts.skipped)}</dd>
                </div>
                <div>
                  <dt>Errors</dt>
                  <dd>{formatCount(logCounts.errors)}</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>{logsSource}</dd>
                </div>
                <div>
                  <dt>Dhan Cached Candle</dt>
                  <dd>
                    {dhanLiveCachedCandle ? (
                      <span className="log-cache-cell">
                        <strong>
                          {formatCompactOptionSymbol(
                            dhanLiveCachedCandle.dhanCachedContract
                              ?.tradingSymbol ??
                              dhanLiveCachedCandle.tradingsymbol,
                          )}
                        </strong>
                        <span>
                          {formatTimeOnly(dhanLiveCachedCandle.candleTime)} · C{" "}
                          {formatCurrency(dhanLiveCachedCandle.close)}
                        </span>
                        {dhanLiveCachedCandle.dhanCachedContract
                          ?.securityId ? (
                          <span>
                            Dhan ID{" "}
                            {dhanLiveCachedCandle.dhanCachedContract.securityId}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      "Not available"
                    )}
                  </dd>
                </div>
                <div className="log-trend-card">
                  <dt>Nifty Trend</dt>
                  <dd>
                    <span className="log-trend-card__row">
                      <span>Fast</span>
                      <TrendBadge value={latestNiftyTrendLog?.fastTrend} />
                      <span>Slow</span>
                      <TrendBadge value={latestNiftyTrendLog?.slowTrend} />
                    </span>
                    <span className="log-trend-card__contract">
                      {latestNiftyTrendLog
                        ? formatCompactOptionSymbol(latestNiftyTrendLog.contract)
                      : "Not available"}
                    </span>
                  </dd>
                </div>
                <div className="log-trend-card">
                  <dt>Dhan Live Trend</dt>
                  <dd>
                    <span className="log-trend-card__row">
                      <span>Fast</span>
                      <TrendBadge value={latestDhanTrendLog?.fastTrend} />
                      <span>Slow</span>
                      <TrendBadge value={latestDhanTrendLog?.slowTrend} />
                    </span>
                    <span className="log-trend-card__contract">
                      {latestDhanTrendLog
                        ? formatCompactOptionSymbol(latestDhanTrendLog.contract)
                        : "Not available"}
                    </span>
                  </dd>
                </div>
              </dl>
            </div>

            <div className="bot-command-card__footer log-command-card__footer">
              <div className="bot-command-card__trade">
                <div className="bot-command-card__trade-line">
                  <span className="empty-state-icon" aria-hidden="true">
                    L
                  </span>
                  <strong>
                    {selectedLogFilterMeta.label} logs for {selectedDate}
                  </strong>
                </div>
                <span className="muted-cell">
                  Latest trend arrows use the newest log row with available
                  Supertrend values.
                </span>
              </div>
            </div>
          </section>

          {logsLoading ? (
            <p className="empty-copy">Loading run logs...</p>
          ) : filteredLogs.length ? (
            <>
              <div className="run-log-card-list">
                {runLogsTable.rows.map((log) => {
                  const contractItems = getRunLogContractItems(log);
                  return (
                    <article
                      key={`${log.run_at}-${log.status}-${log.message}`}
                      className={`run-log-card run-log-card--${getStatusTone(log.status)}`}
                    >
                      <div className="run-log-card__header">
                        <div className="run-log-card__time-block">
                          <span className="run-log-card__icon" aria-hidden="true">
                            {String(log.status ?? "").toLowerCase() === "error"
                              ? "!"
                              : String(log.status ?? "").toLowerCase() ===
                                  "skipped"
                                ? "S"
                                : "R"}
                          </span>
                          <div>
                            {isRunLogColumnVisible("run_at") ? (
                              <strong>{formatTimeOnly(log.run_at)}</strong>
                            ) : null}
                            {isRunLogColumnVisible("strategy_mode") ? (
                              <span>
                                {formatSnakeLabel(log.strategy_mode ?? "index")}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        {isRunLogColumnVisible("status") ? (
                          <span
                            className={`status-pill status-pill--${getStatusTone(log.status)}`}
                          >
                            {log.status ?? "unknown"}
                          </span>
                        ) : null}
                      </div>

                      <div className="run-log-contract-grid">
                        {contractItems.map((item, index) => (
                          <div
                            key={`${item.resolved_symbol ?? item.input ?? index}-${item.candle_time ?? ""}`}
                            className="run-log-contract-card"
                          >
                            <div className="run-log-metric-grid">
                              <div
                                className={`run-log-metric run-log-metric--contract run-log-metric--contract-${getRunLogContractMarket(item)}`}
                              >
                                <span>Contract</span>
                                <strong>
                                  {item.resolved_symbol || item.input
                                    ? formatCompactOptionSymbol(
                                        item.resolved_symbol ?? item.input,
                                      )
                                    : "Contract"}
                                </strong>
                              </div>
                              {isRunLogColumnVisible("close") ? (
                                <div className="run-log-metric run-log-metric--close">
                                  <span>Close</span>
                                  <strong>{renderContractMetric(item, "close")}</strong>
                                </div>
                              ) : null}
                              {isRunLogColumnVisible("st_10_1") ? (
                                <div
                                  className={`run-log-metric run-log-metric--fast run-log-metric--${getRunLogTrendTone(item.st_10_1_trend)}`}
                                >
                                  <span>ST 10,1</span>
                                  <strong>
                                    {renderContractMetric(item, "st_10_1")}
                                    {item.st_10_1_trend != null ? (
                                      <TrendBadge value={item.st_10_1_trend} />
                                    ) : null}
                                  </strong>
                                </div>
                              ) : null}
                              {isRunLogColumnVisible("st_10_3") ? (
                                <div
                                  className={`run-log-metric run-log-metric--slow run-log-metric--${getRunLogTrendTone(item.st_10_3_trend)}`}
                                >
                                  <span>ST 10,3</span>
                                  <strong>
                                    {renderContractMetric(item, "st_10_3")}
                                    {item.st_10_3_trend != null ? (
                                      <TrendBadge value={item.st_10_3_trend} />
                                    ) : null}
                                  </strong>
                                </div>
                              ) : null}
                            </div>

                            <div className="run-log-contract-card__footer">
                              {item.candle_time ? (
                                <span>Candle {formatTimeOnly(item.candle_time)}</span>
                              ) : null}
                              {item.signal_candle_body_pct != null ? (
                                <span
                                  className={`run-log-body-pill run-log-body-pill--${getRunLogBodyTone(item)}`}
                                >
                                  Body {formatLogNumber(item.signal_candle_body_pct)}%
                                </span>
                              ) : null}
                              {item.strike_offset != null ? (
                                <span>
                                  Offset {Number(item.strike_offset) > 0 ? "+" : ""}
                                  {item.strike_offset}
                                </span>
                              ) : null}
                              {isRunLogColumnVisible("message") ? (
                                <p>{log.message ?? "-"}</p>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>
              <PaginationControls {...runLogsTable.pagination.controls} />
            </>
          ) : (
            <p className="empty-copy">
              No {selectedLogFilterMeta.label} run logs found for {selectedDate}
              .
            </p>
          )}
        </section>
      )}
    </main>
  );
}
