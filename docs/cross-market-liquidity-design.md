# 跨市场黄金流动性热力图设计（Bybit XAUT / GLD / CME GC）

## 目标与边界

这是独立于 `Expiry × Strike` 仓位热力图的第二张热力图，用于回答：同一黄金风险敞口，在 Bybit XAUT、GLD、CME GC/MGC 哪个市场成交成本最低、深度最好、数据最新。

不能直接用“盘口数量”相除：XAUT 的数量单位是 token，GLD 是 share，GC/MGC 是 futures contract。所有比较必须先转换为 XAU troy oz 和 USD notional，并用同一时间窗口采样。

## 推荐信息架构

### 1. 顶部固定卡

- Tightest Spread：当前 spread bps 最小的品种。
- Best Depth：±10 bps 内 XAU oz 最大的品种。
- Lowest Impact：指定 XAU oz 下 round-trip impact bps 最小的品种。
- Cross-Market Basis：各品种折算到 USD/XAU oz 后与统一基准价的偏离。
- Largest Staleness：`now - exchangeTimestamp` 最大或缺 timestamp 的 feed。
- Session Warning：GLD 休市、CME maintenance、Bybit 异常或 USDT/USD 偏离。

### 2. 主热力图：Liquidity Ladder

- Columns：Bybit XAUT/USDT、GLD/USD、CME GC front、CME GC next（可增加 MGC）。
- Rows：离 mid 的距离 `0 / 1 / 2 / 5 / 10 / 25 / 50 bps`。
- Metric：Cumulative Depth XAU oz、Cumulative Depth USD、Expected Buy Impact bps、Expected Sell Impact bps、Spread bps、Data Age ms。
- Cell：默认无文字，只对 top/bottom risk 显示数字；hover 显示 bid/ask levels、XAU oz、USD notional、时间戳与来源。
- Color：统一蓝黑→红，但语义固定为“差/风险越高越红”。深度指标先取倒数或转成 `depth shortfall`，避免“深度越好反而越红”。

### 3. 任意两品种比较

选择 A、B 后用相同 `distanceBps` 或相同 `targetXauOz` 对齐：

- `spreadDiffBps = spreadBps(A) - spreadBps(B)`
- `depthRatio = depthXauOz(A) / depthXauOz(B)`
- `impactDiffBps = impactBps(A, targetXauOz) - impactBps(B, targetXauOz)`
- `basisBps = (pricePerXauOz(A) / pricePerXauOz(B) - 1) × 10,000`

正值/负值必须同时显示 A、B 方向，禁止只写“差 3 倍”。

### 4. 三品种比较

三个品种可以同时比较，但不建议把三套订单簿混成一张颜色。推荐共享行轴的 small multiples：三列各自显示 depth ladder，第四列显示排名或相对中位数。这样颜色仍可比较，也不会丢失 venue 身份。

## 统一量纲

### Price

- XAUT：`priceUSDPerXauOz = priceXautUsdt × USDTUSD`；1 XAUT = 1 fine troy oz。
- GLD：`priceUSDPerXauOz = priceGldShare / gldOzPerShare(asOf)`；`gldOzPerShare` 必须读取当日 fund data，不能写死。
- GC：报价本身为 USD/troy oz；标准 GC contract 为 100 troy oz，仍需从 contract master 读取 multiplier。
- MGC：同样从 contract master 读取 multiplier，禁止在业务计算中硬编码。

### Spread

`mid = (bestAsk + bestBid) / 2`

`spreadBps = (bestAsk - bestBid) / mid × 10,000`

### Depth

每一档先转换为 XAU oz：

`levelDepthXauOz = levelQty × unitsPerContract × xauOzPerUnit`

`cumulativeDepthXauOz(d) = Σ levelDepthXauOz, where |levelPrice / mid - 1| × 10,000 <= d`

USD 深度：

`cumulativeDepthUSD(d) = cumulativeDepthXauOz(d) × referenceXauUsd`

### Market impact

对指定 `targetXauOz` 从最优价逐档吃单，计算 VWAP：

`impactBpsBuy = (buyVWAP / mid - 1) × 10,000`

`impactBpsSell = (1 - sellVWAP / mid) × 10,000`

深度不足时必须显示 `FAIL / INSUFFICIENT DEPTH`，不能把缺口当作 0。

## 时间同步与质量规则

- 保存 `exchangeTimestamp`、`receivedAt`、`source`、`sequence/updateId`、`marketSession`。
- 横向比较仅使用同一 `comparisonWindowMs` 内的快照；建议默认 1 秒，专业低延迟源可降至 100ms。
- USDT 与 USD 不能长期固定按 1:1：展示层可近似，流动性比较必须使用实时 USDT/USD 或明确显示 peg 假设。
- GLD 休市与 CME maintenance 时不做实时排名，显示 `MARKET CLOSED`；不能用最后价冒充当下流动性。
- 任何缺失、NaN、时间戳倒退、序列断档都显示 `MISSING/WARN/FAIL`。

## 数据源与实施条件

- Bybit：公共 V5 WebSocket orderbook；spot/linear 可订阅多档 snapshot/delta，并保留 exchange timestamp 与 update id。
- GLD：需要含 real-time top-of-book/depth entitlement 的 broker/CTA/NYSE Arca 数据。当前 Cboe delayed quote 可作期权链和延迟 BBO 参考，不能用于严谨的实时深度倍数。
- CME：Cloud WebSocket API 提供实时 top-of-book；若要真正比较 depth 倍数，需要 CME depth entitlement、Google Pub/Sub/full order book 或有授权的 broker feed。
- GLD XAU 换算：每日读取 SPDR/State Street fund 数据的当日 gold-per-share；不使用固定约数。

在 GLD/CME 真实深度授权接入前，页面只展示 `DESIGN / DATA UNAVAILABLE`，不得输出伪造的“深度相差 N 倍”。

## 推荐实施顺序

1. 接入 Bybit XAUT WebSocket orderbook，落地统一 `NormalizedOrderBook` schema。
2. 接入一条有实时授权的 GLD broker/market-data feed，并校验市场时段。
3. 先接 CME WebSocket top-of-book，完成 spread/basis；取得 depth entitlement 后再开放 depth ratio。
4. 做同步快照、异常状态和回放测试。
5. 最后再开放多品种排序与交易容量建议。
