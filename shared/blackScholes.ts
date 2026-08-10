import { evaluateNamedFormula } from "./formulaEngine";
import { DEFAULT_FORMULAS, type FormulaLike } from "./marketTypes";

/** Black-Scholes calculator used when a live GLD option quote is unavailable. */

// Standard Normal CDF (Cumulative Distribution Function)
function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}

// Standard Normal PDF (Probability Density Function)
function normalPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

export interface BSInput {
  S: number;      // Spot price (underlying)
  K: number;      // Strike price
  T: number;      // Time to expiry in years
  r: number;      // Risk-free rate (annualized)
  sigma: number;  // Implied volatility (annualized)
  type: "call" | "put";
}

export interface BSOutput {
  price: number;
  delta: number;
  gamma: number;
  theta: number;  // Per day
  vega: number;   // Per 1% change in IV
  rho: number;
}

/**
 * Calculate d1 and d2 for Black-Scholes formula
 */
function calcD1D2(S: number, K: number, T: number, r: number, sigma: number) {
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  return { d1, d2 };
}

/**
 * Black-Scholes option pricing and Greeks
 */
export function blackScholes(
  input: BSInput,
  customFormulas: readonly FormulaLike[] = DEFAULT_FORMULAS,
): BSOutput {
  const { S, K, T, r, sigma, type } = input;

  // Handle edge case: expired or zero time
  if (T <= 0) {
    const intrinsic = type === "call" 
      ? Math.max(S - K, 0) 
      : Math.max(K - S, 0);
    return {
      price: intrinsic,
      delta: type === "call" ? (S > K ? 1 : 0) : (S < K ? -1 : 0),
      gamma: 0,
      theta: 0,
      vega: 0,
      rho: 0,
    };
  }

  const variables = { S, K, T, r, sigma };

  try {
    const price = evaluateNamedFormula(
      type === "call" ? "black_scholes_price_call" : "black_scholes_price_put",
      variables,
      customFormulas,
    );
    const delta = evaluateNamedFormula(
      type === "call" ? "black_scholes_delta_call" : "black_scholes_delta_put",
      variables,
      customFormulas,
    );
    const gamma = evaluateNamedFormula("black_scholes_gamma", variables, customFormulas);
    const theta = evaluateNamedFormula(
      type === "call" ? "black_scholes_theta_call" : "black_scholes_theta_put",
      variables,
      customFormulas,
    );
    const vega = evaluateNamedFormula("black_scholes_vega", variables, customFormulas);
    const { d1, d2 } = calcD1D2(S, K, T, r, sigma);
    const expRT = Math.exp(-r * T);
    const rho = type === "call"
      ? K * T * expRT * normalCDF(d2) / 100
      : -K * T * expRT * normalCDF(-d2) / 100;
    return { price, delta, gamma, theta, vega, rho };
  } catch (error) {
    console.warn("[FormulaEngine] Custom Black-Scholes formula failed; using safe defaults:", error);
    const { d1, d2 } = calcD1D2(S, K, T, r, sigma);
    const sqrtT = Math.sqrt(T);
    const Nd1 = normalCDF(d1);
    const Nd2 = normalCDF(d2);
    const Nnd1 = normalCDF(-d1);
    const Nnd2 = normalCDF(-d2);
    const nd1 = normalPDF(d1);
    const expRT = Math.exp(-r * T);
    const price = type === "call"
      ? S * Nd1 - K * expRT * Nd2
      : K * expRT * Nnd2 - S * Nnd1;
    const delta = type === "call" ? Nd1 : Nd1 - 1;
    const theta = type === "call"
      ? (-S * nd1 * sigma / (2 * sqrtT) - r * K * expRT * Nd2) / 365
      : (-S * nd1 * sigma / (2 * sqrtT) + r * K * expRT * Nnd2) / 365;
    const rho = type === "call"
      ? K * T * expRT * Nd2 / 100
      : -K * T * expRT * Nnd2 / 100;
    return {
      price,
      delta,
      gamma: nd1 / (S * sigma * sqrtT),
      theta,
      vega: S * nd1 * sqrtT / 100,
      rho,
    };
  }
}

/**
 * Calculate time to expiry in years from expiry date string
 */
export function timeToExpiry(expiryDate: string): number {
  const expiry = new Date(`${expiryDate}T20:00:00Z`);
  const now = new Date();
  const diffMs = expiry.getTime() - now.getTime();
  return Math.max(diffMs / (365.25 * 24 * 60 * 60 * 1000), 0);
}

/**
 * Default risk-free rate (US Treasury 3-month rate approximation)
 */
export const DEFAULT_RISK_FREE_RATE = 0.045; // 4.5%

/**
 * Default IV for GLD options when not available from market
 */
export const DEFAULT_GLD_IV = 0.20; // 20% annualized
