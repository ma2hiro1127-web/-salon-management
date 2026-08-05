import test from "node:test";
import assert from "node:assert/strict";
import { computeStoreSummary, sortStoresForManagement, normalizeStoreUrls } from "./storeManagement.js";

test("computeStoreSummary derives achievement and staffing metrics", () => {
  const summary = computeStoreSummary({
    settings: { monthlyTargetSales: "1000000", retailTargetSales: "300000", customerTarget: "50" },
    metrics: { currentSales: 800000, previousSales: 700000, operatingProfit: 160000 },
  }, { staffCount: 3 });

  assert.equal(summary.staffCount, 3);
  assert.equal(summary.achievementRate, 80);
  assert.equal(summary.changeRate, 14.3);
  assert.equal(summary.operatingProfit, 160000);
});

test("sortStoresForManagement prioritizes active stores and higher achievement", () => {
  const stores = [
    { id: "b", isActive: false, settings: { monthlyTargetSales: "100000" }, metrics: { currentSales: 90000, previousSales: 60000, operatingProfit: 18000 } },
    { id: "a", isActive: true, settings: { monthlyTargetSales: "100000" }, metrics: { currentSales: 95000, previousSales: 60000, operatingProfit: 19000 } },
  ];

  const sorted = sortStoresForManagement(stores, "achievement");

  assert.deepEqual(sorted.map((store) => store.id), ["a", "b"]);
});

test("normalizeStoreUrls preserves label and value pairs", () => {
  const normalized = normalizeStoreUrls([
    { label: "HP", value: "https://example.com" },
    { label: "Instagram", value: "" },
    { value: "https://reserve.example.com" },
  ]);

  assert.equal(normalized.length, 2);
  assert.equal(normalized[0].label, "HP");
  assert.equal(normalized[1].value, "https://reserve.example.com");
});
