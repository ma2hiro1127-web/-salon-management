import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import {
  defaultClosingItem,
  defaultDailyEntry,
  defaultFixedCostItem,
  defaultVariableCostItem,
  expenseCategories,
  fixedCostCategories,
  variableCostCategories,
} from "./data/defaults.js";
import {
  STORAGE_KEYS,
  buildMonthKey,
  calculateMonthSummary,
  calculateTaxSummary,
  getAiAnalysis,
  getBusinessDaySettings,
  getBusinessDaySummary,
  getClosingItemsForStoreMonth,
  getCustomerTargetSummary,
  getDailyResultsForStoreMonth,
  getFixedCostsForStoreMonth,
  formatLocalDate,
  getTargetForStoreMonth,
  getVariableCostsForStoreMonth,
  money,
  moneyDiff,
  parseNumber,
  percent,
  readAppState,
  readStorage,
  writeAppState,
} from "./utils/storage.js";

const navItems = [
  { id: "dashboard", label: "売上" },
  { id: "daily", label: "日次入力" },
  { id: "monthly", label: "管理画面" },
  { id: "stores", label: "店舗追加" },
  { id: "settings", label: "設定" },
];

const monthlyTabs = [
  { id: "target", label: "目標設定" },
  { id: "fixed", label: "固定費" },
  { id: "variable", label: "販管費" },
  { id: "closing", label: "月締め" },
  { id: "pnl", label: "損益表" },
];

const ensureMonthValue = (value) => value || new Date().toISOString().slice(0, 7);

const getMonthOffset = (monthValue, offset) => {
  const [year, month] = monthValue.split("-").map(Number);
  const nextDate = new Date(year, month - 1 + offset, 1);
  return `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, "0")}`;
};

const getRankTone = (achievement) => {
  if (achievement >= 100) return "good";
  if (achievement >= 95) return "warning";
  return "danger";
};

const formatTimestamp = (value) => {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
};

const buildDailyInsight = ({ form, targetSales, businessDayCount }) => {
  const totalSales = parseNumber(form.totalSales);
  const retailSales = parseNumber(form.retailSales);
  const customers = parseNumber(form.customers);
  const newCustomers = parseNumber(form.newCustomers);
  const repeatCustomers = parseNumber(form.repeatCustomers);
  const targetDailySales = businessDayCount > 0 ? targetSales / businessDayCount : 0;

  if (!totalSales && !retailSales && !customers && !newCustomers && !repeatCustomers) {
    return "分析に必要なデータが不足しています";
  }

  const insights = [];
  if (targetDailySales > 0 && totalSales > 0) {
    const rate = ((totalSales / targetDailySales) - 1) * 100;
    insights.push(`今日は目標より${Math.abs(rate).toFixed(0)}%${rate >= 0 ? "高い" : "低い"}です`);
  }

  if (totalSales > 0 && retailSales > 0) {
    const retailRatio = retailSales / totalSales;
    insights.push(retailRatio >= 0.7 ? "店販率は概ね良好です" : "店販率が目標を下回っています");
  }

  if (customers > 0) {
    const newRate = (newCustomers / customers) * 100;
    const repeatRate = (repeatCustomers / customers) * 100;
    insights.push(newRate >= 30 ? "新規客数は順調です" : "新規客数をもう少し増やせると伸びます");
    insights.push(repeatRate >= 50 ? "再来率は安定しています" : "再来率をもう少し改善すると利益率が上がります");
  }

  return insights.slice(0, 3).join("\n");
};

const initialAppStateValue = readAppState();

