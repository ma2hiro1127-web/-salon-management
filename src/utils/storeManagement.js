export const computeStoreSummary = (store, extra = {}) => {
  const settings = store?.settings || {};
  const monthlyTargetSales = Number(settings.monthlyTargetSales || 0);
  const currentSales = Number(store?.metrics?.currentSales || extra?.currentSales || 0);
  const previousSales = Number(store?.metrics?.previousSales || extra?.previousSales || 0);
  const operatingProfit = Number(store?.metrics?.operatingProfit || extra?.operatingProfit || 0);
  const staffCount = Number(extra?.staffCount ?? store?.staffCount ?? 0);
  const achievementRate = monthlyTargetSales ? Math.round((currentSales / monthlyTargetSales) * 100) : 0;
  const changeRate = previousSales ? Math.round(((currentSales - previousSales) / previousSales) * 1000) / 10 : 0;

  return {
    achievementRate,
    changeRate,
    operatingProfit,
    staffCount,
  };
};

export const sortStoresForManagement = (stores, sortBy = "achievement") => {
  const normalized = [...stores];
  return normalized.sort((left, right) => {
    const leftSummary = computeStoreSummary(left);
    const rightSummary = computeStoreSummary(right);
    const leftIsActive = left?.isActive !== false;
    const rightIsActive = right?.isActive !== false;

    if (leftIsActive !== rightIsActive) {
      return leftIsActive ? -1 : 1;
    }

    switch (sortBy) {
      case "sales":
        return (rightSummary.operatingProfit || 0) - (leftSummary.operatingProfit || 0);
      case "profit":
        return (rightSummary.operatingProfit || 0) - (leftSummary.operatingProfit || 0);
      case "staff":
        return (rightSummary.staffCount || 0) - (leftSummary.staffCount || 0);
      case "name":
        return (left?.name || "").localeCompare(right?.name || "", "ja");
      default:
        return (rightSummary.achievementRate || 0) - (leftSummary.achievementRate || 0);
    }
  });
};

export const normalizeStoreUrls = (urls = []) => {
  const normalized = (urls || [])
    .map((item) => {
      if (typeof item === "string") {
        return { label: "URL", value: item };
      }
      const value = String(item?.value || "").trim();
      const label = String(item?.label || "URL").trim() || "URL";
      if (!value) return null;
      return { label, value };
    })
    .filter(Boolean);

  return normalized;
};
