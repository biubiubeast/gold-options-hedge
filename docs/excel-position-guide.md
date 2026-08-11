# DinoSignal 持仓 Excel 导入、导出与热力图指南

## 支持的工作簿格式

系统以 `0810DinoSignal持仓.xlsx` 为基准，自动寻找第二行包含 `Instrument`、`Underlying` 和 `Net Qty` 的工作表。标准模板共 29 列，顺序如下：

`Source Account`、`Venue`、`Instrument`、`Underlying`、`Product`、`Expiry`、`Strike`、`Call/Put`、`Currency`、`Qty Long`、`Qty Short`、`Net Qty`、`Multiplier XAU`、`XAU Eq Net Qty`、`Reference Date`、`Mark Price`、`Avg/Entry Price`、`Market Value`、`Entry Value`、`Fee`、`Entry Cost`、`Unrealized PnL`、`Unrealized PnL%`、`BS Delta XAU`、`Gamma`、`Theta USD/day`、`Vega USD/vol`、`Raw Margin Mode`、`Raw Margin Type`。

- `Instrument=Total` 的行只用于核对汇总，不会作为期权仓位导入。
- `Underlying` 只接受 GLD 或 XAUT；`Call/Put` 接受 Call/Put，不区分大小写。
- USD 与 USDT 按 1:1 记录，但原币种会保留。
- 空白或错误行情不会静默转成有效的 0；预览会显示 WARN/MISSING。
- 导入前必须先通过预览。`替换全部` 会备份当前组合后替换；`合并更新` 按 Underlying、Expiry、Strike、Call/Put、账户和 Venue 更新同一仓位。

## 本模板的风险口径

网站从 Excel 中的持仓 Total Greeks 反推单位 Greeks：

- `Unit Delta = BS Delta XAU / (Net Qty × Contract Multiplier × Multiplier XAU)`
- `Unit Gamma = Gamma XAU / (Net Qty × Contract Multiplier × Multiplier XAU²)`
- `Unit Theta = Theta USD/day / (Net Qty × Contract Multiplier)`
- `Unit Vega = Vega USD/vol / (Net Qty × Contract Multiplier)`

Contract Multiplier 优先由 `Market Value ÷ (Mark Price × Net Qty)` 或 `Entry Value ÷ (Avg Price × Net Qty)` 反推；无法反推时，GLD 标准合约暂用 100、XAUT 暂用 1。调整合约应让导入表中的 Market/Entry Value 能反映真实 deliverable，或在后续接入 contract master。

导入快照只作为行情降级值：若实时 API 返回可用行情，网站优先使用实时 Mark、Bid/Ask 和 Greeks；否则保留 Excel 的 Reference Date、Source 和 STALE/WARN 状态。

## 导入与恢复

1. 进入“仓位管理”，点击“上传持仓 Excel”。
2. 选择 `.xlsx` 文件，检查工作表、29 列匹配、Reference Date、XAUT/GLD 行数与净数量。
3. 如有错误先修复 Excel；只有无错误时才能确认导入。
4. 日常全量快照选择“替换全部”；多账户增量才选择“合并更新”。
5. 每次导入前，服务器在 `data/backups/` 写入 JSON 备份。需要恢复时可从该文件重建 `data/portfolio.json`。

Render 免费实例没有持久磁盘，重新部署或休眠重建后应重新上传最近快照。长期使用建议启用持久磁盘或 PostgreSQL。

## 导出

仓位管理页点击“导出持仓 Excel”。下载文件使用 `期权持仓_XAUT_GLD` 工作表和相同 29 列排版，并按 XAUT、GLD 分组；每组包含 Total 行。Market Value、Entry Value、Entry Cost、UPL、UPL%、Total Greeks 等计算列带 Excel 公式，便于审计。

## 紧凑热力图

1. 默认列为 Expiry、行为 Strike；`Transpose` 可转置。
2. Metric 选择 Unit Delta 或 Total Delta 时，使用绝对风险强度的连续色标：0 为蓝色，接近 P99 为红色。极端值按 99 分位裁剪，避免单个异常值压扁其他风险差异。
3. `格内文字` 默认关闭，以更小的长方形容纳 100–200 条仓位；可切换为仅高风险或全部显示。
4. `悬停内容` 可选风险、行情、PnL 或全部。鼠标悬停看摘要，点击格子看完整仓位和 Roll Priority 分项。
5. 右侧 legend 明确给出 0、中值与 P99 数值。琥珀色 Spot marker 显示实时 GLD/XAUT Spot 最接近的 Strike；超出范围时显示 Above/Below Range，并可点击 Center Spot。
6. 先使用 Underlying、Venue、Account、Call/Put、DTE 和 Status 筛选，再用顶部风险卡定位最大风险；风险卡只高亮定位，不跳页。
