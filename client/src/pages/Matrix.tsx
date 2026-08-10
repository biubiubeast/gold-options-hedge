import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Maximize2, Minimize2, Scan, ZoomIn, ZoomOut } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { getPositionMarketData, type MarketSnapshot, type PortfolioPosition } from "@/lib/portfolio";
import { usePortfolioSettings } from "@/hooks/usePortfolioSettings";

type MatrixMetric = "all" | "delta" | "markPrice" | "markIv" | "quantity";
type HeatmapMode = "delta" | "absDelta" | "off";
type PositionView = { position: PortfolioPosition; market: MarketSnapshot };

const MATRIX_ZOOM_KEY = "matrix-zoom";
const MATRIX_METRIC_KEY = "matrix-metric";
const HEATMAP_MODE_KEY = "matrix-heatmap-mode";
const MATRIX_AUTO_FIT_KEY = "matrix-auto-fit";
const MIN_MATRIX_ZOOM = 0.2;
const MAX_MATRIX_ZOOM = 1.5;

const clampMatrixZoom = (value: number) => Math.min(MAX_MATRIX_ZOOM, Math.max(MIN_MATRIX_ZOOM, value));

const metricLabels: Record<MatrixMetric, string> = {
  all: "全部数据",
  delta: "Delta",
  markPrice: "Mark Price",
  markIv: "Mark IV",
  quantity: "持仓数量",
};

function loadChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const saved = localStorage.getItem(key) as T | null;
  return saved && allowed.includes(saved) ? saved : fallback;
}

function metricValue(view: PositionView, metric: MatrixMetric) {
  switch (metric) {
    case "delta": return { label: "Delta", value: view.market.delta.toFixed(4) };
    case "markPrice": return { label: "Mark Price", value: view.market.available ? view.market.markPrice.toFixed(4) : "—" };
    case "markIv": return { label: "Mark IV", value: view.market.markIv > 0 ? `${(view.market.markIv * 100).toFixed(2)}%` : "—" };
    case "quantity": return { label: "Quantity", value: view.position.quantity };
    default: return { label: "", value: "" };
  }
}

