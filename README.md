# 黄金期权对冲仓位分析

这是一个可自行运行的 XAUT / GLD 期权组合分析网站。它不再依赖 Manus 登录、Manus 数据代理或外部 MySQL：仓位和公式默认保存在本机 `data/portfolio.json`，所以 Manus 停止服务后仍能持续使用。

> 这是分析工具，不会连接交易账户或自动下单。模型估值与第三方行情可能延迟、缺失或出错，不构成投资建议。

## 主要功能

1. 仓位录入、编辑和删除：Underlying、Expiry、Strike、Call/Put、Entry Price、Quantity、Fee、Entry Delta。
2. Expiry × Strike 矩阵：Mark、IV、Bid/Ask、数量、Delta；可切换为只显示 Delta、Mark Price、Mark IV 或数量；同一格按 Delta 从高到低排列，并用深浅颜色形成热力图。
3. 期权详情：单位 Greeks、持仓 Total Greeks、Entry Cost、Current Value、P&L、数据来源和“实时/估算”标识。
4. 组合 Dashboard：按 Underlying / Expiry / Strike 筛选；显示 XAUT、GLD 和 XAU 代理现价；统一汇总估值与 XAU 风险量纲。
5. 可执行公式：编辑会直接影响 Black-Scholes、估值和汇总；支持新增公式并在其他公式中按名称引用；可逐项或全部恢复默认。
6. 数据来源页：列出 API、认证要求、当前启用状态与降级逻辑。
7. 所有页面支持 20%–140% 缩放；矩阵另有 20%–150% 独立缩放、默认自动适配完整热力图和全屏查看。
8. 本地 JSON 持久化与一键导出备份；生产模式带密码保护。
9. 每个页面顶部固定显示 XAUT/USDT 与 GLD/USD 现价、实时/延迟状态，并每 10 秒自动刷新。
10. 机构版 Position Risk Heatmap：200 条仓位压力数据、P99 Quantile/Log/零中心颜色尺度、固定风险决策卡、Spot range marker、到期资金控制及 XAU/IV/Day 情景分析。

## 机构版 Position Risk Heatmap 使用教程

进入“矩阵视图”即可使用。生产仓位选择 `LIVE`；验收或培训可选择 `MOCK 100` / `MOCK 200`，也可直接打开 `/matrix?mock=200`。Mock 使用固定 seed，每次刷新都可复现，不会写入真实仓位。

1. 默认是 **Expiry 列 × Strike 行**；`Transpose` 可转置。先用 Underlying、Venue、Broker、Account、Call/Put、DTE bucket、Status 缩小决策范围。
2. Metric 可切换 Unit Delta、Total Delta、Gamma、Theta、Vega、Mark IV、MV、UPL、DTE、Distance-to-Strike、Roll Priority。Unit 是单份合约敏感度，Total 已乘数量、实际 multiplier 和黄金量纲，两者不可混用。
3. 默认 `Quantile + P99 clip` 适合快速找集中风险；`Log` 用于同时保留 50 和 1000 级别的差异；`Symmetric Zero` 把 0 固定为中性色，适合有正负方向的 Delta、Theta、UPL。
4. 只有最高重要度 cell 常显数值，其余 hover 查看仓位、source、as-of、状态和 Roll Priority 分项，避免 100+ 仓位文字拥挤。点击顶部决策卡只会定位并高亮相应 cell。
5. Spot 可选 GLD、XAUT 或 XAU。Spot 超出当前 Strike range 时页面明确显示 Above/Below Range；点击 `Center Spot` 把 spot marker 纳入矩阵。
6. GLD DTE<=2 时自动出现 Expiry panel。资金覆盖低于 100% 且可能 ITM 时显示 `FAIL`；adjusted contract 使用仓位的实际 deliverable，不使用硬编码 100。
7. Scenario 支持 XAU Shock -20% 至 +20%、IV Shock -10/-5/0/+5/+10 vol、Day 0/1/3/7，并叠加 Van naked delta，统一输出 USD PnL、XAU delta、Residual PnL 和 Stress Coverage。

完整的架构、schema、计算定义、颜色算法和验收记录见 [`docs/risk-heatmap-spec.md`](docs/risk-heatmap-spec.md)。

## 快速启动

要求：Node.js 20 或更高版本，以及 pnpm。

```bash
cp .env.example .env
pnpm install
pnpm dev
```

浏览器打开终端显示的地址，通常是 `http://localhost:3000`。首次启动会自动创建 `data/portfolio.json`，无需数据库迁移或登录。

生产模式：

```bash
cp .env.example .env
# 用文本编辑器打开 .env，并设置 APP_PASSWORD
pnpm build
pnpm start
```

## Docker 启动

