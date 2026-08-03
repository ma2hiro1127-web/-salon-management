export const initialStores = ["横浜店", "吉祥寺店", "原宿店"];

export const defaultTarget = {
  targetSales: 0,
  operatingDays: 0,
  holidayDates: [],
  targetTechnicalSales: 0,
  targetRetailSales: 0,
  targetCustomers: 0,
  targetAverageSpend: 0,
  targetNewCustomers: 0,
  targetRepeatCustomers: 0,
  targetRetailRatio: 0,
  targetLaborRate: 0,
  targetMaterialRate: 0,
  targetAdRate: 0,
  targetOperatingMargin: 0,
};

export const defaultActual = {
  materialCost: 0,
  laborCost: 0,
  advertising: 0,
  rent: 0,
  utilities: 0,
  systemFees: 0,
  miscellaneous: 0,
  retailCost: 0,
};

export const defaultDailyEntry = {
  id: "",
  date: "",
  technicalSales: 0,
  retailSales: 0,
  customers: 0,
  newCustomers: 0,
  repeatCustomers: 0,
  staffCount: 0,
  memo: "",
};

const createDemoDailyEntries = (monthValue) => {
  const [year, month] = monthValue.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const entries = [];

  for (let day = 1; day <= Math.min(daysInMonth, 10); day += 1) {
    const value = 180000 + day * 42000;
    const retail = 95000 + day * 12000;
    const customerCount = 18 + (day % 5) * 2;
    const newCount = Math.max(3, Math.round(customerCount * 0.28));
    const repeatCount = customerCount - newCount;
    const staffCount = 3 + (day % 3);

    entries.push({
      id: `demo-${monthValue}-${day}`,
      date: `${monthValue}-${String(day).padStart(2, "0")}`,
      technicalSales: value,
      retailSales: retail,
      customers: customerCount,
      newCustomers: newCount,
      repeatCustomers: repeatCount,
      staffCount,
      memo: day % 2 === 0 ? "通常営業" : "昼夜混雑",
    });
  }

  return entries;
};

export const createDefaultAppState = () => {
  const selectedMonth = new Date().toISOString().slice(0, 7);
  const targets = {};
  const actuals = {};
  const dailyResults = {};

  initialStores.forEach((store, index) => {
    const key = `${store}__${selectedMonth}`;
    const baseTargetSales = 8500000 + index * 1500000;

    targets[key] = {
      ...defaultTarget,
      targetSales: baseTargetSales,
      operatingDays: 24,
      holidayDates: [
        `${selectedMonth}-06`,
        `${selectedMonth}-14`,
      ],
      targetTechnicalSales: Math.round(baseTargetSales * 0.68),
      targetRetailSales: Math.round(baseTargetSales * 0.32),
      targetCustomers: 260 + index * 25,
      targetAverageSpend: 32000 + index * 1500,
      targetNewCustomers: Math.round((260 + index * 25) * 0.38),
      targetRepeatCustomers: Math.round((260 + index * 25) * 0.62),
      targetRetailRatio: 26 + index,
      targetLaborRate: 28,
      targetMaterialRate: 12,
      targetAdRate: 7,
      targetOperatingMargin: 18,
    };

    actuals[key] = {
      materialCost: 700000 + index * 200000,
      laborCost: 1500000 + index * 250000,
      advertising: 380000 + index * 70000,
      rent: 650000 + index * 150000,
      utilities: 210000 + index * 40000,
      systemFees: 120000 + index * 20000,
      miscellaneous: 170000 + index * 30000,
      retailCost: 360000 + index * 90000,
    };

    dailyResults[key] = createDemoDailyEntries(selectedMonth);
  });

  return {
    stores: [...initialStores],
    selectedStore: initialStores[0],
    selectedMonth,
    targets,
    actuals,
    dailyResults,
  };
};

export const defaultAppState = createDefaultAppState();
