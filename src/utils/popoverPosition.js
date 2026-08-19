// トリガー要素(対象月ボタン等)の実座標(getBoundingClientRect、常にviewport基準 —
// position:fixedが期待する座標系と一致するため、スクロール位置を別途加算する必要は無い)を
// 基準に、ポップオーバーをviewport内へ確実に収める位置(position:fixedで使うleft/top)を計算
// する純粋関数。DOM/Reactに一切依存しないため、jsdom等を用意しなくても素のNode.jsで
// 網羅的にテストできる — 「実際にクリックして確認できない」制約下でも、位置計算のロジック
// 自体はここで検証する。
//
// 仕様(対象月選択UI・PC/タブレット版):
//   - 横方向: 基本はトリガーの右端に揃える(トリガーが画面右上にある前提の既定位置)。
//     左右どちらの端からもmargin以上の余白を必ず確保する。
//   - 縦方向: 基本はトリガーの直下。下に十分な高さが無ければ上に表示する。上下どちらにも
//     panelHeight分の余白が無い場合は、より広い方を採用し、その残り高さをmaxHeightとして
//     返す(呼び出し側はCSSのoverflow-yで内部スクロールさせる — 要件「内部スクロール」)。
export const computeAnchoredPopoverPosition = ({
  triggerRect,
  panelWidth,
  panelHeight,
  viewportWidth,
  viewportHeight,
  margin = 12,
  gap = 8,
}) => {
  // 横方向: トリガー右端揃えを基本にしつつ、左右の余白を必ずmargin以上確保する。
  let left = triggerRect.right - panelWidth;
  const minLeft = margin;
  const maxLeft = Math.max(margin, viewportWidth - margin - panelWidth);
  left = Math.min(Math.max(left, minLeft), maxLeft);

  // 縦方向: 下→上の順で「panelHeight全体が収まるか」を判定し、どちらも収まらない場合だけ
  // より広い側を採用してmaxHeightで縮める(内部スクロール前提)。
  const spaceBelow = viewportHeight - triggerRect.bottom - gap - margin;
  const spaceAbove = triggerRect.top - gap - margin;

  let placement;
  let top;
  let maxHeight;
  if (spaceBelow >= panelHeight) {
    placement = "below";
    top = triggerRect.bottom + gap;
    maxHeight = panelHeight;
  } else if (spaceAbove >= panelHeight) {
    placement = "above";
    top = triggerRect.top - gap - panelHeight;
    maxHeight = panelHeight;
  } else if (spaceBelow >= spaceAbove) {
    placement = "below";
    top = triggerRect.bottom + gap;
    maxHeight = Math.max(spaceBelow, 0);
  } else {
    placement = "above";
    top = margin;
    maxHeight = Math.max(spaceAbove, 0);
  }

  return { left, top, maxHeight, placement };
};
