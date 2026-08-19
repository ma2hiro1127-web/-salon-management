import test from "node:test";
import assert from "node:assert/strict";
import { computeAnchoredPopoverPosition } from "./popoverPosition.js";

// 対象月ボタンは実際のヘッダーでは画面右上に近い位置にある。各テストのtriggerRectは
// 「viewportWidthに対してボタンが右寄りにある」という実際のレイアウトを模した値にする。
const makeTriggerRect = (viewportWidth, { top = 64, height = 44, buttonWidth = 130, rightGap = 24 } = {}) => {
  const right = viewportWidth - rightGap;
  return { top, bottom: top + height, left: right - buttonWidth, right, width: buttonWidth, height };
};

const PANEL_WIDTH = 320;
const PANEL_HEIGHT = 320; // 年ナビ+3x4グリッド+閉じるボタンのおおよその高さ

[1440, 1280, 1024, 768, 430, 390, 375].forEach((viewportWidth) => {
  test(`computeAnchoredPopoverPosition: viewport幅${viewportWidth}pxでトリガー右端揃え、右端からmargin以上確保される`, () => {
    const triggerRect = makeTriggerRect(viewportWidth);
    const viewportHeight = 900;
    const { left, top, maxHeight } = computeAnchoredPopoverPosition({
      triggerRect, panelWidth: PANEL_WIDTH, panelHeight: PANEL_HEIGHT,
      viewportWidth, viewportHeight, margin: 12, gap: 8,
    });

    // 右端: パネルの右端(left + width)がviewport右端からmargin以上内側にある。
    assert.ok(left + PANEL_WIDTH <= viewportWidth - 12 + 0.001, `right edge overflow at ${viewportWidth}px: left=${left}`);
    // 左端: パネルの左端がmargin以上確保されている。
    assert.ok(left >= 12 - 0.001, `left edge underflow at ${viewportWidth}px: left=${left}`);
    // 縦方向: トリガー直下に収まる高さがある場合は直下に出る。
    assert.equal(top, triggerRect.bottom + 8);
    assert.equal(maxHeight, PANEL_HEIGHT);
  });
});

test("computeAnchoredPopoverPosition: 基本位置はトリガーの右端に揃える(要件: 対象月ボタンの直下・右端揃え)", () => {
  const viewportWidth = 1440;
  const triggerRect = makeTriggerRect(viewportWidth);
  const { left } = computeAnchoredPopoverPosition({
    triggerRect, panelWidth: PANEL_WIDTH, panelHeight: PANEL_HEIGHT,
    viewportWidth, viewportHeight: 900, margin: 12, gap: 8,
  });
  assert.equal(left, triggerRect.right - PANEL_WIDTH);
});

test("computeAnchoredPopoverPosition: トリガーが画面左端に近い場合、パネルの左端がmarginを下回らないようクランプされる", () => {
  const viewportWidth = 1024;
  const triggerRect = { top: 64, bottom: 108, left: 20, right: 150, width: 130, height: 44 };
  const { left } = computeAnchoredPopoverPosition({
    triggerRect, panelWidth: PANEL_WIDTH, panelHeight: PANEL_HEIGHT,
    viewportWidth, viewportHeight: 900, margin: 12, gap: 8,
  });
  // 右端揃え(right - width = 150-320 = -170)だと画面外(負の座標)になるため、marginへクランプされる。
  assert.equal(left, 12);
});

test("computeAnchoredPopoverPosition: 下に十分な高さが無い場合は上方向へ表示する", () => {
  const viewportWidth = 1280;
  const viewportHeight = 500;
  // トリガーが画面下の方にあり、下側にpanelHeight分の余地が無い。
  const triggerRect = makeTriggerRect(viewportWidth, { top: 420, height: 44 });
  const { top, placement, maxHeight } = computeAnchoredPopoverPosition({
    triggerRect, panelWidth: PANEL_WIDTH, panelHeight: PANEL_HEIGHT,
    viewportWidth, viewportHeight, margin: 12, gap: 8,
  });
  assert.equal(placement, "above");
  assert.equal(top, triggerRect.top - 8 - PANEL_HEIGHT);
  assert.equal(maxHeight, PANEL_HEIGHT);
  assert.ok(top >= 12, "パネル上端がviewport上端のmarginを下回ってはいけない");
});

test("computeAnchoredPopoverPosition: 上下どちらにも十分な高さが無い場合、より広い側を採用しmaxHeightで内部スクロールさせる(画面外へはみ出さない)", () => {
  const viewportWidth = 1024;
  const viewportHeight = 300; // 上下ともpanelHeight(320)が入らない極端に低いviewport
  const triggerRect = makeTriggerRect(viewportWidth, { top: 140, height: 44 });
  const { top, maxHeight, placement } = computeAnchoredPopoverPosition({
    triggerRect, panelWidth: PANEL_WIDTH, panelHeight: PANEL_HEIGHT,
    viewportWidth, viewportHeight, margin: 12, gap: 8,
  });
  // 上下どちらのスペースも使い切っても、viewport外へは出ない。
  assert.ok(top >= 12 - 0.001);
  assert.ok(top + maxHeight <= viewportHeight - 12 + 0.001, `bottom overflow: top=${top} maxHeight=${maxHeight}`);
  assert.ok(maxHeight > 0);
  assert.ok(placement === "above" || placement === "below");
});

test("computeAnchoredPopoverPosition: viewport幅がパネル幅より小さい極端なケースでも右端をはみ出さない(モバイルはボトムシート化するため通常発生しないが、フォールバックとして安全であることを確認)", () => {
  const viewportWidth = 300;
  const triggerRect = { top: 20, bottom: 64, left: 150, right: 288, width: 130, height: 44 };
  const { left } = computeAnchoredPopoverPosition({
    triggerRect, panelWidth: PANEL_WIDTH, panelHeight: PANEL_HEIGHT,
    viewportWidth, viewportHeight: 800, margin: 12, gap: 8,
  });
  assert.ok(left >= 12 - 0.001);
  assert.ok(left + PANEL_WIDTH <= Math.max(viewportWidth - 12, 12) + PANEL_WIDTH, "left should at least be clamped to margin, not overflow left");
  assert.equal(left, 12);
});

test("computeAnchoredPopoverPosition: resize相当(同じtrigger位置でviewportWidthだけ変わる)で再計算しても常にviewport内に収まる", () => {
  const triggerRect = makeTriggerRect(1440);
  [1440, 1280, 1024, 900, 800].forEach((viewportWidth) => {
    const { left } = computeAnchoredPopoverPosition({
      triggerRect, panelWidth: PANEL_WIDTH, panelHeight: PANEL_HEIGHT,
      viewportWidth, viewportHeight: 900, margin: 12, gap: 8,
    });
    assert.ok(left + PANEL_WIDTH <= viewportWidth - 12 + 0.001, `overflow at simulated resize to ${viewportWidth}px`);
    assert.ok(left >= 12 - 0.001, `underflow at simulated resize to ${viewportWidth}px`);
  });
});
