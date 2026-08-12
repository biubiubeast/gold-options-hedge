import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity, BarChart3, DollarSign, RotateCcw, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
import { calculatePosition, getPositionMarketData } from "@/lib/portfolio";
import { usePortfolioSettings } from "@/hooks/usePortfolioSettings";
import { MarketRefreshButton } from "@/components/MarketRefreshButton";

const money = (value: number) => new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
}).format(value);

const showPrice = (value: number) => value > 0 ? `$${value.toFixed(2)}` : "暂不可用";

export default function Dashboard() {
  const { data: positions, isLoading: posLoading } = trpc.positions.list.useQuery();
  const { data: formulas } = trpc.formulas.list.useQuery();
  const { data: spotPrices, isFetching: spotFetching } = trpc.market.spotPrices.useQuery(undefined, {
    refetchInterval: 10_000,
  });
  const { data: xautTickers } = trpc.market.xautTickers.useQuery(undefined, {
    refetchInterval: 10_000,
  });
  const gldExpiries = useMemo(() => [...new Set(
    (positions || []).filter(position => position.underlying === "GLD").map(position => position.expiry),
  )], [positions]);
  const gldContracts = useMemo(() => (positions || [])
    .filter(position => position.underlying === "GLD")
    .map(position => ({
      expiry: position.expiry,
      strike: Number(position.strike),
      optionType: position.optionType,
    })), [positions]);
  const { data: gldQuotes } = trpc.market.gldOptionQuotes.useQuery(
    { expiries: gldExpiries, contracts: gldContracts },
    { enabled: gldExpiries.length > 0, refetchInterval: 10_000 },
  );
  const { data: sourceInfo } = trpc.market.sources.useQuery();

  const [filterUnderlying, setFilterUnderlying] = useState("all");
  const [filterExpiry, setFilterExpiry] = useState("all");
  const [filterStrike, setFilterStrike] = useState("all");
  const { settings, setSettings, resetSettings } = usePortfolioSettings();

  const xautPrice = spotPrices?.xaut?.price ?? 0;
  const gldPrice = spotPrices?.gld?.price ?? 0;
  const xauPrice = spotPrices?.gold?.price ?? 0;
  const automaticXautScale = xauPrice > 0 ? xautPrice / xauPrice : 1;
  const automaticGldScale = xauPrice > 0 ? gldPrice / xauPrice : 0.1;

  const expiries = useMemo(() => [...new Set((positions || []).map(position => position.expiry))].sort(), [positions]);
  const strikes = useMemo(() => [...new Set((positions || []).map(position => position.strike))]
    .sort((a, b) => Number(a) - Number(b)), [positions]);
  const filteredPositions = useMemo(() => (positions || []).filter(position =>
    (filterUnderlying === "all" || position.underlying === filterUnderlying) &&
    (filterExpiry === "all" || position.expiry === filterExpiry) &&
    (filterStrike === "all" || position.strike === filterStrike),
  ), [positions, filterUnderlying, filterExpiry, filterStrike]);

  const summary = useMemo(() => filteredPositions.reduce((totals, position) => {
    const market = getPositionMarketData({
      position,
      xautTickers,
      gldQuotes,
      gldSpot: gldPrice,
      formulas,
      settings,
    });
    const result = calculatePosition({
      position,
      market,
      xautSpot: xautPrice,
      gldSpot: gldPrice,
      xauSpot: xauPrice,
      formulas,
      settings,
    });
    totals.entryCost += result.entryCost;
    totals.currentValue += result.currentValue;
    totals.pnl += result.pnl;
    totals.delta += result.totalDeltaXau;
    totals.gamma += result.totalGammaXau;
    totals.theta += result.totalTheta;
    totals.vega += result.totalVega;
    if (market.estimated) totals.estimated += 1;
    if (!market.available) totals.unavailable += 1;
    return totals;
  }, { entryCost: 0, currentValue: 0, pnl: 0, delta: 0, gamma: 0, theta: 0, vega: 0, estimated: 0, unavailable: 0 }), [
    filteredPositions, xautTickers, gldQuotes, gldPrice, xautPrice, xauPrice, formulas, settings,
  ]);

  const pnlPercent = summary.entryCost !== 0 ? summary.pnl / Math.abs(summary.entryCost) * 100 : 0;

  const updateNumber = (key: keyof typeof settings, raw: string, fallback: number) => {
    const value = Number(raw);
    setSettings(current => ({ ...current, [key]: Number.isFinite(value) ? value : fallback }));
  };

  const updateOverride = (key: "xautSpotScaleOverride" | "gldSpotScaleOverride", raw: string) => {
    setSettings(current => ({ ...current, [key]: raw === "" ? null : Number(raw) }));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gold-gradient">黄金期权组合总览</h1>
          <p className="text-sm text-muted-foreground mt-1">估值统一为 USD；Delta / Gamma 统一映射到 XAU/USD 风险量纲</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <MarketRefreshButton />
          {summary.estimated > 0 && <Badge variant="outline" className="text-amber-400 border-amber-400/30">{summary.estimated} 个模型估算</Badge>}
          {summary.unavailable > 0 && <Badge variant="destructive">{summary.unavailable} 个行情不可用</Badge>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          ["XAUT/USDT", xautPrice, `${spotPrices?.xaut?.source || "等待数据源"}${spotPrices?.xaut?.stale ? "（缓存）" : ""}`],
          ["GLD/USD", gldPrice, `${spotPrices?.gld?.source || "等待数据源"}${spotPrices?.gld?.stale ? "（缓存）" : ""}`],
          ["XAU/USD 代理（GC=F）", xauPrice, `${spotPrices?.gold?.source || "等待数据源"}${spotPrices?.gold?.stale ? "（缓存/代理）" : ""}`],
        ].map(([label, value, source]) => (
          <Card className="glass-card" key={String(label)}>
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-lg font-semibold text-primary mt-1">{spotFetching && !value ? "加载中…" : showPrice(Number(value))}</p>
                <p className="text-[11px] text-muted-foreground mt-1">{source}</p>
              </div>
              <Activity className="w-5 h-5 text-primary opacity-60" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="glass-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">筛选与统一量纲参数</CardTitle>
            <Button variant="ghost" size="sm" className="gap-2" onClick={resetSettings}><RotateCcw className="w-3.5 h-3.5" />恢复参数</Button>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <Label className="text-xs text-muted-foreground">Underlying</Label>
            <Select value={filterUnderlying} onValueChange={setFilterUnderlying}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">全部</SelectItem><SelectItem value="XAUT">XAUT</SelectItem><SelectItem value="GLD">GLD</SelectItem></SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Expiry</Label>
            <Select value={filterExpiry} onValueChange={setFilterExpiry}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">全部到期日</SelectItem>{expiries.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Strike</Label>
            <Select value={filterStrike} onValueChange={setFilterStrike}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">全部行权价</SelectItem>{strikes.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">GLD 估算 IV</Label>
            <Input className="mt-1" type="number" step="0.01" min="0.01" value={settings.gldFallbackIv} onChange={event => updateNumber("gldFallbackIv", event.target.value, 0.2)} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">XAUT 合约乘数</Label>
            <Input className="mt-1" type="number" step="0.01" value={settings.xautContractMultiplier} onChange={event => updateNumber("xautContractMultiplier", event.target.value, 1)} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">GLD 合约乘数</Label>
            <Input className="mt-1" type="number" step="1" value={settings.gldContractMultiplier} onChange={event => updateNumber("gldContractMultiplier", event.target.value, 100)} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">XAUT→XAU 比例（留空自动）</Label>
            <Input className="mt-1" type="number" step="0.0001" placeholder={`自动 ${automaticXautScale.toFixed(4)}`} value={settings.xautSpotScaleOverride ?? ""} onChange={event => updateOverride("xautSpotScaleOverride", event.target.value)} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">GLD→XAU 比例（留空自动）</Label>
            <Input className="mt-1" type="number" step="0.0001" placeholder={`自动 ${automaticGldScale.toFixed(4)}`} value={settings.gldSpotScaleOverride ?? ""} onChange={event => updateOverride("gldSpotScaleOverride", event.target.value)} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">无风险利率</Label>
            <Input className="mt-1" type="number" step="0.001" value={settings.riskFreeRate} onChange={event => updateNumber("riskFreeRate", event.target.value, 0.045)} />
          </div>
          <div className="sm:col-span-2 lg:col-span-3 flex items-end">
            <p className="text-xs text-muted-foreground leading-relaxed">
              GLD 数据优先级：{sourceInfo?.gldPriority || "检查数据源中…"}。未取得真实 Greeks 时才使用可编辑的 Black-Scholes 公式估算；参数只保存在本浏览器。
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { label: "Total Entry Cost", value: money(summary.entryCost), Icon: DollarSign },
          { label: "Total Current Value", value: money(summary.currentValue), Icon: TrendingUp },
          { label: "P&L", value: `${summary.pnl >= 0 ? "+" : ""}${money(summary.pnl)} (${pnlPercent.toFixed(1)}%)`, Icon: BarChart3 },
        ].map(({ label, value, Icon }) => (
          <Card className="glass-card" key={label}>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2"><Icon className="w-4 h-4" />{label}</CardTitle></CardHeader>
            <CardContent><p className={`text-2xl font-bold ${label === "P&L" ? (summary.pnl >= 0 ? "text-green-400" : "text-red-400") : ""}`}>{value}</p></CardContent>
          </Card>
        ))}
      </div>

      <Card className="glass-card">
        <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Portfolio Greeks</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div><p className="text-xs text-muted-foreground uppercase">XAU Delta (Δ)</p><p className="text-xl font-semibold mt-1 font-mono">{summary.delta.toFixed(4)}</p></div>
          <div><p className="text-xs text-muted-foreground uppercase">XAU Gamma (Γ)</p><p className="text-xl font-semibold mt-1 font-mono">{summary.gamma.toFixed(6)}</p></div>
          <div><p className="text-xs text-muted-foreground uppercase">Theta / Day</p><p className="text-xl font-semibold mt-1 font-mono">{money(summary.theta)}</p></div>
          <div><p className="text-xs text-muted-foreground uppercase">Vega / 1% IV</p><p className="text-xl font-semibold mt-1 font-mono">{money(summary.vega)}</p></div>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">{posLoading ? "加载仓位中…" : `显示 ${filteredPositions.length} / ${positions?.length ?? 0} 个仓位`}</p>
    </div>
  );
}
