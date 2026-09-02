// 契約管理(無料利用/トライアル/契約中/停止中)まわりの表示用の純粋関数群。
// DB/API呼び出しは一切行わない(結果はここでは保存しない、あくまで画面表示・確認モーダルの
// プレビュー用)。
//
// 日付計算のルール(「翌月1日」「1か月後」)は、実際に保存される値を計算する
// Supabase側のDB関数(compute_billing_start_date / compute_trial_end_date、
// supabase/migrations/20260906000000_contract_billing_fields.sql)と同じ内容を、
// このファイルにも1箇所だけ用意している。**実際にDBへ保存される値は必ずEdge Function経由で
// そのDB関数が計算した値であり、ここでの計算はモーダル上の「見込み表示」専用。**
// ルールを変える場合は、上記migrationのDB関数とこのファイルの両方を直すこと(コード内に
// 日付ルールをベタ書きしないための唯一の例外がこの1ファイル)。

export const CONTRACT_STATUS_LABELS = {
  free: "無料利用",
  trial: "トライアル",
  active: "契約中",
  suspended: "停止中",
};

export const FREE_REASON_LABELS = {
  self: "自社利用",
  monitor: "モニター企業",
  friend: "知人への無料提供",
  campaign: "期間限定キャンペーン",
  other: "その他",
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

// 固定オフセット(JSTは夏時間が無いため常にUTC+9)を使い、「JSTのカレンダー上の年月日」を
// 取り出す。Intl/タイムゾーンAPIに頼らない単純な方法。
const toJstDateParts = (date) => {
  const shifted = new Date(date.getTime() + JST_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth(), day: shifted.getUTCDate() };
};

// JSTのカレンダー年月日から実時刻(Date、UTC内部表現)を組み立てる。
const fromJstDateParts = (year, month, day) => new Date(Date.UTC(year, month, day) - JST_OFFSET_MS);

// 指定の年月日から、日付が範囲外にならないよう「月末でクランプ」しつつnヶ月後の年月日を返す
// (例: 1/31の1か月後は2/31が存在しないので2/28や2/29にクランプする——PostgreSQLの
// `interval '1 month'`と同じ挙動に合わせるため、JS Dateの素朴な月加算(オーバーフローで
// 3月にずれてしまう)は使わない)。
const addMonthsClamped = (year, month, day, monthsToAdd) => {
  const totalMonths = year * 12 + month + monthsToAdd;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return { year: targetYear, month: targetMonth, day: Math.min(day, daysInTargetMonth) };
};

// 「変更した月の翌月1日」(JST基準)。supabase側のcompute_billing_start_date()と同じルール。
export const previewBillingStartDateFromChange = (changeDate = new Date()) => {
  const { year, month } = toJstDateParts(changeDate);
  const target = addMonthsClamped(year, month, 1, 1);
  return fromJstDateParts(target.year, target.month, target.day);
};

// トライアル開始日時の1か月後(JST基準)。supabase側のcompute_trial_end_date()と同じルール。
export const previewTrialEndDate = (startDate = new Date()) => {
  const { year, month, day } = toJstDateParts(startDate);
  const target = addMonthsClamped(year, month, day, 1);
  return fromJstDateParts(target.year, target.month, target.day);
};

// 「無料利用/停止中→契約中」への変更で使う課金開始予定日のプレビュー。トライアルからの
// 変更で、かつtrialEndsAtがまだ未来の場合だけ「トライアル終了日の翌日」を返す
// (update-company-status Edge Functionの計算ロジックと同じ分岐)。
export const previewBillingStart = (fromStatus, trialEndsAt, now = new Date()) => {
  if (fromStatus === "trial" && trialEndsAt) {
    const trialEnd = new Date(trialEndsAt);
    if (!Number.isNaN(trialEnd.getTime()) && trialEnd.getTime() > now.getTime()) {
      return { date: new Date(trialEnd.getTime() + MS_PER_DAY), source: "trial" };
    }
  }
  return { date: previewBillingStartDateFromChange(now), source: "next-month" };
};

const diffYMDFromParts = (from, to) => {
  let years = to.year - from.year;
  let months = to.month - from.month;
  let days = to.day - from.day;
  if (days < 0) {
    months -= 1;
    const prevMonthIndex = to.month === 0 ? 11 : to.month - 1;
    const prevMonthYear = to.month === 0 ? to.year - 1 : to.year;
    days += new Date(Date.UTC(prevMonthYear, prevMonthIndex + 1, 0)).getUTCDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { years, months, days };
};

// 利用期間の表示(「4か月12日」「1年4か月」)。1年以上は年+月のみ(日は省略)、
// 1か月以上1年未満は月+日、1か月未満は日のみ。契約状態が変わっても常に
// company.startedAt(会社作成日=created_at)からの経過で計算するため、状態変更で
// リセットされない(要件どおり)。
export const formatUsageDuration = (startedAt, now = new Date()) => {
  if (!startedAt) return "";
  const start = new Date(startedAt);
  if (Number.isNaN(start.getTime())) return "";
  const { years, months, days } = diffYMDFromParts(toJstDateParts(start), toJstDateParts(now));
  if (years >= 1) return months > 0 ? `${years}年${months}か月` : `${years}年`;
  if (months >= 1) return days > 0 ? `${months}か月${days}日` : `${months}か月`;
  return `${Math.max(days, 0)}日`;
};

// 「残り」表示。1か月未満は日数(トライアルの「残り18日」等)、1か月以上は月数の粗い表示
// (無料期限の「残り2か月」等)。期限を過ぎていれば「期限切れ」を返す。
//
// 期限切れの判定は、年・月・日に分解した後の符号ではなく、分解する前に単純な暦日同士の
// 大小比較で行う(diffYMDFromParts は繰り下がり計算の都合上、例えば「1年前」を
// {years:-1, months:10, days:30}のように符号が揃わない形で返すことがあり、各成分を
// 個別に<=0で判定すると誤判定するため)。
export const formatRemainingLabel = (endValue, now = new Date()) => {
  if (!endValue) return "";
  const end = new Date(endValue);
  if (Number.isNaN(end.getTime())) return "";
  const nowParts = toJstDateParts(now);
  const endParts = toJstDateParts(end);
  const nowDay = Date.UTC(nowParts.year, nowParts.month, nowParts.day);
  const endDay = Date.UTC(endParts.year, endParts.month, endParts.day);
  if (endDay <= nowDay) return "期限切れ";
  const { years, months, days } = diffYMDFromParts(nowParts, endParts);
  if (years >= 1) return months > 0 ? `${years}年${months}か月` : `${years}年`;
  if (months >= 1) return `${months}か月`;
  return `${days}日`;
};

// 表示用の日付ラベル("2026/9/1")。年をまたぐ表示でも誤解が無いよう常に年を含める。
export const formatDateLabel = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const { year, month, day } = toJstDateParts(date);
  return `${year}/${month + 1}/${day}`;
};

// 円表示("¥1,480")。nullやundefinedは空文字を返す(未設定の月額を「¥0」と誤表示しないため)。
export const formatYenOrEmpty = (value) => {
  if (value === null || value === undefined) return "";
  const amount = Number(value);
  if (Number.isNaN(amount)) return "";
  return `¥${amount.toLocaleString("ja-JP")}`;
};
