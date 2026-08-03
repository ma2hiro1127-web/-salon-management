import { useEffect, useMemo, useState } from "react";
import "./App.css";
import {
  defaultClosingItem,
  defaultDailyEntry,
  defaultFixedCostItem,
  defaultVariableCostItem,
  expenseCategories,
} from "./data/defaults.js";
import {
  STORAGE_KEYS,
  buildMonthKey,
  calculateMonthSummary,
  getClosingItemsForStoreMonth,
  getDailyResultsForStoreMonth,
  getFixedCostsForStoreMonth,
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
  { id: "dashboard", label: "ダッシュボード" },
  { id: "daily", label: "日次入力" },
  { id: "monthly", label: "月締め" },
  { id: "stores", label: "店舗管理" },
  { id: "settings", label: "設定" },
];

const monthlyTabs = [
  { id: "target", label: "目標設定" },
  { id: "fixed", label: "固定費" },
  { id: "variable", label: "販管費" },
  { id: "closing", label: "月締め" },
  { id: "pnl", label: "損益" },
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

function App() {
  const [theme, setTheme] = useState(() => (readStorage(STORAGE_KEYS.theme, "light") === "dark" ? "dark" : "light"));
  const [activePage, setActivePage] = useState("dashboard");
  const [activeMonthlyTab, setActiveMonthlyTab] = useState("closing");
  const [rankingSort, setRankingSort] = useState("sales");
  const [appState, setAppState] = useState(() => readAppState());
  const [newStoreName, setNewStoreName] = useState("");
  const [storeFormName, setStoreFormName] = useState("");
  const [storeEditId, setStoreEditId] = useState("");
  const [dailyForm, setDailyForm] = useState(defaultDailyEntry);
  const [fixedForm, setFixedForm] = useState(defaultFixedCostItem);
  const [variableForm, setVariableForm] = useState(defaultVariableCostItem);
  const [closingForm, setClosingForm] = useState(defaultClosingItem);
  const [notice, setNotice] = useState("");

  const { stores, selectedStore, selectedMonth } = appState;
  const target = getTargetForStoreMonth(appState, selectedStore, selectedMonth);
  const dailyEntries = useMemo(() => getDailyResultsForStoreMonth(appState, selectedStore, selectedMonth), [appState, selectedStore, selectedMonth]);
  const fixedCosts = useMemo(() => getFixedCostsForStoreMonth(appState, selectedStore, selectedMonth), [appState, selectedStore, selectedMonth]);
  const variableCosts = useMemo(() => getVariableCostsForStoreMonth(appState, selectedStore, selectedMonth), [appState, selectedStore, selectedMonth]);
  const closingItems = useMemo(() => getClosingItemsForStoreMonth(appState, selectedStore, selectedMonth), [appState, selectedStore, selectedMonth]);
  const summary = useMemo(() => calculateMonthSummary(appState, selectedStore, selectedMonth), [appState, selectedStore, selectedMonth]);
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
    writeAppState(appState);
  }, [appState]);

  useEffect(() => {
    if (!selectedStore && stores.length) {
      setAppState((prev) => ({ ...prev, selectedStore: stores[0] }));
    }
  }, [selectedStore, stores]);

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

  const submitDailyEntry = (event) => {
    event?.preventDefault();
    if (!selectedStore) {
      setNotice("店舗を先に追加してください");
      return;
    }

    if (!dailyForm.date || !dailyForm.totalSales) {
      setNotice("日付と総売上は必須です");
      return;
    }

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

    setNotice("本日の実績を保存しました");
    setDailyForm({ ...defaultDailyEntry });
  };

  const editDailyEntry = (entry) => {
    setDailyForm(entry);
    setNotice("編集モードです");
  };

  const removeDailyEntry = (entryId) => {
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
        <div className="sidebar-footer">
          <small>朝は30秒、営業終了後は30秒、月末は30分で確認できます</small>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">SALON MANAGEMENT</p>
            <h1>{activePage === "dashboard" ? "ダッシュボード" : activePage === "daily" ? "日次入力" : activePage === "monthly" ? "月締め" : activePage === "stores" ? "店舗管理" : "設定"}</h1>
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

        {notice ? <div className="notice-box">{notice}</div> : null}

        {activePage === "dashboard" && (
          <div className="dashboard-layout">
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">KPI</p>
                  <h2>朝の確認</h2>
                </div>
              </div>
              <div className="kpi-grid">
                <MetricCard label="月間目標売上" value={money(target.targetSales || 0)} />
                <MetricCard label="現在売上" value={money(summary.sales)} />
                <MetricCard label="月間達成率" value={percent(summary.targetAchievement)} />
                <MetricCard label="残り営業日数" value={`${summary.remainingBusinessDays}日`} />
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
                      <h2>営業終了後の入力</h2>
                    </div>
                  </div>
                  <form className="input-grid compact" onSubmit={submitDailyEntry}>
                    <Field label="日付" type="date" value={dailyForm.date} onChange={(value) => setDailyForm((prev) => ({ ...prev, date: value }))} />
                    <Field label="総売上" value={dailyForm.totalSales} onChange={(value) => setDailyForm((prev) => ({ ...prev, totalSales: value }))} suffix="円" />
                    <Field label="技術売上" value={dailyForm.technicalSales} onChange={(value) => setDailyForm((prev) => ({ ...prev, technicalSales: value }))} suffix="円" />
                    <Field label="店販売上" value={dailyForm.retailSales} onChange={(value) => setDailyForm((prev) => ({ ...prev, retailSales: value }))} suffix="円" />
                    <Field label="客数" value={dailyForm.customers} onChange={(value) => setDailyForm((prev) => ({ ...prev, customers: value }))} suffix="名" />
                    <Field label="新規客数" value={dailyForm.newCustomers} onChange={(value) => setDailyForm((prev) => ({ ...prev, newCustomers: value }))} suffix="名" />
                    <Field label="再来客数" value={dailyForm.repeatCustomers} onChange={(value) => setDailyForm((prev) => ({ ...prev, repeatCustomers: value }))} suffix="名" />
                    <div className="form-actions">
                      <button className="primary-button" type="submit">保存</button>
                    </div>
                  </form>
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
                      <Field label="売上目標" value={target.targetSales} onChange={(value) => updateTargetField("targetSales", value)} suffix="円" />
                      <Field label="技術売上目標" value={target.targetTechnicalSales} onChange={(value) => updateTargetField("targetTechnicalSales", value)} suffix="円" />
                      <Field label="店販売上目標" value={target.targetRetailSales} onChange={(value) => updateTargetField("targetRetailSales", value)} suffix="円" />
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
                      <input value={fixedForm.amount} onChange={(event) => setFixedForm((prev) => ({ ...prev, amount: event.target.value }))} placeholder="金額" type="number" />
                      <button className="primary-button" type="submit">追加 / 更新</button>
                    </form>
                    <div className="list-card">
                      {fixedCosts.map((item) => (
                        <div key={item.id} className="list-row">
                          <div>
                            <strong>{item.name}</strong>
                            <small>{money(item.amount)}</small>
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
                      <input value={variableForm.amount} onChange={(event) => setVariableForm((prev) => ({ ...prev, amount: event.target.value }))} placeholder="金額" type="number" />
                      <button className="primary-button" type="submit">追加 / 更新</button>
                    </form>
                    <div className="list-card">
                      {variableCosts.map((item) => (
                        <div key={item.id} className="list-row">
                          <div>
                            <strong>{item.name}</strong>
                            <small>{money(item.amount)}</small>
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
                        <p className="eyebrow">CLOSING</p>
                        <h2>月締め</h2>
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
                    <div className="summary-grid">
                      <div className="summary-card"><span>店販比率</span><strong>{percent(summary.retailRatio)}</strong></div>
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
                        <h2>月次損益</h2>
                      </div>
                    </div>
                    <div className="summary-grid">
                      <div className="summary-card"><span>売上</span><strong>{money(summary.sales)}</strong></div>
                      <div className="summary-card"><span>技術売上</span><strong>{money(summary.technicalSales)}</strong></div>
                      <div className="summary-card"><span>店販売上</span><strong>{money(summary.retailSales)}</strong></div>
                      <div className="summary-card"><span>人件費</span><strong>{money(summary.laborCost)}</strong></div>
                      <div className="summary-card"><span>材料費</span><strong>{money(summary.materialCost)}</strong></div>
                      <div className="summary-card"><span>固定費</span><strong>{money(summary.fixedCost)}</strong></div>
                      <div className="summary-card"><span>販管費</span><strong>{money(summary.variableCost)}</strong></div>
                      <div className="summary-card"><span>営業利益</span><strong>{money(summary.operatingProfit)}</strong></div>
                      <div className="summary-card"><span>営業利益率</span><strong>{percent(summary.operatingMargin)}</strong></div>
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
                <h2>店舗管理</h2>
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

function Field({ label, value, onChange, suffix = "", type = "text" }) {
  const normalizedValue = value === undefined || value === null ? "" : value;
  return (
    <label className="field">
      <span>{label}</span>
      <div className="input-with-suffix">
        <input type={type} value={normalizedValue} onChange={(event) => onChange(event.target.value)} />
        {suffix ? <span>{suffix}</span> : null}
      </div>
    </label>
  );
}

export default App;
