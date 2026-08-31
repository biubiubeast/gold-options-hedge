# 期权行情字段完整性与 USD 量纲审计

审计日期：2026-08-31（Asia/Hong_Kong）

## 结论摘要

1. Deribit BTC/ETH 完整链已经从“REST 批量摘要、没有 Size”升级为“REST 合约主数据/摘要 + 持久 WebSocket ticker”。完整链可读取 Best Bid/Ask Price、Best Bid/Ask Amount、Market Bid/Ask/Mark IV、Greeks、OI、Volume、交易所时间戳和同步 Underlying Price。
2. Deribit 权利金以 BTC 或 ETH 计价。网站保留交易所原始 Price，同时使用同步 `underlying_price` 转换 USD；Bid/Ask Dollar Notional 不再把 BTC/ETH 权利金误当成美元。
3. MarketData.app 与 Tradier 适配器原先已经读取 Price、Size、IV 和 Greeks，但漏写 OI/Volume 到统一结构。本次已修复，并增加单元测试。
4. Bybit XAUT/BTC/ETH 与 Cboe GLD 的重要一级行情字段没有发现新的代码漏映射；它们仍有各自的数据源边界，必须由 Source、As-of、Market/Model IV 和 MISSING 状态明确表达。
5. `Volume Notional USD` 已接入市场热力图 Metric、颜色尺度、全局/Expiry 分布统计和 Market Hover。网站按可编辑公式将原始 Volume 统一成 USD 标的名义金额；Call+Put 同格时求和，任一必要输入缺失时整格不着色，真实 0 则保留为 0。

## Deribit 最可靠读取架构

### 冷启动

1. `public/get_instruments` 获取全部未过期合约、Expiry、Strike、Call/Put、状态、`contract_size` 和权利金币种。
2. `public/get_book_summary_by_currency` 一次获取整币种的 Mark、Mark IV、Bid/Ask Price、Underlying Price、OI 和 Volume，作为结构与快速回退。
3. 建立一条长期 WebSocket，按每批 400 个频道订阅 `ticker.{instrument}.100ms`，合并原生 Best Bid/Ask Amount、Bid/Ask IV 和 Greeks。
4. 首次请求最多等待 3.5 秒或达到 95% ticker 覆盖率。对尚未收到 ticker、但批量摘要显示存在 Bid 或 Ask 的合约，按成交量/OI 排序调用最多 60 个 REST `public/ticker` 兜底，避免数千次逐合约请求导致限流和卡顿。

### 持续运行

- 服务器响应 Deribit `test_request` heartbeat，并自动处理断线重连。
- 每次完整链刷新会增量订阅新上市合约、取消已下市合约；不是每 5 分钟重新建立数千条连接。
- 每个 cell 使用该合约自己的 ticker timestamp；服务器休眠/重启后先重建订阅，最初几秒可能出现部分 MISSING，后续快照会自动补齐。
- REST fallback 不是伪造实时数据；Source 会明确显示它没有原生 Top Size。

## USD 统一量纲

公式管理新增或更新以下可编辑公式：

```text
premium_currency_to_usd = premiumToUsd
mark_price_usd = markPrice * premium_currency_to_usd
bid_price_usd = bidPrice * premium_currency_to_usd
ask_price_usd = askPrice * premium_currency_to_usd
bid_dollar_notional = bid_price_usd * bidSize * contractMultiplier
ask_dollar_notional = ask_price_usd * askSize * contractMultiplier
bid_ask_dollar_notional = bidDollarNotional + askDollarNotional
```

参数定义：

| 参数                  | 定义                             | Deribit                                                             | Bybit / GLD                                               |
| --------------------- | -------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------- |
| `premiumToUsd`        | 1 单位权利金币种对应多少 USD     | 同一合约 ticker/summary 的 BTC/ETH `underlying_price`               | USD/USDT/USDC 取 1                                        |
| `contractMultiplier`  | 每一盘口 Size 对应的实际合约规格 | 实时 `get_instruments.contract_size`，当前标准 BTC/ETH 期权通常为 1 | Bybit 当前为 1；GLD 标准为 100 股或逐仓位实际 deliverable |
| `bidSize` / `askSize` | 一档可见数量                     | `best_bid_amount` / `best_ask_amount`                               | 数据源的一档 Size                                         |

例：Deribit BTC 期权 Bid = `0.01 BTC`，Bid Size = `2`，contract size = `1`，同步 BTC/USD = `80,000`：

```text
Bid Dollar Notional = 0.01 × 2 × 1 × 80,000 = 1,600 USD
```

这里的 Dollar Notional 是“一档可见权利金深度”，不是持仓标的 Notional，也不是执行期权所需的行权资金。任一输入缺失时结果为 MISSING，不填 0、不参加热力色标。

## 实时抽样验证

### Volume 覆盖率（2026-08-31）

