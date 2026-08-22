# DinoSignal 持仓 Excel 导入、导出与热力图指南

## 支持的工作簿格式

系统以 DinoSignal 持仓表为基准，自动寻找第二行包含 `Instrument`、`Underlying` 和 `Net Qty` 的工作表。前 29 列是必需结构，顺序如下：

`Source Account`、`Venue`、`Instrument`、`Underlying`、`Product`、`Expiry`、`Strike`、`Call/Put`、`Currency`、`Qty Long`、`Qty Short`、`Net Qty`、`Multiplier XAU`、`XAU Eq Net Qty`、`Reference Date`、`Mark Price`、`Avg/Entry Price`、`Market Value`、`Entry Value`、`Fee`、`Entry Cost`、`Unrealized PnL`、`Unrealized PnL%`、`BS Delta XAU`、`Gamma`、`Theta USD/day`、`Vega USD/vol`、`Raw Margin Mode`、`Raw Margin Type`。

- `Instrument=Total` 的行只用于核对汇总，不会作为期权仓位导入。
- `Underlying` 只接受 GLD 或 XAUT；`Call/Put` 接受 Call/Put，不区分大小写。
- USD 与 USDT 按 1:1 记录，但原币种会保留。
- 空白或错误行情不会静默转成有效的 0；预览会显示 WARN/MISSING。
- 导入前必须先通过预览。`替换全部` 会备份当前组合后替换；`合并更新` 按 Underlying、Expiry、Strike、Call/Put、账户和 Venue 更新同一仓位。

新版导出表在这 29 列之后增加 7 列：

`Shares/Contract`、`Unit Delta`、`Unit Gamma`、`Unit Theta`、`Unit Vega`、`Cumulative Entry Cost`、`Cumulative Realized PnL`。

因此完整导出一共 36 列。上传旧版持仓快照时，这 7 列可以不存在；上传新版文件时会一并读取并保留。

## 本模板的风险口径

网站从 Excel 中的持仓 Total Greeks 反推单位 Greeks：

- `Unit Delta = BS Delta XAU / (Net Qty × Contract Multiplier × Multiplier XAU)`
- `Unit Gamma = Gamma XAU / (Net Qty × Contract Multiplier × Multiplier XAU²)`
- `Unit Theta = Theta USD/day / (Net Qty × Contract Multiplier)`
- `Unit Vega = Vega USD/vol / (Net Qty × Contract Multiplier)`

Contract Multiplier 优先读取 `Shares/Contract`；旧版表没有该列时，GLD 按标准 100、XAUT 按标准 1 识别，BTC 才尝试从 Market/Entry Value 反推。后续页面计算和导出会使用公式管理中当前的 `gld_contract_multiplier` / `xaut_contract_multiplier`；调整合约则应在导入表中明确填写实际 deliverable，长期方案仍建议接入 contract master。

导入快照只作为行情降级值：若实时 API 返回可用行情，网站优先使用实时 Mark、Bid/Ask 和 Greeks；否则保留 Excel 的 Reference Date、Source 和 STALE/WARN 状态。

## 导入持仓快照与恢复

1. 进入“仓位管理”，点击“上传持仓 Excel”。
2. 选择 `.xlsx` 文件，检查工作表、29 列必需字段、Reference Date、XAUT/GLD 行数与净数量；36 列新版模板会显示完整匹配。
3. 如有错误先修复 Excel；只有无错误时才能确认导入。
4. 日常全量快照选择“替换全部”；多账户增量才选择“合并更新”。
5. 每次导入前，服务器在 `data/backups/` 写入 JSON 备份。需要恢复时可从该文件重建 `data/portfolio.json`。

Render 免费实例没有持久磁盘，重新部署或休眠重建后应重新上传最近快照。长期使用建议启用持久磁盘或 PostgreSQL。

## 从全量交易记录推导当前仓位

仓位管理页的“上传全量交易记录”支持以下来源，也支持直接上传同时包含两种 RAW 工作表的推导工作簿：

