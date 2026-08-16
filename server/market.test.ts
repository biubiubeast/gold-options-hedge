import { describe, expect, it } from "vitest";
import { blackScholes } from "../shared/blackScholes";
import {
  evaluateExpression,
  evaluateNamedFormula,
  resolveGldContractMultiplier,
  resolveGldXauMultiplier,
  resolveXautContractMultiplier,
  resolveXautXauMultiplier,
  validateFormula,
} from "../shared/formulaEngine";
import { DEFAULT_FORMULAS } from "../shared/marketTypes";
import { buildOccOptionSymbol } from "./marketData";

describe("formula engine", () => {
  it("supports arithmetic, functions and formula references", () => {
    expect(evaluateExpression("2 + 3 * 4 ^ 2", {})).toBe(50);
    expect(evaluateNamedFormula("d2", { S: 100, K: 100, T: 1, r: 0.05, sigma: 0.2 }, DEFAULT_FORMULAS)).toBeCloseTo(0.15, 5);
  });

  it("rejects unknown variables and circular references", () => {
    expect(validateFormula("unknown + 1", DEFAULT_FORMULAS)).toMatchObject({ valid: false });
    expect(validateFormula("loop + 1", [...DEFAULT_FORMULAS, { name: "loop", expression: "loop + 1" }])).toMatchObject({ valid: false });
  });

  it("uses editable GLD/XAUT XAU and contract multipliers in all affected Greeks", () => {
    const overrides: Record<string, string> = {
      gld_xau_multiplier: "0.1",
      xaut_xau_multiplier: "0.9",
      gld_contract_multiplier: "200",
      xaut_contract_multiplier: "2",
    };
    const custom = DEFAULT_FORMULAS.map(formula => overrides[formula.name]
      ? { ...formula, expression: overrides[formula.name] }
      : formula);
    const spotScale = resolveGldXauMultiplier(custom);
    const variables = {
      delta: 0.5, gamma: 0.02, theta: -0.1, vega: 0.2,
      quantity: 2, contractMultiplier: resolveGldContractMultiplier(custom), spotScale,
    };
    expect(spotScale).toBe(0.1);
    expect(resolveXautXauMultiplier(custom)).toBe(0.9);
    expect(resolveGldContractMultiplier(custom)).toBe(200);
    expect(resolveXautContractMultiplier(custom)).toBe(2);
    expect(evaluateNamedFormula("total_delta_xau", variables, custom)).toBe(20);
    expect(evaluateNamedFormula("total_gamma_xau", variables, custom)).toBeCloseTo(0.08, 10);
    expect(evaluateNamedFormula("total_theta", variables, custom)).toBe(-40);
    expect(evaluateNamedFormula("total_vega", variables, custom)).toBe(80);
  });
});

describe("customizable Black-Scholes", () => {
  it("returns standard call price and Greeks", () => {
    const result = blackScholes({ S: 100, K: 100, T: 1, r: 0.05, sigma: 0.2, type: "call" });
    expect(result.price).toBeCloseTo(10.45, 1);
    expect(result.delta).toBeCloseTo(0.6368, 3);
    expect(result.gamma).toBeGreaterThan(0);
  });

  it("applies a saved formula override", () => {
    const custom = DEFAULT_FORMULAS.map(formula => formula.name === "black_scholes_delta_call"
      ? { ...formula, expression: "0.25" }
      : formula,
    );
    const result = blackScholes({ S: 100, K: 100, T: 1, r: 0.05, sigma: 0.2, type: "call" }, custom);
    expect(result.delta).toBe(0.25);
  });
});

describe("GLD market-data contract mapping", () => {
  it("builds a valid OCC option symbol", () => {
    expect(buildOccOptionSymbol({ expiry: "2026-12-18", strike: 247.5, optionType: "call" }))
      .toBe("GLD261218C00247500");
  });
});