| 市场          | 返回合约 | Volume 字段存在 | Volume > 0 | Volume = 0 | 窗口/口径                      |
| ------------- | -------: | --------------: | ---------: | ---------: | ------------------------------ |
| GLD / Cboe    |    7,972 |           7,972 |      3,218 |      4,754 | 当日/当前交易时段累计、delayed |
| XAUT / Bybit  |      444 |             444 |        151 |        293 | `volume24h`，数据源原生数量    |
| BTC / Bybit   |      770 |             770 |        448 |        322 | `volume24h`，数据源原生数量    |
| ETH / Bybit   |      672 |             672 |        380 |        292 | `volume24h`，数据源原生数量    |
| BTC / Deribit |    1,026 |           1,026 |        493 |        533 | ticker/summary 最近 24 小时    |
| ETH / Deribit |      882 |             882 |        398 |        484 | ticker/summary 最近 24 小时    |

以上为公共接口的一次瞬时覆盖率检查，并不是固定市场统计。`0` 表示数据源明确返回零成交；字段为空、缺失或不可解析才标记 `MISSING`。GLD 样本 As-of 为 `2026-08-31 05:16:50`（Cboe 原始时间字符串）。

以下数字是 2026-08-26 的一次公共接口冷启动抽样，会随上市合约和盘口变化：

| 来源        | 合约数 | WebSocket ticker 覆盖 | 非空 Bid Size | 非空 Ask Size | 非空 Market Bid IV | 非空 Market Ask IV |
| ----------- | -----: | --------------------: | ------------: | ------------: | -----------------: | -----------------: |
| Deribit BTC |    966 |             966 / 966 |           905 |           966 |                712 |                966 |
| Deribit ETH |    816 |             816 / 816 |           770 |           809 |                590 |                809 |

非空数量少于合约数不一定是代码错误：远端/深度外合约可能没有一侧挂单；Deribit 也可能对某些报价返回 Amount 而不返回有效 Bid IV。此时 Market IV 必须保持 MISSING，Model IV 仍作为独立系列存在，不能冒充交易所 IV。

单元测试同时验证：

- Deribit ticker Size、Bid/Ask IV、Greeks、timestamp 正确覆盖 REST summary；
- `0.01 × 2 × 1 × 80,000 = 1,600 USD` 的 BTC Bid Dollar Notional；
- ETH 换算 Spot 缺失时 Dollar Notional 保持 `null`；
- MarketData.app / Tradier 的 Size、OI、Volume 不再在适配层丢失。

## 全标的数据字段审计

| Underlying / Source       | Price + Size                   | Market IV                                     | Greeks                 | OI / Volume    | 当前边界或原因                                                                    |
| ------------------------- | ------------------------------ | --------------------------------------------- | ---------------------- | -------------- | --------------------------------------------------------------------------------- |
| GLD / Cboe delayed JSON   | Bid/Ask 与 Bid/Ask Size        | 原生 Mark IV；没有原生 Bid/Ask IV             | Delta/Gamma/Theta/Vega | 已读取         | 免费公开链是 delayed；Bid/Ask IV 只能独立显示 Model IV；休市时 As-of 不更新       |
| GLD / MarketData.app OPRA | Bid/Ask、Size                  | 原生综合 IV；无独立原生 Bid/Ask IV 时用 Model | Delta/Gamma/Theta/Vega | 本次补齐映射   | 需要 token 和适用 OPRA entitlement；实际实时级别由账户授权决定                    |
| GLD / Tradier + ORATS     | Bid/Ask、Size                  | 读取数据商提供的 IV 字段；缺失时 Model        | Delta/Gamma/Theta/Vega | 本次补齐映射   | 需要 production token；ORATS Greeks 频率可能低于价格；sandbox 延迟                |
| XAUT / Bybit              | Bid/Ask、Size                  | Mark/Bid/Ask IV                               | Delta/Gamma/Theta/Vega | OI、24h Volume | 交易所可能对无效/极端盘口返回 `0` IV；网站将其视为 Market MISSING，Model 独立反解 |
| BTC / Bybit               | Bid/Ask、Size                  | Mark/Bid/Ask IV                               | Delta/Gamma/Theta/Vega | OI、24h Volume | USDT 计价，`premiumToUsd=1`；字段语义是 Bybit 期权 ticker 原生口径                |
| ETH / Bybit               | Bid/Ask、Size                  | Mark/Bid/Ask IV                               | Delta/Gamma/Theta/Vega | OI、24h Volume | 同上                                                                              |
| BTC / Deribit             | WebSocket Best Bid/Ask、Amount | Mark/Bid/Ask IV                               | WebSocket 原生 Greeks  | OI、Volume     | BTC 权利金必须乘同步 BTC price 转 USD；空盘口保持 MISSING                         |
| ETH / Deribit             | WebSocket Best Bid/Ask、Amount | Mark/Bid/Ask IV                               | WebSocket 原生 Greeks  | OI、Volume     | ETH 权利金必须乘同步 ETH price 转 USD；空盘口保持 MISSING                         |