已安装 Docker Desktop 时：

```bash
cp .env.example .env
# 用文本编辑器打开 .env，并先修改 APP_PASSWORD
docker compose up -d --build
```

打开 `http://localhost:3000`，使用 `.env` 里的 `APP_USERNAME` / `APP_PASSWORD` 登录。`./data` 被挂载为持久化目录，升级容器不会清空仓位。生产启动故意要求设置密码，避免误把无登录保护的持仓页面暴露到公网。

停止网站：

```bash
docker compose down
```

## 公网访问方案

### 方案 A：本机 Docker + Cloudflare 临时链接（最快）

适合临时从手机或另一台电脑访问、演示和验收。电脑必须保持开机，Docker Desktop 必须运行；Quick Tunnel 的随机网址会在重启后改变，不适合作为正式长期服务。

```bash
cp .env.example .env
# 修改 .env 中的 APP_PASSWORD 后再执行
docker compose -f docker-compose.public.yml up -d --build
docker compose -f docker-compose.public.yml logs cloudflared
```

日志里会出现一个 `https://随机字符.trycloudflare.com` 链接。打开后输入 `.env` 中的用户名与密码即可。此 Compose 文件不会把应用端口直接暴露给公网，访问流量只通过 Cloudflare Tunnel 进入。

停止临时公网访问：

```bash
docker compose -f docker-compose.public.yml down
```

如果要让自己的域名保持不变，应在 Cloudflare 账户中创建 named tunnel，把域名映射到 `http://gold-options-hedge:3000`，并用 tunnel token 替换临时 tunnel。不要把 token 写入仓库。

### 方案 B：Render Docker 托管

仓库已包含 `render.yaml`。当前默认使用无需银行卡的 Render 免费实例，在新加坡区用现有 Dockerfile 构建网站。操作流程：

1. 把代码放到你自己的 GitHub 私有仓库；确认 `.env` 和 `data/portfolio.json` 没有被提交。
2. 在 Render 选择 **New → Blueprint**，连接仓库并确认识别到 `render.yaml`。
3. 部署时填写 `APP_PASSWORD`；`APP_USERNAME` 已设为 `xauwhale`。服务创建后可在 **Environment** 中添加 `MARKETDATA_TOKEN`，以启用 GLD 低延迟现价和 OPRA 实时期权 Greeks；`TRADIER_API_TOKEN` 是兼容备用源。
4. 部署完成后使用 Render 分配的 `https://...onrender.com` 地址访问，也可绑定自己的域名。
5. 免费实例会休眠、重启，且没有持久磁盘；仓位录入后请立即从网站导出 JSON 备份。

免费 Render 适合当前先取得稳定公网地址并测试功能，但重启或重新部署后仓位 JSON 可能丢失。长期正式使用建议添加付款方式，把 `render.yaml` 的 `plan` 改为 `starter` 并恢复 1 GB 持久磁盘；或把数据层迁移到托管 PostgreSQL。单块 Render 磁盘限制为单实例运行，这与当前单用户 JSON 架构匹配。

### 安全边界

- 当前密码保护使用 HTTPS 上的 HTTP Basic Auth，适合个人/小范围使用；公网必须使用 HTTPS，不要通过普通 HTTP 发送密码。
- `/healthz` 只返回服务存活状态，不暴露仓位；其余页面和 API 都需要登录。
- 更高安全级别可在 Cloudflare Tunnel 前再加 Cloudflare Access（邮箱一次性验证码、Google/Microsoft 登录等），或升级为应用内账户、会话和多因素认证。
- 不要公开 `.env`、Tradier token、仓位备份或 `data` 文件夹。

## 矩阵与缩放使用教程

1. 先在“仓位管理”录入仓位，再进入“矩阵视图”。列是 Expiry，行是 Strike。
2. “方块显示字段”选择“全部数据”、Delta、Mark Price、Mark IV 或“持仓数量”。单指标模式会放大显示所选数值。
3. “热力颜色”默认按 Delta 从低到高由浅到深；选择 `|Delta| 风险强度` 可忽略正负号、突出绝对风险；也可完全关闭颜色。
4. 同一 Expiry × Strike 方格中若有多个 Call/Put 或不同仓位，始终按当前 Delta 从高到低排列。点击方块进入该期权详情。
5. 矩阵默认启用“自动全图”，会同时按宽度和高度缩放到 20%–100%，尽量不拖动滚动条就看到完整热力图；手动点击 `− / +` 会关闭自动适配，全屏后可再次点击“自动全图”。
6. 页面右上角 `− / +` 可在 20%–140% 间缩放所有页面；点击百分比或回转按钮恢复 100%。键盘可用 `Alt -`、`Alt +`、`Alt 0`。

