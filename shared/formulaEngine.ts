import type { FormulaLike } from "./marketTypes";

export const DEFAULT_GLD_XAU_MULTIPLIER = 0.092;
export const DEFAULT_XAUT_XAU_MULTIPLIER = 1;
export const DEFAULT_GLD_CONTRACT_MULTIPLIER = 100;
export const DEFAULT_XAUT_CONTRACT_MULTIPLIER = 1;

type Token =
  | { type: "number"; value: number }
  | { type: "identifier"; value: string }
  | { type: "operator"; value: string }
  | { type: "paren"; value: "(" | ")" }
  | { type: "comma" };

const functions: Record<string, (...values: number[]) => number> = {
  sqrt: Math.sqrt,
  ln: Math.log,
  log: Math.log,
  exp: Math.exp,
  abs: Math.abs,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  N: normalCDF,
  CDF: normalCDF,
  PDF: normalPDF,
};

function normalCDF(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const p = 0.3275911;
  const coefficients = [0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429];
  const t = 1 / (1 + p * x);
  const y = 1 - (((((coefficients[4] * t + coefficients[3]) * t + coefficients[2]) * t + coefficients[1]) * t + coefficients[0]) * t * Math.exp(-x * x));
  return 0.5 * (1 + sign * y);
}

function normalPDF(value: number): number {
  return Math.exp(-0.5 * value * value) / Math.sqrt(2 * Math.PI);
}

function tokenize(rawExpression: string): Token[] {
  const expression = rawExpression
    .replaceAll("×", "*")
    .replaceAll("÷", "/")
    .replaceAll("−", "-")
    .replaceAll("σ", "sigma")
    .replaceAll("π", "pi");
  const tokens: Token[] = [];
  let index = 0;

  while (index < expression.length) {
    const rest = expression.slice(index);
    const whitespace = rest.match(/^\s+/);
    if (whitespace) {
      index += whitespace[0].length;
      continue;
    }
    const number = rest.match(/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i);
    if (number) {
      tokens.push({ type: "number", value: Number(number[0]) });
      index += number[0].length;
      continue;
    }
    const identifier = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (identifier) {
      tokens.push({ type: "identifier", value: identifier[0] });
      index += identifier[0].length;
      continue;
    }
    const character = expression[index];
    if ("+-*/^".includes(character)) tokens.push({ type: "operator", value: character });
    else if (character === "(" || character === ")") tokens.push({ type: "paren", value: character });
    else if (character === ",") tokens.push({ type: "comma" });
    else throw new Error(`无法识别字符“${character}”`);
    index += 1;
  }

  return tokens;
}