export default function Matrix() {
  const { data: positions, isLoading } = trpc.positions.list.useQuery();
  const { data: formulas } = trpc.formulas.list.useQuery();
  const { data: xautTickers } = trpc.market.xautTickers.useQuery(undefined, { refetchInterval: 10_000 });
  const { data: spotPrices } = trpc.market.spotPrices.useQuery(undefined, { refetchInterval: 10_000 });
  const gldExpiries = useMemo(() => [...new Set((positions || [])
    .filter(position => position.underlying === "GLD")
    .map(position => position.expiry))], [positions]);
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
  const { settings } = usePortfolioSettings();
  const [, navigate] = useLocation();
  const matrixViewportRef = useRef<HTMLDivElement>(null);

  const [underlying, setUnderlying] = useState<"all" | "XAUT" | "GLD">("all");
  const [metric, setMetric] = useState<MatrixMetric>(() => loadChoice(MATRIX_METRIC_KEY, ["all", "delta", "markPrice", "markIv", "quantity"] as const, "all"));
  const [heatmapMode, setHeatmapMode] = useState<HeatmapMode>(() => loadChoice(HEATMAP_MODE_KEY, ["delta", "absDelta", "off"] as const, "delta"));
  const [matrixZoom, setMatrixZoom] = useState(() => {
    const saved = Number(localStorage.getItem(MATRIX_ZOOM_KEY));
    return Number.isFinite(saved) && saved > 0 ? clampMatrixZoom(saved) : 1;
  });
  const [autoFit, setAutoFit] = useState(() => localStorage.getItem(MATRIX_AUTO_FIT_KEY) !== "false");
  const [fallbackFullscreen, setFallbackFullscreen] = useState(false);

  useEffect(() => localStorage.setItem(MATRIX_ZOOM_KEY, String(matrixZoom)), [matrixZoom]);
  useEffect(() => localStorage.setItem(MATRIX_METRIC_KEY, metric), [metric]);
  useEffect(() => localStorage.setItem(HEATMAP_MODE_KEY, heatmapMode), [heatmapMode]);
  useEffect(() => localStorage.setItem(MATRIX_AUTO_FIT_KEY, String(autoFit)), [autoFit]);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFallbackFullscreen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const filtered = useMemo(() => (positions || []).filter(position =>
    underlying === "all" || position.underlying === underlying,
  ), [positions, underlying]);

  const positionViews = useMemo<PositionView[]>(() => filtered.map(position => ({
    position,
    market: getPositionMarketData({
      position,
      xautTickers,
      gldQuotes,
      gldSpot: spotPrices?.gld?.price ?? 0,
      formulas,
      settings,
    }),
  })), [filtered, xautTickers, gldQuotes, spotPrices?.gld?.price, formulas, settings]);

  const { expiries, strikes, matrix } = useMemo(() => {
    const expirySet = new Set<string>();
    const strikeSet = new Set<string>();
    const cells: Record<string, PositionView[]> = {};
    for (const view of positionViews) {
      expirySet.add(view.position.expiry);
      strikeSet.add(view.position.strike);
      const key = `${view.position.expiry}|${view.position.strike}`;
      (cells[key] ||= []).push(view);
    }
    for (const views of Object.values(cells)) {
      views.sort((a, b) => b.market.delta - a.market.delta);
    }
    return {
      expiries: [...expirySet].sort(),
      strikes: [...strikeSet].sort((a, b) => Number(a) - Number(b)),
      matrix: cells,
    };
  }, [positionViews]);

  const heatRange = useMemo(() => {
    if (positionViews.length === 0 || heatmapMode === "off") return { min: 0, max: 0 };
    const values = positionViews.map(view => heatmapMode === "absDelta" ? Math.abs(view.market.delta) : view.market.delta);
    return { min: Math.min(...values), max: Math.max(...values) };
  }, [positionViews, heatmapMode]);

  const heatStyle = (view: PositionView): CSSProperties | undefined => {
    if (heatmapMode === "off") return undefined;
    const value = heatmapMode === "absDelta" ? Math.abs(view.market.delta) : view.market.delta;
    const normalized = heatRange.max === heatRange.min ? 0.6 : (value - heatRange.min) / (heatRange.max - heatRange.min);
    const backgroundAlpha = 0.08 + normalized * 0.62;
    const borderAlpha = 0.22 + normalized * 0.62;
    return {
      background: `linear-gradient(145deg, rgba(217, 168, 58, ${backgroundAlpha.toFixed(3)}), rgba(94, 61, 17, ${(backgroundAlpha * 0.72).toFixed(3)}))`,
      borderColor: `rgba(236, 190, 82, ${borderAlpha.toFixed(3)})`,
    };
  };

  const fitMatrix = useCallback((smooth = false) => {
    const viewport = matrixViewportRef.current;
    const viewportWidth = viewport?.clientWidth ?? window.innerWidth;
    const viewportHeight = Math.max(240, Math.min(viewport?.clientHeight || window.innerHeight, window.innerHeight - 220));
    const estimatedMatrixWidth = 112 + expiries.length * 264;
    const estimatedMatrixHeight = 52 + strikes.reduce((total, strike) => {
      const maxTiles = Math.max(1, ...expiries.map(expiry => matrix[`${expiry}|${strike}`]?.length || 0));
      return total + Math.max(160, 16 + maxTiles * 136 + Math.max(0, maxTiles - 1) * 8) + 8;
    }, 0);
    const nextZoom = clampMatrixZoom(Number(Math.min(
      1,
      viewportWidth / Math.max(estimatedMatrixWidth, 1),
      viewportHeight / Math.max(estimatedMatrixHeight, 1),
    ).toFixed(2)));
    setMatrixZoom(current => current === nextZoom ? current : nextZoom);
    viewport?.scrollTo({ left: 0, top: 0, behavior: smooth ? "smooth" : "auto" });
  }, [expiries, strikes, matrix]);

  useEffect(() => {
    if (!autoFit || positionViews.length === 0) return;
    const frame = requestAnimationFrame(() => fitMatrix());
    const viewport = matrixViewportRef.current;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => fitMatrix());
    if (viewport && observer) observer.observe(viewport);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [autoFit, fallbackFullscreen, fitMatrix, positionViews.length]);

  const openFullscreen = () => setFallbackFullscreen(current => !current);

  if (isLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-end 2xl:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gold-gradient">期权矩阵与 Delta 热力图</h1>
          <p className="text-sm text-muted-foreground mt-1">列为 Expiry，行为 Strike；同一方格内按 Delta 从高到低排列</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-36">
            <span className="block text-[11px] text-muted-foreground mb-1">方块显示字段</span>
            <Select value={metric} onValueChange={(value: MatrixMetric) => setMetric(value)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(metricLabels) as MatrixMetric[]).map(value => <SelectItem key={value} value={value}>{metricLabels[value]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-44">
            <span className="block text-[11px] text-muted-foreground mb-1">热力颜色</span>
            <Select value={heatmapMode} onValueChange={(value: HeatmapMode) => setHeatmapMode(value)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="delta">Delta 高 → 低</SelectItem>
                <SelectItem value="absDelta">|Delta| 风险强度</SelectItem>
                <SelectItem value="off">关闭热力颜色</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-1">
            {(["all", "XAUT", "GLD"] as const).map(value => (
              <Button key={value} size="sm" className="h-9" variant={underlying === value ? "default" : "outline"} onClick={() => setUnderlying(value)}>
                {value === "all" ? "全部" : value}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className={`matrix-fullscreen-shell space-y-4 rounded-lg bg-background p-1 sm:p-2 ${fallbackFullscreen ? "matrix-pseudo-fullscreen" : ""}`}>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/50 bg-card/50 p-3">
          <div className="flex items-center gap-3">
            {heatmapMode !== "off" ? (
              <>
                <span className="text-xs text-muted-foreground">{heatmapMode === "absDelta" ? "|Delta|" : "Delta"} 低</span>
                <div className="h-3 w-36 sm:w-52 rounded-full border border-primary/20 bg-[linear-gradient(90deg,rgba(217,168,58,0.08),rgba(217,168,58,0.7))]" aria-hidden="true" />
                <span className="text-xs text-muted-foreground">高</span>
                <span className="hidden sm:inline text-[11px] font-mono text-muted-foreground">{heatRange.min.toFixed(3)} → {heatRange.max.toFixed(3)}</span>
              </>
            ) : <span className="text-xs text-muted-foreground">热力颜色已关闭</span>}
          </div>
          <div className="flex items-center gap-1" role="group" aria-label="矩阵缩放">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => { setAutoFit(false); setMatrixZoom(current => clampMatrixZoom(Number((current - 0.1).toFixed(2)))); }} disabled={matrixZoom <= MIN_MATRIX_ZOOM} title="缩小矩阵，最低 20%" aria-label="缩小矩阵"><ZoomOut className="w-4 h-4" /></Button>
            <button type="button" onClick={() => { setAutoFit(false); setMatrixZoom(1); }} className="h-8 min-w-14 rounded-md px-2 text-xs font-mono hover:bg-accent" title="恢复矩阵 100%">{Math.round(matrixZoom * 100)}%</button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => { setAutoFit(false); setMatrixZoom(current => clampMatrixZoom(Number((current + 0.1).toFixed(2)))); }} disabled={matrixZoom >= MAX_MATRIX_ZOOM} title="放大矩阵" aria-label="放大矩阵"><ZoomIn className="w-4 h-4" /></Button>
            <Button variant={autoFit ? "default" : "outline"} size="sm" className="h-8 gap-1.5" onClick={() => { setAutoFit(true); fitMatrix(true); }} title="自动缩放到一次看到完整热力图"><Scan className="w-3.5 h-3.5" />自动全图</Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={openFullscreen} title={fallbackFullscreen ? "退出全屏热力图" : "全屏查看热力图"} aria-label={fallbackFullscreen ? "退出全屏热力图" : "全屏查看热力图"}>{fallbackFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}</Button>
          </div>
        </div>
        {positionViews.length === 0 ? (
          <Card className="glass-card"><CardContent className="p-12 text-center text-muted-foreground">暂无仓位数据。请先在“仓位管理”页面添加期权持仓。</CardContent></Card>
        ) : (
          <div ref={matrixViewportRef} className="matrix-viewport max-h-[calc(100vh-13rem)] overflow-auto overscroll-contain pb-3">
            <div className="min-w-fit origin-top-left" style={{ zoom: matrixZoom } as CSSProperties}>
              <div className="sticky top-0 z-20 flex gap-2 mb-2 bg-background/95 py-2 backdrop-blur">
                <div className="sticky left-0 z-30 w-28 shrink-0 flex items-end bg-background/95 pb-1"><span className="text-xs text-muted-foreground font-medium">Strike ↓ / Expiry →</span></div>
                {expiries.map(expiry => <div key={expiry} className="w-64 shrink-0 text-center"><Badge variant="outline" className="text-xs font-mono bg-background/90">{expiry}</Badge></div>)}
              </div>
              {strikes.map(strike => (
                <div key={strike} className="flex gap-2 mb-2 items-stretch">
                  <div className="sticky left-0 z-10 w-28 shrink-0 flex items-start bg-background/95 pt-4"><span className="text-sm font-mono font-medium text-primary">{strike}</span></div>
                  {expiries.map(expiry => {
                    const key = `${expiry}|${strike}`;
                    const cellViews = matrix[key] || [];
                    return (
                      <div key={key} className="w-64 shrink-0 min-h-40 rounded-lg border border-border/30 bg-secondary/10 p-2 space-y-2">
                        {cellViews.length === 0 ? <div className="h-full min-h-36 flex items-center justify-center text-muted-foreground/50">—</div> : cellViews.map(view => {
                          const { position, market } = view;
                          const selectedMetric = metricValue(view, metric);
                          return (
                            <button
                              type="button"
                              key={position.id}
                              className="matrix-option-tile w-full min-h-32 rounded-md border border-border/50 bg-card/90 p-3 text-left hover:border-primary hover:brightness-110 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                              style={heatStyle(view)}
                              onClick={() => navigate(`/option/${position.id}`)}
                              title={`${position.underlying} ${position.strike} ${position.optionType.toUpperCase()} · Delta ${market.delta.toFixed(4)}`}
                            >
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-1.5">
                                  <Badge variant={position.underlying === "XAUT" ? "default" : "secondary"} className="text-[10px] px-1.5 py-0">{position.underlying}</Badge>
                                  {market.estimated && <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-amber-300 border-amber-300/40 bg-background/30">估算</Badge>}
                                </div>
                                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 bg-background/30 ${position.optionType === "call" ? "text-green-300" : "text-red-300"}`}>{position.optionType.toUpperCase()}</Badge>
                              </div>
                              {metric === "all" ? (
                                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                                  <span className="text-foreground/65">Mark</span><span className="font-mono text-right">{market.available ? market.markPrice.toFixed(3) : "—"}</span>
                                  <span className="text-foreground/65">IV</span><span className="font-mono text-right">{market.markIv > 0 ? `${(market.markIv * 100).toFixed(1)}%` : "—"}</span>
                                  <span className="text-foreground/65">Bid / Ask</span><span className="font-mono text-right">{market.bid1 > 0 || market.ask1 > 0 ? `${market.bid1.toFixed(2)} / ${market.ask1.toFixed(2)}` : "—"}</span>
                                  <span className="text-foreground/65">Qty</span><span className="font-mono text-right">{position.quantity}</span>
                                  <span className="text-foreground/65">Delta</span><span className="font-mono text-right">{market.delta.toFixed(4)}</span>
                                </div>
                              ) : (
                                <div className="flex min-h-20 flex-col items-center justify-center text-center">
                                  <span className="text-[11px] uppercase tracking-wider text-foreground/65">{selectedMetric.label}</span>
                                  <strong className="mt-1 font-mono text-2xl font-semibold text-foreground">{selectedMetric.value}</strong>
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
