import { Button } from "@/components/ui/button";
import { CandlestickChart, ExternalLink, Layers3, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
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

type SymbolValue = (typeof SYMBOLS)[number]["value"];

interface ChartSession {
  symbol: SymbolValue;
  interval: string;
  reloadKey: number;
}

const DEFAULT_SYMBOL: SymbolValue = "AMEX:GLD";
const DEFAULT_INTERVAL = "60";
const MAX_RETAINED_CHARTS = 3;

function TradingViewWidget({ active, session }: { active: boolean; session: ChartSession }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const tradingViewUrl = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(session.symbol)}`;

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
      symbol: session.symbol,
      interval: session.interval,
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
  }, [session.interval, session.reloadKey, session.symbol]);

  return (
    <div className={active ? "absolute inset-0" : "hidden"} aria-hidden={!active} data-chart-symbol={session.symbol}>
      {loading && <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-[#080c14]"><Loader2 className="h-7 w-7 animate-spin text-primary" /><p className="text-xs text-muted-foreground">正在加载 TradingView 图表…</p></div>}
      {loadError && <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[#080c14] p-6 text-center"><p className="text-sm text-red-300">TradingView 图表资源加载失败，可能被网络或内容拦截器阻止。</p><Button asChild size="sm"><a href={tradingViewUrl} target="_blank" rel="noopener noreferrer">直接打开 TradingView<ExternalLink className="ml-1 h-3.5 w-3.5" /></a></Button></div>}
      <div ref={containerRef} className="tradingview-widget-container h-full w-full" data-testid="tradingview-widget-container" />
    </div>
  );
}

export default function TradingViewChart() {
  const [symbol, setSymbol] = useState<SymbolValue>(DEFAULT_SYMBOL);
  const [sessions, setSessions] = useState<ChartSession[]>([
    { symbol: DEFAULT_SYMBOL, interval: DEFAULT_INTERVAL, reloadKey: 0 },
  ]);
  const activeSession = sessions.find(session => session.symbol === symbol) ?? sessions[sessions.length - 1];
  const activeInterval = activeSession?.interval ?? DEFAULT_INTERVAL;
  const tradingViewUrl = useMemo(() => `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`, [symbol]);

  const selectSymbol = (nextSymbol: SymbolValue) => {
    setSymbol(nextSymbol);
    setSessions(current => {
      const existing = current.find(session => session.symbol === nextSymbol);
      if (existing) return [...current.filter(session => session.symbol !== nextSymbol), existing];
      return [...current, { symbol: nextSymbol, interval: DEFAULT_INTERVAL, reloadKey: 0 }].slice(-MAX_RETAINED_CHARTS);
    });
  };

  const setActiveInterval = (nextInterval: string) => {
    setSessions(current => current.map(session => session.symbol === symbol ? { ...session, interval: nextInterval } : session));
  };

  const reloadActiveChart = () => {
    setSessions(current => current.map(session => session.symbol === symbol ? { ...session, reloadKey: session.reloadKey + 1 } : session));
  };

  return (
    <div className="flex h-[calc(100vh-7rem)] min-h-[620px] flex-col gap-2" data-testid="tradingview-chart-page">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border border-border/60 bg-card/40 px-2 py-1.5">
        <div className="mr-1 flex items-center gap-2">
          <CandlestickChart className="h-4 w-4 text-primary" />
          <div><h1 className="text-xs font-semibold">TradingView K线图</h1><p className="text-[9px] text-muted-foreground">图表资源仅在本页打开时加载</p></div>
        </div>
        <label className="flex items-center gap-1 text-[9px] text-muted-foreground">
          <span>SYMBOL</span>
          <select aria-label="TradingView symbol" className="h-7 min-w-48 border border-border bg-background px-2 font-mono text-[10px] text-foreground" value={symbol} onChange={event => selectSymbol(event.target.value as SymbolValue)}>
            {SYMBOLS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 text-[9px] text-muted-foreground">
          <span>INTERVAL</span>
          <select aria-label="TradingView interval" className="h-7 border border-border bg-background px-2 font-mono text-[10px] text-foreground" value={activeInterval} onChange={event => setActiveInterval(event.target.value)} title="切换周期会重载当前标的，并清除该标的的临时画线">
            {INTERVALS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <Button type="button" variant="outline" size="sm" className="h-7 gap-1 px-2 text-[10px]" onClick={reloadActiveChart} title="刷新会清除当前标的的临时画线"><RefreshCw className="h-3 w-3" />刷新图表</Button>
        <div className="flex h-7 items-center gap-1 border border-border/60 bg-background/70 px-2 font-mono text-[9px] text-muted-foreground" title={`最多保留 ${MAX_RETAINED_CHARTS} 个标的；超过上限后会移除最早打开的标的`}>
          <Layers3 className="h-3 w-3 text-primary" />临时画线缓存 {sessions.length}/{MAX_RETAINED_CHARTS}
        </div>
        <Button asChild size="sm" className="ml-auto h-7 gap-1 px-2 text-[10px]"><a href={tradingViewUrl} target="_blank" rel="noopener noreferrer">在 TradingView 中打开<ExternalLink className="h-3 w-3" /></a></Button>
      </header>

      <section className="relative min-h-0 flex-1 overflow-hidden border border-border/70 bg-[#080c14]" aria-label="TradingView advanced chart">
        {sessions.map(session => <TradingViewWidget key={session.symbol} active={session.symbol === symbol} session={session} />)}
      </section>

      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border border-border/50 bg-card/30 px-2 py-1 text-[9px] text-muted-foreground">
        <span className="flex items-center gap-1"><ShieldCheck className="h-3 w-3 text-emerald-300" />画线仅在当前K线页会话内临时保留；刷新页面、离开本页、切换周期或刷新当前图表会清除。不会保存或共享 TradingView 密码。</span>
        <a className="text-primary hover:underline" href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">图表由 TradingView 提供</a>
      </footer>
    </div>
  );
}