class Parser {
  private index = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly variables: Record<string, number>,
    private readonly registry: Map<string, FormulaLike>,
    private readonly stack: Set<string>,
  ) {}

  parse(): number {
    const value = this.parseAdditive();
    if (this.index !== this.tokens.length) throw new Error("表达式末尾存在多余内容");
    if (!Number.isFinite(value)) throw new Error("计算结果不是有限数值");
    return value;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private consume(): Token {
    const token = this.tokens[this.index++];
    if (!token) throw new Error("表达式意外结束");
    return token;
  }

  private parseAdditive(): number {
    let value = this.parseMultiplicative();
    while (this.peek()?.type === "operator" && ["+", "-"].includes((this.peek() as { value: string }).value)) {
      const operator = (this.consume() as { value: string }).value;
      const right = this.parseMultiplicative();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }

  private parseMultiplicative(): number {
    let value = this.parsePower();
    while (this.peek()?.type === "operator" && ["*", "/"].includes((this.peek() as { value: string }).value)) {
      const operator = (this.consume() as { value: string }).value;
      const right = this.parsePower();
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  }

  private parsePower(): number {
    const left = this.parseUnary();
    if (this.peek()?.type === "operator" && (this.peek() as { value: string }).value === "^") {
      this.consume();
      return Math.pow(left, this.parsePower());
    }
    return left;
  }

  private parseUnary(): number {
    const token = this.peek();
    if (token?.type === "operator" && (token.value === "+" || token.value === "-")) {
      this.consume();
      const value = this.parseUnary();
      return token.value === "-" ? -value : value;
    }
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    const token = this.consume();
    if (token.type === "number") return token.value;
    if (token.type === "paren" && token.value === "(") {
      const value = this.parseAdditive();
      const closing = this.consume();
      if (closing.type !== "paren" || closing.value !== ")") throw new Error("缺少右括号");
      return value;
    }
    if (token.type !== "identifier") throw new Error("此处需要数字、变量或函数");

    if (this.peek()?.type === "paren" && (this.peek() as { value: string }).value === "(") {
      this.consume();
      const args: number[] = [];
      if (!(this.peek()?.type === "paren" && (this.peek() as { value: string }).value === ")")) {
        while (true) {
          args.push(this.parseAdditive());
          if (this.peek()?.type !== "comma") break;
          this.consume();
        }
      }
      const closing = this.consume();
      if (closing.type !== "paren" || closing.value !== ")") throw new Error("函数缺少右括号");
      const fn = functions[token.value];
      if (!fn) throw new Error(`不支持函数 ${token.value}`);
      return fn(...args);
    }

    if (Object.prototype.hasOwnProperty.call(this.variables, token.value)) {
      return this.variables[token.value];
    }
    if (token.value.toLowerCase() === "pi") return Math.PI;
    if (token.value.toLowerCase() === "e") return Math.E;

    const referenced = this.registry.get(token.value);
    if (!referenced) throw new Error(`未知变量或公式 ${token.value}`);
    if (this.stack.has(token.value)) throw new Error(`公式循环引用：${[...this.stack, token.value].join(" → ")}`);
    return evaluateNamedFormula(token.value, this.variables, [...this.registry.values()], this.stack);
  }
}

export function evaluateExpression(
  expression: string,
  variables: Record<string, number>,
  formulas: readonly FormulaLike[] = [],
  stack = new Set<string>(),
): number {
  return new Parser(tokenize(expression), variables, new Map(formulas.map(formula => [formula.name, formula])), stack).parse();
}

export function evaluateNamedFormula(
  name: string,
  variables: Record<string, number>,
  formulas: readonly FormulaLike[],
  parentStack = new Set<string>(),
): number {
  const formula = formulas.find(item => item.name === name);
  if (!formula) throw new Error(`公式 ${name} 不存在`);
  const stack = new Set(parentStack);
  stack.add(name);
  return evaluateExpression(formula.expression, variables, formulas, stack);
}

/**
 * Returns the editable standard GLD share-to-XAU conversion ratio.
 * The formula is deliberately evaluated without market variables so it remains
 * a stable, auditable global conversion parameter rather than a moving spot ratio.
 */
function resolvePositiveConstantFormula(
  name: string,
  formulas: readonly FormulaLike[],
  fallback: number,
): number {
  try {
    const value = evaluateNamedFormula(name, {}, formulas, new Set());
    return Number.isFinite(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

export function resolveGldXauMultiplier(
  formulas: readonly FormulaLike[],
  fallback = DEFAULT_GLD_XAU_MULTIPLIER,
): number {
  return resolvePositiveConstantFormula("gld_xau_multiplier", formulas, fallback);
}

export function resolveXautXauMultiplier(
  formulas: readonly FormulaLike[],
  fallback = DEFAULT_XAUT_XAU_MULTIPLIER,
): number {
  return resolvePositiveConstantFormula("xaut_xau_multiplier", formulas, fallback);
}

export function resolveGldContractMultiplier(
  formulas: readonly FormulaLike[],
  fallback = DEFAULT_GLD_CONTRACT_MULTIPLIER,
): number {
  return resolvePositiveConstantFormula("gld_contract_multiplier", formulas, fallback);
}

export function resolveXautContractMultiplier(
  formulas: readonly FormulaLike[],
  fallback = DEFAULT_XAUT_CONTRACT_MULTIPLIER,
): number {
  return resolvePositiveConstantFormula("xaut_contract_multiplier", formulas, fallback);
}

export function validateFormula(
  expression: string,
  formulas: readonly FormulaLike[],
): { valid: true } | { valid: false; error: string } {
  const sampleVariables = {
    S: 300,
    K: 300,
    T: 0.5,
    r: 0.04,
    sigma: 0.2,
    entryPrice: 10,
    quantity: 2,
    contractMultiplier: 100,
    fee: 1,
    markPrice: 12,
    currentValue: 2400,
    entryCost: 2001,
    underlyingPrice: 300,
    xauUsdPrice: 3000,
    delta: 0.5,
    gamma: 0.01,
    theta: -0.1,
    vega: 0.2,
    spotScale: 0.1,
    bidPrice: 11.5,
    askPrice: 12.5,
    bidSize: 8,
    askSize: 6,
    bidDollarNotional: 9200,
    askDollarNotional: 7500,
  };
  try {
    evaluateExpression(expression, sampleVariables, formulas);
    return { valid: true };
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : String(error) };
  }
}
