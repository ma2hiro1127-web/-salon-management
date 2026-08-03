import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { defaultActual, defaultAppState, defaultDailyEntry, defaultTarget } from "./data/defaults";
import {
  STORAGE_KEYS,
  buildMonthKey,
  calculateMonthSummary,
  getBusinessDayDates,
  getMonthInfo,
  getTargetForStoreMonth,
  money,
  moneyDiff,
  parseNumber,
  percent,
  readAppState,
  readStorage,
  writeAppState,
} from "./utils/storage";

const tabs = [
  ["dashboard", "ダッシュボード"],
  ["sales", "売上・費用"],
  ["comparison", "店舗比較"],
  ["settings", "設定"],
];

const rankingOptions = [
  ["sales", "売上"],
  ["achievement", "目標達成率"],
  ["forecast", "月末着地達成率"],
  ["profit", "営業利益"],
  ["margin", "営業利益率"],
  ["avgSpend", "客単価"],
  ["productivity", "スタッフ生産性"],
];

const formatInputNumber = (value) => {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  if (!digits) return "";
  const parsed = Number(digits);
  return Number.isFinite(parsed) ? new Intl.NumberFormat("ja-JP").format(parsed) : "";
};

const buildMonthCalendar = (monthValue, entries) => {
  const { yearNumber, monthNumber, daysInMonth } = getMonthInfo(monthValue);
  const firstDate = new Date(yearNumber, monthNumber - 1, 1);
  const startWeekday = firstDate.getDay();
  const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7;
  const filledSet = new Set((entries || []).map((entry) => String(entry.date || "")));
  const cells = [];

  for (let index = 0; index < totalCells; index += 1) {
    const dayNumber = index - startWeekday + 1;
    const inMonth = dayNumber >= 1 && dayNumber <= daysInMonth;
    const iso = inMonth ? `${monthValue}-${String(dayNumber).padStart(2, "0")}` : "";
    const isFilled = !!iso && filledSet.has(iso);
    cells.push({
      key: iso || `blank-${index}`,
      day: inMonth ? dayNumber : "",
      iso,
      inMonth,
      isFilled,
    });
  }

  return cells;
};