页面缩放和矩阵筛选设置保存在当前浏览器，下次打开会沿用；换浏览器或清除网站数据后会恢复默认值。

## GLD 低延迟行情与实时 Greeks（推荐配置）

XAUT 行情使用 Bybit 公共接口，无需密钥。GLD 数据按以下优先级自动降级：

1. `MARKETDATA_TOKEN`：MarketData.app SmartMid 实时 GLD 价格；完成 OPRA 权限后，逐个持仓读取实时 Bid/Ask、Mark、IV 和完整 Greeks。
2. `TRADIER_API_TOKEN`：production Brokerage API 提供实时 GLD/期权报价；官方说明 ORATS Greeks 约每小时更新。
3. 两者均未配置：GLD Spot 使用 Yahoo Finance 兼容接口，期权使用可编辑的 Black-Scholes 估算。

推荐配置步骤：

1. 在 MarketData.app 注册账户、获取 API token，并按账户提示完成 OPRA 协议/权限。
2. 在 Render 的服务 **Environment** 页面新增 `MARKETDATA_TOKEN`，值为真实 token；不要写进 GitHub。
3. 保存后选择重新部署。网站“数据来源”页会显示当前实际优先源及时间戳。

若使用 Tradier 备用源：

1. 在 Tradier 创建/获取 Brokerage API token。
2. 复制 `.env.example` 为 `.env`。
3. 设置：

   ```text
   TRADIER_API_TOKEN=你的令牌
   ```

4. 重启网站。

不配置令牌时网站仍可使用，但页面会明确显示“延迟/休市”或“模型估算”，Bid/Ask 显示为 `—`，不会伪装为交易所实时报价。

必须使用 Tradier production token 和 `https://api.tradier.com/v1`；sandbox 是约 15 分钟延迟行情。Tradier 官方当前说明：production 美股/期权报价实时，Greeks 由 ORATS 提供且约每小时更新。

## API 清单与来源

| 数据 | Provider / Endpoint | 密钥 | 用途 |
|---|---|---:|---|
| XAUT 期权 Ticker | Bybit V5 `GET /v5/market/tickers?category=option&baseCoin=XAUT` | 否 | Mark、IV、Bid/Ask、Greeks |
| XAUT 期权合约 | Bybit V5 `GET /v5/market/instruments-info?category=option&baseCoin=XAUT` | 否 | 合约元数据（后续扩展） |
| XAUT/USDT | Bybit V5 `GET /v5/market/tickers?category=spot&symbol=XAUTUSDT` | 否 | Spot 和 XAU 比例 |
| GLD 实时 Spot | MarketData.app `GET /v1/stocks/prices/GLD/` | 是 | SmartMid 实时 GLD，含 extended hours |
| GLD 逐合约期权 | MarketData.app `GET /v1/options/quotes/{OCC_SYMBOL}/?mode=live` | 是 + OPRA | 实时 Bid/Ask、Mark、IV、Greeks |
| GLD 兼容期权链 | Tradier `GET /v1/markets/options/chains` | 是 | 实时报价；ORATS Greeks 约每小时 |
| GLD / GC=F fallback | Yahoo Finance chart `GET /v8/finance/chart/{symbol}` | 否 | 最后备用 Spot 与 XAU/USD 代理 |

参考链接：

