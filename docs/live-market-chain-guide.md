# 市场数据刷新与 GLD/XAUT 完整链热力图

## 1. 更新全部市场数据

每一页顶部，以及 Dashboard、仓位管理、矩阵视图内部，都有“更新市场数据”按钮。点击后服务器会：

1. 清除短时行情缓存并重新联网读取 XAUT / GLD；
2. 按 Underlying + Expiry + Strike + Call/Put 匹配每条仓位；
3. 更新 Mark、市场源 Mark IV、Bid1、Ask1、Unit Delta/Gamma/Theta/Vega；
4. 重新计算并写入 Market Value、UPL、Total Delta/Gamma/Theta/Vega；
5. 保存 Source、Quote As-of、Refresh At、Open Interest、Volume 和 Status；
6. 后续 Dashboard、仓位表、矩阵和 Excel 导出都使用本次持久化结果。

若合约未匹配，不会将数据改成 0，而是标记 MISSING。XAUT 默认使用 Bybit V5 快照；GLD 已持仓合约优先使用 MarketData.app / Tradier（若部署环境配置密钥），否则使用 Cboe 延迟期权链。

## 2. GLD / XAUT FULL CHAIN 热力图

矩阵页 DATA 默认选择 `FULL OPTION CHAIN`。Underlying 选择 GLD 时读取 Cboe 完整延迟链；选择 XAUT 时读取 Bybit V5 全部 Trading instruments，并将 ticker 的 Mark、Bid/Ask、市场源 Mark/Bid/Ask IV、Greeks、OI 与 Volume 合并。

- 青色边框：期权链已上市、可交易，但当前没有仓位；
- 金色边框：当前有仓位；
- 淡色空格：该 Expiry × Strike 组合未在期权链出现；
- 黄色横线：Spot 最近的 Strike；页面打开后自动居中到 Spot，右侧 `CENTER SPOT` 可再次定位；
- 鼠标悬停：按 HOVER 选择展示 Risk / Market / PnL / All；
- 点击格子：完整行情、Greeks、Source、As-of、OI/Volume 和 Roll 解释；
- Metric 继续使用 `Mark IV`、`Bid IV`、`Ask IV`、`Bid Ask IV Spread` 四个通用名称；选择任一 IV 指标后才显示 `IV Source`。Market 只读取交易所/数据商直接发布的数值，Model 才使用网站根据 Mark/Bid/Ask 价格反解的数值，二者不会在色标或 Hover 中混合。GLD 当前只提供 Model 选项；其他支持的标的可在 Market / Model 间切换。上市未持仓合约的 Total 指标显示 MISSING，不伪造为 0。
- 色标 MIN / MAX 首次按 GLD 当前指标有效 cell 的 P25 / P75 初始化。切换 Underlying 保留原范围，便于相同指标跨品种直接比较；点击 `Rescale P25/P75` 才会按当前标的、当前筛选与当前指标重算。Market / Model 的范围独立保存。
- `Display Spot` 用于顶部现货、ATM 和矩阵定位，可以采用更新的独立现货报价；`IV Reference Spot` 必须与期权价格来自同一行情快照，只用于 Model IV。两者不再混用。
- Cboe 完整链目前只直接返回 Mark IV，不返回原生 Bid IV / Ask IV。网站用该链同一快照的 `current_price`、Bid/Ask、Strike、到期时间和默认 4.5% 无风险利率分别反解 Model Bid/Ask IV；无法满足无套利边界时显示明确状态并保持 MISSING，不会退回 Display Spot，也不会把 Model IV 填入 Market IV。
- Bybit ticker 本身直接提供 Mark/Bid/Ask IV；网站原样保存在 Market IV，并另外使用同一 ticker 的 `underlyingPrice` 计算 Model IV，便于比较交易所波动率与网站统一模型的差异。
- Deribit BTC/ETH 完整链先用 REST 读取合约主数据与批量摘要，再通过一条长连接 WebSocket 分批订阅 `ticker.{instrument}.100ms`。Ticker 原生提供 Best Bid/Ask Price、Best Bid/Ask Amount、Market Bid/Ask IV 和 Greeks；服务器维护每个币种的最新快照、自动心跳与断线重连。冷启动最多等待 3.5 秒达到 95% 覆盖率；对仍未收到 ticker、但批量摘要显示有 Bid/Ask 的合约，再按成交量/OI 排序调用最多 60 次 REST `public/ticker` 兜底，避免数千个逐笔请求触发限流。
- Deribit BTC/ETH 的期权权利金以 BTC/ETH 计价，不可直接加美元符号。网站使用同一 ticker/summary 的 `underlying_price` 作为 `premiumToUsd`，按 `Price × Size × contract_size × premiumToUsd` 计算 Bid/Ask Dollar Notional。任何价格、Size、contract size 或换算币价缺失时保持 MISSING，不参与色标；不会静默填 0。
- 热力图不再直接比较各市场原始 Volume，而使用可编辑公式 `volume_notional_usd = volume × contractMultiplier × underlyingPrice` 统一为 Volume Notional USD。GLD 标签只显示 `Session`，Bybit/Deribit 只显示 `24h`；如果原始 Volume、实际合约乘数或 Spot 缺失，Hover 不显示该行，方格保持无色，不用 MISSING 占位。
- `− / +` 调整单格高度；`Fit All` 根据当前窗口和行列数压缩矩阵，目标是在无需上下滚动时查看全部 Strike/Expiry。极端多列时轴标签会简化，但 Hover/点击仍保留完整数据。
- `Transpose` 只交换轴；`Strike ↑/↓` 独立控制行权价从低到高或从高到低，不会改变风险数据。