- KGI GLD 全量表：识别 `Date(UTC)`、`Instrument`、`Type`、`Side`、`Qty`、`Price`、`Fee`、`Change` 等字段。原表 Qty 是 GLD 股数，网站按公式管理中的 `gld_contract_multiplier`（默认 100 股/标准合约）换算为期权张数。
- Bybit / SignalPlus XAUT 全量表：Qty 直接按 XAUT 期权合约数处理，默认一张对应 1 XAUT。
- 推导工作簿：优先读取 `全量_KGI_交易明细` 和 `RAW_Bybit_交易明细`，并避开名称带“原全量”的重复备份页，防止成交重复计入。

使用步骤：

1. 点击“上传全量交易记录”，选择 KGI、Bybit 或混合推导工作簿。
2. 在预览中核对有效成交数、当前持仓数/净数量、Cumulative Entry Cost、Cumulative Realized PnL、错误和警告。
3. 确认后，网站只替换本次文件涉及的 Underlying。例如只传 KGI 时会更新 GLD，但保留现有 XAUT；导入前仍会自动备份。
4. 对推导不出的 Mark、IV、Bid/Ask、Greeks 等行情字段，系统保留为空并标记 `MISSING`，不会用 0 冒充有效数据。随后点击“更新市场数据”补齐可获得的行情，再导出 Excel。

### 成本与已实现损益口径

系统按每个独立期权合约（Underlying + Expiry + Strike + Call/Put）逐笔排序，采用移动加权平均成本：

- 开仓净现金流优先使用原始表的 `Change`，这样手续费、交割和平台账单符号能按来源原样纳入；仅当 `Change` 缺失时才使用 Qty × 合约乘数 × Price 与 Fee 回算。
- `Cumulative Entry Cost` 是该标的自交易记录起点至报告日全部开仓批次的 Entry Cost 总和；它包含已经平掉或到期的合约成本。
- 平仓时先从未平仓账面成本中，按被平数量分配一次成本，再计算 `Cumulative Realized PnL = 平仓/到期净流入 − 本次分配的账面成本`。
- 部分平仓只扣除对应数量的成本；剩余持仓继续携带剩余账面成本，不会在后续平仓时重复扣除。
- 买卖方向反转时，先结清原方向并确认 realized PnL，超出原数量的部分再作为相反方向的新开仓。
- 已过到期日但仍有未平数量，且交易记录中没有可识别的结算/交割记录时，会阻止导入，避免把未知结算结果静默当作零。

文件名中的报告日期（例如 `20260821`）会与交易记录的最后成交日比较，取较晚者作为推导持仓的 Reference Date。交易日之后没有成交并不代表 Reference Date 应停留在最后一笔交易日。

## 导出

仓位管理页点击“更新行情并导出 Excel”。下载文件使用 `期权持仓_XAUT_GLD` 工作表，保留原 29 列排版并在末尾增加 7 列，共 36 列；按 XAUT、GLD 分组，每组包含 Total 行。Market Value、Entry Value、Entry Cost、UPL、UPL%、Total Greeks 等计算列带 Excel 公式，便于审计。

最后两列的 Total 行优先使用全量交易台账汇总，因此即使历史合约已全部关闭，也不会从累计指标中消失。若当前仓位来自旧版持仓快照而不是全量交易记录，这两列可能为空；网站会显示 `—`，而不是将未知值写成 0。

## 紧凑热力图

1. 默认列为 Expiry、行为 Strike；`Transpose` 可转置。
2. Metric 选择 Unit Delta 或 Total Delta 时，使用绝对风险强度的连续色标：0 为蓝色，接近 P99 为红色。极端值按 99 分位裁剪，避免单个异常值压扁其他风险差异。
3. `格内文字` 默认关闭，以更小的长方形容纳 100–200 条仓位；可切换为仅高风险或全部显示。
4. `悬停内容` 可选风险、行情、PnL 或全部。鼠标悬停看摘要，点击格子看完整仓位和 Roll Priority 分项。
5. 右侧 legend 明确给出 0、中值与 P99 数值。琥珀色 Spot marker 显示实时 GLD/XAUT Spot 最接近的 Strike；超出范围时显示 Above/Below Range，并可点击 Center Spot。
6. 先使用 Underlying、Venue、Account、Call/Put、DTE 和 Status 筛选，再用顶部风险卡定位最大风险；风险卡只高亮定位，不跳页。
