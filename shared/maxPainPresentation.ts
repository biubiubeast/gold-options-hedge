import type { GammaStrikeBook } from "./maxPainResearch";

/**
 * Filter one product at ONE observation time by the exchange's expiry date.
 * Date bounds include both endpoints; they are contract IDs, not local dates.
 * Never add OI across observation times: that would count inventory repeatedly.
 */
export function filterOiBooksByExpiryRange(
  books: GammaStrikeBook[],
  startDate: string,
  endDate: string
): { books: GammaStrikeBook[]; error?: string } {
  const validDate = (date: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const timestamp = Date.parse(`${date}T00:00:00Z`);
    return (
      Number.isFinite(timestamp) &&
      new Date(timestamp).toISOString().slice(0, 10) === date
    );
  };
  if (!validDate(startDate) || !validDate(endDate))
    return { books: [], error: "请选择有效的开始到期日和结束到期日。" };
  if (startDate > endDate)
    return { books: [], error: "开始到期日不能晚于结束到期日。" };
  return {
    books: books
      .filter(book => book.maturity >= startDate && book.maturity <= endDate)
      .sort((a, b) => a.maturity.localeCompare(b.maturity)),
  };
}

/**
 * Cross-expiry minimization is a synthetic common-price scenario, not Max Pain
 * at any actual settlement. Keep every aggregate-only display behind one flag.
 */
export function getOiDistributionPresentation(
  isAggregate: boolean,
  showAggregateMinimum = true
) {
  const showIntrinsicValue = !isAggregate || showAggregateMinimum;
  const minimumLabel = isAggregate ? "Minimum Intrinsic Value" : "Max Pain";
  return {
    isAggregate,
    showIntrinsicValue,
    minimumLabel,
    priceLabel: isAggregate ? `${minimumLabel} 对应价位` : "所选 Max Pain",
    amountLabel: isAggregate ? `${minimumLabel} (USD)` : "Max Pain 总内在价值",
    title: `BTC Open Interest By Strike${showIntrinsicValue ? ` × ${minimumLabel}` : ""}`,
  };
}
