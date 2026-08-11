# GLD + XAUT Position Risk Heatmap 机构版规格

## A. 信息架构

页面按交易决策顺序自上而下组织，首屏不依赖点击或浏览器缩放：

1. **实时状态条**：GLD、XAUT、XAU spot，来源、As-of、LIVE/STALE。
2. **固定决策卡**：Max Unit Delta、Max Total Delta、Max Theta Burn、Max Vega、Nearest Expiry、Highest Roll Priority、Largest Data Error。点击仅定位并高亮相应 cell。
3. **一行筛选**：Underlying、Venue、Broker、Account、Call/Put、Expiry bucket、Status、Live/Mock dataset。
4. **热力图控制**：Metric、Quantile/Log/Symmetric scale、99th percentile clipping、Transpose、Spot selector、legend。
5. **核心 Heatmap**：默认 columns=Expiry、rows=Strike；cell 聚合 Expiry×Strike，hover 展示 position detail；只有高重要度 cell 常显数值。
6. **到期控制条**：GLD DTE<=2 自动出现，展示资金覆盖、截止时间和行动状态。
7. **情景条**：XAU shock、IV shock、Day、Van naked delta 与 Residual PnL / Stress Coverage。

导入层独立于展示层：`provider adapter -> normalized RiskPosition -> derived risk -> cell aggregation -> visualization`。手工录入保留为 fallback，不作为机构主流程。

## B. 低保真 wireframe（1366×768）

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ GLD 247.32 LIVE  XAUT 3,358.4 LIVE  XAU 3,359.1 WARN                         As-of 10:31:08 │
├────────────┬────────────┬────────────┬───────────┬────────────┬────────────┬────────────────┤
│MAX UNIT Δ  │MAX TOTAL Δ │THETA BURN  │MAX VEGA   │NEAREST EXP │ROLL PRIOR. │DATA ERROR      │
│GLD 250C .81│XAUT… 82oz  │GLD… -$4.1k│… $12.8k   │GLD… 0DTE   │… 91 / 100  │STALE 38m      │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ U:GLD  Venue:ALL  Broker:ALL  Account:ALL  C/P:Combined  DTE:ALL  Status:ALL  Data:Live     │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ Metric: Total Delta  Scale: Quantile  Clip:P99  Spot:GLD  [Transpose]  legend -80…0…+120  │
├──────────┬──────────┬──────────┬──────────┬──────────┬──────────┬──────────┬───────────────┤
│Strike\Exp│11 AUG 0D │15 AUG 4D │22 AUG 11│19 SEP 39│17 OCT 67│19 DEC130│               │
│   255 OTM│  ░ WARN  │          │  -12.4   │          │          │          │               │
│   250 ATM│ +82.1 ███│  +35.0 ██│          │  +14.2 ░│          │          │ ← SPOT 247.3 │
│   245 ITM│ -41.8 ██ │  +18.6 ░│  MISSING │          │          │          │               │
│   ...    │ compact 24–30px rows; only top-risk cells show values; hover shows positions     │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ EXPIRY FAIL: GLD 250C | funding $250,000 | BP $180,000 | coverage 72% | ROLL | owner WARN │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ Shock -10% | IV +5v | Day 3 | Options +$42k | Van -$63k | Residual -$21k | Coverage 67%   │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

## C. 数据 schema

Canonical `RiskPosition` 不允许用 0 代替缺失数据；可缺字段使用 `null`，并通过 `dataStatus` 标记。

```ts
type DataStatus = "LIVE" | "STALE" | "WARN" | "MISSING" | "FAIL";

interface RiskPosition {
  id: string;
  venue: string;
  broker: string;
  account: string;
  underlying: "GLD" | "XAUT";
  instrument: string;
  callPut: "call" | "put";
  expiry: string;
  strike: number;
  netQty: number;
  contractMultiplier: number | null;
  deliverableSource: string | null;
  contractAdjusted: boolean;
  gldOzPerShare: number | null;
  markPrice: number | null;
  bid: number | null;
  ask: number | null;
  markIV: number | null;
  unitDelta: number | null;
  unitGamma: number | null;
  unitTheta: number | null;
  unitVega: number | null;
  totalDeltaXAU: number | null;
  totalGammaXAU: number | null;
  totalThetaUSD: number | null;
  totalVegaUSD: number | null;
  MV: number | null;
  entryCost: number | null;
  UPL: number | null;
  quoteTime: string | null;
  positionTime: string | null;
  source: string | null;
  dataStatus: DataStatus;
  availableUSD?: number | null;
  buyingPower?: number | null;
  brokerCutoff?: string | null;
  plannedAction?: PlannedAction | null;
  owner?: string | null;
  reviewer?: string | null;
  confirmationId?: string | null;
}
```

Contract multiplier 和 deliverable 的优先级：provider contract master > broker statement contract master > account override > fallback setting。使用 fallback 时必须为 `WARN`；缺失时相关 total risk 为 `null/MISSING`，不得默认为 0。

## D. 风险计算定义

设 `q=netQty`、`m=contractMultiplier`、`o=underlying ounces per unit`。GLD 的 `o=GLD_oz_per_share`；XAUT 的 `o` 来自 live contract spec。

