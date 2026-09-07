# Cronus

Cronus 是一个面向黄金与加密期权对冲团队的市场热力图和仓位风险分析网站。系统以 **Expiry × Strike** 为核心视图，将完整期权链、真实持仓、Market / Model IV、Greeks、盘口深度、名义金额、数据来源和更新时间放到同一个可审计的数据模型中。

当前支持：

- GLD/USD：Cboe / OPRA 延迟完整期权链；可选 MarketData.app 或 Tradier 低延迟持仓行情。
- XAUT/USDT、BTC/USDT、ETH/USDT：Bybit V5 完整期权链。
- BTC/USD、ETH/USD：Deribit REST 完整链 + WebSocket ticker。
- GLD、XAUT、BTC 持仓管理与持仓快照；KGI GLD、Bybit XAUT/BTC 全量交易 Excel 导入。
- TradingView K线页面、Dashboard、公式管理、数据来源和全局设置。

> Cronus 是风险分析与交易决策辅助工具，不会连接账户自动下单。第三方行情可能延迟、缺失或因市场休市而不更新；Model IV 和 Black-Scholes 估值是模型结果，不是交易所报价，也不构成投资建议。

## 当前公网入口

- Render：[https://gold-options-hedge.onrender.com/](https://gold-options-hedge.onrender.com/)
- 公司服务器：[https://bill.spailab.com/optionhedger/](https://bill.spailab.com/optionhedger/)
- GitHub：[https://github.com/biubiubeast/gold-options-hedge](https://github.com/biubiubeast/gold-options-hedge)（Private）

Render 由 `main` 分支自动部署。公司服务器是独立部署，除非另行配置 GitHub Actions、Webhook 或服务器拉取任务，否则 GitHub 更新不会自动更新公司服务器。

## 核心功能

### 1. 市场热力图

热力图默认以列表示 Expiry、行表示 Strike，读取所选市场的完整可交易期权链。每个方格代表同一 Expiry × Strike 下符合 Call/Put 和 ITM/OTM 条件的合约。

可选市场：

| Underlying 选项   | 行情来源                    | 主要字段                                                                                         |
| ----------------- | --------------------------- | ------------------------------------------------------------------------------------------------ |
| GLD/USD-OPRA      | Cboe delayed options / OPRA | 完整上市链、Bid/Ask、Size、Market Mark IV、Greeks、OI、Volume；Model Bid/Ask IV 由同步链快照反解 |
| XAUT/USDT - Bybit | Bybit V5                    | Mark/Bid/Ask、Market IV、Greeks、Size、OI、24h Volume                                            |
| BTC/USDT - Bybit  | Bybit V5                    | 同上                                                                                             |
| BTC/USD - Deribit | Deribit REST + WebSocket    | 完整链、Best Bid/Ask Price/Amount、Market IV、Greeks、OI、Volume                                 |
| ETH/USDT - Bybit  | Bybit V5                    | Mark/Bid/Ask、Market IV、Greeks、Size、OI、24h Volume                                            |
| ETH/USD - Deribit | Deribit REST + WebSocket    | 完整链、Best Bid/Ask Price/Amount、Market IV、Greeks、OI、Volume                                 |

主要 Metric：

- Unit Delta、Total Delta XAU、Gamma XAU、Theta USD/day、Vega USD/vol。
- Mark IV、Bid IV、Ask IV、Bid Ask IV Spread、Volume Notional USD（Metric 下拉框按所选标的显示为 GLD `Volume (Session)` 或加密期权 `Volume (24h)`）。
- Raw Qty、Notional Size USD、Market Value、UPL、DTE、Distance to Strike、Roll Priority。
- Bid Dollar Notional、Ask Dollar Notional、Bid+Ask Dollar Notional。

IV Metric 使用独立的 `IV Source`：

- `MARKET`：交易所或数据商直接发布的 IV，缺失时保持 `MISSING`。
- `MODEL`：网站分别使用 Mark/Bid/Ask Price 和同一行情快照的 IV Reference Spot 反解的 IV。
- Model IV 不会覆盖 Market IV，两套数据可以独立比较。GLD 当前筛选器仅开放 `MODEL`。

### 2. 当前默认热力图视图

每次登录后直接进入 `/matrix`，左侧菜单默认收起。默认筛选为：

| 控件        | 默认值                              |
| ----------- | ----------------------------------- |
| Dataset     | Full Option Chain                   |
| Underlying  | GLD/USD-OPRA                        |
| ITM/OTM     | OTM                                 |
| C/P         | Call + Put                          |
| Metric      | Bid Ask IV Spread                   |
| IV Source   | Model                               |
| Label       | Position Metric                     |
| Hover       | All                                 |
| Color range | GLD 当前 Metric 的 P25 / P75 初始化 |
| Cell size   | 13 px                               |
| Fit All     | 关闭                                |

`Call + Put` 只在 OTM 工作流开放：Call OTM 与 Put OTM 位于 Spot 两侧，便于组成不重叠的波动率横截面。离 Spot 最近的挂牌 Strike 只作为 ATM 视觉位置标记；ITM/OTM 仍按连续 Spot 与 Strike 的真实关系计算，因此最近 Strike 不会再被两个筛选同时误删。

默认直接显示 Underlying、C/P、Metric、条件式 IV Source、ITM/OTM、Label、Hover、Target Option、色标上下限、Cell Size 和 Fullscreen。Venue、Broker、Account、DTE Bucket、Status、Scale、Spot selector、Transpose、Strike 排序与 Fit All 默认隐藏，可由管理员在设置页开启；Underlying 的 `ALL` 选项也默认隐藏。

### 3. 热力颜色、缺失值和边框

- 默认色板：低值绿色、中值黄色、高值红色。
- Quantile、Log、Symmetric Zero-centered 三种尺度可在设置中开启。
- 自动分布尺度使用 P99 clipping；GLD 初始范围按当前 Metric 的 P25/P75 保存。
- 切换 Underlying 时保留原上下限，便于跨市场比较；点击 `Rescale P25/P75` 才按新市场重新标定。
- 每个实际 Metric 独立保存上下限，Market IV 与 Model IV 也分别保存。
- 任一必要输入为 `MISSING/NaN` 时，方格保留实线但不填色、不参加色标和统计。
- Unit Delta 等于 0 时视为可能的数据商占位值，方格不填色。
- Raw Qty 与 Notional Size USD 仅计算和着色真实持仓，不把未持仓的可交易合约当作 0。

边框含义：

- 细青色：期权链中可交易、但当前没有持仓。
- 白色：真实持仓。
- 紫色：Target Option；紫色边框替换该格原边框，背景仍保留当前 Metric 颜色。
- Target Option 在 Label 不为 `None` 时始终显示当前 Metric 数值。

### 4. Hover、统计与 Target Option

- 方格 Hover 可选择 `Risk / Market / PnL / All`，内容可以在设置页逐项编辑。
- Market Hover 显示合约成交量：GLD 为数据源当日/交易时段累计，Bybit 与 Deribit 为最近 24 小时。
- Expiry Hover 显示当前 Metric 的 Min、P25、Median、Average、P75、Max；Total Delta、Raw Qty、Notional Size 还会显示该 Expiry 的持仓合计。
- 左上角 Expiry/Strike Hover 对当前 Underlying 与筛选范围做同样的全局分布统计。
- Expiry 标题直接显示 DTE；右上角 As-of 使用 HKT (UTC+8)。
- 热力图只在一个最近 Strike 显示 ATM；鼠标移到 ATM 标记可查看 Spot 数字和最近 Strike。
- `Target Option + / −` 用于选择或取消方格。选择结果保存在当前浏览器，切换 Metric、Underlying 或刷新页面后仍保留。
- 点击方格打开完整详情、点击 Expiry 打开全面数据默认关闭，可在设置页分别开启。
- 标题状态栏持续显示 held positions、option instruments、grid cells、expiries、strikes 和 max DTE，避免把合约数、方格数和持仓数混为同一指标。

### 5. 视图、全屏和缩放

- Cell Size 可在 3–28 px 调整；手动调整会关闭 Fit All。
- Fullscreen 默认显示，进入全屏时不会自动开启 Fit All。
- Transpose、Strike 正序/倒序和 Fit All 可在设置页显示。
- 页面顶部缩放支持 20%–140%，快捷键为 `Alt -`、`Alt +`、`Alt 0`；缩放比例保存在当前浏览器。
- 每页顶部固定显示 XAUT/USDT、GLD/USD、BTC/USDT、ETH/USDT Spot；悬停可查看来源、时间与实时/延迟/休市状态。

### 6. 可选机构风险模块

以下模块默认隐藏，可在设置页开启：

- Max Unit Delta、Max Total Delta、Max Theta Burn、Max Vega、Nearest Expiry、Highest Roll Priority 等决策卡。
- Largest Data Error：按 `FAIL > MISSING > STALE > WARN > LIVE` 和 Quote Age 定位最严重的数据质量问题。
- GLD DTE≤2 Expiry / Exercise Control。
- XAU Shock、IV Shock、Day、Van Naked PnL、Residual PnL 与 Stress Coverage 情景分析。
- 完整链状态提示、position-only Metric 提示和筛选前合约数量。

`/matrix?mock=100` 与 `/matrix?mock=200` 可载入固定 seed 压力数据，不会写入真实仓位。

## 仓位管理与 Excel

### 手工仓位

仓位管理支持 GLD、XAUT、BTC 的新增、编辑和删除。核心字段包括 Underlying、Expiry、Strike、Call/Put、Entry Price、Net Qty、Fee 和 Unit Delta；还可记录账户、Venue、Instrument、Reference Date、Mark、Multiplier XAU、Shares/Contract 和单位 Greeks。

默认来源：

| Underlying | Source Account     | Venue                                   |
| ---------- | ------------------ | --------------------------------------- |
| GLD        | `KGI-Dinobot-GLD1` | `KGI manual order`                      |
| XAUT       | `SPTT-Dino-Bybit1` | `Bybit via SignalPlus Trading Terminal` |
| BTC        | `LOCAL-HEDGE`      | `Bybit`                                 |

### 持仓快照导入与导出

`上传持仓 Excel` 支持 DinoSignal 原始 29 列格式，也支持新版 36 列格式。系统先预览并验证，不会直接写入；确认时可选择替换或合并更新，并在 `data/backups/` 自动创建导入前备份。

新版导出共 36 列，在原 29 列后增加：

1. Shares/Contract
2. Unit Delta
3. Unit Gamma
4. Unit Theta
5. Unit Vega
6. Cumulative Entry Cost
7. Cumulative Realized PnL

标准 GLD 的 Qty 是期权张数，每张默认对应 100 股 GLD；Mark Price 与 Entry Price 是每股期权权利金，因此市值与成本必须乘 Shares/Contract。标准 XAUT 每张默认对应 1 XAUT。导出时 `Product` 自动写为 `GLD Option`、`XAUT Option` 或 `BTC Option`。

### 从全量交易记录推导持仓

`上传全量交易记录` 支持：

- KGI GLD 全量成交：原始 Qty 按 GLD shares 读取，再按 Shares/Contract 转为合约张数。
- Bybit / SignalPlus XAUT 或 BTC 全量成交：Qty 按期权合约数读取。
- 同时包含 KGI 与 Bybit RAW 工作表的推导工作簿。

系统按时间顺序和移动加权平均成本法处理开仓、部分平仓、反向和到期记录：

- `Cumulative Entry Cost`：从交易记录起点到 Reference Date 的全部开仓成本，包括后来已平仓/到期部分。
- `Cumulative Realized PnL`：每次平仓或结算净流入减去该次数量对应的账面成本；成本只结转一次。
- 无法推导的 Mark、IV、Bid/Ask、Greeks 保持 `MISSING`，随后使用“更新市场数据”补齐。
- 确认导入只替换文件涉及的 Underlying，例如只上传 KGI 时不会覆盖现有 XAUT。

详细格式与成本法见 [`docs/excel-position-guide.md`](docs/excel-position-guide.md)。

## 市场数据更新机制

网站有两类刷新：

1. **轻量行情查询轮询**：Spot、持仓 ticker 与逐持仓 GLD quote 每 5 分钟重新获取；切回浏览器窗口不会额外触发高频请求。完整链在进入/切换市场时读取，并在手动刷新或全局缓存失效后重新获取。
2. **持仓行情持久化**：默认每 60 分钟执行一次，只有网页保持打开时运行。它把 Mark、IV、Bid/Ask、Greeks、MV、UPL、Source 和 As-of 写入当前服务器的仓位记录。

这里“持久化”是指：刷新结果不仅显示在当前画面，还会写入 `data/portfolio.json`，供 Dashboard、仓位管理、热力图和随后导出的 Excel 继续使用。它不代表 Render 免费实例拥有永久磁盘。

页面顶部默认显示唯一的“更新市场数据”按钮；仓位页和热力图内部的同类按钮默认隐藏，可在设置页开启。手动更新会跳过等待时间并立即重算公式。

## 公式和计算口径

### 标准合约参数

以下参数在公式管理页可编辑，并影响页面、市场刷新和 Excel 导出：

- `gld_xau_multiplier = 0.092`
- `xaut_xau_multiplier = 1`
- `gld_contract_multiplier = 100`
- `xaut_contract_multiplier = 1`

调整合约或非标准 deliverable 应优先使用逐仓位/contract master 的真实规格，不能强行套用默认值。

### 持仓计算

```text
Entry Cost = Entry Price × Net Qty × Contract Multiplier + Fee
Current Value = Mark Price × Net Qty × Contract Multiplier
UPL = Current Value − Entry Cost
Notional Size USD = Net Qty × Contract Multiplier × Underlying Spot
Total Delta XAU = Unit Delta × Net Qty × Contract Multiplier × XAU Multiplier
Total Gamma XAU = Unit Gamma × Net Qty × Contract Multiplier × XAU Multiplier²
Total Theta = Unit Theta × Net Qty × Contract Multiplier
Total Vega = Unit Vega × Net Qty × Contract Multiplier
```

`Total Delta XAU` 是统一后的 XAU 风险量纲名称，页面不额外显示 `oz` 单位。Notional Size 是标的名义金额，不是期权 Market Value。

### Model IV

```text
Model Mark IV = invert(Model Price Formula, Mark Price, IV Reference Spot)
Model Bid IV  = invert(Model Price Formula, Bid Price, IV Reference Spot)
Model Ask IV  = invert(Model Price Formula, Ask Price, IV Reference Spot)
Model IV Spread = Model Ask IV − Model Bid IV
```

`bid_ask_iv_inversion_enabled` 大于 0 时开启反解，0 或负数时关闭。IV Reference Spot 必须来自与期权价格同步的行情快照，不能混用较新的 Display Spot。

### 盘口 Dollar Notional

```text
premium_currency_to_usd = premiumToUsd
Bid Dollar Notional = Bid Price × Bid Size × Contract Multiplier × premium_currency_to_usd
Ask Dollar Notional = Ask Price × Ask Size × Contract Multiplier × premium_currency_to_usd
Bid+Ask Dollar Notional = Bid Dollar Notional + Ask Dollar Notional
```

GLD、Bybit USD/USDT/USDC 权利金的换算因子为 1；Deribit BTC/ETH 期权保留原生 BTC/ETH 权利金，并用同一 ticker/summary 的 underlying price 换算为 USD。一档 Size 是 Top-of-book 深度，不代表完整订单簿深度。

### 公式编辑

公式管理支持表达式、业务说明和生效位置编辑；保存后会验证未知变量、循环引用和非有限结果，并立即重算服务器仓位。

支持：

- 运算符：`+ - * / ^`
- 函数：`sqrt / ln / log / exp / abs / min / max / pow / N / CDF / PDF`
- 自定义公式按名称被其他公式引用
- 单项恢复默认或全部恢复默认

只有管理员账户（默认用户名 `xauadmin`）可以修改公式。

## 页面、账户与权限

| 页面              | 路由            | 默认导航 | 说明                            |
| ----------------- | --------------- | -------- | ------------------------------- |
| 市场热力图        | `/matrix`       | 显示     | 登录后默认页面                  |
| 仓位管理          | `/positions`    | 显示     | 手工仓位、Excel、行情更新与导出 |
| TradingView K线图 | `/charts`       | 显示     | 进入页面后才加载第三方图表资源  |
| Dashboard         | `/dashboard`    | 隐藏     | 持仓汇总与统一风险量纲          |
| 公式管理          | `/formulas`     | 隐藏     | 管理员编辑公式                  |
| 数据来源          | `/data-sources` | 隐藏     | API、来源、状态和延迟说明       |
| 设置              | `/settings`     | 显示     | 仅管理员可访问                  |

账户由环境变量配置：

- 管理员：`APP_USERNAME` / `APP_PASSWORD`，默认用户名 `xauadmin`。
- 受限用户：`VIEWER_USERNAME` / `VIEWER_PASSWORD`，默认用户名 `xauwhales`。

`xauwhales` 默认可访问市场热力图、仓位管理、TradingView K线图和 BTC 最大痛点；管理员可在设置页调整其服务端页面权限。设置页始终仅管理员可访问。两个账户默认使用同一组合数据；当前受限账户不是只读角色，只要仓位管理权限开启，仍可新增、修改、导入或删除仓位。

登录 token 只保存在当前页面内存，刷新页面或重新打开网站后需要重新登录。服务器 session 默认 12 小时，退出登录会立即撤销当前 token。

## TradingView K线图

K线页支持 GLD、XAU/USD、XAUT/USDT、Bybit BTC/ETH 和 Deribit BTC/ETH，提供 1m、5m、15m、1h、4h、1D、1W 周期。

- 图表脚本只在打开 K线页时加载，不会持续拖慢热力图。
- 当前页面最多保留 3 个标的的 widget 会话，切回标的时可临时保留画线。
- 刷新页面、离开 K线页、切换周期或主动刷新图表会清除临时画线。
- 网站不保存 TradingView 账号或密码；需要长期保存画线应点击“在 TradingView 中打开”并使用自己的 TradingView 账户。

## 设置页

管理员可以设置：

- xauwhales 可访问页面，以及管理员左侧导航入口。
- 持仓行情自动更新开关和分钟间隔。
- 仓位页/热力图页内部更新按钮、仓位顶部状态卡和底部说明。
- 热力图显示哪些筛选器，以及每个筛选器允许选择哪些选项。
- 持仓格识别码、Hover、Expiry Hover 和完整详情字段。
- 点击方格/Expiry 是否打开详情。
- 决策卡、Largest Data Error、Expiry Control、Scenario 和提示条显示状态。
- GLD/XAUT/BTC 风险参数、fallback IV 和无风险利率。

大部分显示设置、Target Option、页面缩放和色标范围保存在当前浏览器；xauwhales 页面权限和仓位数据保存在服务器。换浏览器或清除网站数据会恢复浏览器侧默认值。

## API 与数据来源

| 数据                      | Provider / Endpoint                                                        |                      密钥 |
| ------------------------- | -------------------------------------------------------------------------- | ------------------------: |
| GLD 完整链                | Cboe `/api/global/delayed_quotes/options/GLD.json`                         |                        否 |
| GLD Spot                  | MarketData.app → Tradier → Cboe delayed → Yahoo fallback                   |                      可选 |
| GLD 持仓低延迟期权        | MarketData.app `/v1/options/quotes/{OCC_SYMBOL}/?mode=live`                | `MARKETDATA_TOKEN` + OPRA |
| GLD Tradier 兼容链        | Tradier `/v1/markets/options/chains?greeks=true`                           |       `TRADIER_API_TOKEN` |
| XAUT/BTC/ETH Bybit 完整链 | Bybit `/v5/market/instruments-info` + `/v5/market/tickers?category=option` |                        否 |
| XAUT/BTC/ETH Spot         | Bybit `/v5/market/tickers?category=spot`                                   |                        否 |
| BTC/ETH Deribit 完整链    | `public/get_instruments` + `public/get_book_summary_by_currency`           |                        否 |
| BTC/ETH Deribit ticker    | WebSocket `ticker.{instrument}.100ms`，REST ticker 降级                    |                        否 |
| XAU/USD 代理              | Yahoo `GC=F`；失败时使用 XAUT/USDT proxy                                   |                        否 |

Deribit WebSocket 会处理 heartbeat、断线重连、增量订阅和有限 REST fallback。服务器刚从休眠恢复时需要重建订阅，最初数秒可能出现部分 `MISSING`。

详细字段审计见 [`docs/market-data-field-audit.md`](docs/market-data-field-audit.md)，实时链使用说明见 [`docs/live-market-chain-guide.md`](docs/live-market-chain-guide.md)。

## 本地快速启动

要求：Node.js 20+、pnpm。

```bash
cp .env.example .env
# 编辑 .env，至少填写 APP_PASSWORD 和 VIEWER_PASSWORD
pnpm install
pnpm dev
```

打开终端显示的地址，通常为 [http://localhost:3000](http://localhost:3000)。首次运行会自动创建 `data/portfolio.json`，无需 MySQL 或数据库迁移。

生产模式：

```bash
pnpm build
pnpm start
```

若 `APP_PASSWORD` 或 `VIEWER_PASSWORD` 为空，生产服务会拒绝启动。不要把真实密码或 API token 提交到 GitHub。

## Docker

```bash
cp .env.example .env
# 填写两个账户密码和可选行情 token
docker compose up -d --build
docker compose logs -f
```

打开 [http://localhost:3000](http://localhost:3000)。`./data` 挂载到容器 `/app/data`，`restart: unless-stopped`；更新镜像不会自动删除宿主机仓位文件。

停止：

```bash
docker compose down
```

## 部署

### Render

仓库的 [`render.yaml`](render.yaml) 使用 Docker、Singapore region、Free plan、`/healthz` 健康检查和 `main` commit 自动部署。首次创建 Blueprint 后，需要在 Render Environment 设置：

```text
APP_PASSWORD=...
VIEWER_PASSWORD=...
MARKETDATA_TOKEN=...       # 可选
TRADIER_API_TOKEN=...      # 可选
```

Render 免费实例会因空闲休眠，唤醒时可能出现约几十秒冷启动；免费服务没有持久磁盘，重新部署或实例重建可能丢失运行期写入的仓位。正式使用应升级持久磁盘、迁移 PostgreSQL/对象存储，或至少在每次重要修改后导出 Excel/JSON。

### 公司服务器子路径

部署到 `https://example.com/optionhedger/` 时设置：

```text
VITE_BASE_PATH=/optionhedger/
```

然后重新构建镜像；这是前端构建参数，不能只重启旧容器：

```bash
git pull --ff-only origin main
docker compose up -d --build
curl -f http://127.0.0.1:3000/healthz
```

反向代理应将 `/optionhedger/*` 转发到应用端口，并按服务器代理配置正确处理路径前缀。推荐使用 GitHub Actions + SSH 部署指定 commit、健康检查和失败回滚；Deploy Key 使用只读权限，服务器密钥只存 GitHub Actions Secrets。

### Cloudflare 临时公网链接

本机临时演示可使用：

```bash
docker compose -f docker-compose.public.yml up -d --build
docker compose -f docker-compose.public.yml logs cloudflared
```

Quick Tunnel URL 会在重启后变化，且依赖本机持续开机，不适合作为长期生产入口。

## 数据、备份与安全边界

- 主数据：`data/portfolio.json`，使用队列串行化和临时文件 rename 原子写入。
- 持仓 Excel 或全量交易导入前：自动备份到 `data/backups/`。
- `DATA_FILE=/绝对路径/portfolio.json` 可更改数据位置。
- `/healthz` 只返回服务存活状态，不暴露仓位。
- `.env`、API token、仓位 Excel、JSON 备份和服务器 SSH 私钥都不应提交到 Git。
- 当前 JSON 架构适合少量协作者和单实例；多实例并发、细粒度权限、审计历史和高可用应迁移数据库。
- 当前认证是内存 Bearer session；服务器重启会使已有 session 失效。

## 验证与开发

```bash
pnpm check
pnpm test
pnpm build
```

当前自动测试覆盖市场适配、Target Option、本地设置默认值、账户退出、持仓 Excel、全量交易成本法、Spot 选择、子路径部署和机构热力图验收。

## 相关文档

- [`docs/excel-position-guide.md`](docs/excel-position-guide.md)：持仓/交易 Excel、移动加权成本、36列导出。
- [`docs/market-data-field-audit.md`](docs/market-data-field-audit.md)：Bybit、Deribit、Cboe、MarketData.app、Tradier 字段完整性与 USD 量纲。
- [`docs/live-market-chain-guide.md`](docs/live-market-chain-guide.md)：完整期权链、市场刷新与数据质量。
- [`docs/risk-heatmap-spec.md`](docs/risk-heatmap-spec.md)：机构热力图原始信息架构、schema 与验收设计；部分默认视觉描述早于当前版本，应以本 README 和代码为准。
- [`docs/cross-market-liquidity-design.md`](docs/cross-market-liquidity-design.md)：跨市场 Spread、深度和统一量纲的后续设计。
- [`docs/黄金对冲分析网站_风险热力图与操作手册_20260814.docx`](docs/黄金对冲分析网站_风险热力图与操作手册_20260814.docx)：中文操作与讲解手册。

## 已知边界与下一阶段

1. GLD 免费完整链来自 Cboe delayed feed，休市或周末 As-of 不会更新；正式交易应配置有授权和 SLA 的 OPRA 数据。
2. GLD 是美式期权，Black-Scholes 仅作回退和 Model IV 统一近似；可升级为美式模型、利率曲线与波动率曲面。
3. GLD adjusted contract 仍需要 OCC/券商 contract master；标准 100 股不能覆盖所有公司行动调整合约。
4. 当前 Dollar Notional 只使用 Best Bid/Ask 一档，不是全深度、滑点或冲击成本。
5. OI 保留 provider-native 口径；热力图的 Volume 已按可编辑公式 `volume_notional_usd = volume × contractMultiplier × underlyingPrice` 统一为 Volume Notional USD。GLD 的窗口是当日/交易时段，Bybit 与 Deribit 是最近 24 小时，因此可比较美元规模，但比较时仍须注意时间窗口差异。
6. Target Option、画线与显示设置主要是浏览器本地状态，不是多人共享的交易任务系统。
7. xauwhales 目前是页面受限、但不是数据只读角色；生产权限体系应增加 read-only、operator、admin 等服务端 RBAC。
8. 长期生产建议增加 PostgreSQL、行情快照历史、仓位变更审计、监控告警、定时备份和公司服务器 CI/CD。
