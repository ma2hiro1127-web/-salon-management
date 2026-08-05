const businessTypeCatalog = {
  salon: {
    id: "salon",
    label: "サロン",
    shortLabel: "サロン",
    defaultStoreName: "本店",
    description: "美容・サロン向けの多店舗運営に最適",
  },
  nail: {
    id: "nail",
    label: "ネイルサロン",
    shortLabel: "ネイル",
    defaultStoreName: "本店",
    description: "ネイル施術・商品管理に最適",
  },
  eyelash: {
    id: "eyelash",
    label: "まつげサロン",
    shortLabel: "まつげ",
    defaultStoreName: "本店",
    description: "まつげ・アイラッシュ施術に最適",
  },
  esthetic: {
    id: "esthetic",
    label: "エステサロン",
    shortLabel: "エステ",
    defaultStoreName: "本店",
    description: "エステ・スパ業務に最適",
  },
};

export const businessTypeOptions = Object.values(businessTypeCatalog);

export const normalizeBusinessType = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return businessTypeCatalog[normalized]?.id || "salon";
};

export const getBusinessTypeConfig = (value = "salon") => {
  const normalized = normalizeBusinessType(value);
  return businessTypeCatalog[normalized] || businessTypeCatalog.salon;
};

export const getBusinessTypeLabel = (value = "salon") => getBusinessTypeConfig(value).label;
export const getBusinessTypeShortLabel = (value = "salon") => getBusinessTypeConfig(value).shortLabel;
export const getBusinessTypeDescription = (value = "salon") => getBusinessTypeConfig(value).description;
export const getBusinessTypeDefaultStoreName = (value = "salon") => getBusinessTypeConfig(value).defaultStoreName;