Bybit 公共接口抽样的 XAUT、BTC、ETH ticker 都包含 `bid1Price/bid1Size/bid1Iv`、`ask1Price/ask1Size/ask1Iv`、Mark、Greeks、OI 和 Volume。当前适配器已经逐项映射，没有发现类似 Deribit Size 被硬编码为空的问题。

## 仍需明确展示、但不能由代码凭空补齐的数据

### 1. 空盘口与 0 IV

真实没有 Bid 或 Ask 的合约没有可用于该侧的 Size/Dollar Notional；交易所返回 `0` 或空 IV 也不等于真实波动率为 0。网站应显示 MISSING，并允许查看 Model IV，但两类 IV 不混合。

### 2. 一级 Size 不是完整深度

当前读取的是 Best Bid/Ask 一档数量。它能支持一级 Dollar Notional 和横截面对比，但不能代表扫单 5/10/25 bps 的累计深度、滑点或冲击成本。专业下一步应订阅 Deribit `book.{instrument}.{group}.{depth}.100ms`、Bybit orderbook，并对 GLD 购买具备 OPRA 深度的许可源。

### 3. Volume 已统一为 USD 名义金额，OI 仍保留原生口径

原始 Volume 继续按 provider-native 字段保存用于审计：Bybit 是 ticker 的 24h Volume，Deribit 是 ticker stats / summary 的 24h Volume，GLD 是 OPRA/Cboe 当日/当前交易时段合约数。热力图不再直接着色原始数量，而通过公式管理中的可编辑公式统一换算：

`volume_notional_usd = volume × contractMultiplier × underlyingPrice`

当前热力图的 `Volume Notional USD` 遵守以下规则：

- GLD 使用 `Session` 标签；Bybit/Deribit 使用 `24h` 标签，同一合约只显示适用的一种窗口；
- Combined Call+Put cell 使用两腿 Volume Notional USD 之和；
- Expiry 与左上角统计使用当前筛选后的 Min/P25/Median/Average/P75/Max；
- 任一合约的原始 Volume、实际合约乘数或 Spot 缺失，整格不着色，Hover 不显示无效 Volume 行；真实 0 保留为 0；
- USD 量纲使跨标的规模比较成为可能，但 Session 与 24h 窗口不同，不能把差异全部解释为流动性差异。

OI 仍保留 provider-native 口径。若要跨市场比较 OI，应另建 `OI × contract size × spot` 的 USD 指标，而不是直接比较原始 OI。

### 4. GLD adjusted contract deliverable

标准 GLD 期权按 100 股，但拆分、并购或其他调整合约必须来自 OCC/券商 contract master。当前完整链符号和手工/Excel deliverable 能处理标准仓位，但没有自动接入 OCC adjusted deliverable master；这是 GLD 名义金额与 Greeks 准确性的高优先级生产改进。

### 5. Greeks 的模型与更新频率不同

Deribit/Bybit Greeks 是交易所字段；Cboe/MarketData/Tradier 的来源、模型和频率不同。即使都叫 Delta/Gamma/Theta/Vega，也不能假定模型参数完全相同。跨 venue 聚合前应保留 Source、As-of、IV Source、利率和合约规格。

### 6. 服务器休眠、网络与授权

Render 免费实例休眠后，WebSocket 必须重新建立；公司服务器若有代理、DNS、TLS 或出口限制，也会造成部分订阅缺口。GLD 付费源 token 失效或 OPRA entitlement 不足时会降级。页面需要依据 Source、As-of、Data Status 判断，不应仅根据“按钮点击成功”判断行情实时。

## 上线前建议优先级

1. **P0：** 保持当前 WebSocket 心跳、断线重连、覆盖率与 MISSING 语义，并监控 Deribit ticker coverage、last message age、reconnect count。
2. **P0：** 为生产 GLD 接入具备授权与 SLA 的 OPRA 数据；免费 Cboe 继续作为完整链结构和故障回退。
3. **P1：** 接入 OCC/券商 contract master，覆盖 GLD adjusted deliverable。
4. **P1：** 新增全深度与标准化冲击成本指标，避免把 Top Size 当作完整流动性。
5. **P1：** Volume 已完成窗口标签和 USD 名义金额；下一步对 OI 增加单位、窗口和 USD 等值字段，禁止跨 venue 直接比较原始 OI。
6. **P2：** 保存每次行情质量快照，形成数据缺失率、延迟分布、恢复时间和供应商 SLA 报表。

## 官方接口依据

- [Deribit public ticker](https://docs.deribit.com/api-reference/market-data/public-ticker)
- [Deribit book summary by currency](https://docs.deribit.com/api-reference/market-data/public-get_book_summary_by_currency)
- [Deribit market-data collection best practices](https://docs.deribit.com/articles/market-data-collection-best-practices)
- [Bybit V5 option tickers](https://bybit-exchange.github.io/docs/v5/market/tickers)
- [MarketData.app option quotes](https://www.marketdata.app/docs/api/options/quotes/)
- [Cboe GLD delayed option-chain JSON](https://cdn.cboe.com/api/global/delayed_quotes/options/GLD.json)
