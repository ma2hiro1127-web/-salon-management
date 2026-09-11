// create-checkout-session/index.tsから使う純粋関数(副作用なし)だけを切り出したモジュール。
// index.test.tsから直接importしてテストするために分けている(index.ts自体はDeno.serve(...)を
// トップレベルで呼ぶため、テストからそのままimportすると副作用が発生するのを避ける)。
// このリポジトリの「Edge Functionは関数間でモジュールを共有しない」規約は維持したまま
// (このファイルはcreate-checkout-session関数の中だけで完結する)。

// 1か月無料トライアルの付与対象かどうか(2026-09-11、恒久対応として切り出し)。
// 以下の両方を満たす会社だけをtrue(=Stripeへtrial_endを渡して良い)とする——
//   1. contractStartedAtが無い(これまで一度も課金開始したことが無い)
//   2. stripeSubscriptionIdが無い(これまで一度もStripeで実サブスクリプションを
//      作ったことが無い——「trialingのまま一度も課金開始に至らず解約された」会社は
//      1.だけでは検知できず、再度Checkoutするとまた新しいtrial_endが渡ってしまう
//      抜け道になっていたため、過去にサブスクリプションが存在した痕跡
//      (stripeSubscriptionIdは解約後もクリアされない)も合わせて見る)
// 「解約して再登録すればまた1か月無料」という悪用を構造的に防ぐための唯一の判定基準。
export function isEligibleForFreeTrial(params: {
  contractStartedAt: string | null;
  stripeSubscriptionId: string | null;
}): boolean {
  return !params.contractStartedAt && !params.stripeSubscriptionId;
}
