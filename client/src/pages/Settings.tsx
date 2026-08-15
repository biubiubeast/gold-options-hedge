import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { usePortfolioSettings } from "@/hooks/usePortfolioSettings";
import { MARKET_REFRESH_EVENT, readLastMarketRefreshAt } from "@/lib/marketRefreshStatus";
import { trpc } from "@/lib/trpc";
import { DEFAULT_PORTFOLIO_SETTINGS, type AdminPasswordPage, type PortfolioSettings } from "@/lib/portfolio";
import { METRIC_LABELS, type HeatmapMetric } from "@shared/riskHeatmap";
import { CheckCircle2, Clock3, Database, Eye, Filter, LockKeyhole, MessageSquareText, RefreshCw, RotateCcw, Scale, ShieldAlert, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

function numeric(value: string, fallback: number, minimum = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

const heatmapFilterLabels: Array<[keyof PortfolioSettings["heatmapVisibleFilters"], string, string]> = [
  ["dataset", "Data / 数据集", "真实仓位、完整期权链或压力测试数据"],
  ["underlying", "Underlying", "GLD、XAUT、BTC 或全部标的"],
  ["venue", "Venue", "交易场所或行情场所"],
  ["broker", "Broker", "经纪商维度"],
  ["account", "Account", "账户维度"],
  ["callPut", "Call / Put", "Call、Put 或 Combined"],
  ["expiryBucket", "DTE / Expiry Bucket", "按剩余期限区间筛选"],
  ["status", "Data Status", "LIVE、STALE、WARN、MISSING、FAIL"],
  ["metric", "Metric", "热力图颜色所代表的指标"],
  ["scale", "Color Scale", "Quantile、Log、Zero-centered"],
  ["spot", "Spot 标记", "GLD、XAUT、BTC 或 XAU Spot"],
  ["label", "Label", "方格内数值标签模式"],
  ["hover", "Hover", "Hover 弹窗的数据预设"],
  ["range", "色标上下限", "MIN、MAX 和自定义范围按钮"],
  ["transpose", "Transpose", "Expiry 与 Strike 转置"],
  ["reverseStrikes", "Strike 排序", "升序或降序"],
  ["cellSize", "方格尺寸", "缩小或放大方格"],
  ["fitAll", "Fit All", "自动容纳完整热力图"],
  ["fullscreen", "Fullscreen", "进入或退出全屏"],
];

const heldCellContentLabels: Array<[keyof PortfolioSettings["heatmapHeldCellContent"], string, string]> = [
  ["underlying", "Underlying · X/G/B", "X=XAUT、G=GLD、B=BTC、M=同格包含多个标的"],
  ["callPut", "Option Type · C/P", "C=Call、P=Put、C/P=同格同时包含 Call 与 Put"],
  ["dataStatus", "Data Status · L/S/W/M/F", "L=LIVE、S=STALE、W=WARN、M=MISSING、F=FAIL"],
];

const pageEntryLabels: Array<[keyof PortfolioSettings["visiblePages"], string, string]> = [
  ["dashboard", "Dashboard", "总持仓汇总与风险数据"],
  ["positions", "仓位管理", "默认显示；管理员门禁单独设置"],
  ["matrix", "风险热力图", "默认显示；默认免管理员密码"],
  ["formulas", "公式管理", "公式说明、编辑与恢复"],
  ["dataSources", "数据来源", "行情 API 与延迟说明"],
  ["settings", "设置", "本页入口；页面本身受管理员门禁保护"],
];

const adminPasswordPageLabels: Array<[AdminPasswordPage, string, string]> = [
  ["dashboard", "Dashboard", "默认需要密码"],
  ["positions", "仓位管理", "默认需要密码"],
  ["matrix", "风险热力图", "默认不需要密码，可在此开启"],
  ["formulas", "公式管理", "默认需要密码"],
  ["dataSources", "数据来源", "默认需要密码"],
  ["settings", "设置", "默认需要密码"],
  ["optionDetail", "期权完整详情页", "默认需要密码"],
  ["notFound", "未知 / 404 页面", "默认需要密码"],
];

const heatmapSectionLabels: Array<[keyof PortfolioSettings["heatmapVisibleSections"], string, string]> = [
  ["decisionCards", "Show Cards / 决策卡", "显示顶部 Show/Hide Cards 按钮；默认隐藏"],
  ["dataError", "Largest Data Error", "显示顶部数据质量说明按钮；默认隐藏"],
  ["scenario", "情景分析", "显示热力图底部 XAU / IV / Day Shock 分析；默认隐藏"],
  ["chainStatusBanner", "期权链状态提示", "显示筛选区下方 GLD / XAUT / BTC FULL CHAIN 行情来源与更新时间；默认隐藏"],
  ["positionOnlyMetricBanner", "Position-only Metric 提示", "显示 Qty、Notional、MV 等仅按持仓着色的口径说明；默认隐藏"],
];

const fixedOptionGroups = [
  ["dataset", "Data / 数据集", [["chain", "完整期权链"], ["live", "持仓行情"], ["mock100", "Mock 100"], ["mock200", "Mock 200"]]],
  ["underlying", "Underlying", [["GLD", "GLD"], ["XAUT", "XAUT"], ["BTC", "BTC"], ["all", "ALL"]]],
  ["callPut", "C/P", [["call", "CALL"], ["put", "PUT"], ["combined", "COMBINED"]]],
  ["expiryBucket", "DTE", [["all", "ALL"], ["expired", "EXPIRED"], ["0-2", "0–2"], ["3-7", "3–7"], ["8-30", "8–30"], ["31+", "31+"]]],
  ["status", "Data Status", [["all", "ALL"], ["LIVE", "LIVE"], ["STALE", "STALE"], ["WARN", "WARN"], ["MISSING", "MISSING"], ["FAIL", "FAIL"]]],
  ["scale", "Color Scale", [["quantile", "QUANTILE"], ["log", "LOG"], ["symmetric", "ZERO-CENTER"]]],
  ["spot", "Spot", [["GLD", "GLD"], ["XAUT", "XAUT"], ["BTC", "BTC"], ["XAU", "XAU"]]],
  ["label", "Label", [["none", "NONE"], ["held", "HELD METRIC"], ["top", "TOP 15%"], ["bottom", "BOTTOM 15%"], ["all", "ALL"]]],
  ["hover", "Hover Preset", [["risk", "RISK"], ["market", "MARKET"], ["pnl", "PNL"], ["all", "ALL"]]],
] as const;

const hoverContentLabels: Array<[keyof PortfolioSettings["heatmapHoverContent"], string, string]> = [
  ["selectedMetric", "Selected Metric", "当前热力图 Metric 的值"],
  ["unitDelta", "Unit Delta", "单张期权 Delta"], ["totalDelta", "Total Delta XAU", "持仓合计 XAU Delta"],
  ["unitGamma", "Unit Gamma", "默认隐藏"], ["totalGamma", "Total Gamma", "默认隐藏"],
  ["unitTheta", "Unit Theta", "默认隐藏"], ["totalTheta", "Total Theta", "默认隐藏"],
  ["unitVega", "Unit Vega", "默认隐藏"], ["totalVega", "Total Vega", "默认隐藏"],
  ["dteRoll", "DTE / Roll", "到期天数和 Roll Priority"], ["qtyNotional", "Qty / Notional", "持仓数量和名义本金"],
  ["markIv", "Mark / IV", "Mark 价格与 IV"], ["bidAsk", "Bid / Ask", "盘口价格"],
  ["bidAskIv", "Bid IV / Ask IV", "盘口隐含波动率"], ["ivSpread", "IV Spread", "Ask IV − Bid IV"],
  ["sourceQuote", "Source / Quote As-of", "行情来源和时间"], ["openInterestVolume", "OI / Volume", "未平仓量与成交量"],
  ["mvEntry", "MV / Entry", "市场价值与成本"], ["upl", "UPL", "未实现盈亏"],
];

const expiryHoverContentLabels: Array<[keyof PortfolioSettings["heatmapExpiryHoverContent"], string, string]> = [
  ["heldListed", "Held / Listed", "持仓与上市合约数量"], ["totalDelta", "Total Delta", "Expiry 持仓合计 XAU Delta"],
  ["totalGamma", "Total Gamma", "默认隐藏"], ["totalTheta", "Total Theta", "默认隐藏"], ["totalVega", "Total Vega", "默认隐藏"],
  ["maxRoll", "Max Roll", "默认隐藏"], ["worstStatus", "Worst Status", "最严重数据状态"],
  ["averageIv", "Average IV", "Mark / Bid / Ask IV 平均值"], ["openInterestVolume", "OI / Volume", "合约链聚合盘口统计"],
  ["staleMissing", "Stale / Missing", "旧报价和缺失数据数量"], ["latestQuote", "Latest Quote", "最新行情时间"],
  ["netGrossQty", "Net / Gross Qty", "Expiry 持仓数量汇总"], ["grossNotional", "Gross Notional", "Expiry 总名义金额"],
  ["mvEntry", "MV / Entry", "市场价值与成本"], ["upl", "UPL", "未实现盈亏"],
];

const detailContentLabels: Array<[keyof PortfolioSettings["heatmapDetailContent"], string, string]> = [
  ["instrument", "Instrument", "合约代码"], ["underlyingCallPut", "Underlying / C/P", "标的与期权类型"],
  ["expiryDte", "Expiry / DTE", "到期日和剩余天数"], ["strike", "Strike", "行权价"],
  ["venueBrokerAccount", "Venue / Broker / Account", "场所、经纪商和账户"], ["netQty", "Net Qty", "净持仓"],
  ["contractMultiplier", "Contract Multiplier", "合约乘数"], ["xauPerUnit", "XAU per unit", "统一 XAU 量纲"],
  ["markBidAsk", "Mark / Bid / Ask", "价格行情"], ["markIv", "Mark IV", "Mark 隐含波动率"],
  ["bidAskIv", "Bid / Ask IV / Spread", "盘口 IV"], ["qtyNotional", "Qty / Notional", "持仓规模"],
  ["unitDelta", "Unit Delta", "默认显示"], ["totalDelta", "Total Delta XAU", "默认显示"],
  ["unitGamma", "Unit Gamma", "默认隐藏"], ["totalGamma", "Total Gamma", "默认隐藏"],
  ["unitTheta", "Unit Theta", "默认隐藏"], ["totalTheta", "Total Theta", "默认隐藏"],
  ["unitVega", "Unit Vega", "默认隐藏"], ["totalVega", "Total Vega", "默认隐藏"],
  ["marketValue", "Market Value", "当前市值"], ["entryPrice", "Entry Price", "单张平均入场价格"], ["entryCost", "Entry Cost", "入场成本"], ["upl", "UPL", "未实现盈亏"],
  ["source", "Source", "行情来源"], ["quoteAsOf", "Quote As-of", "行情时间"], ["dataStatus", "Data Status", "数据质量"],
  ["deliverableSource", "Deliverable Source", "交割规格来源"], ["adjustedContract", "Adjusted Contract", "是否调整合约"],
  ["rollPriority", "Roll Priority", "评分及各项原因"],
];

export default function Settings() {
  const { settings, setSettings, resetSettings } = usePortfolioSettings();
  const [draft, setDraft] = useState<PortfolioSettings>(settings);
  const [lastRefreshAt, setLastRefreshAt] = useState(readLastMarketRefreshAt);
  const { data: positions } = trpc.positions.list.useQuery();
  const dynamicFilterOptions = {
    venue: [...new Set(["Bybit", "Cboe / OPRA", "OPRA", ...(positions ?? []).map(position => position.venue).filter((value): value is string => Boolean(value))])].sort(),
    broker: [...new Set(["MARKET CHAIN", "SignalPlus", "Manual fallback", ...(positions ?? []).map(position => position.venue || (position.underlying === "XAUT" ? "SignalPlus" : "Manual fallback"))])].sort(),
    account: [...new Set(["LISTED-NO-POSITION", "LOCAL-HEDGE", ...(positions ?? []).map(position => position.sourceAccount).filter((value): value is string => Boolean(value))])].sort(),
  };

  useEffect(() => setDraft(settings), [settings]);
  useEffect(() => {
    const sync = () => setLastRefreshAt(readLastMarketRefreshAt());
    window.addEventListener("storage", sync);
    window.addEventListener(MARKET_REFRESH_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(MARKET_REFRESH_EVENT, sync);
    };
  }, []);

  const save = () => {
    const invalidGroup = fixedOptionGroups.find(([key]) => !Object.values(draft.heatmapFilterOptions[key]).some(Boolean));
    if (invalidGroup || !Object.values(draft.heatmapFilterOptions.metric).some(Boolean)) {
      toast.error(`${invalidGroup?.[1] ?? "Metric"} 至少保留一个可选项`);
      return;
    }
    const validated: PortfolioSettings = {
      ...draft,
      marketAutoRefreshMinutes: numeric(String(draft.marketAutoRefreshMinutes), 60, 1),
      xautContractMultiplier: numeric(String(draft.xautContractMultiplier), 1, Number.EPSILON),
      gldContractMultiplier: numeric(String(draft.gldContractMultiplier), 100, Number.EPSILON),
      gldFallbackIv: numeric(String(draft.gldFallbackIv), 0.2, 0.0001),
      riskFreeRate: numeric(String(draft.riskFreeRate), 0.045, -1),
      gldSpotScaleOverride: draft.gldSpotScaleOverride === null ? 0.092 : numeric(String(draft.gldSpotScaleOverride), 0.092, Number.EPSILON),
      xautSpotScaleOverride: draft.xautSpotScaleOverride === null ? null : numeric(String(draft.xautSpotScaleOverride), 1, Number.EPSILON),
    };
    setSettings(validated);
    toast.success("全站参数已保存并同步到 Dashboard、仓位、风险热力图和详情页");
  };

  const reset = () => {
    resetSettings();
    setDraft(DEFAULT_PORTFOLIO_SETTINGS);
    toast.success("已恢复默认设置");
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gold-gradient">设置</h1>
        <p className="mt-1 text-sm text-muted-foreground">控制全站市场刷新、合约口径与风险估值参数。保存后当前浏览器的所有页面立即生效。</p>
      </div>

      <Card className="glass-card">
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><LockKeyhole className="h-4 w-4 text-primary" />管理员门禁与页面入口</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div><p className="mb-2 flex items-center gap-2 text-xs font-semibold"><LockKeyhole className="h-3.5 w-3.5" />各页面管理员密码</p><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{adminPasswordPageLabels.map(([key, label, description]) => <div key={key} className="flex items-center justify-between gap-3 rounded-md border border-amber-300/25 bg-amber-300/[0.03] p-3"><div><Label htmlFor={`admin-password-page-${key}`} className="text-xs">{label}</Label><p className="mt-1 text-[10px] leading-snug text-muted-foreground">{description}</p></div><Switch id={`admin-password-page-${key}`} checked={draft.adminPasswordPages[key]} onCheckedChange={checked => setDraft(current => ({ ...current, adminPasswordPages: { ...current.adminPasswordPages, [key]: checked } }))} aria-label={`${label}开启管理员密码`} /></div>)}</div><p className="mt-2 text-[11px] text-muted-foreground">默认只有风险热力图免管理员密码；其他页面每次打开或刷新都需要输入 8888。这里的门禁不替代网站 Basic Auth 登录。</p></div>
          <div><p className="mb-2 flex items-center gap-2 text-xs font-semibold"><Eye className="h-3.5 w-3.5" />左侧导航入口显示</p><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{pageEntryLabels.map(([key, label, description]) => <div key={key} className="flex items-center justify-between gap-3 rounded-md border border-border/60 p-3"><div><Label htmlFor={`page-entry-${key}`} className="text-xs">{label}</Label><p className="mt-1 text-[10px] text-muted-foreground">{description}</p></div><Switch id={`page-entry-${key}`} checked={draft.visiblePages[key]} onCheckedChange={checked => setDraft(current => ({ ...current, visiblePages: { ...current.visiblePages, [key]: checked } }))} aria-label={`显示 ${label} 页面入口`} /></div>)}</div></div>
          <p className="text-[11px] text-muted-foreground">隐藏入口不会删除页面或数据；已知网址仍可访问，并继续遵守管理员门禁。默认只显示风险热力图、仓位管理和设置。</p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="glass-card">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><RefreshCw className="h-4 w-4 text-primary" />市场数据自动更新</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4 rounded-md border border-border/60 p-3">
              <div><p className="text-sm font-medium">网页打开时自动更新持仓行情</p><p className="mt-1 text-xs text-muted-foreground">更新 Mark、IV、Bid/Ask、Greeks、MV、UPL、Source 与 As-of，并进入 Excel 导出。</p></div>
              <Switch checked={draft.marketAutoRefreshEnabled} onCheckedChange={checked => setDraft(current => ({ ...current, marketAutoRefreshEnabled: checked }))} aria-label="自动更新市场数据" />
            </div>
            <div>
              <Label htmlFor="refresh-minutes">更新间隔（分钟）</Label>
              <Input id="refresh-minutes" className="mt-1" type="number" min="1" max="1440" step="1" value={draft.marketAutoRefreshMinutes} onChange={event => setDraft(current => ({ ...current, marketAutoRefreshMinutes: Number(event.target.value) }))} />
              <p className="mt-1 text-xs text-muted-foreground">默认 60 分钟。GLD 延迟行情频繁更新不会变成实时行情；请按数据源额度设置。</p>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold">页面内部的更新市场数据按钮</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 p-3"><div><Label htmlFor="positions-refresh-button" className="text-xs">仓位管理</Label><p className="mt-1 text-[10px] text-muted-foreground">默认隐藏页面内部按钮</p></div><Switch id="positions-refresh-button" checked={draft.pageMarketRefreshButtons.positions} onCheckedChange={checked => setDraft(current => ({ ...current, pageMarketRefreshButtons: { ...current.pageMarketRefreshButtons, positions: checked } }))} aria-label="仓位管理显示更新市场数据按钮" /></div>
                <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 p-3"><div><Label htmlFor="matrix-refresh-button" className="text-xs">风险热力图</Label><p className="mt-1 text-[10px] text-muted-foreground">默认隐藏页面内部按钮</p></div><Switch id="matrix-refresh-button" checked={draft.pageMarketRefreshButtons.matrix} onCheckedChange={checked => setDraft(current => ({ ...current, pageMarketRefreshButtons: { ...current.pageMarketRefreshButtons, matrix: checked } }))} aria-label="风险热力图显示更新市场数据按钮" /></div>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">全站最顶部的“更新市场数据”按钮始终保留显示，不受这里控制。</p>
            </div>
            <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 rounded-md bg-secondary/25 p-3 text-xs">
              <Clock3 className="row-span-2 h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">最近成功刷新</span>
              <strong className="font-mono">{lastRefreshAt ? new Date(lastRefreshAt).toLocaleString("zh-CN", { hour12: false }) : "尚未记录"}</strong>
            </div>
            <div className="flex gap-2 text-xs leading-relaxed text-amber-200"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /><p>当前自动刷新依赖网页保持打开。要在关闭浏览器后仍 24×7 运行，应使用常驻 Render 实例、持久数据库和服务端 scheduler。</p></div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Scale className="h-4 w-4 text-primary" />XAU 统一量纲与合约默认值</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="gld-xau-scale">GLD/XAU · Multiplier XAU</Label>
              <Input id="gld-xau-scale" className="mt-1" type="number" min="0.000001" step="0.001" value={draft.gldSpotScaleOverride ?? ""} onChange={event => setDraft(current => ({ ...current, gldSpotScaleOverride: event.target.value === "" ? null : Number(event.target.value) }))} />
              <p className="mt-1 text-xs text-muted-foreground">默认 0.092。新增 GLD 仓位时自动带入；已有仓位若已记录 Multiplier XAU，保留其实际值。</p>
            </div>
            <div><Label htmlFor="gld-contract">GLD Contract Multiplier</Label><Input id="gld-contract" className="mt-1" type="number" min="0.0001" step="1" value={draft.gldContractMultiplier} onChange={event => setDraft(current => ({ ...current, gldContractMultiplier: Number(event.target.value) }))} /><p className="mt-1 text-[11px] text-muted-foreground">仅用于缺失 deliverable 的 fallback；标准值 100 shares。</p></div>
            <div><Label htmlFor="xaut-contract">XAUT Contract Multiplier</Label><Input id="xaut-contract" className="mt-1" type="number" min="0.0001" step="0.01" value={draft.xautContractMultiplier} onChange={event => setDraft(current => ({ ...current, xautContractMultiplier: Number(event.target.value) }))} /><p className="mt-1 text-[11px] text-muted-foreground">实际合约规格优先，默认 fallback 为 1。</p></div>
            <div><Label htmlFor="btc-contract">BTC Contract Multiplier</Label><Input id="btc-contract" className="mt-1" type="number" min="0.00000001" step="0.01" value={draft.btcContractMultiplier} onChange={event => setDraft(current => ({ ...current, btcContractMultiplier: Number(event.target.value) }))} /><p className="mt-1 text-[11px] text-muted-foreground">Bybit BTC 期权数量以 BTC 计；默认 fallback 为 1。</p></div>
            <div><Label htmlFor="xaut-xau-scale">XAUT/XAU override</Label><Input id="xaut-xau-scale" className="mt-1" type="number" min="0.000001" step="0.0001" placeholder="留空按现价自动" value={draft.xautSpotScaleOverride ?? ""} onChange={event => setDraft(current => ({ ...current, xautSpotScaleOverride: event.target.value === "" ? null : Number(event.target.value) }))} /></div>
            <div><Label htmlFor="btc-xau-scale">BTC/XAU override</Label><Input id="btc-xau-scale" className="mt-1" type="number" min="0.000001" step="0.0001" placeholder="留空按 BTC÷XAU 自动" value={draft.btcSpotScaleOverride ?? ""} onChange={event => setDraft(current => ({ ...current, btcSpotScaleOverride: event.target.value === "" ? null : Number(event.target.value) }))} /></div>
            <div><Label htmlFor="gld-fallback-iv">GLD fallback IV</Label><Input id="gld-fallback-iv" className="mt-1" type="number" min="0.0001" step="0.01" value={draft.gldFallbackIv} onChange={event => setDraft(current => ({ ...current, gldFallbackIv: Number(event.target.value) }))} /></div>
            <div className="sm:col-span-2"><Label htmlFor="risk-free-rate">Risk-free Rate</Label><Input id="risk-free-rate" className="mt-1" type="number" step="0.001" value={draft.riskFreeRate} onChange={event => setDraft(current => ({ ...current, riskFreeRate: Number(event.target.value) }))} /></div>
          </CardContent>
        </Card>
      </div>

      <Card className="glass-card">
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Eye className="h-4 w-4 text-primary" />风险热力图模块显示</CardTitle></CardHeader>
        <CardContent><p className="mb-4 text-xs text-muted-foreground">控制交易屏幕上较占空间的分析模块和筛选区下方提示条。所有项目默认隐藏，打开后保存即可生效。</p><div className="grid gap-2 md:grid-cols-3">{heatmapSectionLabels.map(([key, label, description]) => <div key={key} className="flex items-center justify-between gap-3 rounded-md border border-border/60 p-3"><div><Label htmlFor={`heatmap-section-${key}`} className="text-xs">{label}</Label><p className="mt-1 text-[10px] leading-snug text-muted-foreground">{description}</p></div><Switch id={`heatmap-section-${key}`} checked={draft.heatmapVisibleSections[key]} onCheckedChange={checked => setDraft(current => ({ ...current, heatmapVisibleSections: { ...current.heatmapVisibleSections, [key]: checked } }))} aria-label={`热力图显示 ${label}`} /></div>)}</div></CardContent>
      </Card>

      <Card className="glass-card">
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Filter className="h-4 w-4 text-primary" />热力图筛选器显示设置</CardTitle></CardHeader>
        <CardContent>
          <p className="mb-4 text-xs leading-relaxed text-muted-foreground">默认显示 Underlying、C/P、Metric、Label、Hover，以及色标上下限、Strike 排序、方格尺寸、Fit All、Fullscreen。隐藏业务筛选器后，该条件自动恢复为非限制状态；隐藏视图控制不会改变当前热力图计算。</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {heatmapFilterLabels.map(([key, label, description]) => <div key={key} className="flex items-center justify-between gap-3 rounded-md border border-border/60 p-3">
              <div className="min-w-0"><Label htmlFor={`heatmap-filter-${key}`} className="text-xs font-medium">{label}</Label><p className="mt-1 text-[10px] leading-snug text-muted-foreground">{description}</p></div>
              <Switch id={`heatmap-filter-${key}`} checked={draft.heatmapVisibleFilters[key]} onCheckedChange={checked => setDraft(current => ({ ...current, heatmapVisibleFilters: { ...current.heatmapVisibleFilters, [key]: checked } }))} aria-label={`热力图显示 ${label}`} />
            </div>)}
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><SlidersHorizontal className="h-4 w-4 text-primary" />筛选项内部选项设置</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <p className="text-xs leading-relaxed text-muted-foreground">决定每个下拉框里可以选择什么。当前已选择项若被隐藏，风险热力图会自动切换到该组第一个可用项。每组至少保留一个选项。</p>
          <div>
            <p className="mb-2 text-xs font-semibold">Metric</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {(Object.entries(METRIC_LABELS) as Array<[HeatmapMetric, string]>).map(([key, label]) => <div key={key} className="flex items-center justify-between gap-2 rounded-md border border-border/60 p-2">
                <Label htmlFor={`heatmap-option-metric-${key}`} className="text-[11px]">{label}</Label>
                <Switch id={`heatmap-option-metric-${key}`} checked={draft.heatmapFilterOptions.metric[key]} onCheckedChange={checked => setDraft(current => ({ ...current, heatmapFilterOptions: { ...current.heatmapFilterOptions, metric: { ...current.heatmapFilterOptions.metric, [key]: checked } } }))} aria-label={`Metric 显示 ${label}`} />
              </div>)}
            </div>
          </div>
          {fixedOptionGroups.map(([groupKey, groupLabel, options]) => <div key={groupKey}>
            <p className="mb-2 text-xs font-semibold">{groupLabel}</p>
            <div className="flex flex-wrap gap-2">
              {options.map(([key, label]) => <div key={key} className="flex min-w-28 items-center justify-between gap-3 rounded-md border border-border/60 px-2 py-1.5">
                <Label htmlFor={`heatmap-option-${groupKey}-${key}`} className="text-[10px]">{label}</Label>
                <Switch id={`heatmap-option-${groupKey}-${key}`} checked={(draft.heatmapFilterOptions[groupKey] as Record<string, boolean>)[key]} onCheckedChange={checked => setDraft(current => ({ ...current, heatmapFilterOptions: { ...current.heatmapFilterOptions, [groupKey]: { ...current.heatmapFilterOptions[groupKey], [key]: checked } } }))} aria-label={`${groupLabel} 显示 ${label}`} />
              </div>)}
            </div>
          </div>)}
          <div>
            <p className="mb-2 text-xs font-semibold">动态选项 · Venue / Broker / Account</p>
            <div className="grid gap-3 md:grid-cols-3">
              {(Object.entries(dynamicFilterOptions) as Array<[keyof typeof dynamicFilterOptions, string[]]>).map(([group, values]) => <div key={group} className="rounded-md border border-border/60 p-3"><p className="mb-2 text-[10px] font-semibold uppercase">{group}</p>{values.length ? <div className="space-y-2">{values.map(value => {
                const visible = !draft.heatmapHiddenDynamicOptions[group].includes(value);
                return <div key={value} className="flex items-center justify-between gap-2"><span className="truncate text-[10px]">{value}</span><Switch checked={visible} onCheckedChange={checked => setDraft(current => ({ ...current, heatmapHiddenDynamicOptions: { ...current.heatmapHiddenDynamicOptions, [group]: checked ? current.heatmapHiddenDynamicOptions[group].filter(item => item !== value) : [...current.heatmapHiddenDynamicOptions[group], value] } }))} aria-label={`${group} 显示 ${value}`} /></div>;
              })}</div> : <p className="text-[10px] text-muted-foreground">暂无仓位选项</p>}</div>)}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Filter className="h-4 w-4 text-amber-300" />持仓方格内容显示设置</CardTitle></CardHeader>
        <CardContent>
          <p className="mb-4 text-xs leading-relaxed text-muted-foreground">控制持仓方格右侧的识别码。三个项目可独立显示或隐藏；热力图 Label 的 HELD METRIC 仍单独控制方格中的 Metric 数值。注意：S 表示 STALE（行情过期），不是 Stable。</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {heldCellContentLabels.map(([key, label, description]) => <div key={key} className="flex items-center justify-between gap-3 rounded-md border border-amber-300/20 bg-amber-300/[0.03] p-3">
              <div className="min-w-0"><Label htmlFor={`held-cell-content-${key}`} className="text-xs font-medium">{label}</Label><p className="mt-1 text-[10px] leading-snug text-muted-foreground">{description}</p></div>
              <Switch id={`held-cell-content-${key}`} checked={draft.heatmapHeldCellContent[key]} onCheckedChange={checked => setDraft(current => ({ ...current, heatmapHeldCellContent: { ...current.heatmapHeldCellContent, [key]: checked } }))} aria-label={`持仓方格显示 ${label}`} />
            </div>)}
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><MessageSquareText className="h-4 w-4 text-primary" />Hover 弹窗内容</CardTitle></CardHeader>
        <CardContent>
          <p className="mb-4 text-xs text-muted-foreground">选择鼠标移到方格时显示的字段。Greeks / Risk 默认只显示 Unit Delta 和 Total Delta。</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{hoverContentLabels.map(([key, label, description]) => <div key={key} className="flex items-center justify-between gap-3 rounded-md border border-border/60 p-3"><div><Label htmlFor={`hover-content-${key}`} className="text-xs">{label}</Label><p className="mt-1 text-[10px] text-muted-foreground">{description}</p></div><Switch id={`hover-content-${key}`} checked={draft.heatmapHoverContent[key]} onCheckedChange={checked => setDraft(current => ({ ...current, heatmapHoverContent: { ...current.heatmapHoverContent, [key]: checked } }))} aria-label={`Hover 显示 ${label}`} /></div>)}</div>
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><MessageSquareText className="h-4 w-4 text-cyan-300" />Expiry 完整数据弹窗内容</CardTitle></CardHeader>
        <CardContent>
          <p className="mb-4 text-xs text-muted-foreground">Hover 固定跟随当前 Metric 显示 Min / Median / Max；本区控制点击 Expiry 后完整数据弹窗的汇总字段。Greeks 默认只显示 Delta，隐藏 Gamma、Theta、Vega。</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{expiryHoverContentLabels.map(([key, label, description]) => <div key={key} className="flex items-center justify-between gap-3 rounded-md border border-border/60 p-3"><div><Label htmlFor={`expiry-hover-content-${key}`} className="text-xs">{label}</Label><p className="mt-1 text-[10px] text-muted-foreground">{description}</p></div><Switch id={`expiry-hover-content-${key}`} checked={draft.heatmapExpiryHoverContent[key]} onCheckedChange={checked => setDraft(current => ({ ...current, heatmapExpiryHoverContent: { ...current.heatmapExpiryHoverContent, [key]: checked } }))} aria-label={`Expiry Hover 显示 ${label}`} /></div>)}</div>
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><MessageSquareText className="h-4 w-4 text-amber-300" />完整仓位详情弹窗内容</CardTitle></CardHeader>
        <CardContent>
          <p className="mb-4 text-xs text-muted-foreground">选择点击方格后的完整详情字段。Position As-of 已永久移除；Greeks / Risk 默认只显示 Unit Delta 和 Total Delta。</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{detailContentLabels.map(([key, label, description]) => <div key={key} className="flex items-center justify-between gap-3 rounded-md border border-border/60 p-3"><div><Label htmlFor={`detail-content-${key}`} className="text-xs">{label}</Label><p className="mt-1 text-[10px] text-muted-foreground">{description}</p></div><Switch id={`detail-content-${key}`} checked={draft.heatmapDetailContent[key]} onCheckedChange={checked => setDraft(current => ({ ...current, heatmapDetailContent: { ...current.heatmapDetailContent, [key]: checked } }))} aria-label={`完整详情显示 ${label}`} /></div>)}</div>
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Database className="h-4 w-4 text-primary" />参数优先级与作用范围</CardTitle></CardHeader>
        <CardContent className="grid gap-3 text-xs leading-relaxed md:grid-cols-3">
          <div className="rounded-md border border-border/60 p-3"><strong className="flex items-center gap-2"><span className="font-mono text-primary">1</span> Contract master / Excel actual</strong><p className="mt-2 text-muted-foreground">实际 deliverable、仓位自身 Multiplier XAU 和导入快照优先，避免 adjusted contract 被默认值覆盖。</p></div>
          <div className="rounded-md border border-border/60 p-3"><strong className="flex items-center gap-2"><span className="font-mono text-primary">2</span> Global setting</strong><p className="mt-2 text-muted-foreground">缺少实际值时使用本页设置；适用于 Dashboard、仓位管理、热力图、详情页和刷新计算。</p></div>
          <div className="rounded-md border border-border/60 p-3"><strong className="flex items-center gap-2"><span className="font-mono text-primary">3</span> Formula / live ratio fallback</strong><p className="mt-2 text-muted-foreground">最后才按实时 GLD÷XAU、XAUT÷XAU 或公式管理中的默认表达式估算，并标记数据质量。</p></div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="outline" className="gap-2" onClick={reset}><RotateCcw className="h-4 w-4" />恢复全部默认值</Button>
        <Button className="gap-2" onClick={save}><CheckCircle2 className="h-4 w-4" />保存全站设置</Button>
      </div>
    </div>
  );
}
