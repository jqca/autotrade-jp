/**
 * auカブコム証券 手数料計算
 * シングル（1約定）コース（税込）
 *
 * 現物取引:
 *   5万円以下       55円
 *   10万円以下      99円
 *   20万円以下     115円
 *   50万円以下     275円
 *  100万円以下     535円
 *  150万円以下     640円
 *  200万円以下     800円
 *  300万円以下   1,000円
 *  300万円超     1,013円（上限）
 *
 * 信用取引:
 *  10万円以下      99円
 *  10万円超       198円
 *
 * 参考: https://kabu.com/company/legalinfo/commission.html
 */

export function calcAuKabuCommission(tradeAmount: number, cashMargin: number = 1): number {
  if (cashMargin === 2) {
    // 信用取引
    if (tradeAmount <= 100_000) return 99;
    return 198;
  }
  // 現物取引
  if (tradeAmount <= 50_000) return 55;
  if (tradeAmount <= 100_000) return 99;
  if (tradeAmount <= 200_000) return 115;
  if (tradeAmount <= 500_000) return 275;
  if (tradeAmount <= 1_000_000) return 535;
  if (tradeAmount <= 1_500_000) return 640;
  if (tradeAmount <= 2_000_000) return 800;
  if (tradeAmount <= 3_000_000) return 1_000;
  return 1_013; // 上限
}

/**
 * 買い・売りのラウンドトリップ合計手数料
 */
export function calcRoundTripCommission(buyAmount: number, sellAmount: number, cashMargin: number = 1): number {
  return calcAuKabuCommission(buyAmount, cashMargin) + calcAuKabuCommission(sellAmount, cashMargin);
}
