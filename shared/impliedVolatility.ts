import { evaluateNamedFormula } from "./formulaEngine";
import { DEFAULT_FORMULAS, type FormulaLike } from "./marketTypes";

export const BID_ASK_IV_INVERSION_TOGGLE = "bid_ask_iv_inversion_enabled";

function formulaRegistry(customFormulas: readonly FormulaLike[]) {
  return customFormulas.length ? customFormulas : DEFAULT_FORMULAS;
}

export function isBidAskIvInversionEnabled(customFormulas: readonly FormulaLike[] = DEFAULT_FORMULAS) {
  const formulas = formulaRegistry(customFormulas);
  if (!formulas.some(formula => formula.name === BID_ASK_IV_INVERSION_TOGGLE)) return true;
  try {
    return evaluateNamedFormula(BID_ASK_IV_INVERSION_TOGGLE, {}, formulas, new Set()) > 0;
  } catch {
    return false;
  }
}

export type ImpliedVolatilityInput = {
  price: number;
  spot: number;
  strike: number;
  expiry: string;
  optionType: "call" | "put";
  asOf: number;
  expiryTimestamp?: number | null;
  rate?: number;
  formulas?: readonly FormulaLike[];
};

/**
 * Solves modelPrice(sigma) = observed option price by bisection. The model-price
 * hook is editable in Formula Management; invalid or unbracketed inputs stay
 * MISSING instead of silently becoming zero.
 */
export function impliedVolatilityFromPrice(input: ImpliedVolatilityInput): number | null {
  const { price, spot, strike, optionType, asOf } = input;
  if (![price, spot, strike].every(value => Number.isFinite(value) && value > 0)) return null;
  const formulas = formulaRegistry(input.formulas ?? DEFAULT_FORMULAS);
  if (!isBidAskIvInversionEnabled(formulas)) return null;

  const parsedExpiry = Date.parse(`${input.expiry}T20:00:00Z`);
  const expiryTimestamp = Number.isFinite(input.expiryTimestamp) && Number(input.expiryTimestamp) > 0
    ? Number(input.expiryTimestamp)
    : parsedExpiry;
  if (!Number.isFinite(expiryTimestamp)) return null;
  const T = Math.max((expiryTimestamp - asOf) / (365.25 * 86_400_000), 1 / (365.25 * 24));
  const r = Number.isFinite(input.rate) ? Number(input.rate) : 0.045;
  const discountedStrike = strike * Math.exp(-r * T);
  const lowerBound = optionType === "call" ? Math.max(spot - discountedStrike, 0) : Math.max(discountedStrike - spot, 0);
  const upperBound = optionType === "call" ? spot : discountedStrike;
  const tolerance = Math.max(0.02, spot * 1e-8);
  if (price < lowerBound - tolerance || price > upperBound + tolerance) return null;

  const hookName = optionType === "call" ? "iv_inversion_model_price_call" : "iv_inversion_model_price_put";
  const fallbackName = optionType === "call" ? "black_scholes_price_call" : "black_scholes_price_put";
  const formulaName = formulas.some(formula => formula.name === hookName) ? hookName : fallbackName;
  const modelPrice = (sigma: number) => {
    try {
      const result = evaluateNamedFormula(formulaName, { S: spot, K: strike, T, r, sigma }, formulas, new Set());
      return Number.isFinite(result) ? result : null;
    } catch {
      return null;
    }
  };

  let low = 0.0001;
  let high = 5;
  const lowPrice = modelPrice(low);
  const highPrice = modelPrice(high);
  if (lowPrice === null || highPrice === null || price < lowPrice - tolerance || price > highPrice + tolerance) return null;
  for (let iteration = 0; iteration < 48; iteration += 1) {
    const middle = (low + high) / 2;
    const middlePrice = modelPrice(middle);
    if (middlePrice === null) return null;
    if (middlePrice < price) low = middle;
    else high = middle;
  }
  const result = (low + high) / 2;
  return Number.isFinite(result) && result > 0 ? result : null;
}
