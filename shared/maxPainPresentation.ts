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
