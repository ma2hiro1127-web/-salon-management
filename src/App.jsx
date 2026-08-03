import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { MetricCard } from "./components/MetricCard";
import { NumberField, TextField } from "./components/FormFields";
import { DataTable } from "./components/DataTable";
import { SalesTrendChart } from "./components/SalesTrendChart";
import { emptyCustomerForm, emptyInventoryForm, emptyMonth, emptyReservationForm, emptyStaffForm, initialStores } from "./data/defaults";
import { STORAGE_KEYS, calcSalesSummary, getPreviousYearMonth, money, number, percent, readAppState, readStorage, toNumber, writeAppState } from "./utils/storage";

function App() {
  const [theme, setTheme] = useState(() => {
    const savedTheme = readStorage("salon-theme", "light");
    return savedTheme === "dark" ? "dark" : "light";
  });
  const [activeTab, setActiveTab] = useState("dashboard");
  const [appState, setAppState] = useState(() => readAppState());
  const [installPrompt, setInstallPrompt] = useState(null);

  const { stores, selectedStore, selectedMonth, monthlyData, staff, customers, reservations, inventory } = appState;

  const [staffForm, setStaffForm] = useState(emptyStaffForm);
  const [customerForm, setCustomerForm] = useState(emptyCustomerForm);
  const [reservationForm, setReservationForm] = useState(emptyReservationForm);
  const [inventoryForm, setInventoryForm] = useState(emptyInventoryForm);
  const [newStoreName, setNewStoreName] = useState("");

  const monthKey = `${selectedStore}__${selectedMonth}`;
  const current = monthlyData[monthKey] || emptyMonth;

  useEffect(() => {
    const onBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.theme, JSON.stringify(theme));
  }, [theme]);

  useEffect(() => {
    writeAppState(appState);
  }, [appState]);

  const metrics = useMemo(() => calcSalesSummary(current), [current]);

  const previousMonthValue = getPreviousYearMonth(selectedMonth);
  const previousMonthData = monthlyData[`${selectedStore}__${previousMonthValue}`] || emptyMonth;
  const previousSales = Number(previousMonthData.technicalSales || 0) + Number(previousMonthData.retailSales || 0);
  const yoyDelta = metrics.sales - previousSales;
  const yoyRate = previousSales ? (yoyDelta / previousSales) * 100 : 0;

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

  const addStaff = (event) => {
    event.preventDefault();
    if (!staffForm.name.trim()) return;
    setAppState((prev) => ({
      ...prev,
      staff: [
        ...prev.staff,
        {
          ...staffForm,
          id: crypto.randomUUID(),
          store: prev.selectedStore,
          monthlySales: toNumber(staffForm.monthlySales),
          customers: toNumber(staffForm.customers),
        },
      ],
    }));
    setStaffForm(emptyStaffForm);
  };

  const addCustomer = (event) => {
    event.preventDefault();
    if (!customerForm.name.trim()) return;
    setAppState((prev) => ({
      ...prev,
      customers: [
        ...prev.customers,
        {
          ...customerForm,
          id: crypto.randomUUID(),
          store: prev.selectedStore,
        },
      ],
    }));
    setCustomerForm(emptyCustomerForm);
  };

  const addReservation = (event) => {
    event.preventDefault();
    if (!reservationForm.date || !reservationForm.customerName.trim()) return;
    setAppState((prev) => ({
      ...prev,
      reservations: [
        ...prev.reservations,
        {
          ...reservationForm,
          id: crypto.randomUUID(),
          store: prev.selectedStore,
          price: toNumber(reservationForm.price),
        },
      ],
    }));
    setReservationForm(emptyReservationForm);
  };

  const addInventory = (event) => {
    event.preventDefault();
    if (!inventoryForm.name.trim()) return;
    setAppState((prev) => ({
      ...prev,
      inventory: [
        ...prev.inventory,
        {
          ...inventoryForm,
          id: crypto.randomUUID(),
          store: prev.selectedStore,
          stock: toNumber(inventoryForm.stock),
          minimumStock: toNumber(inventoryForm.minimumStock),
          unitCost: toNumber(inventoryForm.unitCost),
        },
      ],
    }));
    setInventoryForm(emptyInventoryForm);
  };

  const removeItem = (key, id) => {
    setAppState((prev) => ({
      ...prev,
      [key]: prev[key].filter((item) => item.id !== id),
    }));
  };

  const handleInstall = async () => {
    if (!installPrompt) return;

    installPrompt.prompt();
    const result = await installPrompt.userChoice;
    if (result.outcome === "accepted") {
      setInstallPrompt(null);
    }
  };

  const updateMonth = (field, value) => {
    setAppState((prev) => ({
      ...prev,
      monthlyData: {
        ...prev.monthlyData,
        [`${prev.selectedStore}__${prev.selectedMonth}`]: {
          ...emptyMonth,
          ...(prev.monthlyData[`${prev.selectedStore}__${prev.selectedMonth}`] || {}),
          [field]: toNumber(value),
        },
      },
    }));
  };

  const exportCsv = () => {
    const rows = [
      ["店舗", selectedStore],
      ["対象月", selectedMonth],
      ["技術売上", current.technicalSales],
      ["店販売上", current.retailSales],
      ["総売上", metrics.sales],
      ["客数", current.customers],
      ["新規客数", current.newCustomers],
      ["再来客数", current.repeatCustomers],
      ["客単価", Math.round(metrics.averageSpend)],
      ["材料費", current.materialCost],
      ["店販仕入", current.retailCost],
      ["人件費", current.laborCost],
      ["家賃", current.rent],
      ["広告費", current.advertising],
      ["水道光熱費", current.utilities],
      ["システム利用料", current.systemFees],
      ["その他経費", current.miscellaneous],
      ["粗利益", metrics.grossProfit],
      ["営業利益", metrics.operatingProfit],
      ["営業利益率", metrics.operatingMargin.toFixed(1)],
      ["人件費率", metrics.laborRate.toFixed(1)],
      ["材料費率", metrics.materialRate.toFixed(1)],
    ];

    const csv = "\uFEFF" + rows.map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${selectedStore}_${selectedMonth}_経営データ.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const storeComparison = stores
    .map((storeName) => {
      const data = monthlyData[`${storeName}__${selectedMonth}`] || emptyMonth;
      const { sales, operatingProfit } = calcSalesSummary(data);
      return {
        storeName,
        sales,
        operatingProfit,
        customers: Number(data.customers || 0),
      };
    })
    .sort((a, b) => b.sales - a.sales);

  const tabs = [
    ["dashboard", "ダッシュボード"],
    ["sales", "売上・費用"],
    ["reservations", "予約管理"],
    ["customers", "顧客管理"],
    ["staff", "スタッフ"],
    ["inventory", "在庫管理"],
    ["comparison", "店舗比較"],
    ["settings", "設定"],
  ];

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
              <button
                key={id}
                className={activeTab === id ? "nav-button active" : "nav-button"}
                onClick={() => setActiveTab(id)}
              >
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
              <select
                value={selectedStore}
                onChange={(event) =>
                  setAppState((prev) => ({
                    ...prev,
                    selectedStore: event.target.value,
                  }))
                }
              >
                {stores.map((storeName) => (
                  <option key={storeName}>{storeName}</option>
                ))}
              </select>
            </label>

            <label>
              対象月
              <input
                type="month"
                value={selectedMonth}
                onChange={(event) =>
                  setAppState((prev) => ({
                    ...prev,
                    selectedMonth: event.target.value,
                  }))
                }
              />
            </label>
          </div>
        </header>

        {activeTab === "dashboard" && (
          <>
            <section className="metric-grid">
              <MetricCard label="総売上" value={money(metrics.sales)} />
              <MetricCard label="営業利益" value={money(metrics.operatingProfit)} tone={metrics.operatingProfit >= 0 ? "positive" : "negative"} />
              <MetricCard label="営業利益率" value={percent(metrics.operatingMargin)} />
              <MetricCard label="客単価" value={money(metrics.averageSpend)} />
              <MetricCard label="客数" value={`${number(current.customers)}名`} />
              <MetricCard label="前年比" value={yoyRate >= 0 ? `+${percent(yoyRate)}` : `${percent(yoyRate)}`} />
            </section>

            <section className="two-column">
              <article className="panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">PROFIT</p>
                    <h2>利益構造</h2>
                  </div>
                  <button type="button" className="secondary-button" onClick={exportCsv}>CSV出力</button>
                </div>

                <div className="profit-list">
                  <SummaryRow label="売上" value={money(metrics.sales)} />
                  <SummaryRow label="変動費（材料・店販仕入）" value={money(metrics.variableCost)} />
                  <SummaryRow label="粗利益" value={money(metrics.grossProfit)} />
                  <SummaryRow label="販管費" value={money(metrics.operatingExpenses)} />
                  <SummaryRow label="営業利益" value={money(metrics.operatingProfit)} strong />
                </div>
              </article>

              <article className="panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">KPI</p>
                    <h2>主要指標</h2>
                  </div>
                </div>

                <div className="kpi-list">
                  <KpiBar label="人件費率" value={metrics.laborRate} target={45} />
                  <KpiBar label="材料費率" value={metrics.materialRate} target={10} />
                  <KpiBar label="広告費率" value={metrics.advertisingRate} target={10} />
                  <KpiBar label="利益率" value={metrics.operatingMargin} target={15} />
                </div>
              </article>
            </section>

            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">TREND</p>
                  <h2>月別売上推移</h2>
                </div>
              </div>
              <SalesTrendChart storeName={selectedStore} monthlyData={monthlyData} />
            </section>
          </>
        )}

        {activeTab === "sales" && (
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">INPUT</p>
                <h2>月次売上・費用入力</h2>
              </div>
              <button className="primary-button" onClick={exportCsv}>
                CSV出力
              </button>
            </div>

            <div className="form-section">
              <h3>売上・客数</h3>
              <div className="input-grid">
                <NumberField
                  label="技術売上"
                  value={current.technicalSales}
                  onChange={(value) => updateMonth("technicalSales", value)}
                />
                <NumberField
                  label="店販売上"
                  value={current.retailSales}
                  onChange={(value) => updateMonth("retailSales", value)}
                />
                <NumberField
                  label="総客数"
                  value={current.customers}
                  onChange={(value) => updateMonth("customers", value)}
                  suffix="名"
                />
                <NumberField
                  label="新規客数"
                  value={current.newCustomers}
                  onChange={(value) => updateMonth("newCustomers", value)}
                  suffix="名"
                />
                <NumberField
                  label="再来客数"
                  value={current.repeatCustomers}
                  onChange={(value) => updateMonth("repeatCustomers", value)}
                  suffix="名"
                />
              </div>
            </div>

            <div className="form-section">
              <h3>原価・経費</h3>
              <div className="input-grid">
                <NumberField
                  label="材料費"
                  value={current.materialCost}
                  onChange={(value) => updateMonth("materialCost", value)}
                />
                <NumberField
                  label="店販仕入"
                  value={current.retailCost}
                  onChange={(value) => updateMonth("retailCost", value)}
                />
                <NumberField
                  label="人件費"
                  value={current.laborCost}
                  onChange={(value) => updateMonth("laborCost", value)}
                />
                <NumberField
                  label="家賃"
                  value={current.rent}
                  onChange={(value) => updateMonth("rent", value)}
                />
                <NumberField
                  label="広告費"
                  value={current.advertising}
                  onChange={(value) => updateMonth("advertising", value)}
                />
                <NumberField
                  label="水道光熱費"
                  value={current.utilities}
                  onChange={(value) => updateMonth("utilities", value)}
                />
                <NumberField
                  label="システム利用料"
                  value={current.systemFees}
                  onChange={(value) => updateMonth("systemFees", value)}
                />
                <NumberField
                  label="その他経費"
                  value={current.miscellaneous}
                  onChange={(value) => updateMonth("miscellaneous", value)}
                />
              </div>
            </div>

            <div className="summary-strip">
              <div>
                <span>粗利益</span>
                <strong>{money(metrics.grossProfit)}</strong>
              </div>
              <div>
                <span>営業利益</span>
                <strong>{money(metrics.operatingProfit)}</strong>
              </div>
              <div>
                <span>営業利益率</span>
                <strong>{percent(metrics.operatingMargin)}</strong>
              </div>
            </div>
          </section>
        )}

        {activeTab === "reservations" && (
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">RESERVATION</p>
                <h2>予約管理</h2>
              </div>
            </div>

            <form className="form-grid" onSubmit={addReservation}>
              <TextField
                label="日付"
                type="date"
                value={reservationForm.date}
                onChange={(value) =>
                  setReservationForm((prev) => ({ ...prev, date: value }))
                }
              />
              <TextField
                label="時間"
                type="time"
                value={reservationForm.time}
                onChange={(value) =>
                  setReservationForm((prev) => ({ ...prev, time: value }))
                }
              />
              <TextField
                label="お客様名"
                value={reservationForm.customerName}
                onChange={(value) =>
                  setReservationForm((prev) => ({
                    ...prev,
                    customerName: value,
                  }))
                }
              />
              <TextField
                label="メニュー"
                value={reservationForm.menu}
                onChange={(value) =>
                  setReservationForm((prev) => ({ ...prev, menu: value }))
                }
              />
              <TextField
                label="担当者"
                value={reservationForm.staffName}
                onChange={(value) =>
                  setReservationForm((prev) => ({
                    ...prev,
                    staffName: value,
                  }))
                }
              />
              <TextField
                label="料金"
                type="number"
                value={reservationForm.price}
                onChange={(value) =>
                  setReservationForm((prev) => ({ ...prev, price: value }))
                }
              />
              <button className="primary-button" type="submit">
                予約を追加
              </button>
            </form>

            <DataTable
              headers={["日時", "お客様", "メニュー", "担当", "料金", ""]}
              rows={reservations
                .filter((item) => item.store === selectedStore)
                .sort((a, b) =>
                  `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)
                )
                .map((item) => [
                  `${item.date} ${item.time}`,
                  item.customerName,
                  item.menu || "-",
                  item.staffName || "-",
                  money(item.price),
                  <button
                    className="text-button danger"
                    onClick={() => removeItem("reservations", item.id)}
                  >
                    削除
                  </button>,
                ])}
            />
          </section>
        )}

        {activeTab === "customers" && (
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">CUSTOMER</p>
                <h2>顧客管理</h2>
              </div>
            </div>

            <form className="form-grid" onSubmit={addCustomer}>
              <TextField
                label="お客様名"
                value={customerForm.name}
                onChange={(value) =>
                  setCustomerForm((prev) => ({ ...prev, name: value }))
                }
              />
              <TextField
                label="電話番号"
                value={customerForm.phone}
                onChange={(value) =>
                  setCustomerForm((prev) => ({ ...prev, phone: value }))
                }
              />
              <TextField
                label="最終来店日"
                type="date"
                value={customerForm.lastVisit}
                onChange={(value) =>
                  setCustomerForm((prev) => ({ ...prev, lastVisit: value }))
                }
              />
              <TextField
                label="メモ"
                value={customerForm.memo}
                onChange={(value) =>
                  setCustomerForm((prev) => ({ ...prev, memo: value }))
                }
              />
              <button className="primary-button" type="submit">
                顧客を追加
              </button>
            </form>

            <DataTable
              headers={["お客様名", "電話番号", "最終来店", "メモ", ""]}
              rows={customers
                .filter((item) => item.store === selectedStore)
                .map((item) => [
                  item.name,
                  item.phone || "-",
                  item.lastVisit || "-",
                  item.memo || "-",
                  <button
                    className="text-button danger"
                    onClick={() => removeItem("customers", item.id)}
                  >
                    削除
                  </button>,
                ])}
            />
          </section>
        )}

        {activeTab === "staff" && (
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">STAFF</p>
                <h2>スタッフ管理</h2>
              </div>
            </div>

            <form className="form-grid" onSubmit={addStaff}>
              <TextField
                label="スタッフ名"
                value={staffForm.name}
                onChange={(value) =>
                  setStaffForm((prev) => ({ ...prev, name: value }))
                }
              />
              <label className="field">
                役職
                <select
                  value={staffForm.role}
                  onChange={(event) =>
                    setStaffForm((prev) => ({
                      ...prev,
                      role: event.target.value,
                    }))
                  }
                >
                  <option>代表</option>
                  <option>店長</option>
                  <option>スタイリスト</option>
                  <option>Jr.スタイリスト</option>
                  <option>アシスタント</option>
                  <option>レセプション</option>
                </select>
              </label>
              <TextField
                label="月間売上"
                type="number"
                value={staffForm.monthlySales}
                onChange={(value) =>
                  setStaffForm((prev) => ({ ...prev, monthlySales: value }))
                }
              />
              <TextField
                label="客数"
                type="number"
                value={staffForm.customers}
                onChange={(value) =>
                  setStaffForm((prev) => ({ ...prev, customers: value }))
                }
              />
              <button className="primary-button" type="submit">
                スタッフを追加
              </button>
            </form>

            <DataTable
              headers={["スタッフ名", "役職", "月間売上", "客数", "客単価", ""]}
              rows={staff
                .filter((item) => item.store === selectedStore)
                .map((item) => [
                  item.name,
                  item.role,
                  money(item.monthlySales),
                  `${number(item.customers)}名`,
                  money(
                    item.customers ? item.monthlySales / item.customers : 0
                  ),
                  <button
                    className="text-button danger"
                    onClick={() => removeItem("staff", item.id)}
                  >
                    削除
                  </button>,
                ])}
            />
          </section>
        )}

        {activeTab === "inventory" && (
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">INVENTORY</p>
                <h2>材料・店販在庫</h2>
              </div>
            </div>

            <form className="form-grid" onSubmit={addInventory}>
              <TextField
                label="商品・材料名"
                value={inventoryForm.name}
                onChange={(value) =>
                  setInventoryForm((prev) => ({ ...prev, name: value }))
                }
              />
              <label className="field">
                区分
                <select
                  value={inventoryForm.category}
                  onChange={(event) =>
                    setInventoryForm((prev) => ({
                      ...prev,
                      category: event.target.value,
                    }))
                  }
                >
                  <option>材料</option>
                  <option>店販商品</option>
                  <option>備品</option>
                </select>
              </label>
              <TextField
                label="現在庫"
                type="number"
                value={inventoryForm.stock}
                onChange={(value) =>
                  setInventoryForm((prev) => ({ ...prev, stock: value }))
                }
              />
              <TextField
                label="最低在庫"
                type="number"
                value={inventoryForm.minimumStock}
                onChange={(value) =>
                  setInventoryForm((prev) => ({
                    ...prev,
                    minimumStock: value,
                  }))
                }
              />
              <TextField
                label="仕入単価"
                type="number"
                value={inventoryForm.unitCost}
                onChange={(value) =>
                  setInventoryForm((prev) => ({ ...prev, unitCost: value }))
                }
              />
              <button className="primary-button" type="submit">
                在庫を追加
              </button>
            </form>

            <DataTable
              headers={["商品・材料", "区分", "現在庫", "最低在庫", "在庫金額", "状態", ""]}
              rows={inventory
                .filter((item) => item.store === selectedStore)
                .map((item) => [
                  item.name,
                  item.category,
                  number(item.stock),
                  number(item.minimumStock),
                  money(item.stock * item.unitCost),
                  item.stock <= item.minimumStock ? (
                    <span className="status warning">要発注</span>
                  ) : (
                    <span className="status ok">適正</span>
                  ),
                  <button
                    className="text-button danger"
                    onClick={() => removeItem("inventory", item.id)}
                  >
                    削除
                  </button>,
                ])}
            />
          </section>
        )}

        {activeTab === "comparison" && (
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">COMPARE</p>
                <h2>{selectedMonth} 店舗別比較</h2>
              </div>
            </div>

            <DataTable
              headers={["店舗", "売上", "営業利益", "客数", "客単価"]}
              rows={storeComparison.map((item) => [
                item.storeName,
                money(item.sales),
                money(item.operatingProfit),
                `${number(item.customers)}名`,
                money(item.customers ? item.sales / item.customers : 0),
              ])}
            />
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
                <input
                  value={newStoreName}
                  onChange={(event) => setNewStoreName(event.target.value)}
                  placeholder="新しい店舗名"
                />
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
                <button type="button" className="primary-button" onClick={handleInstall}>
                  ホーム画面に追加
                </button>
              )}

              <button type="button" className="secondary-button" onClick={exportCsv}>選択中の月をCSV出力</button>
            </article>
          </section>
        )}
      </main>
    </div>
  );
}

function SummaryRow({ label, value, strong = false }) {
  return (
    <div className={strong ? "summary-row strong" : "summary-row"}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function KpiBar({ label, value, target }) {
  const width = Math.min(Math.max(value, 0), 100);
  return (
    <div className="kpi-item">
      <div>
        <span>{label}</span>
        <strong>{percent(value)}</strong>
      </div>
      <div className="bar">
        <span style={{ width: `${width}%` }} />
      </div>
      <small>目安 {target}%</small>
    </div>
  );
}

export default App;
