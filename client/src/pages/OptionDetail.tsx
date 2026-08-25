import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft } from "lucide-react";
import { useParams, useLocation } from "wouter";
import { calculatePosition, getPositionMarketData } from "@/lib/portfolio";
import { MARKET_QUERY_OPTIONS } from "@/lib/marketPolling";
import { usePortfolioSettings } from "@/hooks/usePortfolioSettings";

const money = (value: number) => new Intl.NumberFormat("zh-CN", { style: "currency", currency: "USD" }).format(value);

export default function OptionDetail() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const positionId = Number(params.id || 0);
  const { data: position, isLoading } = trpc.positions.get.useQuery({ id: positionId }, { enabled: positionId > 0 });
  const { data: formulas } = trpc.formulas.list.useQuery();
  const { data: xautTickers } = trpc.market.xautTickers.useQuery(undefined, MARKET_QUERY_OPTIONS);
  const { data: btcTickers } = trpc.market.btcTickers.useQuery(undefined, MARKET_QUERY_OPTIONS);
  const { data: spotPrices } = trpc.market.spotPrices.useQuery(undefined, MARKET_QUERY_OPTIONS);
  const { data: gldQuotes } = trpc.market.gldOptionQuotes.useQuery(
    {
      expiries: position?.underlying === "GLD" ? [position.expiry] : [],
      contracts: position?.underlying === "GLD" ? [{
        expiry: position.expiry,
        strike: Number(position.strike),
        optionType: position.optionType,
      }] : [],
    },
    { ...MARKET_QUERY_OPTIONS, enabled: position?.underlying === "GLD" },
  );
  const { settings } = usePortfolioSettings();

  if (isLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  if (!position) return (
    <div className="space-y-6">
      <Button variant="ghost" onClick={() => navigate("/matrix")} className="gap-2"><ArrowLeft className="w-4 h-4" />返回矩阵</Button>
      <p className="text-muted-foreground">仓位未找到</p>
    </div>
  );

  const market = getPositionMarketData({
    position,
    xautTickers,
    btcTickers,
    gldQuotes,
    gldSpot: spotPrices?.gld?.price ?? 0,
    formulas,
    settings,
  });
  const calculated = calculatePosition({
    position,
    market,
    xautSpot: spotPrices?.xaut?.price ?? 0,
    btcSpot: spotPrices?.btc?.price ?? 0,
    gldSpot: spotPrices?.gld?.price ?? 0,
    xauSpot: spotPrices?.gold?.price ?? 0,
    formulas,
    settings,
  });

  const marketRows = [
    ["Mark Price", market.available ? market.markPrice.toFixed(4) : "—"],
    ["Mark IV", market.markIv > 0 ? `${(market.markIv * 100).toFixed(2)}%` : "—"],
    ["Bid 1", market.bid1 > 0 ? market.bid1.toFixed(4) : "—"],
    ["Ask 1", market.ask1 > 0 ? market.ask1.toFixed(4) : "—"],
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/matrix")}><ArrowLeft className="w-5 h-5" /></Button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gold-gradient">期权详情</h1>
            {market.estimated && <Badge variant="outline" className="text-amber-400 border-amber-400/30">模型估算</Badge>}
          </div>
          <p className="text-sm text-muted-foreground mt-1">{position.underlying} {position.strike} {position.optionType.toUpperCase()} · {position.expiry}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="glass-card">
          <CardHeader className="pb-3"><CardTitle className="text-sm text-muted-foreground">持仓信息</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {[
              ["Underlying", position.underlying], ["Type", position.optionType.toUpperCase()], ["Strike", position.strike],
              ["Expiry", position.expiry], ["Quantity", position.quantity], ["Entry Price", position.entryPrice],
              ["Fee", position.fee], ["Entry Delta", position.entryDelta], ["Contract Multiplier", calculated.contractMultiplier.toString()],
            ].map(([label, value]) => <div className="flex justify-between" key={label}><span className="text-muted-foreground">{label}</span><span className="font-mono">{value}</span></div>)}
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardHeader className="pb-3"><CardTitle className="text-sm text-muted-foreground">市场数据</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {marketRows.map(([label, value]) => <div className="flex justify-between" key={label}><span className="text-muted-foreground">{label}</span><span className="font-mono">{value}</span></div>)}
            <div className="flex justify-between items-center"><span className="text-muted-foreground">数据来源</span><Badge variant="outline">{market.source}</Badge></div>
          </CardContent>
        </Card>
      </div>

      <Card className="glass-card">
        <CardHeader className="pb-3"><CardTitle className="text-sm text-muted-foreground">Greeks（单位值 / 持仓合计）</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div><p className="text-xs text-muted-foreground uppercase">Delta (Δ)</p><p className="text-lg font-semibold mt-1 font-mono">{market.delta.toFixed(6)}</p><p className="text-xs text-primary mt-1">Raw Total: {calculated.totalDeltaRaw.toFixed(4)}</p><p className="text-xs text-muted-foreground">XAU Total: {calculated.totalDeltaXau.toFixed(4)}</p></div>
          <div><p className="text-xs text-muted-foreground uppercase">Gamma (Γ)</p><p className="text-lg font-semibold mt-1 font-mono">{market.gamma.toFixed(8)}</p><p className="text-xs text-primary mt-1">Raw Total: {calculated.totalGammaRaw.toFixed(6)}</p><p className="text-xs text-muted-foreground">XAU Total: {calculated.totalGammaXau.toFixed(6)}</p></div>
          <div><p className="text-xs text-muted-foreground uppercase">Theta / Day</p><p className="text-lg font-semibold mt-1 font-mono">{market.theta.toFixed(6)}</p><p className="text-xs text-primary mt-1">Total: {money(calculated.totalTheta)}</p></div>
          <div><p className="text-xs text-muted-foreground uppercase">Vega / 1% IV</p><p className="text-lg font-semibold mt-1 font-mono">{market.vega.toFixed(6)}</p><p className="text-xs text-primary mt-1">Total: {money(calculated.totalVega)}</p></div>
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardHeader className="pb-3"><CardTitle className="text-sm text-muted-foreground">估值（USD / USDT 近似等值）</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div><p className="text-xs text-muted-foreground uppercase">Entry Cost</p><p className="text-xl font-semibold mt-1">{money(calculated.entryCost)}</p></div>
          <div><p className="text-xs text-muted-foreground uppercase">Current Value</p><p className="text-xl font-semibold mt-1">{money(calculated.currentValue)}</p></div>
          <div><p className="text-xs text-muted-foreground uppercase">P&L</p><p className={`text-xl font-semibold mt-1 ${calculated.pnl >= 0 ? "text-green-400" : "text-red-400"}`}>{calculated.pnl >= 0 ? "+" : ""}{money(calculated.pnl)}</p></div>
        </CardContent>
      </Card>
    </div>
  );
}
