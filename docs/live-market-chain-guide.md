# 市场数据刷新与 GLD/XAUT 完整链热力图

## 1. 更新全部市场数据

每一页顶部，以及 Dashboard、仓位管理、矩阵视图内部，都有“更新市场数据”按钮。点击后服务器会：

1. 清除短时行情缓存并重新联网读取 XAUT / GLD；
2. 按 Underlying + Expiry + Strike + Call/Put 匹配每条仓位；
3. 更新 Mark、Mark IV、Bid1、Ask1、Unit Delta/Gamma/Theta/Vega；
4. 重新计算并写入 Market Value、UPL、Total Delta/Gamma/Theta/Vega；
5. 保存 Source、Quote As-of、Refresh At、Open Interest、Volume 和 Status；
6. 后续 Dashboard、仓位表、矩阵和 Excel 导出都使用本次持久化结果。

若合约未匹配，不会将数据改成 0，而是标记 MISSING。XAUT 默认使用 Bybit V5 快照；GLD 已持仓合约优先使用 MarketData.app / Tradier（若部署环境配置密钥），否则使用 Cboe 延迟期权链。

## 2. GLD / XAUT FULL CHAIN 热力图

矩阵页 DATA 默认选择 `FULL OPTION CHAIN`，Call/Put 默认显示 `CALL`。Underlying 选择 GLD 时读取 Cboe 完整延迟链；选择 XAUT 时读取 Bybit V5 全部 Trading instruments，并将 ticker 的 Mark、Bid/Ask、Mark IV、Bid IV、Ask IV、Greeks、OI 与 Volume 合并。

- 青色边框：期权链已上市、可交易，但当前没有仓位；
- 金色边框：当前有仓位；
- 淡色空格：该 Expiry × Strike 组合未在期权链出现；
- 黄色横线：Spot 最近的 Strike；页面打开后自动居中到 Spot，右侧 `CENTER SPOT` 可再次定位；
- 鼠标悬停：按 HOVER 选择展示 Risk / Market / PnL / All；
- 点击格子：完整行情、Greeks、Source、As-of、OI/Volume 和 Roll 解释；
- Metric 可切换 Unit Delta、Total Delta、Mark IV、Bid IV、Ask IV、Bid Ask IV Spread 等；IV 与 Delta 默认都使用低值蓝、高值红的 99 分位裁剪色标；上市未持仓合约的 Total 指标显示 MISSING，不伪造为 0。
- Cboe 本身不直接返回 Bid IV / Ask IV，系统分别用 Bid/Ask 价格、GLD Spot、Strike、DTE 和 4.5% 默认无风险利率反解 Black-Scholes IV；无法满足无套利边界的报价显示 MISSING。
- `− / +` 调整单格高度；`Fit All` 根据当前窗口和行列数压缩矩阵，目标是在无需上下滚动时查看全部 Strike/Expiry。极端多列时轴标签会简化，但 Hover/点击仍保留完整数据。
- `Transpose` 只交换轴；`Strike ↑/↓` 独立控制行权价从低到高或从高到低，不会改变风险数据。

## 3. Largest Data Error

它不是风险金额或盈亏。它只检查当前筛选的真实持仓，并按以下顺序寻找最差数据：

`FAIL > MISSING > STALE > WARN > LIVE`

若严重度相同，选 Quote Age 最大的一条。缺 Source、Mark、合约乘数或 Greeks 会触发 MISSING；Quote Age 超过 15 分钟会触发 STALE。矩阵页点击 `Largest Data Error` 可查看相同说明。点击 `Hide Cards` 可收起全部顶部决策卡，设置会保存在当前浏览器。

## 4. Excel 导出

导出文件包含两个工作表：

- `期权持仓_XAUT_GLD`：保持原 29 列模板和 Total 行；Reference Date、Mark、Market Value、UPL、Total Greeks 使用最近一次刷新值；
- `Market_Data_实时明细`：增加 Mark IV、Bid/Ask、Unit Greeks、OI、Volume、Source、Quote As-of、Refresh At 与 Status，便于审计行情来源和延迟。

## 5. 行情延迟说明

- Bybit XAUT：交易所实时快照；
- MarketData.app：需 `MARKETDATA_TOKEN` 和适用的 OPRA 权限；实时/延迟等级取决于授权；
- Tradier：需 production `TRADIER_API_TOKEN`；报价权限取决于账户，Greeks 来源为 ORATS；
- Cboe GLD 全链：无需密钥，属于 Cboe 标记的 delayed feed；页面直接显示 JSON 提供的最新 `updated` 时间和系统观测到的 age。实际延迟会随交易时段/缓存更新变化，因此网站显示实测分钟数，不硬写固定延迟；
- Yahoo：只作为 Spot 最后备用，不提供完整 GLD 期权链。

要获得 GLD 真正 OPRA 实时 Greeks，推荐在 Render Environment 配置具备 OPRA entitlement 的 `MARKETDATA_TOKEN`。Cboe 完整链仍保留为免费结构底座与故障回退。