- [Bybit V5 Get Tickers](https://bybit-exchange.github.io/docs/v5/market/tickers)
- [Bybit V5 Instruments Info](https://bybit-exchange.github.io/docs/v5/market/instrument)
- [Tradier Options Chains](https://docs.tradier.com/reference/brokerage-api-markets-get-options-chains)
- [Tradier Market Data（实时、延迟及 Greeks 说明）](https://docs.tradier.com/docs/market-data)
- [MarketData.app Real-Time Stock Prices](https://www.marketdata.app/docs/api/stocks/prices/)
- [MarketData.app Option Quotes / Greeks](https://www.marketdata.app/docs/api/options/quotes/)
- [SPDR GLD 官方产品页](https://www.ssga.com/us/en/individual/etfs/spdr-gold-shares-gld)

Yahoo Finance 的 chart 地址是无密钥兼容接口，并非承诺稳定性的正式开发者产品。因此服务器加入了超时、短期缓存和最后成功值降级；如果用于关键生产用途，建议按下文方案换成有 SLA 的数据商。

## 计算口径

默认估值：

- `Entry Cost = Entry Price × Quantity × Contract Multiplier + Fee`
- `Current Value = Mark Price × Quantity × Contract Multiplier`
- GLD 标准期权默认合约乘数为 `100` 股；发生拆分、合并等公司行动后的调整合约可能不同，请以券商/OCC 合约详情为准。XAUT 默认 `1`，两者都可在 Dashboard 手动修改。
- Entry Cost 和 Current Value 汇总为 USD/USDT 近似等值，不再错误地乘上“黄金盎司换算系数”。

统一 XAU 风险量纲：

- `spotScale = underlyingPrice / xauUsdPrice`
- `XAU Delta = delta × quantity × contractMultiplier × spotScale`
- `XAU Gamma = gamma × quantity × contractMultiplier × spotScale²`
- `Theta / Vega = unit greek × quantity × contractMultiplier`

这样 GLD 的 Delta 会先按每张 100 股放大，再用 GLD/XAU 价格比通过链式法则映射到 XAU/USD；Gamma 是二阶导数，所以比例需要平方。比例可在 Dashboard 留空自动计算，也可手动覆盖。

## 公式编辑教程

进入“公式管理”：

1. 点击任意内置公式的“编辑”。
2. 修改表达式，点击“验证并保存”。保存成功后 Dashboard、矩阵和详情页会在查询刷新后使用新值。
3. 支持运算符 `+ - * / ^`，函数 `sqrt / ln / exp / abs / min / max / pow / N / PDF`。
4. 点击“添加公式”创建例如 `my_adjustment = fee * 0.5`。
5. 在内置公式中直接写名称引用，例如把 `entry_cost` 改成 `entryPrice * quantity * contractMultiplier + my_adjustment`。
6. 循环引用、未知变量、非法字符或非有限结果会被拒绝。
7. 用回转按钮恢复单项，或“恢复所有默认”。

内置钩子名称是功能接口。自定义公式只有被内置钩子或另一个已引用的公式调用时才会影响结果。

## 数据与备份

- 实际数据文件：`data/portfolio.json`。
- 仓位页“导出备份”会下载包含仓位和公式的 JSON。
- 做系统升级前，建议同时复制整个 `data` 文件夹。
- 可用环境变量 `DATA_FILE=/绝对路径/portfolio.json` 更改保存位置。
- JSON 本地存储适合单用户或私人服务器。如果要多用户并发、权限隔离和高可用，应改用 PostgreSQL 并恢复真正的身份认证。

## 验证与开发

```bash
pnpm check
pnpm test
pnpm build
```

## 本次相对 Manus 版本的关键修改

- 删除运行时对 Manus OAuth、Forge Data API、Forge Storage 和 Manus Vite Runtime 的依赖。
- MySQL/Drizzle 的核心仓位与公式存储改为原子写入的本地 JSON；不再要求 `DATABASE_URL`。
- GLD 现价升级为 MarketData.app SmartMid → Tradier production → Yahoo fallback，并在所有页面显示来源时间和延迟状态。
- GLD 期权升级为按持仓查询 MarketData.app / OPRA 实时 Bid/Ask、IV 与 Greeks，Tradier 作为兼容源，缺少密钥时明确回退到模型估值。
- 修正 GLD 100 股合约乘数、Entry/Current Value 口径以及 XAU Delta/Gamma 链式换算。
- 把“公式管理”从纯展示文本升级为安全表达式解析器；公式会真正影响计算，并支持新增、引用、校验、循环检测和恢复默认。
- 修复 Bybit 合约匹配逻辑，不再依赖 `-C-` / `-P-` 必须位于符号中间。
- 增加矩阵单字段筛选、Delta 排序、Delta / |Delta| 热力颜色、20%–150% 独立缩放、自动适配完整热力图和全屏模式。
- 增加 20%–140% 全站缩放、每页顶部实时价格栏与浏览器内设置记忆。
- 增加生产密码保护、无敏感数据的健康检查、Cloudflare 临时公网 Compose 和 Render 持久化 Blueprint。
- 增加数据来源状态、估算标记、备份、Docker 运行和中文使用文档。

## 建议的下一阶段

1. **付费/有 SLA 的行情**：若结果用于真实对冲决策，接入 Polygon、Cboe DataShop、ORATS 或 Bloomberg，并保存交易所时间戳、延迟级别和交易时段。
2. **GLD 股息与美式期权模型**：GLD 期权是美式合约，Black-Scholes 仅为回退近似；可升级为带股息/借贷成本的二叉树或 Barone-Adesi-Whaley，并支持利率曲线与波动率曲面。
3. **PnL 场景矩阵**：增加 XAU 价格 × IV × 时间的情景分析、到期损益图、压力测试和对冲建议。
4. **审计与历史**：保存每次行情快照和仓位变更记录，区分已实现/未实现 P&L，并处理多次加仓的成本批次。
5. **生产安全**：公网部署时加 HTTPS、登录、反向代理、限流、每日备份和 PostgreSQL；不要把 `.env` 或 token 提交到 Git。
