import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MARKET_QUERY_OPTIONS } from "@/lib/marketPolling";
import { CheckCircle2, ExternalLink, Loader2, ShieldAlert } from "lucide-react";

export default function DataSources() {
  const { data, isLoading } = trpc.market.sources.useQuery();
  const { data: spots, refetch, isFetching } = trpc.market.spotPrices.useQuery(undefined, MARKET_QUERY_OPTIONS);

  if (isLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gold-gradient">API 与数据来源</h1>
          <p className="text-sm text-muted-foreground mt-1">所有密钥仅由服务器读取，浏览器不会获得令牌</p>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>{isFetching && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}测试现价源</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: "XAUT/USDT", value: spots?.xaut },
          { label: "BTC/USDT", value: spots?.btc },
          { label: "ETH/USDT", value: spots?.eth },
          { label: "GLD/USD", value: spots?.gld },
          { label: "XAU/USD 代理", value: spots?.gold },
        ].map(({ label, value }) => {
          const price = value?.price ?? 0;
          const source = value?.source ?? "";
          const updated = value?.timestamp ? new Date(value.timestamp).toLocaleString("zh-CN", { hour12: false }) : "—";
          const status = value?.status === "realtime" ? "实时" : value?.status === "stale" ? "旧值/休市" : "延迟/休市";
          return <Card className="glass-card" key={label}><CardContent className="p-4"><div className="flex items-center gap-2"><span className="text-sm">{label}</span>{price ? <CheckCircle2 className="w-4 h-4 text-green-400" /> : <ShieldAlert className="w-4 h-4 text-amber-400" />}<Badge variant="outline" className="ml-auto text-[10px]">{status}</Badge></div><p className="text-xl font-semibold mt-2">{price ? `$${price.toFixed(2)}` : "不可用"}</p><p className="text-[11px] text-muted-foreground mt-1">{source || "请检查网络"}</p><p className="text-[10px] text-muted-foreground mt-1">更新时间：{updated}</p></CardContent></Card>;
        })}
      </div>

      <div className="space-y-3">
        {data?.sources.map(source => (
          <Card key={source.product} className="glass-card">
            <CardHeader className="pb-2"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><CardTitle className="text-base">{source.product}</CardTitle><Badge variant="outline">{source.mode}</Badge></div></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid grid-cols-1 md:grid-cols-[10rem_1fr] gap-1 md:gap-3"><span className="text-muted-foreground">Provider</span><span>{source.provider}</span><span className="text-muted-foreground">Endpoint</span><code className="text-xs break-all">{source.endpoint}</code><span className="text-muted-foreground">认证</span><span>{source.authentication}</span></div>
              <a href={source.documentationUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-primary hover:underline">官方/来源页面 <ExternalLink className="w-3.5 h-3.5" /></a>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className={data?.marketDataConfigured || data?.tradierConfigured ? "border-green-400/20 bg-green-400/5" : "border-amber-400/20 bg-amber-400/5"}>
        <CardContent className="p-4 text-sm leading-relaxed">
          <p className="font-medium">当前 GLD 优先级：{data?.gldPriority || "检测中"}</p>
          <p className="text-muted-foreground mt-1">推荐在服务器设置 <code>MARKETDATA_TOKEN</code> 并完成 OPRA 实时权限，可获得 GLD 逐合约低延迟 Bid/Ask、IV 与 Delta/Gamma/Theta/Vega；备用的 Tradier production token 可提供实时报价，但其 ORATS Greeks 官方标注约每小时更新。两者都未配置时，现价使用 Yahoo fallback，期权 Greeks 使用“公式管理”中的 Black-Scholes 估算。</p>
        </CardContent>
      </Card>
    </div>
  );
}
