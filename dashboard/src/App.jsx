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
  HourlyPnlReport,
  MarketQuoteCard,
  MetricCard,
  NAV_OPTIONS,
  OPTION_BACKTEST_ENTRY_SIGNALS,
  OPTION_BACKTEST_EXCHANGES,
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

export function App() {
  const [activeView, setActiveView] = useState("overview");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [clockNow, setClockNow] = useState(() => new Date());
  const [theme, setTheme] = useState(() => {
    const savedTheme = window.localStorage.getItem("dashboard-theme");
    return savedTheme === "light" || !savedTheme ? "warm" : savedTheme;
  });
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
  const [deleteTradeCandidate, setDeleteTradeCandidate] = useState(null);
  const [selectedDate, setSelectedDate] = useState(getTodayInIst());
  const [streamStatus, setStreamStatus] = useState("connecting");
  const [zerodhaAuthBusy, setZerodhaAuthBusy] = useState(false);
  const [zerodhaConfirmOpen, setZerodhaConfirmOpen] = useState(false);
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
    },
    option_contracts_5m_sensex: {
      ...DEFAULT_DAILY_SETUP_FORM,
      targetPct: "8",
      minSignalCandlePct: "2",
      strikeOffset: "100",
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
    maxSignalCandlePct: "10",
    strikeOffset: "0",
    stopLossPct: "8",
    stopLossMode: "signal_low",
    capStopLoss: true,
    entryTiming: "signal_close",
    entryTime: "09:30",
    exitTime: "15:10",
  });
  const [optionBacktestResult, setOptionBacktestResult] = useState(null);
  const [optionBacktestLoading, setOptionBacktestLoading] = useState(false);
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
      maxBodyPct: "10",
      minBodyPct: "2",
      stopLossPct: "8",
      strikeOffset: "100",
      entryTime: "09:30",
      exitTime: "15:10",
    });
  const [niftyFiveMinuteBacktestResult, setNiftyFiveMinuteBacktestResult] =
    useState(null);
  const [niftyFiveMinuteBacktestLoading, setNiftyFiveMinuteBacktestLoading] =
    useState(false);
  const [liveActionBusy, setLiveActionBusy] = useState("");
  const [liveSetupMarket, setLiveSetupMarket] = useState("NIFTY");
  const dirtyContractStrategiesRef = useRef(new Set());
  const hydratedSetupSignaturesRef = useRef({});

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
          maxSignalCandlePct: setup.maxSignalCandlePct ?? 10,
          minSignalCandlePct: setup.minSignalCandlePct ?? 0,
          strikeOffset: setup.strikeOffset ?? 0,
          stopLossMode: setup.stopLossMode ?? "signal_low",
          stopLossPct: setup.stopLossPct ?? 8,
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
          maxSignalCandlePct: String(setup.maxSignalCandlePct ?? 10),
          minSignalCandlePct: String(setup.minSignalCandlePct ?? 0),
          strikeOffset: String(setup.strikeOffset ?? 0),
          stopLossMode: setup.stopLossMode ?? "signal_low",
          stopLossPct: String(setup.stopLossPct ?? 8),
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
      ...(field === "exchange" && value === "BFO" ? { lotSize: "20" } : {}),
      ...(field === "exchange" && value === "NFO" ? { lotSize: "75" } : {}),
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
      dirtyContractStrategiesRef.current.delete(strategyKey);
      hydratedSetupSignaturesRef.current[strategyKey] = "";

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
        throw new Error(
          `Option report CSV export failed with ${response.status}`,
        );
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
          lotSize: optionBacktestForm.exchange === "BFO" ? 20 : 75,
          targetPct: Number(optionBacktestForm.targetPct),
          maxSignalCandlePct: Number(optionBacktestForm.maxSignalCandlePct),
          strikeOffset: Number(optionBacktestForm.strikeOffset),
          stopLossPct: Number(optionBacktestForm.stopLossPct),
          stopLossMode: optionBacktestForm.stopLossMode,
          capStopLoss: optionBacktestForm.stopLossMode !== "percent",
          requireVwap: false,
          entryTiming: "signal_close",
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
          strikeOffset: Number(niftyFiveMinuteBacktestForm.strikeOffset),
          entryTime: niftyFiveMinuteBacktestForm.entryTime,
          exitTime: niftyFiveMinuteBacktestForm.exitTime,
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
  const sensexFiveMinutePaperTrading =
    paperTradingByStrategy.option_contracts_5m_sensex ?? {};
  const paperTrading = niftyPaperTrading;
  const liveTrading = data?.liveTrading ?? {};
  const liveTradingStatus = liveTrading.status ?? {};
  const liveOrders = liveTrading.orders ?? [];
  const liveTrades = liveTrading.trades ?? [];
  const livePositions = liveTrading.positions ?? {};
  const liveMargins = liveTrading.margins ?? {};
  const liveBalance = liveTrading.balance ?? {};
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
  const rawSensexFiveMinuteActiveTrade =
    sensexFiveMinutePaperTrading.activeTrade ?? null;
  const rawSensexFiveMinuteActiveTrades =
    sensexFiveMinutePaperTrading.activeTrades ??
    (rawSensexFiveMinuteActiveTrade ? [rawSensexFiveMinuteActiveTrade] : []);
  const rawSensexFiveMinuteTradeHistory =
    sensexFiveMinutePaperTrading.tradeHistory ?? [];
  const activeTrades = [
    ...rawNiftyFiveMinuteActiveTrades,
    ...rawSensexFiveMinuteActiveTrades,
  ];
  const tradeHistory = [
    ...rawNiftyFiveMinuteTradeHistory,
    ...rawSensexFiveMinuteTradeHistory,
  ].sort(
    (first, second) =>
      new Date(second.entry_time ?? second.entryTime ?? 0).getTime() -
      new Date(first.entry_time ?? first.entryTime ?? 0).getTime(),
  );
  const dailySummary = paperTrading.dailySummary ?? {};
  const zerodha = data?.zerodha ?? {};
  const combinedCapitalBase =
    Number(niftyPaperTrading.capitalBase ?? 0) +
      Number(sensexPaperTrading.capitalBase ?? 0) +
      Number(niftyFiveMinutePaperTrading.capitalBase ?? 0) +
      Number(sensexFiveMinutePaperTrading.capitalBase ?? 0) ||
    Number(paperTrading.capitalBase ?? 0);
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
  const optionBacktestTrades = optionBacktestResult?.trades ?? [];
  const niftyFiveMinuteBacktestTrades =
    niftyFiveMinuteBacktestResult?.trades ?? [];
  const niftyFiveMinuteBacktestSkipped =
    niftyFiveMinuteBacktestResult?.skipped ?? [];
  const niftyFiveMinuteBacktestStRows =
    niftyFiveMinuteBacktestResult?.data?.stValueRows ?? [];
  const niftyFiveMinuteHourlyPnlReport = buildHourlyPnlReport(
    niftyFiveMinuteBacktestTrades,
    "total",
  );
  const niftyFiveMinuteWeekdayPnlReport = buildWeekdayPnlReport(
    niftyFiveMinuteBacktestTrades,
    "total",
  );
  const optionContractStats = optionBacktestResult?.data?.contractStats ?? [];
  const optionTypeStats = optionBacktestResult?.data?.optionTypeStats ?? [];
  const optionBacktestHourlyPnlReport = buildHourlyPnlReport(
    optionBacktestTrades,
    "total",
  );
  const optionBacktestWeekdayPnlReport = buildWeekdayPnlReport(
    optionBacktestTrades,
    "total",
  );
  const isNiftyFiveMinuteLog = (log) =>
    String(log?.strategy_key ?? "").toLowerCase() ===
      DAILY_SETUP_KEYS.niftyFiveMinuteBot ||
    (String(log?.interval ?? "").toLowerCase() === "5m" &&
      String(log?.underlying ?? "").toUpperCase() !== "SENSEX" &&
      String(log?.strategy_key ?? "").toLowerCase() !==
        DAILY_SETUP_KEYS.sensexFiveMinuteBot);
  const isSensexFiveMinuteLog = (log) =>
    String(log?.strategy_key ?? "").toLowerCase() ===
      DAILY_SETUP_KEYS.sensexFiveMinuteBot ||
    (String(log?.interval ?? "").toLowerCase() === "5m" &&
      String(log?.underlying ?? "").toUpperCase() === "SENSEX");
  const fiveMinuteLogs = logs.filter(
    (log) => isNiftyFiveMinuteLog(log) || isSensexFiveMinuteLog(log),
  );
  const filteredLogs =
    logStrategyFilter === "niftyFiveMinute"
      ? logs.filter(isNiftyFiveMinuteLog)
      : logStrategyFilter === "sensexFiveMinute"
        ? logs.filter(isSensexFiveMinuteLog)
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
  const latestSensexTrendLog = getLatestTrendSnapshot(
    logs,
    isSensexFiveMinuteLog,
  );
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
  const isSensexFiveMinuteOptionTrade = (trade) =>
    (trade?.strategy_key ?? trade?.strategyKey) ===
    DAILY_SETUP_KEYS.sensexFiveMinuteBot;
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
  const sensexFiveMinuteOptionTrades = rawSensexFiveMinuteTradeHistory.filter(
    isSensexFiveMinuteOptionTrade,
  );
  const sensexFiveMinuteActiveTrades = rawSensexFiveMinuteActiveTrades.filter(
    isSensexFiveMinuteOptionTrade,
  );
  const filterTradesByStrategy = (filterId) => {
    if (filterId === "niftyOneMinute") return oneMinuteOptionTrades;
    if (filterId === "sensexOneMinute") return sensexOneMinuteOptionTrades;
    if (filterId === "niftyFiveMinute") return niftyFiveMinuteOptionTrades;
    if (filterId === "sensexFiveMinute") return sensexFiveMinuteOptionTrades;
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
  const sensexFiveMinuteBotSummary = buildBotPageSummary(
    sensexFiveMinuteOptionTrades,
    sensexFiveMinuteActiveTrades,
  );
  const overviewBotCards = [
    {
      label: "NIFTY 5m",
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
      label: "SENSEX 5m",
      strategyKey: DAILY_SETUP_KEYS.sensexFiveMinuteBot,
      paperTrading: sensexFiveMinutePaperTrading,
      activeTrades: sensexFiveMinuteActiveTrades,
      summary: sensexFiveMinuteBotSummary,
      trendLog: latestSensexTrendLog,
      setup:
        strategyConfig.strategySetups?.[DAILY_SETUP_KEYS.sensexFiveMinuteBot] ??
        {},
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
  const optionBacktestTradeColumns = [
    { id: "signal", label: "Signal" },
    { id: "entryTime", label: "Entry" },
    { id: "exitTime", label: "Exit" },
    { id: "optionSymbol", label: "Contract" },
    { id: "quantity", label: "Qty" },
    { id: "entryPrice", label: "Exec Entry" },
    { id: "exitPrice", label: "Exec Exit" },
    { id: "stopLoss", label: "SL" },
    { id: "target", label: "Target" },
    { id: "netPnl", label: "Net PnL" },
    { id: "status", label: "Status" },
    { id: "exitReason", label: "Exit Reason" },
  ];
  const optionContractStatsColumns = [
    { id: "optionSymbol", label: "Contract" },
    { id: "selectedSignals", label: "Signals" },
    { id: "fastBoth", label: "Fast / Both" },
    { id: "trades", label: "Trades" },
    { id: "skipped", label: "Skipped" },
    { id: "netPnl", label: "Net PnL" },
  ];
  const optionTypeStatsColumns = [
    { id: "optionType", label: "Type" },
    { id: "trades", label: "Trades" },
    { id: "winsLosses", label: "Wins / Losses" },
    { id: "winRate", label: "Win Rate" },
    { id: "netPnl", label: "Net PnL" },
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
  const [
    selectedOptionBacktestTradeColumns,
    setSelectedOptionBacktestTradeColumns,
  ] = useState(() =>
    loadSelectedColumns("option-backtest-trades", optionBacktestTradeColumns),
  );
  const [
    selectedOptionContractStatsColumns,
    setSelectedOptionContractStatsColumns,
  ] = useState(() =>
    loadSelectedColumns("option-contract-stats", optionContractStatsColumns),
  );
  const [selectedOptionTypeStatsColumns, setSelectedOptionTypeStatsColumns] =
    useState(() =>
      loadSelectedColumns("option-type-stats", optionTypeStatsColumns),
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

  useEffect(() => {
    window.localStorage.setItem(
      `${TABLE_COLUMN_STORAGE_PREFIX}option-backtest-trades`,
      JSON.stringify(selectedOptionBacktestTradeColumns),
    );
  }, [selectedOptionBacktestTradeColumns]);

  useEffect(() => {
    window.localStorage.setItem(
      `${TABLE_COLUMN_STORAGE_PREFIX}option-contract-stats`,
      JSON.stringify(selectedOptionContractStatsColumns),
    );
  }, [selectedOptionContractStatsColumns]);

  useEffect(() => {
    window.localStorage.setItem(
      `${TABLE_COLUMN_STORAGE_PREFIX}option-type-stats`,
      JSON.stringify(selectedOptionTypeStatsColumns),
    );
  }, [selectedOptionTypeStatsColumns]);

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
        close: log.close,
        st_10_1: log.st_10_1,
        st_10_3: log.st_10_3,
        st_10_1_trend: log.st_10_1_trend,
        st_10_3_trend: log.st_10_3_trend,
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
  const visibleOptionBacktestTradeColumns = optionBacktestTradeColumns.filter(
    (column) => selectedOptionBacktestTradeColumns.includes(column.id),
  );
  const visibleOptionContractStatsColumns = optionContractStatsColumns.filter(
    (column) => selectedOptionContractStatsColumns.includes(column.id),
  );
  const visibleOptionTypeStatsColumns = optionTypeStatsColumns.filter(
    (column) => selectedOptionTypeStatsColumns.includes(column.id),
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
  const optionBacktestTradesTable = paginateRows(
    "option-backtest-trades",
    optionBacktestTrades,
  );
  const optionContractStatsTable = paginateRows(
    "option-contract-stats",
    optionContractStats,
  );
  const optionTypeStatsTable = paginateRows(
    "option-type-stats",
    optionTypeStats,
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
      await refreshLiveTradingData();
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
                  baseValue={botPaperTrading.capitalBase}
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
                    baseValue={botPaperTrading.capitalBase}
                  />
                </dd>
              </div>
              <div>
                <dt>Unrealized</dt>
                <dd>
                  <PnlValue
                    value={summary.unrealizedPnl}
                    baseValue={botPaperTrading.capitalBase}
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
                        strategyKey === DAILY_SETUP_KEYS.sensexOneMinuteBot ||
                        strategyKey === DAILY_SETUP_KEYS.sensexFiveMinuteBot
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
                  activeView === "sensexFiveMinuteBot"
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
              : activeView === "niftyFiveMinuteBot"
                ? "NIFTY 5m"
                : activeView === "sensexFiveMinuteBot"
                  ? "SENSEX 5m"
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
                            baseValue={bot.paperTrading.capitalBase}
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
                                baseValue={bot.paperTrading.capitalBase}
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
          eyebrow: "NIFTY 5-Minute Option Bot",
          title: "NIFTY 5m option-contract execution",
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
      ) : activeView === "sensexFiveMinuteBot" ? (
        renderBotPage({
          eyebrow: "SENSEX 5-Minute Option Bot",
          title: "SENSEX 5m option-contract execution",
          subtitle:
            "Separate SENSEX lane for the same BUY-only 5m Supertrend strategy.",
          scheduleLabel: "Every 5 min at +2s",
          strategyKey: DAILY_SETUP_KEYS.sensexFiveMinuteBot,
          trades: sensexFiveMinuteOptionTrades,
          currentActiveTrades: sensexFiveMinuteActiveTrades,
          summary: sensexFiveMinuteBotSummary,
          showContracts: true,
          botPaperTrading: sensexFiveMinutePaperTrading,
        })
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
                  {["NIFTY", "SENSEX"].map((instrument) => (
                    <button
                      key={instrument}
                      type="button"
                      className={`segmented-toggle__button ${
                        niftyFiveMinuteBacktestForm.instrument === instrument
                          ? "segmented-toggle__button--active"
                          : ""
                      }`}
                      onClick={() =>
                        updateNiftyFiveMinuteBacktestField(
                          "instrument",
                          instrument,
                        )
                      }
                    >
                      {instrument}
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
                        niftyFiveMinuteBacktestForm.instrument === "SENSEX"
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
                  label="Contracts"
                  value={
                    niftyFiveMinuteBacktestResult.data?.contracts?.length
                      ? niftyFiveMinuteBacktestResult.data.contracts
                          .map(formatCompactOptionSymbol)
                          .join(" / ")
                      : "Not available"
                  }
                />
                <MetricCard
                  label="Instrument"
                  value={
                    niftyFiveMinuteBacktestResult.data?.underlying ??
                    niftyFiveMinuteBacktestResult.data?.instrument ??
                    "Option"
                  }
                />
                <MetricCard
                  label="Timeframe"
                  value={niftyFiveMinuteBacktestResult.data?.interval ?? "5m"}
                />
                <MetricCard
                  label="Target / SL"
                  value={`${formatNumber(niftyFiveMinuteBacktestResult.request?.target_pct ?? niftyFiveMinuteBacktestResult.request?.targetPct)}% / ${formatNumber(niftyFiveMinuteBacktestResult.request?.stop_loss_pct ?? niftyFiveMinuteBacktestResult.request?.stopLossPct)}%`}
                />
                <MetricCard
                  label="Body Range"
                  value={`${formatNumber(niftyFiveMinuteBacktestResult.request?.min_body_pct ?? niftyFiveMinuteBacktestResult.request?.minBodyPct)}% - ${formatNumber(niftyFiveMinuteBacktestResult.request?.max_body_pct ?? niftyFiveMinuteBacktestResult.request?.maxBodyPct)}%`}
                />
                <MetricCard
                  label="Signal Data"
                  value={formatSnakeLabel(
                    niftyFiveMinuteBacktestResult.data?.signalDataSource,
                  )}
                />
                <MetricCard
                  label="1m Data"
                  value={formatSnakeLabel(
                    niftyFiveMinuteBacktestResult.data?.executionDataSource,
                  )}
                />
                <MetricCard
                  label="BUY Signals"
                  value={formatCount(
                    niftyFiveMinuteBacktestResult.data?.rawBuySignalCount,
                  )}
                />
                <MetricCard
                  label="Body Accepted"
                  value={formatCount(
                    niftyFiveMinuteBacktestResult.data?.bodyAcceptedSignalCount,
                  )}
                />
                <MetricCard
                  label="Skipped"
                  value={formatCount(
                    niftyFiveMinuteBacktestResult.data?.skippedCount,
                  )}
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

              {niftyFiveMinuteBacktestStRows.length ? (
                <section className="panel">
                  <div className="panel-header">
                    <div>
                      <p className="panel-title">
                        {niftyFiveMinuteBacktestResult.data?.underlying ?? "Option"}{" "}
                        5m Supertrend Values
                      </p>
                    </div>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>Contract</th>
                          <th>O / H / L / C</th>
                          <th>Body %</th>
                          <th>ST 10,1</th>
                          <th>ST 10,3</th>
                          <th>Signal</th>
                          <th>Body OK</th>
                        </tr>
                      </thead>
                      <tbody>
                        {niftyFiveMinuteBacktestStRows.map((row, index) => (
                          <tr
                            key={`${row.optionSymbol}-${row.candleTime}-${index}`}
                            className={row.isBuySignal ? "highlight-row" : ""}
                          >
                            <td>{formatTimeOnly(row.candleTime)}</td>
                            <td>{formatCompactOptionSymbol(row.optionSymbol)}</td>
                            <td>
                              {formatCurrency(row.open)} / {formatCurrency(row.high)} /{" "}
                              {formatCurrency(row.low)} / {formatCurrency(row.close)}
                            </td>
                            <td>{formatNumber(row.bodyPct)}%</td>
                            <td>
                              {formatNumber(row.st10_1)}{" "}
                              <TrendBadge value={row.st10_1Trend} />
                            </td>
                            <td>
                              {formatNumber(row.st10_3)}{" "}
                              <TrendBadge value={row.st10_3Trend} />
                            </td>
                            <td>{row.signal ? formatSignal(row.signal) : "-"}</td>
                            <td>
                              {row.isBuySignal ? (
                                <span
                                  className={`status-pill status-pill--${row.bodyAccepted ? "good" : "warn"}`}
                                >
                                  {row.bodyAccepted ? "Yes" : "No"}
                                </span>
                              ) : (
                                "-"
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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
                </div>
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
                        </tr>
                      </thead>
                      <tbody>
                        {niftyFiveMinuteBacktestTrades.map((trade) => (
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
                          </tr>
                        ))}
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
              </div>
            </div>

            <form
              className="backtest-form"
              onSubmit={runOptionContractBacktest}
            >
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
                <span>Contract 1 side</span>
                <input
                  type="text"
                  value={optionBacktestForm.optionSymbol}
                  placeholder="PE or CE"
                  onChange={(event) =>
                    updateOptionBacktestField(
                      "optionSymbol",
                      event.target.value,
                    )
                  }
                  required
                />
              </label>
              <label className="form-field">
                <span>Contract 2 side (optional)</span>
                <input
                  type="text"
                  value={optionBacktestForm.optionSymbol2}
                  placeholder="CE"
                  onChange={(event) =>
                    updateOptionBacktestField(
                      "optionSymbol2",
                      event.target.value,
                    )
                  }
                />
              </label>
              <div className="form-field segmented-field">
                <span>Candle Timeframe</span>
                <div
                  className="segmented-toggle"
                  role="group"
                  aria-label="Option candle timeframe"
                >
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
                <span>Entry Signal</span>
                <div
                  className="segmented-toggle segmented-toggle--three"
                  role="group"
                  aria-label="Option entry signal"
                >
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
                <span>Max Body %</span>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={optionBacktestForm.maxSignalCandlePct}
                  onChange={(event) =>
                    updateOptionBacktestField(
                      "maxSignalCandlePct",
                      event.target.value,
                    )
                  }
                  required
                />
              </label>
              <label className="form-field">
                <span>Strike Offset</span>
                <input
                  type="number"
                  step={optionBacktestForm.exchange === "BFO" ? "100" : "50"}
                  value={optionBacktestForm.strikeOffset}
                  placeholder="0, 100, -100"
                  onChange={(event) =>
                    updateOptionBacktestField(
                      "strikeOffset",
                      event.target.value,
                    )
                  }
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
                <div
                  className="segmented-toggle"
                  role="group"
                  aria-label="Option stop loss rule"
                >
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
                  </div>
                  <button
                    type="button"
                    className="action-button"
                    onClick={exportOptionBacktestReportCsv}
                    disabled={backtestExportLoading}
                  >
                    {backtestExportLoading
                      ? "Saving CSV..."
                      : "Save Report CSV"}
                  </button>
                </div>
              </section>

              <section className="report-metrics-grid option-backtest-metrics">
                <MetricCard
                  label="Net PnL"
                  value={
                    <PnlValue
                      value={optionBacktestResult.summary?.netPnl ?? 0}
                    />
                  }
                  tone={getPnlTone(optionBacktestResult.summary?.netPnl ?? 0)}
                />
                <MetricCard
                  label="Trades"
                  value={formatCount(optionBacktestResult.summary?.tradeCount)}
                />
                <MetricCard
                  label="Wins / Losses"
                  value={`${formatCount(optionBacktestResult.summary?.wins)} / ${formatCount(optionBacktestResult.summary?.losses)}`}
                />
                <MetricCard
                  label="Win Rate"
                  value={formatPercent(optionBacktestResult.summary?.winRate)}
                />
                <MetricCard
                  label="Contracts"
                  value={
                    (optionBacktestResult.data?.contracts || []).join(" / ") ||
                    "-"
                  }
                />
                <MetricCard
                  label="Timeframe"
                  value={
                    optionBacktestResult.data?.signalInterval ||
                    optionBacktestResult.data?.interval ||
                    "-"
                  }
                />
                <MetricCard
                  label="Signal Rule"
                  value={formatSnakeLabel(
                    optionBacktestResult.data?.signalMode,
                  )}
                />
                <MetricCard
                  label="VWAP Filter"
                  value={
                    optionBacktestResult.request?.require_vwap ? "ON" : "OFF"
                  }
                />
                <MetricCard
                  label="Selected Signals"
                  value={formatCount(
                    optionBacktestResult.data?.selectedSignalCount,
                  )}
                />
                <MetricCard
                  label="Fast / Both Signals"
                  value={`${formatCount(optionBacktestResult.data?.fastSignalCount)} / ${formatCount(optionBacktestResult.data?.bothSignalCount)}`}
                />
                <MetricCard
                  label="Signal Data"
                  value={formatSnakeLabel(
                    optionBacktestResult.data?.signalDataSource,
                  )}
                />
                <MetricCard
                  label="1m Data"
                  value={formatSnakeLabel(
                    optionBacktestResult.data?.executionDataSource,
                  )}
                />
              </section>

              <section className="panel pnl-report-panel">
                <div className="panel-header">
                  <div>
                    <p className="panel-title">Option Hourly PnL Report</p>
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
                  buckets={optionBacktestHourlyPnlReport}
                  showPnl={showHourlyPnl}
                />
              </section>

              {optionBacktestResult.data?.contractStats?.length ? (
                <section className="panel">
                  <div className="panel-header">
                    <div>
                      <p className="panel-title">Contract Breakdown</p>
                    </div>
                    <ColumnPicker
                      label="Contract Breakdown"
                      columns={optionContractStatsColumns}
                      selected={selectedOptionContractStatsColumns}
                      onToggle={(columnId) =>
                        toggleColumn(
                          columnId,
                          selectedOptionContractStatsColumns,
                          setSelectedOptionContractStatsColumns,
                          optionContractStatsColumns,
                        )
                      }
                      onReset={() =>
                        setSelectedOptionContractStatsColumns(
                          optionContractStatsColumns.map((column) => column.id),
                        )
                      }
                    />
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          {visibleOptionContractStatsColumns.map((column) => (
                            <th key={column.id}>{column.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {optionContractStatsTable.rows.map((contract) => (
                          <tr key={contract.optionSymbol}>
                            {visibleOptionContractStatsColumns.map((column) => {
                              if (column.id === "optionSymbol")
                                return (
                                  <td key={column.id}>
                                    {contract.optionSymbol}
                                  </td>
                                );
                              if (column.id === "selectedSignals")
                                return (
                                  <td key={column.id}>
                                    {formatCount(contract.selectedSignals)}
                                  </td>
                                );
                              if (column.id === "fastBoth")
                                return (
                                  <td key={column.id}>
                                    {formatCount(contract.fastSignals)} /{" "}
                                    {formatCount(contract.bothSignals)}
                                  </td>
                                );
                              if (column.id === "trades")
                                return (
                                  <td key={column.id}>
                                    {formatCount(contract.trades)}
                                  </td>
                                );
                              if (column.id === "skipped")
                                return (
                                  <td key={column.id}>
                                    {formatCount(contract.skipped)}
                                  </td>
                                );
                              if (column.id === "netPnl")
                                return (
                                  <td key={column.id}>
                                    <PnlValue value={contract.netPnl} />
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
                    {...optionContractStatsTable.pagination.controls}
                  />
                </section>
              ) : null}

              {optionBacktestResult.data?.optionTypeStats?.length ? (
                <section className="panel">
                  <div className="panel-header">
                    <div>
                      <p className="panel-title">CE / PE PnL Breakdown</p>
                    </div>
                    <ColumnPicker
                      label="CE / PE Breakdown"
                      columns={optionTypeStatsColumns}
                      selected={selectedOptionTypeStatsColumns}
                      onToggle={(columnId) =>
                        toggleColumn(
                          columnId,
                          selectedOptionTypeStatsColumns,
                          setSelectedOptionTypeStatsColumns,
                          optionTypeStatsColumns,
                        )
                      }
                      onReset={() =>
                        setSelectedOptionTypeStatsColumns(
                          optionTypeStatsColumns.map((column) => column.id),
                        )
                      }
                    />
                  </div>
                  <div className="table-wrap table-wrap--compact">
                    <table>
                      <thead>
                        <tr>
                          {visibleOptionTypeStatsColumns.map((column) => (
                            <th key={column.id}>{column.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {optionTypeStatsTable.rows.map((item) => (
                          <tr key={item.optionType}>
                            {visibleOptionTypeStatsColumns.map((column) => {
                              if (column.id === "optionType")
                                return (
                                  <td key={column.id}>{item.optionType}</td>
                                );
                              if (column.id === "trades")
                                return (
                                  <td key={column.id}>
                                    {formatCount(item.trades)}
                                  </td>
                                );
                              if (column.id === "winsLosses")
                                return (
                                  <td key={column.id}>
                                    {formatCount(item.wins)} /{" "}
                                    {formatCount(item.losses)}
                                  </td>
                                );
                              if (column.id === "winRate")
                                return (
                                  <td key={column.id}>
                                    {formatPercent(item.winRate)}
                                  </td>
                                );
                              if (column.id === "netPnl")
                                return (
                                  <td key={column.id}>
                                    <PnlValue value={item.netPnl} />
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
                    {...optionTypeStatsTable.pagination.controls}
                  />
                </section>
              ) : null}

              <section className="panel pnl-report-panel">
                <div className="panel-header">
                  <div>
                    <p className="panel-title">Option Weekday PnL Report</p>
                  </div>
                </div>
                <WeekdayPnlReport buckets={optionBacktestWeekdayPnlReport} />
              </section>

              <section className="panel">
                <div className="panel-header">
                  <div>
                    <p className="panel-title">Option Backtest Trades</p>
                  </div>
                  <ColumnPicker
                    label="Option Backtest Trades"
                    columns={optionBacktestTradeColumns}
                    selected={selectedOptionBacktestTradeColumns}
                    onToggle={(columnId) =>
                      toggleColumn(
                        columnId,
                        selectedOptionBacktestTradeColumns,
                        setSelectedOptionBacktestTradeColumns,
                        optionBacktestTradeColumns,
                      )
                    }
                    onReset={() =>
                      setSelectedOptionBacktestTradeColumns(
                        optionBacktestTradeColumns.map((column) => column.id),
                      )
                    }
                  />
                </div>
                {optionBacktestResult.trades?.length ? (
                  <>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            {visibleOptionBacktestTradeColumns.map((column) => (
                              <th key={column.id}>{column.label}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {optionBacktestTradesTable.rows.map((trade) => (
                            <tr
                              key={`${trade.entryTime}-${trade.signal}-${trade.optionSymbol}`}
                            >
                              {visibleOptionBacktestTradeColumns.map(
                                (column) => {
                                  if (column.id === "signal")
                                    return (
                                      <td key={column.id}>
                                        {formatSignal(trade.signal)}
                                      </td>
                                    );
                                  if (column.id === "entryTime")
                                    return (
                                      <td key={column.id}>
                                        {formatTableDateTime(trade.entryTime)}
                                      </td>
                                    );
                                  if (column.id === "exitTime")
                                    return (
                                      <td key={column.id}>
                                        {formatTableDateTime(trade.exitTime)}
                                      </td>
                                    );
                                  if (column.id === "optionSymbol")
                                    return (
                                      <td key={column.id}>
                                        {trade.optionSymbol}
                                      </td>
                                    );
                                  if (column.id === "quantity")
                                    return (
                                      <td key={column.id}>{trade.quantity}</td>
                                    );
                                  if (column.id === "entryPrice")
                                    return (
                                      <td key={column.id}>
                                        {formatCurrency(trade.entryPrice)}
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
                                  return <td key={column.id}>-</td>;
                                },
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <PaginationControls
                      {...optionBacktestTradesTable.pagination.controls}
                    />
                  </>
                ) : (
                  <p className="empty-copy">
                    No option-contract trades were generated for this
                    configuration.
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
                  <dt>Sensex Trend</dt>
                  <dd>
                    <span className="log-trend-card__row">
                      <span>Fast</span>
                      <TrendBadge value={latestSensexTrendLog?.fastTrend} />
                      <span>Slow</span>
                      <TrendBadge value={latestSensexTrendLog?.slowTrend} />
                    </span>
                    <span className="log-trend-card__contract">
                      {latestSensexTrendLog
                        ? formatCompactOptionSymbol(latestSensexTrendLog.contract)
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