## 3. Largest Data Error

它不是风险金额或盈亏。它只检查当前筛选的真实持仓，并按以下顺序寻找最差数据：

`FAIL > MISSING > STALE > WARN > LIVE`

若严重度相同，选 Quote Age 最大的一条。缺 Source、Mark、合约乘数或 Greeks 会触发 MISSING；Quote Age 超过 15 分钟会触发 STALE。矩阵页点击 `Largest Data Error` 可查看相同说明。点击 `Hide Cards` 可收起全部顶部决策卡，设置会保存在当前浏览器。

## 4. Excel 导出

导出文件包含两个工作表：

- `期权持仓_XAUT_GLD`：保持原 29 列模板和 Total 行；Reference Date、Mark、Market Value、UPL、Total Greeks 使用最近一次刷新值；
- `Market_Data_实时明细`：增加市场源 Mark IV、Bid/Ask、Unit Greeks、OI、Volume、Source、Quote As-of、Refresh At 与 Status，便于审计行情来源和延迟。Model IV 目前属于热力图的可重算模型字段，不覆盖持仓 Excel 的市场源 IV。

## 5. 行情延迟说明

- Bybit XAUT：交易所实时快照；
- Deribit BTC/ETH：公开 WebSocket ticker 实时更新，REST 合约/摘要用于完整链结构与冷启动；网页显示每份合约自己的交易所 timestamp。服务器重启或休眠唤醒后会自动重建订阅，首次完整覆盖通常需要数秒；
- MarketData.app：需 `MARKETDATA_TOKEN` 和适用的 OPRA 权限；实时/延迟等级取决于授权；
- Tradier：需 production `TRADIER_API_TOKEN`；报价权限取决于账户，Greeks 来源为 ORATS；
- Cboe GLD 全链：无需密钥，属于 Cboe 标记的 delayed feed；页面直接显示 JSON 提供的最新 `updated` 时间和系统观测到的 age。实际延迟会随交易时段/缓存更新变化，因此网站显示实测分钟数，不硬写固定延迟；
- Yahoo：只作为 Spot 最后备用，不提供完整 GLD 期权链。

要获得 GLD 真正 OPRA 实时 Greeks，推荐在 Render Environment 配置具备 OPRA entitlement 的 `MARKETDATA_TOKEN`。Cboe 完整链仍保留为免费结构底座与故障回退。
