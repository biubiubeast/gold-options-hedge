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
    description:
      "Black-Scholes 中间变量 d1。S=现价，K=行权价，r=无风险利率，sigma=年化 IV，T=剩余年数。",
    usedIn: "所有 Black-Scholes 价格、Delta、Gamma、Theta、Vega 公式",
    defaultExpression:
      "(ln(S / K) + (r + sigma ^ 2 / 2) * T) / (sigma * sqrt(T))",
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
    name: "bid_ask_iv_inversion_enabled",
    category: "valuation",
    expression: "1",
    description:
      "Model IV 价格反解开关：大于 0 为开启，0 或负数为关闭。Model Mark/Bid/Ask IV 只使用与期权价格同一快照的 IV Reference Spot；市场原生 IV 保持独立，不会被覆盖。",
    usedIn:
      "市场热力图 Model Mark IV、Model Bid IV、Model Ask IV、Model Bid Ask IV Spread；公式页提供 ON/OFF 快捷切换",
    defaultExpression: "1",
  },
  {
    name: "iv_inversion_model_price_call",
    category: "valuation",
    expression: "black_scholes_price_call",
    description:
      "Call 的 Model IV 反解价格公式。系统分别用 Mark/Bid/Ask 价格求解 sigma；S 固定为同一行情快照的 IV Reference Spot。变量：S、K、T、r、sigma。",
    usedIn:
      "Call 的 Model Mark/Bid/Ask IV 与 Model IV Spread；不覆盖市场原生 IV",
    defaultExpression: "black_scholes_price_call",
  },
  {
    name: "iv_inversion_model_price_put",
    category: "valuation",
    expression: "black_scholes_price_put",
    description:
      "Put 的 Model IV 反解价格公式。系统分别用 Mark/Bid/Ask 价格求解 sigma；S 固定为同一行情快照的 IV Reference Spot。变量：S、K、T、r、sigma。",
    usedIn:
      "Put 的 Model Mark/Bid/Ask IV 与 Model IV Spread；不覆盖市场原生 IV",
    defaultExpression: "black_scholes_price_put",
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
    expression:
      "(-(S * PDF(d1) * sigma) / (2 * sqrt(T)) - r * K * exp(-r * T) * N(d2)) / 365",
    description: "欧式看涨期权每日 Theta。",
    usedIn: "GLD 估算、详情和 Dashboard",
    defaultExpression:
      "(-(S * PDF(d1) * sigma) / (2 * sqrt(T)) - r * K * exp(-r * T) * N(d2)) / 365",
  },
  {
    name: "black_scholes_theta_put",
    category: "greeks",
    expression:
      "(-(S * PDF(d1) * sigma) / (2 * sqrt(T)) + r * K * exp(-r * T) * N(-d2)) / 365",
    description: "欧式看跌期权每日 Theta。",
    usedIn: "GLD 估算、详情和 Dashboard",
    defaultExpression:
      "(-(S * PDF(d1) * sigma) / (2 * sqrt(T)) + r * K * exp(-r * T) * N(-d2)) / 365",
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
    description:
      "历史成本（USD/USDT）= 成交权利金 × 数量 × 合约乘数 + 手续费。GLD 标准合约默认乘数为 100。",
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
    description:
      "Signed 标的名义金额（USD/USDT）= Net Qty × 实际合约乘数/Deliverable × 标的现价。正数为净多、负数为净空；热力图颜色使用其绝对值。它不是期权 Market Value。",
    usedIn:
      "仓位管理 Notional USD、矩阵 Qty/Notional metric、方格/Expiry Hover 与完整详情",
    defaultExpression: "quantity * contractMultiplier * underlyingPrice",
  },
  {
    name: "premium_currency_to_usd",
    category: "conversion",
    expression: "premiumToUsd",
    description:
      "期权权利金币种换算到 USD 的运行时乘数。USD/USDT/USDC = 1；Deribit BTC/ETH 期权使用与盘口同一快照的 underlying/index price。变量 premiumToUsd 由行情适配器提供；缺失时结果保持 MISSING，不静默使用 0。",
    usedIn:
      "Deribit BTC/ETH Bid/Ask Dollar Notional，以及其他非 USD 权利金币种的统一 USD 量纲；可被估值公式按名称引用",
    defaultExpression: "premiumToUsd",
  },
  {
    name: "mark_price_usd",
    category: "conversion",
    expression: "markPrice * premium_currency_to_usd",
    description:
      "单份期权 Mark 权利金的 USD 等值。GLD/Bybit 的 USD/USDT/USDC 权利金不变；Deribit BTC/ETH 权利金乘同步币价。",
    usedIn:
      "理解和审计非 USD 权利金；可被自定义估值公式引用。原始 Mark Price 仍保留交易所原生计价单位。",
    defaultExpression: "markPrice * premium_currency_to_usd",
  },
  {
    name: "bid_price_usd",
    category: "conversion",
    expression: "bidPrice * premium_currency_to_usd",
    description:
      "单份期权 Best Bid 权利金的 USD 等值；使用与该期权盘口同一快照的 premium_currency_to_usd。",
    usedIn: "Bid Dollar Notional；也可被自定义公式引用",
    defaultExpression: "bidPrice * premium_currency_to_usd",
  },
  {
    name: "ask_price_usd",
    category: "conversion",
    expression: "askPrice * premium_currency_to_usd",
    description:
      "单份期权 Best Ask 权利金的 USD 等值；使用与该期权盘口同一快照的 premium_currency_to_usd。",
    usedIn: "Ask Dollar Notional；也可被自定义公式引用",
    defaultExpression: "askPrice * premium_currency_to_usd",
  },
  {
    name: "bid_dollar_notional",
    category: "valuation",
    expression: "bid_price_usd * bidSize * contractMultiplier",
    description:
      "Bid 一档美元权利金深度 = Bid1 Price × Bid1 Size × Contract Multiplier × premium_currency_to_usd。GLD/Bybit 的 USD/USDT/USDC 乘数为 1；Deribit BTC/ETH 权利金再乘同步币价转为 USD。它不使用持仓 Qty。",
    usedIn:
      "市场热力图 Bid Dollar Notional metric、方格 Hover 与完整详情；任一输入缺失时显示 MISSING 且不参与色标",
    defaultExpression: "bid_price_usd * bidSize * contractMultiplier",
  },
  {
    name: "ask_dollar_notional",
    category: "valuation",
    expression: "ask_price_usd * askSize * contractMultiplier",
    description:
      "Ask 一档美元权利金深度 = Ask1 Price × Ask1 Size × Contract Multiplier × premium_currency_to_usd。GLD/Bybit 的 USD/USDT/USDC 乘数为 1；Deribit BTC/ETH 权利金再乘同步币价转为 USD。它不使用持仓 Qty。",
    usedIn:
      "市场热力图 Ask Dollar Notional metric、方格 Hover 与完整详情；任一输入缺失时显示 MISSING 且不参与色标",
    defaultExpression: "ask_price_usd * askSize * contractMultiplier",
  },
  {
    name: "bid_ask_dollar_notional",
    category: "valuation",
    expression: "bidDollarNotional + askDollarNotional",
    description:
      "Bid+Ask 一档美元名义深度 = Bid Dollar Notional + Ask Dollar Notional，用于比较合约盘口两侧总可见深度。",
    usedIn:
      "市场热力图 Bid+Ask Dollar Notional metric、方格 Hover 与完整详情；任一侧缺失时显示 MISSING 且不参与色标",
    defaultExpression: "bidDollarNotional + askDollarNotional",
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
    name: "gld_xau_multiplier",
    category: "conversion",
    expression: "0.092",
    description:
      "标准 GLD 每股对应的 XAU 盎司量纲。默认 GLD/XAU = 0.092；表达式必须返回正数。标准 GLD 仓位统一使用该值，调整合约仍优先使用逐仓位实际 deliverable。",
    usedIn:
      "GLD Multiplier XAU、XAU Eq Qty、Total Delta XAU、Total Gamma XAU、市场热力图、Dashboard、仓位管理、市场数据刷新与 Excel 导出",
    defaultExpression: "0.092",
  },
  {
    name: "xaut_xau_multiplier",
    category: "conversion",
    expression: "1",
    description:
      "标准 XAUT 每单位对应的 XAU 量纲。默认 XAUT/XAU = 1；表达式必须返回不依赖市场变量的正数。非标准合约仍优先采用逐仓位实际规格。",
    usedIn:
      "XAUT Multiplier XAU、XAU Eq Qty、Total Delta XAU、Total Gamma XAU、市场热力图、Dashboard、仓位管理、市场数据刷新与 Excel 导出",
    defaultExpression: "1",
  },
  {
    name: "gld_contract_multiplier",
    category: "conversion",
    expression: "100",
    description:
      "标准 GLD 期权每张对应的 GLD 股数，默认 100 shares。表达式必须返回不依赖市场变量的正数；调整合约继续使用逐仓位实际 deliverable。",
    usedIn:
      "GLD Entry Value、Entry Cost、Market Value、UPL、Notional、全部 Total Greeks、市场热力图、仓位管理、市场刷新与 Excel 导出",
    defaultExpression: "100",
  },
  {
    name: "xaut_contract_multiplier",
    category: "conversion",
    expression: "1",
    description:
      "标准 XAUT 期权每张对应的 XAUT 数量，默认 1 XAUT。表达式必须返回不依赖市场变量的正数；非标准合约仍优先采用逐仓位实际规格。",
    usedIn:
      "XAUT Entry Value、Entry Cost、Market Value、UPL、Notional、全部 Total Greeks、市场热力图、仓位管理、市场刷新与 Excel 导出",
    defaultExpression: "1",
  },
  {
    name: "spot_scale",
    category: "conversion",
    expression: "underlyingPrice / xauUsdPrice",
    description:
      "BTC 等未配置固定量纲公式的标的，每变动 1 美元相对于 XAU/USD 每变动 1 美元的动态比例。标准 GLD 使用 gld_xau_multiplier；标准 XAUT 使用 xaut_xau_multiplier。",
    usedIn:
      "BTC Delta、Gamma 的 XAU/USD 统一量纲 fallback；GLD/XAUT 分别使用各自固定量纲公式",
    defaultExpression: "underlyingPrice / xauUsdPrice",
  },
  {
    name: "total_delta_xau",
    category: "conversion",
    expression: "delta * quantity * contractMultiplier * spotScale",
    description:
      "组合 XAU Delta = Unit Delta × Net Qty × Contract Multiplier × spotScale。标准 GLD/XAUT 分别使用 gld_xau_multiplier、xaut_xau_multiplier；合约乘数分别使用 gld_contract_multiplier、xaut_contract_multiplier。",
    usedIn:
      "Dashboard、仓位管理、市场热力图、详情页、市场刷新持久化与 Excel 导出的 Total Delta XAU",
    defaultExpression: "delta * quantity * contractMultiplier * spotScale",
  },
  {
    name: "total_gamma_xau",
    category: "conversion",
    expression: "gamma * quantity * contractMultiplier * spotScale ^ 2",
    description:
      "组合 XAU Gamma = Unit Gamma × Net Qty × Contract Multiplier × spotScale²。标准 GLD/XAUT 分别使用各自 XAU Multiplier；二阶敏感度必须使用比例平方。",
    usedIn:
      "Dashboard、仓位管理、市场热力图、详情页、市场刷新持久化与 Excel 导出的 Total Gamma XAU",
    defaultExpression: "gamma * quantity * contractMultiplier * spotScale ^ 2",
  },
  {
    name: "total_theta",
    category: "greeks",
    expression: "theta * quantity * contractMultiplier",
    description:
      "组合每日 Theta（USD/USDT）。Theta 已是货币/日量纲，不乘 GLD/XAU 比例。",
    usedIn: "Dashboard 总 Theta 与详情页 Total Theta",
    defaultExpression: "theta * quantity * contractMultiplier",
  },
  {
    name: "total_vega",
    category: "greeks",
    expression: "vega * quantity * contractMultiplier",
    description:
      "组合 Vega（IV 每变化 1 个百分点对应的 USD/USDT 价值变化）。Vega 已是货币量纲，不乘 GLD/XAU 比例。",
    usedIn: "Dashboard 总 Vega 与详情页 Total Vega",
    defaultExpression: "vega * quantity * contractMultiplier",
  },
] as const;