function App() {
  const [theme, setTheme] = useState(() => (readStorage(STORAGE_KEYS.theme, "light") === "dark" ? "dark" : "light"));
  const [activePage, setActivePage] = useState("dashboard");
  const [activeMonthlyTab, setActiveMonthlyTab] = useState("closing");
  const [rankingSort, setRankingSort] = useState("sales");
  const [appState, setAppState] = useState(initialAppStateValue);
  const [newStoreName, setNewStoreName] = useState("");
  const [storeFormName, setStoreFormName] = useState("");
  const [storeEditId, setStoreEditId] = useState("");
  const [dailyForm, setDailyForm] = useState({ ...defaultDailyEntry });
  const updateDailyField = (field, value) => {
    setDailyForm((prev) => {
      const next = { ...prev, [field]: value };
      if (field === "technicalSales" || field === "retailSales") {
        next.totalSales = parseNumber(field === "technicalSales" ? value : prev.technicalSales) + parseNumber(field === "retailSales" ? value : prev.retailSales);
      }
      return next;
    });
  };
  const [dailyMode, setDailyMode] = useState("create");
  const [dailyOriginalEntry, setDailyOriginalEntry] = useState(null);
  const [dailyInsight, setDailyInsight] = useState("");
  const [fixedForm, setFixedForm] = useState(defaultFixedCostItem);
  const [variableForm, setVariableForm] = useState(defaultVariableCostItem);
  const [closingForm, setClosingForm] = useState(defaultClosingItem);
  const [notice, setNotice] = useState("");
  const [businessDayInput, setBusinessDayInput] = useState("");
  const [saveStatus, setSaveStatus] = useState({ status: "saved", message: "自動保存済み", timestamp: "", error: false });
  const [isOnline, setIsOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const lastPersistedRef = useRef("");

  const { stores, selectedStore, selectedMonth } = appState;
  const target = getTargetForStoreMonth(appState, selectedStore, selectedMonth);
  const dailyEntries = useMemo(() => getDailyResultsForStoreMonth(appState, selectedStore, selectedMonth), [appState, selectedStore, selectedMonth]);
  const fixedCosts = useMemo(() => getFixedCostsForStoreMonth(appState, selectedStore, selectedMonth), [appState, selectedStore, selectedMonth]);
  const variableCosts = useMemo(() => getVariableCostsForStoreMonth(appState, selectedStore, selectedMonth), [appState, selectedStore, selectedMonth]);
  const closingItems = useMemo(() => getClosingItemsForStoreMonth(appState, selectedStore, selectedMonth), [appState, selectedStore, selectedMonth]);
  const summary = useMemo(() => calculateMonthSummary(appState, selectedStore, selectedMonth), [appState, selectedStore, selectedMonth]);
  const businessDaySummary = useMemo(() => getBusinessDaySummary(appState, selectedStore, selectedMonth), [appState, selectedStore, selectedMonth]);
  const taxSummary = useMemo(() => calculateTaxSummary({ sales: summary.sales, totalExpenses: summary.expenseTotal, taxRate: appState.taxSettings?.rate ?? 0.1, roundingMode: appState.taxSettings?.roundingMode || "half-up" }), [appState.taxSettings?.rate, appState.taxSettings?.roundingMode, summary.expenseTotal, summary.sales]);
  const customerTargetSummary = useMemo(() => getCustomerTargetSummary({ customers: summary.customers, targetCustomers: summary.customerTarget, businessDayCount: summary.businessDays, completedDays: summary.completedDays, remainingBusinessDays: summary.remainingBusinessDays, targetAverageCustomersPerDay: parseNumber(target.targetAverageCustomersPerDay) }), [summary.businessDays, summary.completedDays, summary.customerTarget, summary.customers, summary.remainingBusinessDays, target.targetAverageCustomersPerDay]);
  const aiAnalysis = useMemo(() => getAiAnalysis({ targetAchievement: summary.targetAchievement, customerAchievement: customerTargetSummary.achievementRate, customerTarget: customerTargetSummary.targetCustomers, customers: customerTargetSummary.customers, targetAverageSpend: parseNumber(target.targetAverageSpend), averageSpend: summary.averageSpend, operatingMargin: summary.operatingMargin, targetOperatingMargin: 10, fixedCost: summary.fixedCost, variableCost: summary.variableCost, equipmentInvestmentCost: summary.equipmentInvestmentCost, taxExclusiveSales: taxSummary.taxExclusiveSales, taxAmount: taxSummary.taxAmount, adjustedOperatingProfit: summary.adjustedOperatingProfit, remainingBusinessDays: summary.remainingBusinessDays, remainingSalesTarget: summary.remainingSalesTarget, remainingCustomersTarget: customerTargetSummary.remainingCustomers }), [customerTargetSummary, summary.adjustedOperatingProfit, summary.averageSpend, summary.fixedCost, summary.operatingMargin, summary.remainingBusinessDays, summary.remainingSalesTarget, summary.targetAchievement, summary.variableCost, summary.equipmentInvestmentCost, target.targetAverageSpend, taxSummary.taxAmount, taxSummary.taxExclusiveSales]);
  const businessDaySettings = useMemo(() => getBusinessDaySettings(appState, selectedStore, selectedMonth), [appState, selectedStore, selectedMonth]);
  const monthClosingStatus = useMemo(() => {
    const key = buildMonthKey(selectedStore, selectedMonth);
    return appState.monthClosingStatus?.[key] || { closed: false, lockedAt: "", note: "" };
  }, [appState.monthClosingStatus, selectedStore, selectedMonth]);
  const todayEntry = useMemo(() => {
    const todayIso = new Date().toISOString().slice(0, 10);
    return dailyEntries.find((entry) => entry.date === todayIso) || null;
  }, [dailyEntries]);
  const todayActual = todayEntry ? Number(todayEntry.totalSales || todayEntry.technicalSales || 0) : 0;
  const todayAchievement = summary.todayTarget ? (todayActual / summary.todayTarget) * 100 : 0;

  const rankingRows = useMemo(() => {
    const previousMonth = getMonthOffset(selectedMonth, -1);
    return stores
      .map((storeName) => {
        const storeSummary = calculateMonthSummary(appState, storeName, selectedMonth);
        const previousSummary = calculateMonthSummary(appState, storeName, previousMonth);
        return {
          storeName,
          sales: storeSummary.sales,
          achievement: storeSummary.targetAchievement,
          previousSales: previousSummary.sales,
          previousDiff: storeSummary.sales - previousSummary.sales,
          forecast: storeSummary.forecast,
          tone: getRankTone(storeSummary.targetAchievement),
          achievementLabel: storeSummary.targetAchievement >= 100 ? "目標ペース以上" : storeSummary.targetAchievement >= 95 ? "要確認" : "要改善",
        };
      })
      .sort((a, b) => {
        if (rankingSort === "achievement") {
          return b.achievement - a.achievement;
        }
        return b.sales - a.sales;
      });
  }, [appState, rankingSort, selectedMonth, stores]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.theme, JSON.stringify(theme));
  }, [theme]);

  useEffect(() => {
    const snapshot = JSON.stringify(appState);
    if (lastPersistedRef.current === snapshot) {
      return;
    }

    lastPersistedRef.current = snapshot;
    const timestamp = new Date().toISOString();
    setSaveStatus({ status: "saving", message: "保存中...", timestamp, error: false });

    try {
      writeAppState(appState);
      setSaveStatus({ status: "saved", message: "自動保存済み", timestamp, error: false });
    } catch (error) {
      setSaveStatus({ status: "error", message: error instanceof Error ? error.message : "保存に失敗しました", timestamp, error: true });
    }
  }, [appState]);

  useEffect(() => {
    const updateOnlineState = () => setIsOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    updateOnlineState();
    window.addEventListener("online", updateOnlineState);
    window.addEventListener("offline", updateOnlineState);
    return () => {
      window.removeEventListener("online", updateOnlineState);
      window.removeEventListener("offline", updateOnlineState);
    };
  }, []);

  useEffect(() => {
    if (!selectedStore && stores.length) {
      setAppState((prev) => ({ ...prev, selectedStore: stores[0] }));
    }
  }, [selectedStore, stores]);

  useEffect(() => {
    setBusinessDayInput(businessDaySettings.businessDayCount ? String(businessDaySettings.businessDayCount) : "");
  }, [businessDaySettings.businessDayCount]);

  useEffect(() => {
    if (!selectedStore) {
      setDailyForm({ ...defaultDailyEntry });
      setDailyMode("create");
      setDailyOriginalEntry(null);
      setDailyInsight("");
      return;
    }
    setDailyForm({ ...defaultDailyEntry });
    setDailyMode("create");
    setDailyOriginalEntry(null);
    setDailyInsight("");
  }, [selectedMonth, selectedStore]);

  const persistSaveStatus = (status, message, error = false) => {
    setSaveStatus({ status, message, timestamp: new Date().toISOString(), error });
  };

  const updateTargetField = (field, value) => {
    setAppState((prev) => {
      const key = buildMonthKey(prev.selectedStore, prev.selectedMonth);
      const existing = prev.targets?.[key] || {};
      return {
        ...prev,
        targets: {
          ...prev.targets,
          [key]: {
            ...existing,
            [field]: parseNumber(value),
          },
        },
      };
    });
  };

  const handleDailyDateChange = (value) => {
    const nextDate = value;
    const existingEntry = dailyEntries.find((entry) => entry.date === nextDate) || null;

    if (existingEntry) {
      setDailyForm({ ...existingEntry, totalSales: parseNumber(existingEntry.technicalSales || 0) + parseNumber(existingEntry.retailSales || 0) });
      setDailyMode("view");
      setDailyOriginalEntry({ ...existingEntry });
      setDailyInsight(buildDailyInsight({ form: existingEntry, targetSales: parseNumber(target.targetSales), businessDayCount: businessDaySummary.businessDayCount || 0 }));
      setNotice("入力済みの日付です。編集ボタンで内容を確認・更新できます。");
      return;
    }

    setDailyForm({ ...defaultDailyEntry, date: nextDate });
    setDailyMode("create");
    setDailyOriginalEntry(null);
    setDailyInsight("");
    setNotice("");
  };

  const submitDailyEntry = (event) => {
    event?.preventDefault();
    if (!selectedStore) {
      setNotice("店舗を先に追加してください");
      persistSaveStatus("error", "店舗を先に追加してください", true);
      return;
    }

    if (!dailyForm.date) {
      setNotice("日付は必須です");
      persistSaveStatus("error", "日付は必須です", true);
      return;
    }

    const missingFields = [];
    if (!dailyForm.totalSales) missingFields.push("総売上");
    if (!dailyForm.technicalSales) missingFields.push("技術売上");
    if (!dailyForm.retailSales) missingFields.push("店販売上");
    if (!dailyForm.customers) missingFields.push("客数");
    if (!dailyForm.newCustomers) missingFields.push("新規客数");
    if (!dailyForm.repeatCustomers) missingFields.push("再来客数");

    if (missingFields.length) {
      setNotice(`未入力項目があります: ${missingFields.join(" / ")}`);
      persistSaveStatus("error", `未入力項目があります: ${missingFields.join(" / ")}`, true);
      return;
    }

    const existingEntry = dailyEntries.find((entry) => entry.date === dailyForm.date) || null;
    if (existingEntry && existingEntry.id !== dailyForm.id) {
      setNotice("この日付は既に登録済みです。編集ボタンで更新してください。");
      persistSaveStatus("error", "この日付は既に登録済みです。編集ボタンで更新してください。", true);
      return;
    }

    try {
      setAppState((prev) => {
        const key = buildMonthKey(prev.selectedStore, prev.selectedMonth);
        const list = prev.dailyResults?.[key] || [];
        const nextEntry = {
          ...dailyForm,
          totalSales: parseNumber(dailyForm.totalSales),
          technicalSales: parseNumber(dailyForm.technicalSales),
          retailSales: parseNumber(dailyForm.retailSales),
          customers: parseNumber(dailyForm.customers),
          newCustomers: parseNumber(dailyForm.newCustomers),
          repeatCustomers: parseNumber(dailyForm.repeatCustomers),
        };

        const filtered = dailyForm.id || existingEntry?.id
          ? list.map((item) => (item.id === (dailyForm.id || existingEntry?.id) ? { ...item, ...nextEntry } : item))
          : [...list, { ...nextEntry, id: crypto.randomUUID() }];

        return {
          ...prev,
          dailyResults: {
            ...prev.dailyResults,
            [key]: filtered,
          },
        };
      });

      const entryId = dailyForm.id || existingEntry?.id || crypto.randomUUID();
      const savedEntry = {
        ...dailyForm,
        id: entryId,
        totalSales: parseNumber(dailyForm.technicalSales || 0) + parseNumber(dailyForm.retailSales || 0),
        technicalSales: parseNumber(dailyForm.technicalSales),
        retailSales: parseNumber(dailyForm.retailSales),
        otherSales: parseNumber(dailyForm.otherSales || 0),
        customers: parseNumber(dailyForm.customers),
        newCustomers: parseNumber(dailyForm.newCustomers),
        repeatCustomers: parseNumber(dailyForm.repeatCustomers),
      };
      setDailyForm(savedEntry);
      setDailyMode("view");
      setDailyOriginalEntry({ ...savedEntry });
      setDailyInsight(buildDailyInsight({ form: savedEntry, targetSales: parseNumber(target.targetSales), businessDayCount: businessDaySummary.businessDayCount || 0 }));
      persistSaveStatus("saved", "日次実績を保存しました");
      setNotice("日次実績を保存しました");
    } catch (error) {
      persistSaveStatus("error", error instanceof Error ? error.message : "保存に失敗しました", true);
      setNotice("保存に失敗しました");
    }
  };

  const startNewDailyEntry = () => {
    const defaultValue = { ...defaultDailyEntry, date: dailyForm.date || "" };
    setDailyForm(defaultValue);
    setDailyMode("create");
    setDailyOriginalEntry(null);
    setDailyInsight("");
    setNotice("新規入力モードです");
  };

  const editDailyEntry = () => {
    if (!dailyForm.id) {
      setNotice("編集対象のデータがありません");
      return;
    }
    setDailyMode("edit");
    setNotice("編集モードです。内容を確認してから完了してください。" );
  };

  const cancelDailyEntryEdit = () => {
    if (dailyOriginalEntry) {
      setDailyForm({ ...dailyOriginalEntry });
      setDailyMode("view");
      setDailyInsight(buildDailyInsight({ form: dailyOriginalEntry, targetSales: parseNumber(target.targetSales), businessDayCount: businessDaySummary.businessDayCount || 0 }));
      setNotice("編集をキャンセルしました");
      return;
    }
    setDailyForm({ ...defaultDailyEntry, date: dailyForm.date || "" });
    setDailyMode("create");
    setDailyInsight("");
    setNotice("入力をキャンセルしました");
  };

  const copyPreviousDayData = () => {
    const selectedDate = dailyForm.date || new Date().toISOString().slice(0, 10);
    const currentDate = new Date(`${selectedDate}T00:00:00`);
    currentDate.setDate(currentDate.getDate() - 1);
    const previousDate = formatLocalDate(currentDate);
    const sourceEntry = dailyEntries.find((entry) => entry.date === previousDate) || null;
    if (!sourceEntry) {
      setNotice("前日のデータがありません");
      return;
    }
    setDailyForm({
      ...defaultDailyEntry,
      date: selectedDate,
      totalSales: sourceEntry.totalSales ?? "",
      technicalSales: sourceEntry.technicalSales ?? "",
      retailSales: sourceEntry.retailSales ?? "",
      otherSales: sourceEntry.otherSales ?? "",
      customers: sourceEntry.customers ?? "",
      newCustomers: sourceEntry.newCustomers ?? "",
      repeatCustomers: sourceEntry.repeatCustomers ?? "",
    });
    setDailyMode("edit");
    setDailyOriginalEntry(null);
    setDailyInsight("");
    setNotice(`${previousDate}のデータをコピーしました`);
  };

  const removeDailyEntry = (entryId) => {
    if (!window.confirm("この日次実績を削除しますか？")) {
      return;
    }
    setAppState((prev) => {
      const key = buildMonthKey(prev.selectedStore, prev.selectedMonth);
      const list = prev.dailyResults?.[key] || [];
      return {
        ...prev,
        dailyResults: {
          ...prev.dailyResults,
          [key]: list.filter((item) => item.id !== entryId),
        },
      };
    });
    setNotice("日次実績を削除しました");
  };

  const submitFixedCost = (event) => {
    event.preventDefault();
    if (!fixedForm.name || !fixedForm.amount) {
      setNotice("項目名と金額は必須です");
      return;
    }

    setAppState((prev) => {
      const key = buildMonthKey(prev.selectedStore, prev.selectedMonth);
      const list = prev.fixedCosts?.[key] || [];
      const nextItem = { ...fixedForm, amount: parseNumber(fixedForm.amount) };
      const updated = fixedForm.id
        ? list.map((item) => (item.id === fixedForm.id ? nextItem : item))
        : [...list, { ...nextItem, id: crypto.randomUUID() }];

      return {
        ...prev,
        fixedCosts: {
          ...prev.fixedCosts,
          [key]: updated,
        },
      };
    });

    setNotice("月固定費を保存しました");
    setFixedForm({ ...defaultFixedCostItem });
  };

  const editFixedCost = (item) => {
    setFixedForm(item);
    setNotice("固定費を編集します");
  };

  const removeFixedCost = (itemId) => {
    if (!window.confirm("この固定費を削除しますか？")) {
      return;
    }
    setAppState((prev) => {
      const key = buildMonthKey(prev.selectedStore, prev.selectedMonth);
      const list = prev.fixedCosts?.[key] || [];
      return {
        ...prev,
        fixedCosts: {
          ...prev.fixedCosts,
          [key]: list.filter((item) => item.id !== itemId),
        },
      };
    });
    setNotice("固定費を削除しました");
  };

  const submitVariableCost = (event) => {
    event.preventDefault();
    if (!variableForm.name || !variableForm.amount) {
      setNotice("項目名と金額は必須です");
      return;
    }

    setAppState((prev) => {
      const key = buildMonthKey(prev.selectedStore, prev.selectedMonth);
      const list = prev.variableCosts?.[key] || [];
      const nextItem = { ...variableForm, amount: parseNumber(variableForm.amount) };
      const updated = variableForm.id
        ? list.map((item) => (item.id === variableForm.id ? nextItem : item))
        : [...list, { ...nextItem, id: crypto.randomUUID() }];

      return {
        ...prev,
        variableCosts: {
          ...prev.variableCosts,
          [key]: updated,
        },
      };
    });

    setNotice("月販管費を保存しました");
    setVariableForm({ ...defaultVariableCostItem });
  };

  const editVariableCost = (item) => {
    setVariableForm(item);
    setNotice("販管費を編集します");
  };

  const removeVariableCost = (itemId) => {
    if (!window.confirm("この販管費を削除しますか？")) {
      return;
    }
    setAppState((prev) => {
      const key = buildMonthKey(prev.selectedStore, prev.selectedMonth);
      const list = prev.variableCosts?.[key] || [];
      return {
        ...prev,
        variableCosts: {
          ...prev.variableCosts,
          [key]: list.filter((item) => item.id !== itemId),
        },
      };
    });
    setNotice("販管費を削除しました");
  };

  const submitClosingItem = (event) => {
    event.preventDefault();
    if (!closingForm.name || !closingForm.amount) {
      setNotice("項目名と金額は必須です");
      return;
    }

    setAppState((prev) => {
      const key = buildMonthKey(prev.selectedStore, prev.selectedMonth);
      const list = prev.monthClosing?.[key] || [];
      const nextItem = { ...closingForm, amount: parseNumber(closingForm.amount) };
      const updated = closingForm.id
        ? list.map((item) => (item.id === closingForm.id ? nextItem : item))
        : [...list, { ...nextItem, id: crypto.randomUUID() }];

      return {
        ...prev,
        monthClosing: {
          ...prev.monthClosing,
          [key]: updated,
        },
      };
    });

    setNotice("月締め項目を保存しました");
    setClosingForm({ ...defaultClosingItem });
  };

  const editClosingItem = (item) => {
    setClosingForm(item);
    setNotice("月締め項目を編集します");
  };

  const removeClosingItem = (itemId) => {
    if (!window.confirm("この月締め項目を削除しますか？")) {
      return;
    }
    setAppState((prev) => {
      const key = buildMonthKey(prev.selectedStore, prev.selectedMonth);
      const list = prev.monthClosing?.[key] || [];
      return {
        ...prev,
        monthClosing: {
          ...prev.monthClosing,
          [key]: list.filter((item) => item.id !== itemId),
        },
      };
    });
    setNotice("月締め項目を削除しました");
  };

  const saveBusinessDaySetting = (event) => {
    event.preventDefault();
    const parsed = parseNumber(businessDayInput);
    if (!selectedStore) {
      setNotice("店舗を選択してください");
      return;
    }
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 31) {
      setNotice("営業日数は1〜31の整数で入力してください");
      return;
    }
    const key = buildMonthKey(selectedStore, selectedMonth);
    setAppState((prev) => ({
      ...prev,
      businessDaySettings: {
        ...prev.businessDaySettings,
        [key]: {
          ...prev.businessDaySettings?.[key],
          businessDayCount: parsed,
        },
      },
    }));
    persistSaveStatus("saved", "営業日数を保存しました");
    setNotice("営業日数を保存しました");
  };

  const toggleMonthClosing = () => {
    if (!selectedStore) {
      setNotice("店舗を選択してください");
      return;
    }

    const key = buildMonthKey(selectedStore, selectedMonth);
    const nextClosed = !Boolean(monthClosingStatus.closed);
    setAppState((prev) => ({
      ...prev,
      monthClosingStatus: {
        ...prev.monthClosingStatus,
        [key]: {
          closed: nextClosed,
          lockedAt: nextClosed ? new Date().toISOString() : "",
          note: nextClosed ? "月締め済み" : "未確定",
        },
      },
    }));
    persistSaveStatus("saved", nextClosed ? "月締めを確定しました" : "月締めを解除しました");
    setNotice(nextClosed ? "月締めを確定しました" : "月締めを解除しました");
  };

  const toggleDayClosing = () => {
    if (!selectedStore || !dailyForm.date) {
      setNotice("締め対象の日付を入力してください");
      return;
    }
    const todayIso = new Date().toISOString().slice(0, 10);
    if (dailyForm.date > todayIso) {
      setNotice("未来日は締めできません");
      return;
    }
    if (!window.confirm(`この日の締めを${dailyForm.date}で切り替えますか？`)) {
      return;
    }
    const key = buildMonthKey(selectedStore, selectedMonth);
    setAppState((prev) => {
      const current = prev.dayClosingStates?.[key] || {};
      return {
        ...prev,
        dayClosingStates: {
          ...prev.dayClosingStates,
          [key]: {
            ...current,
            [dailyForm.date]: !Boolean(current[dailyForm.date]),
          },
        },
      };
    });
    persistSaveStatus("saved", "日締め状態を更新しました");
    setNotice("日締め状態を更新しました");
  };

  const handleStoreAdd = () => {
    const trimmed = newStoreName.trim();
    if (!trimmed) {
      setNotice("店舗名を入力してください");
      return;
    }
    if (stores.includes(trimmed)) {
      setNotice("既に登録済みの店舗名です");
      return;
    }
    setAppState((prev) => ({
      ...prev,
      stores: [...prev.stores, trimmed],
      selectedStore: trimmed,
    }));
    setNewStoreName("");
    setNotice("店舗を追加しました");
  };

  const handleStoreUpdate = (event) => {
    event.preventDefault();
    const trimmed = storeFormName.trim();
    if (!trimmed || !storeEditId) return;
    setAppState((prev) => ({
      ...prev,
      stores: prev.stores.map((store) => (store === storeEditId ? trimmed : store)),
      selectedStore: prev.selectedStore === storeEditId ? trimmed : prev.selectedStore,
    }));
    setStoreFormName("");
    setStoreEditId("");
    setNotice("店舗名を更新しました");
  };

  const handleStoreDelete = (storeName) => {
    if (!window.confirm(`${storeName} を削除しますか？`)) {
      return;
    }
    if (stores.length <= 1) {
      setAppState((prev) => ({ ...prev, stores: [], selectedStore: "" }));
      setNotice("最後の店舗を削除しました");
      return;
    }
    const nextStores = stores.filter((item) => item !== storeName);
    setAppState((prev) => ({
      ...prev,
      stores: nextStores,
      selectedStore: prev.selectedStore === storeName ? nextStores[0] : prev.selectedStore,
    }));
    setNotice("店舗を削除しました");
  };

  const copyPreviousMonthData = (section) => {
    const previousMonth = getMonthOffset(selectedMonth, -1);
    const sourceKey = buildMonthKey(selectedStore, previousMonth);
    const targetKey = buildMonthKey(selectedStore, selectedMonth);

    setAppState((prev) => {
      if (section === "fixed") {
        return {
          ...prev,
          fixedCosts: {
            ...prev.fixedCosts,
            [targetKey]: (prev.fixedCosts?.[sourceKey] || []).map((item) => ({ ...item, id: crypto.randomUUID() })),
          },
        };
      }
      if (section === "variable") {
        return {
          ...prev,
          variableCosts: {
            ...prev.variableCosts,
            [targetKey]: (prev.variableCosts?.[sourceKey] || []).map((item) => ({ ...item, id: crypto.randomUUID() })),
          },
        };
      }
      return {
        ...prev,
        monthClosing: {
          ...prev.monthClosing,
          [targetKey]: (prev.monthClosing?.[sourceKey] || []).map((item) => ({ ...item, id: crypto.randomUUID() })),
        },
      };
    });
    setNotice(`前月データを${selectedMonth}へコピーしました`);
  };

  const startEditStore = (storeName) => {
    setStoreEditId(storeName);
    setStoreFormName(storeName);
  };

  return (
    <div className={`app-shell ${theme === "dark" ? "theme-dark" : ""}`}>
      <aside className="sidebar">
        <div>
          <div className="brand">
            <span className="brand-mark">S</span>
            <div>
              <strong>Salon Manager</strong>
              <small>美容室経営管理</small>
            </div>
          </div>
          <nav className="nav">
            {navItems.map((item) => (
              <button key={item.id} className={activePage === item.id ? "nav-button active" : "nav-button"} onClick={() => setActivePage(item.id)}>
                {item.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="sidebar-footer" />
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">SALON MANAGEMENT</p>
            <h1>{activePage === "dashboard" ? "売上" : activePage === "daily" ? "日次入力" : activePage === "monthly" ? "管理画面" : activePage === "stores" ? "店舗追加" : "設定"}</h1>
          </div>

          <div className="filters">
            <label>
              店舗
              <select value={selectedStore} onChange={(event) => setAppState((prev) => ({ ...prev, selectedStore: event.target.value }))}>
                {stores.length ? stores.map((storeName) => <option key={storeName} value={storeName}>{storeName}</option>) : <option value="">未登録</option>}
              </select>
            </label>
            <label>
              対象月
              <input type="month" value={ensureMonthValue(selectedMonth)} onChange={(event) => setAppState((prev) => ({ ...prev, selectedMonth: event.target.value }))} />
            </label>
          </div>
        </header>

        {!isOnline ? <div className="notice-box">オフラインです。入力内容は端末に保存されています。</div> : null}
        {notice ? <div className="notice-box">{notice}</div> : null}

        {activePage === "dashboard" && (
          <div className="dashboard-layout">
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">KPI</p>
                  <h2>売上</h2>
                </div>
                <div className="status-stack">
                  <div className={`status-pill ${saveStatus.error ? "error" : saveStatus.status === "saving" ? "saving" : "saved"}`}>
                    {saveStatus.message || "自動保存済み"}
                  </div>
                  {saveStatus.timestamp ? <div className="timestamp-pill">最終保存 {formatTimestamp(saveStatus.timestamp)}</div> : null}
                </div>
              </div>
              <div className="business-progress-card">
                <div className="business-progress-header">
                  <div>
                    <p className="eyebrow">PROGRESS</p>
                    <h3>営業進捗</h3>
                  </div>
                  <span className={`status-chip ${businessDaySummary.progressRate === null ? "neutral" : businessDaySummary.progressRate >= 100 ? "good" : businessDaySummary.progressRate >= 50 ? "warning" : "danger"}`}>
                    {businessDaySummary.progressRate === null ? "未設定" : `${Math.round(businessDaySummary.progressRate)}%`}
                  </span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${Math.min(100, businessDaySummary.progressRate || 0)}%` }} />
                </div>
                <div className="business-progress-grid">
                  <div><span>今月営業日数</span><strong>{businessDaySummary.businessDayCount ? `${businessDaySummary.businessDayCount}日` : "未設定"}</strong></div>
                  <div><span>営業完了</span><strong>{businessDaySummary.completedDays}日</strong></div>
                  <div><span>残り営業日</span><strong>{businessDaySummary.remainingBusinessDays === null ? "未設定" : `${businessDaySummary.remainingBusinessDays}日`}</strong></div>
                  <div><span>目標売上まで</span><strong>{money(summary.remainingSalesTarget)}</strong></div>
                  <div><span>残り1日必要売上</span><strong>{money(summary.dailyNeededSales)}</strong></div>
                  <div><span>目標客数まで</span><strong>{summary.remainingCustomersTarget}名</strong></div>
                </div>
              </div>
              <div className="kpi-grid">
                <MetricCard label="月間目標売上" value={money(target.targetSales || 0)} />
                <MetricCard label="現在売上" value={money(summary.sales)} />
                <MetricCard label="月間達成率" value={percent(summary.targetAchievement)} />
                <MetricCard label="月間設定営業日数" value={businessDaySummary.businessDayCount ? `${businessDaySummary.businessDayCount}日` : "未設定"} />
                <MetricCard label="営業完了日数" value={`${businessDaySummary.completedDays}日`} />
                <MetricCard label="残り営業日数" value={businessDaySummary.remainingBusinessDays === null ? "未設定" : `${businessDaySummary.remainingBusinessDays}日`} />
                <MetricCard label="営業進捗率" value={businessDaySummary.progressRate === null ? "未設定" : percent(businessDaySummary.progressRate)} />
                <MetricCard label="1日平均売上" value={money(summary.averageSales)} />
                <MetricCard label="目標まで残り売上" value={money(summary.remainingSalesTarget)} />
                <MetricCard label="残り1営業日あたり必要売上" value={money(summary.dailyNeededSales)} />
                <MetricCard label="本日の目標売上" value={money(summary.todayTarget)} />
              </div>
              {todayEntry ? (
                <div className="today-result-card">
                  <div className="panel-heading compact">
                    <div>
                      <p className="eyebrow">TODAY</p>
                      <h3>本日の実績</h3>
                    </div>
                  </div>
                  <div className="kpi-grid compact-grid">
                    <MetricCard label="本日の実績売上" value={money(todayActual)} />
                    <MetricCard label="本日の目標との差額" value={moneyDiff(todayActual - summary.todayTarget)} />
                    <MetricCard label="本日の達成率" value={percent(todayAchievement)} />
                  </div>
                </div>
              ) : null}
            </section>

            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">RANKING</p>
                  <h2>店舗売上ランキング</h2>
                </div>
                <select value={rankingSort} onChange={(event) => setRankingSort(event.target.value)}>
                  <option value="sales">現在売上順</option>
                  <option value="achievement">達成率順</option>
                </select>
              </div>
              {stores.length === 0 ? (
                <div className="empty-card">店舗を追加してください。</div>
              ) : (
                <div className="ranking-list">
                  {rankingRows.map((row, index) => (
                    <div key={row.storeName} className={`ranking-card tone-${row.tone}`}>
                      <div className="rank-badge">{index + 1}</div>
                      <div className="ranking-main">
                        <div className="ranking-title-row">
                          <strong>{row.storeName}</strong>
                          <span>{row.achievementLabel}</span>
                        </div>
                        <div className="ranking-metrics">
                          <div><span>現在売上</span><strong>{money(row.sales)}</strong></div>
                          <div><span>目標達成率</span><strong>{percent(row.achievement)}</strong></div>
                          <div><span>前月売上</span><strong>{money(row.previousSales)}</strong></div>
                          <div><span>前月との差額</span><strong>{moneyDiff(row.previousDiff)}</strong></div>
                          <div><span>月末着地予測</span><strong>{money(row.forecast)}</strong></div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {activePage === "daily" && (
          <div className="stack">
            {!selectedStore ? (
              <div className="empty-card">店舗を追加してから日次入力を始めてください。</div>
            ) : (
              <>
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <p className="eyebrow">DAILY</p>
                      <h2>毎日30秒入力</h2>
                    </div>
                    <div className="status-stack">
                      <div className={`status-pill ${saveStatus.error ? "error" : saveStatus.status === "saving" ? "saving" : "saved"}`}>
                        {saveStatus.message || "自動保存済み"}
                      </div>
                      {saveStatus.timestamp ? <div className="timestamp-pill">最終保存 {formatTimestamp(saveStatus.timestamp)}</div> : null}
                    </div>
                  </div>

                  <div className="daily-hero">
                    <div className="daily-hero-card">
                      <span>営業日数</span>
                      <strong>{businessDaySummary.businessDayCount ? `${businessDaySummary.businessDayCount}日` : "未設定"}</strong>
                    </div>
                    <div className="daily-hero-card">
                      <span>営業完了</span>
                      <strong>{businessDaySummary.completedDays}日</strong>
                    </div>
                    <div className="daily-hero-card">
                      <span>残り営業日</span>
                      <strong>{businessDaySummary.remainingBusinessDays === null ? "未設定" : `${businessDaySummary.remainingBusinessDays}日`}</strong>
                    </div>
                  </div>

                  <form className="inline-form" onSubmit={saveBusinessDaySetting}>
                    <input value={businessDayInput} onChange={(event) => setBusinessDayInput(event.target.value)} placeholder="営業日数を入力" type="number" min="1" max="31" />
                    <button className="primary-button" type="submit">営業日数を保存</button>
                  </form>

                  <div className="button-row">
                    <button className="secondary-button" type="button" onClick={startNewDailyEntry}>新規入力</button>
                    <button className="secondary-button" type="button" onClick={editDailyEntry} disabled={!dailyForm.id || dailyMode === "edit"}>編集</button>
                    <button className="primary-button" type="submit" form="daily-form">保存</button>
                    <button className="secondary-button" type="button" onClick={cancelDailyEntryEdit}>キャンセル</button>
                    <button className="secondary-button" type="button" onClick={copyPreviousDayData}>前日コピー</button>
                    <button className="secondary-button" type="button" onClick={toggleDayClosing}>日締め</button>
                  </div>

                  <form id="daily-form" className="daily-form-grid" onSubmit={submitDailyEntry}>
                    <div className="daily-section-card">
                      <h3>基本情報</h3>
                      <label className="field">
                        <span>店舗</span>
                        <select value={selectedStore} onChange={(event) => setAppState((prev) => ({ ...prev, selectedStore: event.target.value }))}>
                          {stores.length ? stores.map((storeName) => <option key={storeName} value={storeName}>{storeName}</option>) : <option value="">未登録</option>}
                        </select>
                      </label>
                      <Field label="対象日" type="date" value={dailyForm.date} onChange={(value) => handleDailyDateChange(value)} disabled={dailyMode === "view"} />
                      <div className="field">
                        <span>営業日数</span>
                        <div className="value-pill">{businessDaySummary.businessDayCount ? `${businessDaySummary.businessDayCount}日` : "未設定"}</div>
                      </div>
                      <div className="field">
                        <span>日締め状態</span>
                        <div className={`value-pill ${appState.dayClosingStates?.[buildMonthKey(selectedStore, selectedMonth)]?.[dailyForm.date] ? "active" : "inactive"}`}>
                          {appState.dayClosingStates?.[buildMonthKey(selectedStore, selectedMonth)]?.[dailyForm.date] ? "締め済み" : "未締め"}
                        </div>
                      </div>
                    </div>

                    <div className="daily-section-card">
                      <h3>売上入力</h3>
                      <Field label="技術売上（税込）" value={dailyForm.technicalSales} onChange={(value) => updateDailyField("technicalSales", value)} suffix="円" disabled={dailyMode === "view"} />
                      <Field label="店販売上（税込）" value={dailyForm.retailSales} onChange={(value) => updateDailyField("retailSales", value)} suffix="円" disabled={dailyMode === "view"} />
                      {appState.preferences?.showOtherSales ? <Field label="その他売上（税込）" value={dailyForm.otherSales} onChange={(value) => setDailyForm((prev) => ({ ...prev, otherSales: value }))} suffix="円" disabled={dailyMode === "view"} /> : null}
                      <div className="summary-card compact">
                        <span>総売上（税込）</span>
                        <strong>{money(parseNumber(dailyForm.technicalSales) + parseNumber(dailyForm.retailSales))}</strong>
                      </div>
                    </div>

                    <div className="daily-section-card">
                      <h3>客数</h3>
                      <Field label="客数" value={dailyForm.customers} onChange={(value) => setDailyForm((prev) => ({ ...prev, customers: value }))} suffix="名" disabled={dailyMode === "view"} />
                      <Field label="新規客数" value={dailyForm.newCustomers} onChange={(value) => setDailyForm((prev) => ({ ...prev, newCustomers: value }))} suffix="名" disabled={dailyMode === "view"} />
                      <Field label="再来客数" value={dailyForm.repeatCustomers} onChange={(value) => setDailyForm((prev) => ({ ...prev, repeatCustomers: value }))} suffix="名" disabled={dailyMode === "view"} />
                    </div>
                  </form>

                  <div className="helper-text">必要な数字だけ入力すれば、客単価・店販率・新規率・再来率は自動計算されます。</div>
                  {dailyMode === "view" && dailyOriginalEntry ? (
                    <div className="preview-card">
                      <strong>入力済みの内容</strong>
                      <small>日付 {dailyOriginalEntry.date} / 総売上 {money(dailyOriginalEntry.totalSales || 0)} / 客数 {dailyOriginalEntry.customers || 0}名</small>
                    </div>
                  ) : null}

                  <div className="kpi-grid compact-grid">
                    <MetricCard label="客単価" value={money(parseNumber(dailyForm.customers) ? (parseNumber(dailyForm.technicalSales) + parseNumber(dailyForm.retailSales)) / parseNumber(dailyForm.customers) : 0)} />
                    <MetricCard label="店販率" value={percent((parseNumber(dailyForm.technicalSales) + parseNumber(dailyForm.retailSales)) ? (parseNumber(dailyForm.retailSales) / (parseNumber(dailyForm.technicalSales) + parseNumber(dailyForm.retailSales))) * 100 : 0)} />
                    <MetricCard label="新規率" value={percent(parseNumber(dailyForm.customers) ? (parseNumber(dailyForm.newCustomers) / parseNumber(dailyForm.customers)) * 100 : 0)} />
                    <MetricCard label="再来率" value={percent(parseNumber(dailyForm.customers) ? (parseNumber(dailyForm.repeatCustomers) / parseNumber(dailyForm.customers)) * 100 : 0)} />
                  </div>

                  <div className="insight-card">
                    <p className="eyebrow">AI COMMENT</p>
                    <strong>{dailyInsight || "分析に必要なデータが不足しています"}</strong>
                  </div>

                  <div className="calendar-card">
                    <div className="panel-heading compact">
                      <div>
                        <p className="eyebrow">CALENDAR</p>
                        <h3>月カレンダー</h3>
                      </div>
                    </div>
                    <div className="calendar-grid">
                      {Array.from({ length: 35 }, (_, index) => {
                        const day = index + 1;
                        const monthInfo = new Date(`${selectedMonth}-01`);
                        const isInMonth = day <= new Date(monthInfo.getFullYear(), monthInfo.getMonth() + 1, 0).getDate();
                        if (!isInMonth) return <div key={index} className="calendar-day muted" />;
                        const iso = `${selectedMonth}-${String(day).padStart(2, "0")}`;
                        const entry = dailyEntries.find((item) => item.date === iso);
                        const closed = appState.dayClosingStates?.[buildMonthKey(selectedStore, selectedMonth)]?.[iso];
                        const className = entry ? "calendar-day filled" : closed ? "calendar-day closed" : "calendar-day empty";
                        return <div key={index} className={className}>{day}</div>;
                      })}
                    </div>
                  </div>
                </section>

                {todayEntry ? (
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <p className="eyebrow">RESULT</p>
                        <h2>本日の確認</h2>
                      </div>
                    </div>
                    <div className="kpi-grid compact-grid">
                      <MetricCard label="本日の実績売上" value={money(todayActual)} />
                      <MetricCard label="本日の目標との差額" value={moneyDiff(todayActual - summary.todayTarget)} />
                      <MetricCard label="本日の達成率" value={percent(todayAchievement)} />
                    </div>
                  </section>
                ) : null}
              </>
            )}
          </div>
        )}

        {activePage === "monthly" && (
          <div className="stack">
            <div className="subnav">
              {monthlyTabs.map((tab) => (
                <button key={tab.id} className={activeMonthlyTab === tab.id ? "subnav-button active" : "subnav-button"} onClick={() => setActiveMonthlyTab(tab.id)}>
                  {tab.label}
                </button>
              ))}
            </div>
            {!selectedStore ? (
              <div className="empty-card">店舗を追加してから月締めを行ってください。</div>
            ) : (
              <>
                {activeMonthlyTab === "target" && (
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <p className="eyebrow">TARGET</p>
                        <h2>月間目標設定</h2>
                      </div>
                    </div>
                    <div className="input-grid">
                      <Field label="売上目標（税込）" value={target.targetSales} onChange={(value) => updateTargetField("targetSales", value)} suffix="円" />
                      <Field label="技術売上目標（税込）" value={target.targetTechnicalSales} onChange={(value) => updateTargetField("targetTechnicalSales", value)} suffix="円" />
                      <Field label="店販売上目標（税込）" value={target.targetRetailSales} onChange={(value) => updateTargetField("targetRetailSales", value)} suffix="円" />
                      <Field label="客数目標" value={target.targetCustomers} onChange={(value) => updateTargetField("targetCustomers", value)} suffix="名" />
                      <Field label="客単価目標" value={target.targetAverageSpend} onChange={(value) => updateTargetField("targetAverageSpend", value)} suffix="円" />
                      <Field label="新規客数目標" value={target.targetNewCustomers} onChange={(value) => updateTargetField("targetNewCustomers", value)} suffix="名" />
                      <Field label="再来客数目標" value={target.targetRepeatCustomers} onChange={(value) => updateTargetField("targetRepeatCustomers", value)} suffix="名" />
                    </div>
                  </section>
                )}

                {activeMonthlyTab === "fixed" && (
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <p className="eyebrow">FIXED</p>
                        <h2>月固定費</h2>
                      </div>
                      <button className="secondary-button" type="button" onClick={() => copyPreviousMonthData("fixed")}>前月をコピー</button>
                    </div>
                    <form className="inline-form" onSubmit={submitFixedCost}>
                      <input value={fixedForm.name} onChange={(event) => setFixedForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="項目名" />
                      <select value={fixedForm.category} onChange={(event) => setFixedForm((prev) => ({ ...prev, category: event.target.value }))}>
                        {fixedCostCategories.map((category) => <option key={category} value={category}>{category}</option>)}
                      </select>
                      <input value={fixedForm.amount} onChange={(event) => setFixedForm((prev) => ({ ...prev, amount: event.target.value }))} placeholder="金額" type="number" />
                      <input type="month" value={fixedForm.startMonth || ""} onChange={(event) => setFixedForm((prev) => ({ ...prev, startMonth: event.target.value }))} placeholder="開始月" />
                      <input type="month" value={fixedForm.endMonth || ""} onChange={(event) => setFixedForm((prev) => ({ ...prev, endMonth: event.target.value }))} placeholder="終了月" />
                      <select value={fixedForm.applyMode} onChange={(event) => setFixedForm((prev) => ({ ...prev, applyMode: event.target.value }))}>
                        <option value="this-month">当月のみ</option>
                        <option value="this-month-onward">以降適用</option>
                      </select>
                      <input value={fixedForm.memo || ""} onChange={(event) => setFixedForm((prev) => ({ ...prev, memo: event.target.value }))} placeholder="備考" />
                      <button className="primary-button" type="submit">追加 / 更新</button>
                    </form>
                    <div className="list-card">
                      {fixedCosts.map((item) => (
                        <div key={item.id} className="list-row">
                          <div>
                            <strong>{item.name}</strong>
                            <small>{item.category} / {money(item.amount)}{item.startMonth || item.endMonth ? ` / ${item.startMonth || ""}${item.endMonth ? `〜${item.endMonth}` : ""}` : ""}{item.memo ? ` / ${item.memo}` : ""}</small>
                          </div>
                          <div className="row-actions">
                            <button className="text-button" type="button" onClick={() => editFixedCost(item)}>編集</button>
                            <button className="text-button danger" type="button" onClick={() => removeFixedCost(item.id)}>削除</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {activeMonthlyTab === "variable" && (
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <p className="eyebrow">VARIABLE</p>
                        <h2>月販管費入力</h2>
                      </div>
                      <button className="secondary-button" type="button" onClick={() => copyPreviousMonthData("variable")}>前月をコピー</button>
                    </div>
                    <form className="inline-form" onSubmit={submitVariableCost}>
                      <input value={variableForm.name} onChange={(event) => setVariableForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="項目名" />
                      <select value={variableForm.category} onChange={(event) => setVariableForm((prev) => ({ ...prev, category: event.target.value }))}>
                        {variableCostCategories.map((category) => <option key={category} value={category}>{category}</option>)}
                      </select>
                      <input value={variableForm.amount} onChange={(event) => setVariableForm((prev) => ({ ...prev, amount: event.target.value }))} placeholder="金額" type="number" />
                      <input type="date" value={variableForm.incurredDate || ""} onChange={(event) => setVariableForm((prev) => ({ ...prev, incurredDate: event.target.value }))} placeholder="発生日" />
                      <select value={variableForm.type} onChange={(event) => setVariableForm((prev) => ({ ...prev, type: event.target.value }))}>
                        <option value="regular">定例</option>
                        <option value="temporary">臨時</option>
                      </select>
                      <input value={variableForm.memo || ""} onChange={(event) => setVariableForm((prev) => ({ ...prev, memo: event.target.value }))} placeholder="備考" />
                      <button className="primary-button" type="submit">追加 / 更新</button>
                    </form>
                    <div className="list-card">
                      {variableCosts.map((item) => (
                        <div key={item.id} className="list-row">
                          <div>
                            <strong>{item.name}</strong>
                            <small>{item.category} / {money(item.amount)}{item.incurredDate ? ` / ${item.incurredDate}` : ""}{item.type === "temporary" ? " / 臨時" : " / 定例"}{item.memo ? ` / ${item.memo}` : ""}</small>
                          </div>
                          <div className="row-actions">
                            <button className="text-button" type="button" onClick={() => editVariableCost(item)}>編集</button>
                            <button className="text-button danger" type="button" onClick={() => removeVariableCost(item.id)}>削除</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {activeMonthlyTab === "closing" && (
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <p className="eyebrow">MANAGEMENT</p>
                        <h2>管理画面</h2>
                      </div>
                      <button className="secondary-button" type="button" onClick={() => copyPreviousMonthData("closing")}>前月をコピー</button>
                    </div>
                    <form className="inline-form" onSubmit={submitClosingItem}>
                      <input value={closingForm.name} onChange={(event) => setClosingForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="項目名" />
                      <input value={closingForm.amount} onChange={(event) => setClosingForm((prev) => ({ ...prev, amount: event.target.value }))} placeholder="金額" type="number" />
                      <select value={closingForm.category} onChange={(event) => setClosingForm((prev) => ({ ...prev, category: event.target.value }))}>
                        {expenseCategories.map((category) => <option key={category} value={category}>{category}</option>)}
                      </select>
                      <button className="primary-button" type="submit">追加 / 更新</button>
                    </form>
                    <div className="toggle-panel">
                      <div>
                        <strong>{monthClosingStatus.closed ? "月締め済み" : "未締め"}</strong>
                        <small>{monthClosingStatus.lockedAt ? `最終確定: ${new Date(monthClosingStatus.lockedAt).toLocaleString("ja-JP")}` : "締め状態はまだ未設定です"}</small>
                      </div>
                      <button className={monthClosingStatus.closed ? "secondary-button" : "primary-button"} type="button" onClick={toggleMonthClosing}>
                        {monthClosingStatus.closed ? "締めを解除" : "月締めを確定"}
                      </button>
                    </div>
                    <div className="summary-grid">
                      <div className="summary-card"><span>店販比率</span><strong>{percent(summary.retailRatio || 0)}</strong></div>
                      <div className="summary-card"><span>人件費率</span><strong>{percent(summary.laborRate)}</strong></div>
                      <div className="summary-card"><span>材料費率</span><strong>{percent(summary.materialRate)}</strong></div>
                      <div className="summary-card"><span>固定費率</span><strong>{percent(summary.fixedRate)}</strong></div>
                      <div className="summary-card"><span>販管費率</span><strong>{percent(summary.variableRate)}</strong></div>
                      <div className="summary-card"><span>営業利益率</span><strong>{percent(summary.operatingMargin)}</strong></div>
                    </div>
                    <div className="list-card">
                      {closingItems.map((item) => (
                        <div key={item.id} className="list-row">
                          <div>
                            <strong>{item.name}</strong>
                            <small>{item.category} / {money(item.amount)}</small>
                          </div>
                          <div className="row-actions">
                            <button className="text-button" type="button" onClick={() => editClosingItem(item)}>編集</button>
                            <button className="text-button danger" type="button" onClick={() => removeClosingItem(item.id)}>削除</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {activeMonthlyTab === "pnl" && (
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <p className="eyebrow">P&L</p>
                        <h2>月次損益表</h2>
                      </div>
                    </div>
                    <div className="summary-grid">
                      <div className="summary-card"><span>総売上（税込）</span><strong>{money(summary.sales)}</strong></div>
                      <div className="summary-card"><span>技術売上（税込）</span><strong>{money(summary.technicalSales)}</strong></div>
                      <div className="summary-card"><span>店販売上（税込）</span><strong>{money(summary.retailSales)}</strong></div>
                      <div className="summary-card"><span>その他売上（税込）</span><strong>{money(summary.otherSales)}</strong></div>
                      <div className="summary-card"><span>税込売上</span><strong>{money(taxSummary.grossSales)}</strong></div>
                      <div className="summary-card"><span>税抜売上</span><strong>{money(taxSummary.taxExclusiveSales)}</strong></div>
                      <div className="summary-card"><span>消費税相当額</span><strong>{money(taxSummary.taxAmount)}</strong></div>
                      <div className="summary-card"><span>適用税率</span><strong>{percent(taxSummary.rate * 100)}</strong></div>
                      <div className="summary-card"><span>税込費用</span><strong>{money(summary.expenseTotal)}</strong></div>
                      <div className="summary-card"><span>税抜費用</span><strong>{money(taxSummary.taxExclusiveExpenses)}</strong></div>
                      <div className="summary-card"><span>概算納税額</span><strong>{money(taxSummary.estimatedTax)}</strong></div>
                      <div className="summary-card"><span>人件費</span><strong>{money(summary.laborCost)}</strong></div>
                      <div className="summary-card"><span>材料費</span><strong>{money(summary.materialCost)}</strong></div>
                      <div className="summary-card"><span>発注費</span><strong>{money(summary.orderCost)}</strong></div>
                      <div className="summary-card"><span>固定費合計</span><strong>{money(summary.fixedCost)}</strong></div>
                      <div className="summary-card"><span>販管費合計</span><strong>{money(summary.variableCost)}</strong></div>
                      <div className="summary-card"><span>設備投資</span><strong>{money(summary.equipmentInvestmentCost)}</strong></div>
                      <div className="summary-card"><span>その他経費</span><strong>{money(summary.otherCost)}</strong></div>
                      <div className="summary-card"><span>費用合計</span><strong>{money(summary.expenseTotal)}</strong></div>
                      <div className="summary-card"><span>粗利益</span><strong>{money(summary.grossProfit)}</strong></div>
                      <div className="summary-card"><span>営業利益</span><strong>{money(summary.operatingProfit)}</strong></div>
                      <div className="summary-card"><span>調整後営業利益</span><strong>{money(summary.adjustedOperatingProfit)}</strong></div>
                      <div className="summary-card"><span>営業利益率</span><strong>{percent(summary.operatingMargin)}</strong></div>
                      <div className="summary-card"><span>調整後営業利益率</span><strong>{percent(summary.adjustedOperatingMargin)}</strong></div>
                    </div>
                    <div className="helper-text">消費税額は簡易計算による参考値です。実際の申告額は課税区分、控除対象、免税・簡易課税制度などにより異なります。</div>
                    <div className="panel-heading compact">
                      <div>
                        <p className="eyebrow">TARGET</p>
                        <h3>客数目標</h3>
                      </div>
                    </div>
                    <div className="summary-grid">
                      <div className="summary-card"><span>目標客数</span><strong>{customerTargetSummary.targetCustomers}名</strong></div>
                      <div className="summary-card"><span>現在客数</span><strong>{customerTargetSummary.customers}名</strong></div>
                      <div className="summary-card"><span>不足客数</span><strong>{customerTargetSummary.remainingCustomers}名</strong></div>
                      <div className="summary-card"><span>達成率</span><strong>{percent(customerTargetSummary.achievementRate)}</strong></div>
                      <div className="summary-card"><span>残り営業日数</span><strong>{customerTargetSummary.remainingBusinessDays}</strong></div>
                      <div className="summary-card"><span>残り1日あたり必要客数</span><strong>{customerTargetSummary.remainingCustomersPerDay.toFixed(1)}名</strong></div>
                      <div className="summary-card"><span>現在のペースでの月末予測客数</span><strong>{customerTargetSummary.forecastCustomers.toFixed(1)}名</strong></div>
                      <div className="summary-card"><span>状態</span><strong>{customerTargetSummary.statusLabel}</strong></div>
                    </div>
                    <div className="panel-heading compact">
                      <div>
                        <p className="eyebrow">AI</p>
                        <h3>AI経営分析</h3>
                      </div>
                    </div>
                    <div className="list-card">
                      {aiAnalysis.summary.map((item) => <div key={item} className="list-row"><strong>{item}</strong></div>)}
                      <div className="list-row"><strong>優先項目</strong><small>{aiAnalysis.priorities.join(" / ")}</small></div>
                      <div className="list-row"><strong>アクション</strong><small>{aiAnalysis.notes.slice(0, 3).join(" / ")}</small></div>
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        )}

        {activePage === "stores" && (
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">STORE</p>
                <h2>店舗追加</h2>
              </div>
            </div>
            <div className="inline-form">
              <input value={newStoreName} onChange={(event) => setNewStoreName(event.target.value)} placeholder="新しい店舗名" />
              <button className="primary-button" type="button" onClick={handleStoreAdd}>追加</button>
            </div>
            <div className="list-card">
              {stores.length ? stores.map((storeName) => (
                <div key={storeName} className="list-row">
                  <div>
                    <strong>{storeName}</strong>
                    <small>{selectedStore === storeName ? "選択中" : "未選択"}</small>
                  </div>
                  <div className="row-actions">
                    <button className="text-button" type="button" onClick={() => setAppState((prev) => ({ ...prev, selectedStore: storeName }))}>選択</button>
                    <button className="text-button" type="button" onClick={() => startEditStore(storeName)}>編集</button>
                    <button className="text-button danger" type="button" onClick={() => handleStoreDelete(storeName)}>削除</button>
                  </div>
                </div>
              )) : <div className="empty-state">まだ店舗はありません</div>}
            </div>
            {storeEditId ? (
              <form className="inline-form" onSubmit={handleStoreUpdate}>
                <input value={storeFormName} onChange={(event) => setStoreFormName(event.target.value)} placeholder="店舗名を変更" />
                <button className="primary-button" type="submit">更新</button>
                <button className="secondary-button" type="button" onClick={() => { setStoreEditId(""); setStoreFormName(""); }}>キャンセル</button>
              </form>
            ) : null}
          </section>
        )}

        {activePage === "settings" && (
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">PREFS</p>
                <h2>表示設定</h2>
              </div>
              <div className={`status-pill ${saveStatus.error ? "error" : saveStatus.status === "saving" ? "saving" : "saved"}`}>
                {saveStatus.message || "自動保存済み"}
              </div>
            </div>
            <div className="toggle-panel">
              <div>
                <strong>ダークモード</strong>
                <small>{theme === "dark" ? "オン" : "オフ"}</small>
              </div>
              <button className="secondary-button" type="button" onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}>
                {theme === "dark" ? "ライトに切替" : "ダークに切替"}
              </button>
            </div>
            <div className="toggle-panel">
              <div>
                <strong>その他売上を使用する</strong>
                <small>{appState.preferences?.showOtherSales ? "オン" : "オフ"}</small>
              </div>
              <button className="secondary-button" type="button" onClick={() => setAppState((prev) => ({ ...prev, preferences: { ...prev.preferences, showOtherSales: !Boolean(prev.preferences?.showOtherSales) } }))}>
                {appState.preferences?.showOtherSales ? "オフにする" : "オンにする"}
              </button>
            </div>
            <div className="empty-card">今後はログイン、CSV/Excel出力、PWA対応、KPIダッシュボードなどを追加しやすい構成です。</div>
          </section>
        )}
      </main>
    </div>
  );
}

function MetricCard({ label, value }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Field({ label, value, onChange, suffix = "", type = "text", disabled = false }) {
  const normalizedValue = value === undefined || value === null ? "" : value;
  return (
    <label className="field">
      <span>{label}</span>
      <div className="input-with-suffix">
        <input type={type} value={normalizedValue} onChange={(event) => onChange(event.target.value)} disabled={disabled} />
        {suffix ? <span>{suffix}</span> : null}
      </div>
    </label>
  );
}

export default App;
