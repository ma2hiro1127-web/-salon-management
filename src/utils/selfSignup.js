// 新規オーナー・セルフサインアップフォームの入力検証。self-signup Edge Function側でも同じ
// 必須項目・パスワード長を検証するため二重防御になるが、フロント側でも同じ判定を純粋関数として
// 切り出しておくことで、送信前にユーザーへ即座にエラーを示せる(要件15: 「登録処理中…」のまま
// 何も分からない状態を作らない)のと、単体テストが書ける(このファイル自体はSupabase呼び出しを
// 一切含まない)。
export function validateOwnerSignUpInput({ ownerName, companyName, email, password, passwordConfirm }) {
  const trimmedOwnerName = String(ownerName || "").trim();
  const trimmedCompanyName = String(companyName || "").trim();
  const trimmedEmail = String(email || "").trim();

  if (!trimmedOwnerName) return "オーナー名を入力してください。";
  if (!trimmedCompanyName) return "サロン名（会社名）を入力してください。";
  if (!trimmedEmail) return "メールアドレスを入力してください。";
  if (!String(password || "")) return "パスワードを入力してください。";
  if (String(password || "").length < 8) return "パスワードは8文字以上で設定してください。";
  if (passwordConfirm !== undefined && password !== passwordConfirm) return "パスワード（確認）が一致しません。";

  return "";
}
