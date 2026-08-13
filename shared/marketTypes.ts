export interface OptionMarketData {
  symbol: string;
  markPrice: number;
  markIv: number;
  bid1Price: number;
  ask1Price: number;
  bid1Size: number;
  ask1Size: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  underlyingPrice: number;
  indexPrice: number;
  volume24h: number;
  openInterest: number;
}

export interface SpotPrice {
  price: number;
  timestamp: number;
  source: string;
  stale?: boolean;
  status?: "realtime" | "delayed" | "stale";
  delaySeconds?: number;
}

export interface FormulaLike {
  name: string;
  expression: string;
}

export interface Greeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

export const DEFAULT_FORMULAS = [
  {
    name: "d1",
    category: "greeks",
    expression: "(ln(S / K) + (r + sigma ^ 2 / 2) * T) / (sigma * sqrt(T))",
    description: "Black-Scholes 中间变量 d1。S=现价，K=行权价，r=无风险利率，sigma=年化 IV，T=剩余年数。",
    usedIn: "所有 Black-Scholes 价格、Delta、Gamma、Theta、Vega 公式",
    defaultExpression: "(ln(S / K) + (r + sigma ^ 2 / 2) * T) / (sigma * sqrt(T))",
  },
  {
    name: "d2",
    category: "greeks",
    expression: "d1 - sigma * sqrt(T)",
    description: "Black-Scholes 中间变量 d2；这里直接引用公式 d1。",
    usedIn: "Black-Scholes 价格与 Theta",
    defaultExpression: "d1 - sigma * sqrt(T)",
  },
  {
    name: "black_scholes_price_call",
    category: "valuation",
    expression: "S * N(d1) - K * exp(-r * T) * N(d2)",
    description: "欧式看涨期权理论价格。",
    usedIn: "GLD 无实时期权链时的 Mark Price 估算",
    defaultExpression: "S * N(d1) - K * exp(-r * T) * N(d2)",
  },
  {
    name: "black_scholes_price_put",
    category: "valuation",
    expression: "K * exp(-r * T) * N(-d2) - S * N(-d1)",
    description: "欧式看跌期权理论价格。",
    usedIn: "GLD 无实时期权链时的 Mark Price 估算",
    defaultExpression: "K * exp(-r * T) * N(-d2) - S * N(-d1)",
  },
  {
    name: "black_scholes_delta_call",
    category: "greeks",
    expression: "N(d1)",
    description: "欧式看涨期权 Delta。N 为标准正态分布累计函数。",
    usedIn: "GLD 估算、矩阵、详情和 Dashboard",
    defaultExpression: "N(d1)",
  },
  {
    name: "black_scholes_delta_put",
    category: "greeks",
    expression: "N(d1) - 1",
    description: "欧式看跌期权 Delta。",
    usedIn: "GLD 估算、矩阵、详情和 Dashboard",
    defaultExpression: "N(d1) - 1",
  },
  {
    name: "black_scholes_gamma",
    category: "greeks",
    expression: "PDF(d1) / (S * sigma * sqrt(T))",
    description: "Black-Scholes Gamma。PDF 为标准正态分布密度函数。",
    usedIn: "GLD 估算、详情和 Dashboard",
    defaultExpression: "PDF(d1) / (S * sigma * sqrt(T))",
  },
  {
    name: "black_scholes_theta_call",
    category: "greeks",
    expression: "(-(S * PDF(d1) * sigma) / (2 * sqrt(T)) - r * K * exp(-r * T) * N(d2)) / 365",
    description: "欧式看涨期权每日 Theta。",
    usedIn: "GLD 估算、详情和 Dashboard",
    defaultExpression: "(-(S * PDF(d1) * sigma) / (2 * sqrt(T)) - r * K * exp(-r * T) * N(d2)) / 365",
  },
  {
    name: "black_scholes_theta_put",
    category: "greeks",
    expression: "(-(S * PDF(d1) * sigma) / (2 * sqrt(T)) + r * K * exp(-r * T) * N(-d2)) / 365",
    description: "欧式看跌期权每日 Theta。",
    usedIn: "GLD 估算、详情和 Dashboard",
    defaultExpression: "(-(S * PDF(d1) * sigma) / (2 * sqrt(T)) + r * K * exp(-r * T) * N(-d2)) / 365",
  },
  {
    name: "black_scholes_vega",
    category: "greeks",
    expression: "S * PDF(d1) * sqrt(T) / 100",
    description: "IV 每变化 1 个百分点时的 Vega。",
    usedIn: "GLD 估算、详情和 Dashboard",
    defaultExpression: "S * PDF(d1) * sqrt(T) / 100",
  },
  {
    name: "entry_cost",
    category: "valuation",
    expression: "entryPrice * quantity * contractMultiplier + fee",
    description: "历史成本（USD/USDT）= 成交权利金 × 数量 × 合约乘数 + 手续费。GLD 标准合约默认乘数为 100。",
    usedIn: "详情页与 Dashboard",
    defaultExpression: "entryPrice * quantity * contractMultiplier + fee",
  },
  {
    name: "current_value",
    category: "valuation",
    expression: "markPrice * quantity * contractMultiplier",
    description: "当前市值（USD/USDT）= Mark Price × 数量 × 合约乘数。",
    usedIn: "详情页与 Dashboard",
    defaultExpression: "markPrice * quantity * contractMultiplier",
  },
  {
    name: "notional_size",
    category: "valuation",
    expression: "quantity * contractMultiplier * underlyingPrice",
    description: "Signed 标的名义金额（USD/USDT）= Net Qty × 实际合约乘数/Deliverable × 标的现价。正数为净多、负数为净空；热力图颜色使用其绝对值。它不是期权 Market Value。",
    usedIn: "仓位管理 Notional USD、矩阵 Qty/Notional metric、方格/Expiry Hover 与完整详情",
    defaultExpression: "quantity * contractMultiplier * underlyingPrice",
  },
  {
    name: "pnl",
    category: "valuation",
    expression: "currentValue - entryCost",
    description: "未实现盈亏 = 当前市值 − 历史成本。",
    usedIn: "详情页与 Dashboard",
    defaultExpression: "currentValue - entryCost",
  },
  {
    name: "spot_scale",
    category: "conversion",
    expression: "underlyingPrice / xauUsdPrice",
    description: "标的每变动 1 美元相对于 XAU/USD 每变动 1 美元的比例。GLD 通常约为 0.09；XAUT 接近 1。",
    usedIn: "将 Delta/Gamma 统一为 XAU/USD 风险量纲",
    defaultExpression: "underlyingPrice / xauUsdPrice",
  },
  {
    name: "total_delta_xau",
    category: "conversion",
    expression: "delta * quantity * contractMultiplier * spotScale",
    description: "组合 XAU Delta；应用链式法则和合约乘数。",
    usedIn: "Dashboard 总 Delta 与详情页 XAU Delta",
    defaultExpression: "delta * quantity * contractMultiplier * spotScale",
  },
  {
    name: "total_gamma_xau",
    category: "conversion",
    expression: "gamma * quantity * contractMultiplier * spotScale ^ 2",
    description: "组合 XAU Gamma；二阶敏感度需使用 spotScale 的平方。",
    usedIn: "Dashboard 总 Gamma 与详情页 XAU Gamma",
    defaultExpression: "gamma * quantity * contractMultiplier * spotScale ^ 2",
  },
  {
    name: "total_theta",
    category: "greeks",
    expression: "theta * quantity * contractMultiplier",
    description: "组合每日 Theta（USD/USDT）。",
    usedIn: "Dashboard 总 Theta 与详情页 Total Theta",
    defaultExpression: "theta * quantity * contractMultiplier",
  },
  {
    name: "total_vega",
    category: "greeks",
    expression: "vega * quantity * contractMultiplier",
    description: "组合 Vega（IV 每变化 1 个百分点对应的 USD/USDT 价值变化）。",
    usedIn: "Dashboard 总 Vega 与详情页 Total Vega",
    defaultExpression: "vega * quantity * contractMultiplier",
  },
] as const;
