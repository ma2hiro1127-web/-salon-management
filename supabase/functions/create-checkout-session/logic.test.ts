// create-checkout-session/logic.tsの純粋関数のテスト。
// `npx -y deno test supabase/functions/create-checkout-session/logic.test.ts` で実行する。
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isEligibleForFreeTrial } from "./logic.ts";

Deno.test("契約実績・過去のサブスクリプションが両方無ければトライアル対象(自己サインアップ直後・新規会社)", () => {
  assertEquals(isEligibleForFreeTrial({ contractStartedAt: null, stripeSubscriptionId: null }), true);
});

Deno.test("解約後の再登録で無料期間を再取得できない: contract_started_atがあれば対象外", () => {
  assertEquals(
    isEligibleForFreeTrial({ contractStartedAt: "2026-01-01T00:00:00.000Z", stripeSubscriptionId: null }),
    false
  );
});

Deno.test("トライアル中に一度も課金開始せず解約した会社の再登録では無料期間を再取得できない: stripe_subscription_idの痕跡だけで対象外(contract_started_atがnullでも)", () => {
  assertEquals(
    isEligibleForFreeTrial({ contractStartedAt: null, stripeSubscriptionId: "sub_old_canceled_during_trial" }),
    false
  );
});

Deno.test("両方ある場合も対象外", () => {
  assertEquals(
    isEligibleForFreeTrial({ contractStartedAt: "2026-01-01T00:00:00.000Z", stripeSubscriptionId: "sub_123" }),
    false
  );
});
