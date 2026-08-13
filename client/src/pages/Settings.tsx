import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { usePortfolioSettings } from "@/hooks/usePortfolioSettings";
import { MARKET_REFRESH_EVENT, readLastMarketRefreshAt } from "@/lib/marketRefreshStatus";
import { DEFAULT_PORTFOLIO_SETTINGS, type PortfolioSettings } from "@/lib/portfolio";
import { CheckCircle2, Clock3, Database, Filter, RefreshCw, RotateCcw, Scale, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

function numeric(value: string, fallback: number, minimum = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

const heatmapFilterLabels: Array<[keyof PortfolioSettings["heatmapVisibleFilters"], string, string]> = [
  ["dataset", "Data / 数据集", "真实仓位、完整期权链或压力测试数据"],
  ["underlying", "Underlying", "GLD、XAUT 或全部标的"],
  ["venue", "Venue", "交易场所或行情场所"],
  ["broker", "Broker", "经纪商维度"],
  ["account", "Account", "账户维度"],
  ["callPut", "Call / Put", "Call、Put 或 Combined"],
  ["expiryBucket", "DTE / Expiry Bucket", "按剩余期限区间筛选"],
  ["status", "Data Status", "LIVE、STALE、WARN、MISSING、FAIL"],
];

const heldCellContentLabels: Array<[keyof PortfolioSettings["heatmapHeldCellContent"], string, string]> = [
  ["underlying", "Underlying · X/G", "X=XAUT、G=GLD、B=同格包含两个标的"],
  ["callPut", "Option Type · C/P", "C=Call、P=Put、C/P=同格同时包含 Call 与 Put"],
  ["dataStatus", "Data Status · L/S/W/M/F", "L=LIVE、S=STALE、W=WARN、M=MISSING、F=FAIL"],
];

export default function Settings() {
  const { settings, setSettings, resetSettings } = usePortfolioSettings();
  const [draft, setDraft] = useState<PortfolioSettings>(settings);
  const [lastRefreshAt, setLastRefreshAt] = useState(readLastMarketRefreshAt);

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
    toast.success("全站参数已保存并同步到 Dashboard、仓位、矩阵和详情页");
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
            <div><Label htmlFor="xaut-xau-scale">XAUT/XAU override</Label><Input id="xaut-xau-scale" className="mt-1" type="number" min="0.000001" step="0.0001" placeholder="留空按现价自动" value={draft.xautSpotScaleOverride ?? ""} onChange={event => setDraft(current => ({ ...current, xautSpotScaleOverride: event.target.value === "" ? null : Number(event.target.value) }))} /></div>
            <div><Label htmlFor="gld-fallback-iv">GLD fallback IV</Label><Input id="gld-fallback-iv" className="mt-1" type="number" min="0.0001" step="0.01" value={draft.gldFallbackIv} onChange={event => setDraft(current => ({ ...current, gldFallbackIv: Number(event.target.value) }))} /></div>
            <div className="sm:col-span-2"><Label htmlFor="risk-free-rate">Risk-free Rate</Label><Input id="risk-free-rate" className="mt-1" type="number" step="0.001" value={draft.riskFreeRate} onChange={event => setDraft(current => ({ ...current, riskFreeRate: Number(event.target.value) }))} /></div>
          </CardContent>
        </Card>
      </div>

      <Card className="glass-card">
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Filter className="h-4 w-4 text-primary" />热力图筛选器显示设置</CardTitle></CardHeader>
        <CardContent>
          <p className="mb-4 text-xs leading-relaxed text-muted-foreground">选择 POSITION RISK HEATMAP 第一行展示哪些业务筛选器。隐藏某个筛选器后，该条件会自动恢复为非限制状态；Data 恢复为完整期权链，避免隐藏条件继续影响结果。</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {heatmapFilterLabels.map(([key, label, description]) => <div key={key} className="flex items-center justify-between gap-3 rounded-md border border-border/60 p-3">
              <div className="min-w-0"><Label htmlFor={`heatmap-filter-${key}`} className="text-xs font-medium">{label}</Label><p className="mt-1 text-[10px] leading-snug text-muted-foreground">{description}</p></div>
              <Switch id={`heatmap-filter-${key}`} checked={draft.heatmapVisibleFilters[key]} onCheckedChange={checked => setDraft(current => ({ ...current, heatmapVisibleFilters: { ...current.heatmapVisibleFilters, [key]: checked } }))} aria-label={`热力图显示 ${label}`} />
            </div>)}
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
