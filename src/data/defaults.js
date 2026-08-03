export const initialStores = ["横浜店", "吉祥寺店", "原宿店"];

export const emptyMonth = {
  technicalSales: 0,
  retailSales: 0,
  customers: 0,
  newCustomers: 0,
  repeatCustomers: 0,
  laborCost: 0,
  materialCost: 0,
  retailCost: 0,
  rent: 0,
  advertising: 0,
  utilities: 0,
  systemFees: 0,
  miscellaneous: 0,
};

export const emptyStaffForm = {
  name: "",
  role: "スタイリスト",
  monthlySales: 0,
  customers: 0,
};

export const emptyCustomerForm = {
  name: "",
  phone: "",
  lastVisit: "",
  memo: "",
};

export const emptyReservationForm = {
  date: "",
  time: "",
  customerName: "",
  menu: "",
  staffName: "",
  price: 0,
};

export const emptyInventoryForm = {
  name: "",
  category: "材料",
  stock: 0,
  minimumStock: 0,
  unitCost: 0,
};

export const defaultAppState = {
  stores: initialStores,
  selectedStore: initialStores[0],
  selectedMonth: new Date().toISOString().slice(0, 7),
  monthlyData: {},
  staff: [],
  customers: [],
  reservations: [],
  inventory: [],
};
