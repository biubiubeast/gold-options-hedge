# Cronus BTC 历史 Max Pain 研究页

## 已接入的能力

- 路由：`/max-pain`
- 历史范围：实测从 2023-05-05 起；单次查询 1–93 天
- 观察时点：每天 UTC 00:00、04:00、08:00、12:00、16:00、20:00
- 产品：Inverse BTC、Linear USDC、Combined
- 期限：最近到期、当日到期、最近周五、最近月度，或固定到期日
- 输出：Max Pain、Call/Put/Total OI、OI Notional、逐 Strike OIList
- 图表：1h/4h/12h/1d BTC K线、Max Pain 蓝线、每日 00:00 毛 Gamma 代理区
- 回测：前 24h 描述性收敛、后 24h 无未来数据检验、Pearson、Spearman
- 管理：管理员导航显示、xauwhales 页面权限、页面各模块显示开关

## 数据流

```text
SignalPlus 历史逐合约 OI
  -> 每个观察时点取前 30 分钟内最后一条记录
  -> 解析 BTC-* / BTC_USDC-* 合约名
  -> 按产品 + 到期日 + Strike 汇总 Call/Put OI
  -> 计算 inverse / linear
  -> 合并逐 Strike OI 后重新计算 combined

Coinbase 小时 K线 -> OKX 备用 -> Binance 最后备用
  -> UTC 聚合为 1h/4h/12h/1d
  -> Notional / Gamma 代理 / 回测 / 叠加图
```

浏览器只调用受登录保护的 Cronus tRPC。上游请求、缓存和备用源切换都在服务器完成，因此 Render 根路径与公司服务器 `/optionhedger/` 子路径使用同一套实现。

## Max Pain 口径

对候选结算价 `S`：

```text
P(S) = Σ max(S-K, 0) × CallOI + Σ max(K-S, 0) × PutOI
MaxPain = argmin P(S)
```

候选结算价取该到期日实际 Strike。最小值相同时保留较低 Strike。该口径与 Deribit 示例的到期内在价值算法一致，不包含权利金、手续费、持仓方向、做市商对冲和时间价值。

Combined 不是两个 Max Pain 的平均值；它先按 Strike 合并 inverse 和 linear 的 OI，再对完整赔付曲线找最小值。

## 关键文件

- `shared/maxPainResearch.ts`：纯计算、类型、期限选择、Gamma 代理与回测
- `server/maxPainResearchService.ts`：SignalPlus、Coinbase、OKX、Binance 适配与缓存
- `server/routers.ts`：受登录保护的 tRPC 接口
- `client/src/hooks/useMaxPainResearch.ts`：四并发逐日读取、进度、取消与内存缓存
- `client/src/components/MaxPainCandlestickChart.tsx`：K线/蓝线/Gamma SVG 图
- `client/src/pages/MaxPainResearch.tsx`：Cronus 页面
- `shared/maxPainResearch.test.ts`、`server/maxPainResearchService.test.ts`：计算与适配测试

## 本地运行

```bash
cd "/Users/jinwork/Downloads/gold-options-hedge (1)"
pnpm dev
```

登录后打开：

```text
http://localhost:3000/max-pain
```

若端口被占用，开发服务器会自动尝试后续端口。生产构建：

```bash
pnpm check
pnpm test
pnpm build
pnpm start
```

## 使用步骤

1. 选择 7/30/90 天，或输入开始、结束日期。
2. 选择 BTC K线周期后点击“计算”。
3. 在图表右上角切换 Combined、Inverse BTC、Linear USDC。
4. 使用期限策略，或从“指定到期日曲线”选择一个具体到期日。
5. 展开六时点明细底部的 Strike/OIList，核对最新 00:00 的逐 Strike 输入。
6. 在回测卡切换 00/04/08/12/16/20 时点。
7. 在“设置”控制页面入口、xauwhales 权限和各分析模块；在“公式管理”“数据来源”查看口径与端点。

## 已知边界

- SignalPlus 没有公开历史保留 SLA；2023-05-05 是实测边界，不是供应商承诺。
- SignalPlus 响应没有交易所字段。Deribit 风格合约名不足以证明数据就是 Deribit 官方归档，因此页面不会将它误标为 Binance、Bybit、OKX 或官方 Deribit 数据。
- OI 能计算标准 Max Pain，但不能识别买方/卖方、客户/做市商方向，所以不能从 OI 单独推导真实正/负 dealer Gamma。
- Gamma 区使用 Black-Scholes、过去 30 天小时实现波动率与 Call+Put OI，只是毛敏感度集中区。
- “价格向痛点靠近”是统计描述或预测检验，不证明 Max Pain 导致价格移动。正式策略研究还应做非重叠样本、按 DTE/波动率分层、交易成本和 walk-forward 样本外测试。

## 后续用 Codex 迭代

在 Codex 打开本仓库后，可直接指定页面或文件，例如：

```text
在 Cronus 的 /max-pain 增加 CSV 导出，保持 tRPC 登录保护和 /optionhedger/ 子路径兼容，并补测试。
```

每次改动至少要求：类型检查、计算单元测试、生产构建，以及一日真实数据冒烟测试。涉及算法口径时，同步更新“公式管理”和本文件；涉及上游端点时，同步更新“数据来源”。

## 参考

- [Deribit Max Pain Python 指南](https://insights.deribit.com/dev-hub/deribit-max-pain-python-code/)
- [Deribit API：期权 OI 的 amount unit](https://docs.deribit.com/)
- [Coinbase Exchange Candles](https://docs.cdp.coinbase.com/exchange/reference/exchangerestapi_getproductcandles)
- [OKX History Candles](https://www.okx.com/docs-v5/en/#rest-api-market-data-get-candlesticks-history)
