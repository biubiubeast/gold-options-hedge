import { Button } from "@/components/ui/button";
import { CandlestickChart, ExternalLink, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

const SYMBOLS = [
  { value: "AMEX:GLD", label: "GLD/USD · NYSE Arca" },
  { value: "OANDA:XAUUSD", label: "XAU/USD · OANDA" },
  { value: "BYBIT:XAUTUSDT", label: "XAUT/USDT · Bybit" },
  { value: "BYBIT:BTCUSDT", label: "BTC/USDT · Bybit" },
  { value: "BYBIT:ETHUSDT", label: "ETH/USDT · Bybit" },
  { value: "DERIBIT:BTCUSD", label: "BTC/USD · Deribit" },
  { value: "DERIBIT:ETHUSD", label: "ETH/USD · Deribit" },
] as const;

const INTERVALS = [
  { value: "1", label: "1m" },
  { value: "5", label: "5m" },
  { value: "15", label: "15m" },
  { value: "60", label: "1h" },
  { value: "240", label: "4h" },
  { value: "D", label: "1D" },
  { value: "W", label: "1W" },
] as const;

export default function TradingViewChart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [symbol, setSymbol] = useState<(typeof SYMBOLS)[number]["value"]>("AMEX:GLD");
  const [interval, setInterval] = useState("60");
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const tradingViewUrl = useMemo(() => `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`, [symbol]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setLoading(true);
    setLoadError(false);
    container.replaceChildren();

    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget h-full w-full";
    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.textContent = JSON.stringify({
      autosize: true,
      symbol,
      interval,
      timezone: "Asia/Hong_Kong",
      theme: "dark",
      style: "1",
      locale: "zh_CN",
      backgroundColor: "rgba(8, 12, 20, 1)",
      gridColor: "rgba(42, 46, 57, 0.35)",
      hide_top_toolbar: false,
      hide_side_toolbar: false,
      allow_symbol_change: true,
      save_image: true,
      calendar: false,
      support_host: "https://www.tradingview.com",
    });
    script.onload = () => setLoading(false);
    script.onerror = () => {
      setLoading(false);
      setLoadError(true);
    };
    container.append(widget, script);

    const timeout = window.setTimeout(() => setLoading(false), 12_000);
    return () => {
      window.clearTimeout(timeout);
      container.replaceChildren();
    };
  }, [interval, reloadKey, symbol]);

  return (
    <div className="flex h-[calc(100vh-7rem)] min-h-[620px] flex-col gap-2" data-testid="tradingview-chart-page">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border border-border/60 bg-card/40 px-2 py-1.5">
        <div className="mr-1 flex items-center gap-2">
          <CandlestickChart className="h-4 w-4 text-primary" />
          <div><h1 className="text-xs font-semibold">TradingView K线图</h1><p className="text-[9px] text-muted-foreground">图表资源仅在本页打开时加载</p></div>
        </div>
        <label className="flex items-center gap-1 text-[9px] text-muted-foreground">
          <span>SYMBOL</span>
          <select aria-label="TradingView symbol" className="h-7 min-w-48 border border-border bg-background px-2 font-mono text-[10px] text-foreground" value={symbol} onChange={event => setSymbol(event.target.value as typeof symbol)}>
            {SYMBOLS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 text-[9px] text-muted-foreground">
          <span>INTERVAL</span>
          <select aria-label="TradingView interval" className="h-7 border border-border bg-background px-2 font-mono text-[10px] text-foreground" value={interval} onChange={event => setInterval(event.target.value)}>
            {INTERVALS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <Button type="button" variant="outline" size="sm" className="h-7 gap-1 px-2 text-[10px]" onClick={() => setReloadKey(value => value + 1)}><RefreshCw className="h-3 w-3" />刷新图表</Button>
        <Button asChild size="sm" className="ml-auto h-7 gap-1 px-2 text-[10px]"><a href={tradingViewUrl} target="_blank" rel="noopener noreferrer">在 TradingView 中打开<ExternalLink className="h-3 w-3" /></a></Button>
      </header>

      <section className="relative min-h-0 flex-1 overflow-hidden border border-border/70 bg-[#080c14]" aria-label="TradingView advanced chart">
        {loading && <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-[#080c14]"><Loader2 className="h-7 w-7 animate-spin text-primary" /><p className="text-xs text-muted-foreground">正在加载 TradingView 图表…</p></div>}
        {loadError && <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[#080c14] p-6 text-center"><p className="text-sm text-red-300">TradingView 图表资源加载失败，可能被网络或内容拦截器阻止。</p><Button asChild size="sm"><a href={tradingViewUrl} target="_blank" rel="noopener noreferrer">直接打开 TradingView<ExternalLink className="ml-1 h-3.5 w-3.5" /></a></Button></div>}
        <div ref={containerRef} className="tradingview-widget-container h-full w-full" data-testid="tradingview-widget-container" />
      </section>

      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border border-border/50 bg-card/30 px-2 py-1 text-[9px] text-muted-foreground">
        <span className="flex items-center gap-1"><ShieldCheck className="h-3 w-3 text-emerald-300" />不会在 Cronus 中保存或共享 TradingView 密码；官网按钮使用你自己的 TradingView 登录会话。</span>
        <a className="text-primary hover:underline" href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">图表由 TradingView 提供</a>
      </footer>
    </div>
  );
}