- `MV = markPrice × q × m`
- `Entry Cost = entryPrice × q × m + fee`
- `UPL = MV − Entry Cost`
- `Total Delta XAU = unitDelta × q × m × o`
- `Total Gamma XAU = unitGamma × q × m × o²`
- `Total Theta USD/day = unitTheta × q × m`
- `Total Vega USD/vol-point = unitVega × q × m`
- `Distance to Strike = (spot − strike) / spot`
- `DTE = max(expiry close time − asOf, 0)`；过期仓保留负 DTE 状态，不静默截断。
- `Exercise Funding = strike × actual deliverable × abs(contracts)`；adjusted contract 使用 contract master deliverable。
- `Funding Coverage = min(available USD, buying power) / exercise funding`。资金字段缺失时为 `MISSING`，不是 0%。
- `Scenario Option PnL = shocked theoretical value − current MV`；GLD/XAUT 分别重估后统一到 USD。
- `Van Naked PnL = Van naked XAU delta × XAU spot × shock%`
- `Residual PnL = Option PnL + Van Naked PnL`
- `Stress Coverage = positive hedge PnL / abs(negative Van Naked PnL)`；分母不为负时显示 N/A。

### Roll Priority Score

透明 heuristic，满分 100；每个 position 保留分项、原值、权重与解释：

| 因子 | 权重 | 高分含义 |
|---|---:|---|
| DTE | 20% | 越接近到期越高 |
| Theta / abs(MV) | 15% | 每日时间价值燃烧占比高 |
| Distance to strike | 15% | 越接近 ATM 越高 |
| Unit / Total Delta | 10% | 方向敏感度或仓位放大风险高 |
| Liquidity spread | 10% | spread 宽、退出成本高 |
| Remaining time value | 10% | 时间价值低、到期决策更急 |
| Hedge contribution | 10% | 对当前组合对冲贡献显著 |
| Van residual improvement | 10% | roll 后压力残余改善潜力高 |

Score 仅用于排序和解释，不自动生成交易指令。

## E. 颜色尺度算法

所有模式默认先做 1st/99th percentile clipping，避免单个异常值压平其余仓位；legend 必须显示实际分界值。

1. **Quantile（默认）**：使用过滤后 cell 值的 `q01/q20/q40/q60/q80/q95/q99` 建立 6 档；每档 cell 数接近，适合稠密组合比较。
2. **Log**：`z = sign(x) × log1p(abs(x)/s) / log1p(p99Abs/s)`；`s` 取非零绝对值中位数，保留符号并拉开 50 与 1000。
3. **Symmetric Zero-centered**：`z = clamp(x / p99Abs, -1, 1)`；0 固定中性色，负值红、正值蓝，适合 Delta/Theta/UPL 等带符号风险。

单边指标（IV、DTE、Roll Priority）使用中性→琥珀连续色；带符号指标使用红→中性→蓝。`MISSING/WARN/FAIL` 用边框和角标表达，绝不映射为风险数值 0。

## F. 200 持仓 mock data 与截图

- Mock generator 使用固定 seed，生成 100/200 条可复现 GLD + XAUT positions。
- 强制包含：0DTE、expired、adjusted contract、missing Greeks、stale quote、Call/Put、ITM/ATM/OTM，以及 `unitDelta=.05 qty=1000` 对比 `unitDelta=.8 qty=1`。
- 页面可通过 `/matrix?mock=200` 直接载入 200 条压力数据；默认只看 GLD 时首屏同时分析其中 100 条持仓。
- 验收截图：[`risk-heatmap-200.png`](./risk-heatmap-200.png)，条件为 `1366×768 / Mock 200 / GLD / Total Delta / Quantile P99`。

## G. 验收测试结果

自动测试与 1366×768 Chromium 浏览器验收均通过：

1. **PASS** — 固定 seed 的 100/200 positions 均包含要求的边界样本；200 数据集按 GLD 筛选后，100 条持仓、17 个 Strike、9 个 Expiry 和全部决策卡在首屏可识别，无需浏览器 zoom。
2. **PASS** — 随机仓位 Qty `+1` 后，Total Greeks、heatmap cell、Expiry funding/alert、scenario PnL 全部同步变化。
3. **PASS** — `unitDelta=.05, qty=1000` 与 `unitDelta=.8, qty=1` 在 Unit/Total 两个 metric 下产生不同且正确的排序。
4. **PASS** — Spot 高于/低于全部 Strike 时显示 `SPOT ABOVE RANGE` / `SPOT BELOW RANGE`；`Center Spot` 会插入明确的 spot marker，不让标记消失。
5. **PASS** — Call/Put、ITM/ATM/OTM、0DTE、expired、adjusted contract、missing Greeks、stale quote 均有自动断言和页面状态角标。
6. **PASS** — 非有限值、missing source、missing Greeks 不会进入数值聚合；页面分别显示 `MISSING/WARN/FAIL`，不会静默变成 0。

回归结果：3 个测试文件、12 项测试全部通过；TypeScript 检查和 production build 通过；浏览器控制台无 warning/error。