function App() {
  const [theme, setTheme] = useState(() => {
    const savedTheme = readStorage(STORAGE_KEYS.theme, "light");
    return savedTheme === "dark" ? "dark" : "light";
  });
  const [activeTab, setActiveTab] = useState("dashboard");
  const [rankingMetric, setRankingMetric] = useState("sales");
  const [appState, setAppState] = useState(() => readAppState());
  const [installPrompt, setInstallPrompt] = useState(null);
  const [newStoreName, setNewStoreName] = useState("");
  const [dailyForm, setDailyForm] = useState(defaultDailyEntry);
  const [formErrors, setFormErrors] = useState({});
  const [saveNotice, setSaveNotice] = useState("");

  const { stores, selectedStore, selectedMonth } = appState;
  const storeKey = buildMonthKey(selectedStore, selectedMonth);
  const target = getTargetForStoreMonth(appState, selectedStore, selectedMonth);
  const actual = appState.actuals?.[storeKey] || { ...defaultActual };
  const dailyEntries = (appState.dailyResults?.[storeKey] || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const summary = useMemo(() => calculateMonthSummary(appState, selectedStore, selectedMonth), [appState, selectedStore, selectedMonth]);

  const businessDates = useMemo(() => getBusinessDayDates(selectedMonth, target.holidayDates || []), [selectedMonth, target.holidayDates]);
  const monthCalendarDays = useMemo(() => buildMonthCalendar(selectedMonth, dailyEntries), [selectedMonth, dailyEntries]);

  const chartPoints = useMemo(() => {
    const targetPerDay = businessDates.length ? Number(target.targetSales || 0) / businessDates.length : 0;
    const map = {};
    dailyEntries.forEach((entry) => {
      map[entry.date] = Number(entry.technicalSales || 0) + Number(entry.retailSales || 0);
    });

    return businessDates.map((date) => ({
      date,
      target: targetPerDay,
      actual: map[date] || 0,
    }));
  }, [businessDates, dailyEntries, target.targetSales]);

  const cumulativeTarget = useMemo(() => {
    let runningTarget = 0;
    let runningActual = 0;
    return businessDates.map((date) => {
      const dayEntry = dailyEntries.find((item) => item.date === date);
      const daySales = dayEntry ? Number(dayEntry.technicalSales || 0) + Number(dayEntry.retailSales || 0) : 0;
      runningTarget += Number(target.targetSales || 0) / Math.max(businessDates.length, 1);
      runningActual += daySales;
      return { date, target: runningTarget, actual: runningActual };
    });
  }, [businessDates, dailyEntries, target.targetSales]);

  const alertItems = useMemo(() => {
    const rows = [];

    if (summary.targetAchievement < 100 && summary.targetAchievement >= 95) {
      rows.push({ label: "月間達成率", value: `${percent(summary.targetAchievement)}`, tone: "warning", reason: "目標に近いが確認が必要" });
    } else if (summary.targetAchievement < 95) {
      rows.push({ label: "月間達成率", value: `${percent(summary.targetAchievement)}`, tone: "danger", reason: "目標未達" });
    }

    if (summary.forecast < Number(target.targetSales || 0)) {
      rows.push({ label: "月末着地予測", value: `${money(summary.forecast)} / ${money(target.targetSales)}`, tone: "danger", reason: "目標未達の見込み" });
    }

    if (Number(target.targetLaborRate || 0) > 0 && summary.laborRate > Number(target.targetLaborRate || 0)) {
      rows.push({ label: "人件費率", value: `${percent(summary.laborRate)} > ${percent(target.targetLaborRate)}`, tone: "danger", reason: "目標超過" });
    }

    if (Number(target.targetMaterialRate || 0) > 0 && summary.materialRate > Number(target.targetMaterialRate || 0)) {
      rows.push({ label: "材料費率", value: `${percent(summary.materialRate)} > ${percent(target.targetMaterialRate)}`, tone: "danger", reason: "目標超過" });
    }

    if (Number(target.targetAdRate || 0) > 0 && summary.adRate > Number(target.targetAdRate || 0)) {
      rows.push({ label: "広告費率", value: `${percent(summary.adRate)} > ${percent(target.targetAdRate)}`, tone: "danger", reason: "目標超過" });
    }

    if (Number(target.targetOperatingMargin || 0) > 0 && summary.operatingMargin < Number(target.targetOperatingMargin || 0)) {
      rows.push({ label: "営業利益率", value: `${percent(summary.operatingMargin)} < ${percent(target.targetOperatingMargin)}`, tone: "danger", reason: "目標未達" });
    }

    if (Number(target.targetAverageSpend || 0) > 0 && summary.averageSpend < Number(target.targetAverageSpend || 0)) {
      rows.push({ label: "客単価", value: `${money(summary.averageSpend)} < ${money(target.targetAverageSpend)}`, tone: "danger", reason: "目標未達" });
    }

    if (Number(target.targetRetailRatio || 0) > 0 && summary.retailRatio < Number(target.targetRetailRatio || 0)) {
      rows.push({ label: "店販比率", value: `${percent(summary.retailRatio)} < ${percent(target.targetRetailRatio)}`, tone: "danger", reason: "目標未達" });
    }

    return rows;
  }, [summary, target]);

  useEffect(() => {
    const onBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.theme, JSON.stringify(theme));
  }, [theme]);

  useEffect(() => {
    writeAppState(appState);
  }, [appState]);

  const updateTargetField = (field, value) => {
    setAppState((prev) => {
      const key = buildMonthKey(prev.selectedStore, prev.selectedMonth);
      const existing = prev.targets?.[key] || { ...defaultTarget };
      const nextValue = field === "holidayDates"
        ? String(value)
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
        : parseNumber(value);

      return {
        ...prev,
        targets: {
          ...prev.targets,
          [key]: {
            ...existing,
            [field]: nextValue,
          },
        },
      };
    });
  };

  const updateActualField = (field, value) => {
    setAppState((prev) => {
      const key = buildMonthKey(prev.selectedStore, prev.selectedMonth);
      const existing = prev.actuals?.[key] || { ...defaultActual };
      return {
        ...prev,
        actuals: {
          ...prev.actuals,
          [key]: {
            ...existing,
            [field]: parseNumber(value),
          },
        },
      };
    });
  };

  const copyPreviousDayToToday = () => {
    const baseDate = dailyForm.date || new Date().toISOString().slice(0, 10);
    const currentDate = new Date(`${baseDate}T00:00:00`);
    const previousDate = new Date(currentDate);
    previousDate.setDate(currentDate.getDate() - 1);
    const previousIso = previousDate.toISOString().slice(0, 10);
    const previousEntry = dailyEntries.find((entry) => entry.date === previousIso);
    if (!previousEntry) {
      setSaveNotice("前日の実績がありません");
      return;
    }

    setDailyForm((prev) => ({
      ...defaultDailyEntry,
      date: baseDate,
      technicalSales: previousEntry.technicalSales || 0,
      retailSales: previousEntry.retailSales || 0,
      customers: previousEntry.customers || 0,
      newCustomers: previousEntry.newCustomers || 0,
      repeatCustomers: previousEntry.repeatCustomers || 0,
      staffCount: previousEntry.staffCount || 0,
      memo: previousEntry.memo || "",
    }));
    setSaveNotice("前日のデータを反映しました");
  };

  const submitDailyForm = (event) => {
    if (event?.preventDefault) event.preventDefault();

    const requiredFields = {
      date: dailyForm.date,
      technicalSales: dailyForm.technicalSales,
      retailSales: dailyForm.retailSales,
      customers: dailyForm.customers,
      staffCount: dailyForm.staffCount,
    };

    const nextErrors = Object.entries(requiredFields).reduce((acc, [key, value]) => {
      if (!value && value !== 0) {
        acc[key] = true;
      }
      return acc;
    }, {});

    setFormErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setSaveNotice("入力漏れがあります");
      return;
    }

    setAppState((prev) => {
      const key = buildMonthKey(prev.selectedStore, prev.selectedMonth);
      const list = prev.dailyResults?.[key] || [];
      const nextEntry = {
        ...dailyForm,
        technicalSales: parseNumber(dailyForm.technicalSales),
        retailSales: parseNumber(dailyForm.retailSales),
        customers: parseNumber(dailyForm.customers),
        newCustomers: parseNumber(dailyForm.newCustomers),
        repeatCustomers: parseNumber(dailyForm.repeatCustomers),
        staffCount: parseNumber(dailyForm.staffCount),
      };

      const filtered = dailyForm.id
        ? list.map((item) => (item.id === dailyForm.id ? { ...item, ...nextEntry } : item))
        : [...list, { ...nextEntry, id: crypto.randomUUID() }];

      return {
        ...prev,
        dailyResults: {
          ...prev.dailyResults,
          [key]: filtered,
        },
      };
    });

    setSaveNotice("保存しました");
    setFormErrors({});
    setDailyForm(defaultDailyEntry);
  };

  const removeDailyEntry = (id) => {
    setAppState((prev) => {
      const key = buildMonthKey(prev.selectedStore, prev.selectedMonth);
      const list = prev.dailyResults?.[key] || [];
      return {
        ...prev,
        dailyResults: {
          ...prev.dailyResults,
          [key]: list.filter((item) => item.id !== id),
        },
      };
    });
  };

  const exportCsv = () => {
    const rows = [
      ["店舗", selectedStore],
      ["対象月", selectedMonth],
      ["月間目標売上", target.targetSales],
      ["現在売上", summary.sales],
      ["月末着地予測", summary.forecast],
      ["月間達成率", summary.targetAchievement.toFixed(1)],
      ["粗利益", summary.grossProfit],
      ["営業利益", summary.operatingProfit],
      ["営業利益率", summary.operatingMargin.toFixed(1)],
      ["人件費率", summary.laborRate.toFixed(1)],
      ["材料費率", summary.materialRate.toFixed(1)],
      ["広告費率", summary.adRate.toFixed(1)],
      ["客単価", summary.averageSpend.toFixed(0)],
      ["店販比率", summary.retailRatio.toFixed(1)],
    ];

    const csv = "\uFEFF" + rows.map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${selectedStore}_${selectedMonth}_売上管理.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const addStore = () => {
    const trimmed = newStoreName.trim();
    if (!trimmed || stores.includes(trimmed)) return;
    setAppState((prev) => ({
      ...prev,
      stores: [...prev.stores, trimmed],
      selectedStore: trimmed,
    }));
    setNewStoreName("");
  };

  const comparisonRows = stores
    .map((storeName) => {
      const monthTarget = getTargetForStoreMonth(appState, storeName, selectedMonth);
      const monthActual = appState.actuals?.[buildMonthKey(storeName, selectedMonth)] || { ...defaultActual };
      const entries = appState.dailyResults?.[buildMonthKey(storeName, selectedMonth)] || [];
      const sales = entries.reduce((total, item) => total + Number(item.technicalSales || 0) + Number(item.retailSales || 0), 0);
      const customers = entries.reduce((total, item) => total + Number(item.customers || 0), 0);
      const retailSales = entries.reduce((total, item) => total + Number(item.retailSales || 0), 0);
      const grossProfit = sales - (Number(monthActual.materialCost || 0) + Number(monthActual.retailCost || 0));
      const operatingExpenses = Number(monthActual.laborCost || 0) + Number(monthActual.advertising || 0) + Number(monthActual.rent || 0) + Number(monthActual.utilities || 0) + Number(monthActual.systemFees || 0) + Number(monthActual.miscellaneous || 0);
      const operatingProfit = grossProfit - operatingExpenses;
      const averageSpend = customers ? sales / customers : 0;
      const retailRatio = sales ? (retailSales / sales) * 100 : 0;
      const laborRate = sales ? (Number(monthActual.laborCost || 0) / sales) * 100 : 0;
      const materialRate = sales ? (Number(monthActual.materialCost || 0) / sales) * 100 : 0;
      const totalStaff = entries.reduce((total, item) => total + Number(item.staffCount || 0), 0);
      const productivity = totalStaff ? sales / totalStaff : 0;
      const achievement = Number(monthTarget.targetSales || 0) ? (sales / monthTarget.targetSales) * 100 : 0;
      const forecast = sales * 1.03;
      return {
        storeName,
        sales,
        targetSales: Number(monthTarget.targetSales || 0),
        achievement,
        forecast,
        operatingProfit,
        operatingMargin: sales ? (operatingProfit / sales) * 100 : 0,
        averageSpend,
        retailRatio,
        laborRate,
        materialRate,
        productivity,
      };
    })
    .sort((a, b) => {
      switch (rankingMetric) {
        case "achievement": return b.achievement - a.achievement;
        case "forecast": return b.forecast - a.forecast;
        case "profit": return b.operatingProfit - a.operatingProfit;
        case "margin": return b.operatingMargin - a.operatingMargin;
        case "avgSpend": return b.averageSpend - a.averageSpend;
        case "productivity": return b.productivity - a.productivity;
        default: return b.sales - a.sales;
      }
    });

  const metricRows = [
    { label: "月間達成率", current: summary.targetAchievement, target: 100, type: "sales" },
    { label: "営業利益率", current: summary.operatingMargin, target: Number(target.targetOperatingMargin || 0), type: "rateLower" },
    { label: "人件費率", current: summary.laborRate, target: Number(target.targetLaborRate || 0), type: "rateLower" },
    { label: "材料費率", current: summary.materialRate, target: Number(target.targetMaterialRate || 0), type: "rateLower" },
    { label: "広告費率", current: summary.adRate, target: Number(target.targetAdRate || 0), type: "rateLower" },
    { label: "客単価", current: summary.averageSpend, target: Number(target.targetAverageSpend || 0), type: "sales" },
    { label: "店販比率", current: summary.retailRatio, target: Number(target.targetRetailRatio || 0), type: "sales" },
  ];

  const kpiRows = metricRows.map((row) => {
    const diff = row.current - row.target;
    const achievement = row.target ? (row.current / row.target) * 100 : 0;
    const tone =
      row.type === "rateLower"
        ? row.current <= row.target
          ? "good"
          : Math.abs(row.current - row.target) <= row.target * 0.05
            ? "warning"
            : "danger"
        : row.current >= row.target
          ? "good"
          : Math.abs(row.current - row.target) <= row.target * 0.05
            ? "warning"
            : "danger";

    return { ...row, diff, achievement, tone };
  });

  const businessDayCount = businessDates.length || 1;

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
            {tabs.map(([id, label]) => (
              <button key={id} className={activeTab === id ? "nav-button active" : "nav-button"} onClick={() => setActiveTab(id)}>
                {label}
              </button>
            ))}
          </nav>
        </div>
        <div className="sidebar-footer">
          <small>入力データはこの端末に自動保存されます</small>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">SALON MANAGEMENT</p>
            <h1>{tabs.find(([id]) => id === activeTab)?.[1]}</h1>
          </div>

          <div className="filters">
            <label>
              店舗
              <select value={selectedStore} onChange={(event) => setAppState((prev) => ({ ...prev, selectedStore: event.target.value }))}>
                {stores.map((storeName) => (
                  <option key={storeName}>{storeName}</option>
                ))}
              </select>
            </label>

            <label>
              対象月
              <input type="month" value={selectedMonth} onChange={(event) => setAppState((prev) => ({ ...prev, selectedMonth: event.target.value }))} />
            </label>
          </div>
        </header>

        {activeTab === "dashboard" && (
          <>
            <section className="hero-grid">
              <HeroCard label="月間目標売上" value={money(target.targetSales)} tone="default" />
              <HeroCard label="現在売上" value={money(summary.sales)} tone={summary.targetAchievement >= 100 ? "positive" : "neutral"} />
              <HeroCard label="月末着地予測" value={money(summary.forecast)} tone={summary.forecast >= target.targetSales ? "positive" : "negative"} />
              <HeroCard label="目標との差額" value={moneyDiff(summary.targetGap)} tone={summary.targetGap >= 0 ? "positive" : "negative"} />
              <HeroCard label="残り必要売上" value={money(summary.remainingSalesTarget)} tone={summary.remainingSalesTarget > 0 ? "negative" : "positive"} />
              <HeroCard label="残り1営業日あたり" value={money(summary.neededPerDay)} tone={summary.neededPerDay > 0 ? "negative" : "positive"} />
              <HeroCard label="今日の目標" value={money(summary.todayTarget)} tone="neutral" />
              <HeroCard label="今日の実績" value={money(summary.todayActual)} tone={summary.todayActual >= summary.todayTarget ? "positive" : "negative"} />
              <HeroCard label="今日の差額" value={moneyDiff(summary.todayGap)} tone={summary.todayGap >= 0 ? "positive" : "negative"} />
            </section>

            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">PROGRESS</p>
                  <h2>月間達成率</h2>
                </div>
                <strong>{percent(summary.targetAchievement)}</strong>
              </div>
              <div className="progress-bar">
                <span style={{ width: `${Math.min(summary.targetAchievement, 100)}%` }} />
              </div>
              <div className="status-row">
                <span>営業日消化率: {percent(summary.dayProgress)}</span>
                <span>営業日: {summary.completedDays} / {businessDayCount}</span>
                <span>残り営業日: {summary.remainingBusinessDays}</span>
              </div>
            </section>

            <section className="summary-banner">
              <div className="summary-banner-item">
                <span>残り必要売上</span>
                <strong>{money(summary.remainingSalesTarget)}</strong>
              </div>
              <div className="summary-banner-item">
                <span>残り1営業日あたり必要売上</span>
                <strong>{money(summary.neededPerDay)}</strong>
              </div>
              <div className="summary-banner-item">
                <span>月末着地予測との差額</span>
                <strong className={summary.forecastGap >= 0 ? "positive-text" : "negative-text"}>{moneyDiff(summary.forecastGap)}</strong>
              </div>
            </section>

            <section className="two-column">
              <article className="panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">CHART</p>
                    <h2>日別目標 vs 実績</h2>
                  </div>
                </div>
                <MiniLineChart data={chartPoints} />
              </article>

              <article className="panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">CHART</p>
                    <h2>累計目標 vs 累計実績</h2>
                  </div>
                </div>
                <MiniLineChart data={cumulativeTarget} />
              </article>
            </section>

            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">KPI</p>
                  <h2>KPI目標 / 現在値 / 差 / 達成率 / 判定</h2>
                </div>
              </div>
              <div className="kpi-table-wrap">
                <table className="kpi-table">
                  <thead>
                    <tr>
                      <th>項目</th>
                      <th>目標</th>
                      <th>現在</th>
                      <th>差</th>
                      <th>達成率</th>
                      <th>判定</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kpiRows.map((row) => (
                      <tr key={row.label}>
                        <td>{row.label}</td>
                        <td>{row.type === "sales" ? money(row.target) : percent(row.target)}</td>
                        <td>{row.type === "sales" ? money(row.current) : percent(row.current)}</td>
                        <td className={row.diff >= 0 ? "positive-text" : "negative-text"}>{row.type === "sales" ? moneyDiff(row.diff) : `${row.diff >= 0 ? "+" : ""}${percent(Math.abs(row.diff))}`}</td>
                        <td>{percent(row.achievement)}</td>
                        <td><span className={`tag tone-${row.tone}`}>{row.tone === "good" ? "良好" : row.tone === "warning" ? "要確認" : "要改善"}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">ALERT</p>
                  <h2>要確認項目</h2>
                </div>
              </div>
              {alertItems.length ? (
                <div className="alert-list">
                  {alertItems.map((item) => (
                    <div key={item.label} className={`alert-pill tone-${item.tone}`}>
                      <strong>{item.label}</strong>
                      <span>{item.value}</span>
                      <small>{item.reason}</small>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state-box">確認が必要な項目はありません</div>
              )}
            </section>
          </>
        )}

        {activeTab === "sales" && (
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">TARGET</p>
                <h2>月間目標設定</h2>
              </div>
              <button className="primary-button" onClick={exportCsv}>CSV出力</button>
            </div>

            <div className="input-grid">
              <NumberField label="月間目標売上" value={target.targetSales} suffix="円" onChange={(value) => updateTargetField("targetSales", value)} />
              <NumberField label="月間営業日" value={target.operatingDays || businessDayCount} suffix="日" onChange={(value) => updateTargetField("operatingDays", value)} />
              <TextField label="休業日（例: 2026-08-15, 2026-08-16）" value={(target.holidayDates || []).join(", ")} onChange={(value) => updateTargetField("holidayDates", value)} />
              <NumberField label="技術売上目標" value={target.targetTechnicalSales} suffix="円" onChange={(value) => updateTargetField("targetTechnicalSales", value)} />
              <NumberField label="店販売上目標" value={target.targetRetailSales} suffix="円" onChange={(value) => updateTargetField("targetRetailSales", value)} />
              <NumberField label="客数目標" value={target.targetCustomers} suffix="名" onChange={(value) => updateTargetField("targetCustomers", value)} />
              <NumberField label="客単価目標" value={target.targetAverageSpend} suffix="円" onChange={(value) => updateTargetField("targetAverageSpend", value)} />
              <NumberField label="新規客数目標" value={target.targetNewCustomers} suffix="名" onChange={(value) => updateTargetField("targetNewCustomers", value)} />
              <NumberField label="再来客数目標" value={target.targetRepeatCustomers} suffix="名" onChange={(value) => updateTargetField("targetRepeatCustomers", value)} />
              <NumberField label="店販比率目標" value={target.targetRetailRatio} suffix="%" onChange={(value) => updateTargetField("targetRetailRatio", value)} />
              <NumberField label="人件費率目標" value={target.targetLaborRate} suffix="%" onChange={(value) => updateTargetField("targetLaborRate", value)} />
              <NumberField label="材料費率目標" value={target.targetMaterialRate} suffix="%" onChange={(value) => updateTargetField("targetMaterialRate", value)} />
              <NumberField label="広告費率目標" value={target.targetAdRate} suffix="%" onChange={(value) => updateTargetField("targetAdRate", value)} />
              <NumberField label="営業利益率目標" value={target.targetOperatingMargin} suffix="%" onChange={(value) => updateTargetField("targetOperatingMargin", value)} />
            </div>

            <div className="form-section">
              <div className="form-header-row">
                <h3>日次実績入力</h3>
                <button type="button" className="secondary-button" onClick={copyPreviousDayToToday}>前日のデータをコピー</button>
              </div>
              <form className="input-grid compact-form" onSubmit={submitDailyForm}>
                <TextField label="日付" type="date" value={dailyForm.date} error={!!formErrors.date} onChange={(value) => setDailyForm((prev) => ({ ...prev, date: value }))} />
                <NumberField label="技術売上" value={dailyForm.technicalSales} error={!!formErrors.technicalSales} onChange={(value) => setDailyForm((prev) => ({ ...prev, technicalSales: value }))} />
                <NumberField label="店販売上" value={dailyForm.retailSales} error={!!formErrors.retailSales} onChange={(value) => setDailyForm((prev) => ({ ...prev, retailSales: value }))} />
                <NumberField label="総客数" value={dailyForm.customers} suffix="名" error={!!formErrors.customers} onChange={(value) => setDailyForm((prev) => ({ ...prev, customers: value }))} />
                <NumberField label="新規客数" value={dailyForm.newCustomers} suffix="名" onChange={(value) => setDailyForm((prev) => ({ ...prev, newCustomers: value }))} />
                <NumberField label="再来客数" value={dailyForm.repeatCustomers} suffix="名" onChange={(value) => setDailyForm((prev) => ({ ...prev, repeatCustomers: value }))} />
                <NumberField label="スタッフ出勤人数" value={dailyForm.staffCount} suffix="名" error={!!formErrors.staffCount} onChange={(value) => setDailyForm((prev) => ({ ...prev, staffCount: value }))} />
                <TextField label="メモ" value={dailyForm.memo} onChange={(value) => setDailyForm((prev) => ({ ...prev, memo: value }))} />
              </form>

              <div className="calendar-section">
                <h4>月間入力状況</h4>
                <MonthCalendar dates={monthCalendarDays} />
              </div>

              {saveNotice && <div className="save-notice">{saveNotice}</div>}
            </div>

            <div className="sticky-save-bar">
              <button type="button" className="primary-button full-width" onClick={() => submitDailyForm()}>{dailyForm.id ? "日次実績を更新" : "日次実績を保存"}</button>
            </div>

            <div className="form-section">
              <h3>費用実績</h3>
              <div className="input-grid">
                <NumberField label="材料費" value={actual.materialCost} onChange={(value) => updateActualField("materialCost", value)} />
                <NumberField label="人件費" value={actual.laborCost} onChange={(value) => updateActualField("laborCost", value)} />
                <NumberField label="広告費" value={actual.advertising} onChange={(value) => updateActualField("advertising", value)} />
                <NumberField label="家賃" value={actual.rent} onChange={(value) => updateActualField("rent", value)} />
                <NumberField label="水道光熱費" value={actual.utilities} onChange={(value) => updateActualField("utilities", value)} />
                <NumberField label="システム利用料" value={actual.systemFees} onChange={(value) => updateActualField("systemFees", value)} />
                <NumberField label="その他経費" value={actual.miscellaneous} onChange={(value) => updateActualField("miscellaneous", value)} />
                <NumberField label="店販仕入" value={actual.retailCost} onChange={(value) => updateActualField("retailCost", value)} />
              </div>
            </div>

            <div className="summary-strip">
              <div>
                <span>総売上</span>
                <strong>{money(summary.sales)}</strong>
              </div>
              <div>
                <span>粗利益</span>
                <strong>{money(summary.grossProfit)}</strong>
              </div>
              <div>
                <span>営業利益</span>
                <strong>{money(summary.operatingProfit)}</strong>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>日付</th>
                    <th>技術売上</th>
                    <th>店販売上</th>
                    <th>総売上</th>
                    <th>客数</th>
                    <th>スタッフ</th>
                    <th>メモ</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {dailyEntries.length ? dailyEntries.map((item) => (
                    <tr key={item.id}>
                      <td>{item.date}</td>
                      <td>{money(item.technicalSales)}</td>
                      <td>{money(item.retailSales)}</td>
                      <td>{money(Number(item.technicalSales || 0) + Number(item.retailSales || 0))}</td>
                      <td>{item.customers}名</td>
                      <td>{item.staffCount}名</td>
                      <td>{item.memo || "-"}</td>
                      <td className="row-actions">
                        <button type="button" className="text-button" onClick={() => setDailyForm(item)}>編集</button>
                        <button type="button" className="text-button danger" onClick={() => removeDailyEntry(item.id)}>削除</button>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={8} className="empty-state">まだ日次実績がありません</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === "comparison" && (
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">COMPARE</p>
                <h2>店舗別比較</h2>
              </div>
              <select value={rankingMetric} onChange={(event) => setRankingMetric(event.target.value)}>
                {rankingOptions.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>

            <div className="ranking-grid">
              {comparisonRows.map((item, index) => (
                <div key={item.storeName} className="ranking-card">
                  <div className="rank-badge">{index + 1}</div>
                  <div>
                    <small>{item.storeName}</small>
                    <strong>{money(item.sales)}</strong>
                  </div>
                  <ul>
                    <li>達成率: {percent(item.achievement)}</li>
                    <li>予測: {money(item.forecast)}</li>
                    <li>営業利益: {money(item.operatingProfit)}</li>
                    <li>営業利益率: {percent(item.operatingMargin)}</li>
                    <li>客単価: {money(item.averageSpend)}</li>
                    <li>店販比率: {percent(item.retailRatio)}</li>
                  </ul>
                </div>
              ))}
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>店舗</th>
                    <th>月間目標売上</th>
                    <th>現在売上</th>
                    <th>達成率</th>
                    <th>月末着地予測</th>
                    <th>営業利益</th>
                    <th>営業利益率</th>
                    <th>客単価</th>
                    <th>店販比率</th>
                    <th>人件費率</th>
                    <th>材料費率</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonRows.map((row) => (
                    <tr key={row.storeName}>
                      <td>{row.storeName}</td>
                      <td>{money(row.targetSales)}</td>
                      <td>{money(row.sales)}</td>
                      <td>{percent(row.achievement)}</td>
                      <td>{money(row.forecast)}</td>
                      <td>{money(row.operatingProfit)}</td>
                      <td>{percent(row.operatingMargin)}</td>
                      <td>{money(row.averageSpend)}</td>
                      <td>{percent(row.retailRatio)}</td>
                      <td>{percent(row.laborRate)}</td>
                      <td>{percent(row.materialRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === "settings" && (
          <section className="two-column">
            <article className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">STORE</p>
                  <h2>店舗設定</h2>
                </div>
              </div>

              <div className="inline-form">
                <input value={newStoreName} onChange={(event) => setNewStoreName(event.target.value)} placeholder="新しい店舗名" />
                <button type="button" className="primary-button" onClick={addStore}>店舗を追加</button>
              </div>

              <div className="tag-list">
                {stores.map((storeName) => (
                  <span key={storeName}>{storeName}</span>
                ))}
              </div>
            </article>

            <article className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">PREFS</p>
                  <h2>表示設定</h2>
                </div>
              </div>
              <div className="toggle-panel">
                <div>
                  <strong>ダークモード</strong>
                  <small>{theme === "dark" ? "オン" : "オフ"}</small>
                </div>
                <button type="button" className="secondary-button" onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}>
                  {theme === "dark" ? "ライトに切替" : "ダークに切替"}
                </button>
              </div>
              {installPrompt && (
                <button type="button" className="primary-button full-width" onClick={async () => {
                  installPrompt.prompt();
                  await installPrompt.userChoice;
                  setInstallPrompt(null);
                }}>
                  ホーム画面に追加
                </button>
              )}
              <button type="button" className="secondary-button full-width" onClick={exportCsv}>CSV出力</button>
            </article>
          </section>
        )}
      </main>
    </div>
  );
}

function HeroCard({ label, value, tone = "default" }) {
  return (
    <article className={`hero-card tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function NumberField({ label, value, onChange, suffix = "円", error = false }) {
  const normalizedValue = value === undefined || value === null ? 0 : value;

  return (
    <label className={`field ${error ? "field-error" : ""}`}>
      {label}
      <div className="input-with-suffix">
        <input
          type="text"
          inputMode="numeric"
          min="0"
          value={formatInputNumber(normalizedValue)}
          onChange={(event) => onChange(event.target.value.replace(/[^\d]/g, ""))}
          className={error ? "input-error" : ""}
        />
        <span>{suffix}</span>
      </div>
    </label>
  );
}

function TextField({ label, value, onChange, type = "text", error = false }) {
  return (
    <label className={`field ${error ? "field-error" : ""}`}>
      {label}
      <input
        type={type}
        value={value || ""}
        onChange={(event) => onChange(event.target.value)}
        className={error ? "input-error" : ""}
      />
    </label>
  );
}

function MonthCalendar({ dates }) {
  const weekDays = ["日", "月", "火", "水", "木", "金", "土"];

  return (
    <div className="calendar-grid">
      {weekDays.map((day) => (
        <div key={day} className="calendar-weekday">{day}</div>
      ))}
      {dates.map((date) => (
        <div
          key={date.key}
          className={`calendar-day ${date.inMonth ? "" : "calendar-empty"} ${date.isFilled ? "calendar-filled" : "calendar-missing"}`}
        >
          {date.day || ""}
        </div>
      ))}
    </div>
  );
}

function MiniLineChart({ data }) {
  const width = 540;
  const height = 220;
  const padding = 24;
  const maxValue = Math.max(...data.map((point) => Math.max(point.target, point.actual, 1)), 1);

  const pointsA = data.map((point, index) => {
    const x = padding + (index * (width - padding * 2)) / Math.max(data.length - 1, 1);
    const y = height - padding - (point.target / maxValue) * (height - padding * 2);
    return `${x},${y}`;
  }).join(" ");

  const pointsB = data.map((point, index) => {
    const x = padding + (index * (width - padding * 2)) / Math.max(data.length - 1, 1);
    const y = height - padding - (point.actual / maxValue) * (height - padding * 2);
    return `${x},${y}`;
  }).join(" ");

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="mini-chart" aria-label="売上推移グラフ">
        <polyline points={pointsA} className="sales-line" />
        <polyline points={pointsB} className="profit-line" />
      </svg>
      <div className="chart-labels">
        {data.slice(0, 7).map((point) => (
          <span key={point.date}>{point.date.slice(5)}</span>
        ))}
      </div>
    </div>
  );
}

export default App;
