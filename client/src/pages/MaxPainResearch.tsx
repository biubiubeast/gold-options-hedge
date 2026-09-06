import { MaxPainCandlestickChart } from "@/components/MaxPainCandlestickChart";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useMaxPainResearch } from "@/hooks/useMaxPainResearch";
import { usePortfolioSettings } from "@/hooks/usePortfolioSettings";
import {
  MAX_INTRADAY_QUERY_DAYS,
  OBSERVATION_HOURS,
  SIGNALPLUS_EARLIEST_VERIFIED_DATE,
  backtestMaxPain,
  calculateGrossGammaZone,
  nearestClose,
  selectIntradayExpiry,
  type MaxPainExpiryPolicy,
  type ObservationHour,
  type OptionProduct,
  type ResearchKlineInterval,
} from "@shared/maxPainResearch";
import {
  AlertTriangle,
  BarChart3,
  Calculator,
  Database,
  FlaskConical,
  Info,
  Loader2,
  Sigma,
  Target,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

function utcDate(daysAgo: number) {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

function money(value?: number) {
  return value === undefined || !Number.isFinite(value)
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(value);
}

function percent(value?: number) {
  return value === undefined || !Number.isFinite(value)
    ? "—"
    : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

const EXPIRIES: Array<{ value: MaxPainExpiryPolicy; label: string }> = [
  { value: "front", label: "最近到期" },
  { value: "daily", label: "当日到期" },
  { value: "weekly", label: "最近周五" },
  { value: "monthly", label: "最近月度" },
];

const PRODUCTS: Array<{ value: OptionProduct; label: string }> = [
  { value: "combined", label: "Combined" },
  { value: "inverse", label: "Inverse BTC" },
  { value: "linear", label: "Linear USDC" },
];

const INTERVALS: ResearchKlineInterval[] = ["1h", "4h", "12h", "1d"];

function SegmentedButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-3 py-2 text-xs transition-colors ${
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

export default function MaxPainResearch() {
  const { settings } = usePortfolioSettings();
  const sections = settings.maxPainVisibleSections;
  const [startDate, setStartDate] = useState(utcDate(7));
  const [endDate, setEndDate] = useState(utcDate(1));
  const [interval, setInterval] = useState<ResearchKlineInterval>("4h");
  const [product, setProduct] = useState<OptionProduct>("combined");
  const [expiryPolicy, setExpiryPolicy] =
    useState<MaxPainExpiryPolicy>("front");
  const [selectedMaturity, setSelectedMaturity] = useState("policy");
  const [backtestHour, setBacktestHour] = useState<ObservationHour>(0);
  const [showMaxPain, setShowMaxPain] = useState(true);
  const [showGamma, setShowGamma] = useState(true);
  const [validationError, setValidationError] = useState<string>();
  const research = useMaxPainResearch();

  const allPoints = useMemo(
    () => research.days.flatMap(day => day.points),
    [research.days]
  );
  const availableMaturities = useMemo(
    () =>
      [
        ...new Set(
          allPoints
            .filter(point => point.product === product)
            .map(point => point.maturity)
        ),
      ].sort(),
    [allPoints, product]
  );
  const selectedPoints = useMemo(() => {
    const productPoints = allPoints.filter(
      point =>
        point.product === product &&
        Date.parse(`${point.maturity}T08:00:00Z`) > point.timestamp
    );
    if (selectedMaturity !== "policy") {
      return productPoints
        .filter(point => point.maturity === selectedMaturity)
        .sort((a, b) => a.timestamp - b.timestamp);
    }
    return selectIntradayExpiry(productPoints, expiryPolicy);
  }, [allPoints, expiryPolicy, product, selectedMaturity]);

  useEffect(() => {
    if (
      !research.loading &&
      research.days.length > 0 &&
      selectedMaturity !== "policy" &&
      !availableMaturities.includes(selectedMaturity)
    )
      setSelectedMaturity("policy");
  }, [
    availableMaturities,
    research.days.length,
    research.loading,
    selectedMaturity,
  ]);

  const selectedAtZero = useMemo(
    () =>
      new Map(
        selectedPoints
          .filter(point => point.hourUtc === 0)
          .map(point => [point.date, point])
      ),
    [selectedPoints]
  );
  const gammaZones = useMemo(() => {
    if (!research.market) return [];
    return research.days.flatMap(day => {
      const selected = selectedAtZero.get(day.date);
      if (!selected) return [];
      const book = day.gammaBooksAtZero.find(
        candidate =>
          candidate.product === product &&
          candidate.maturity === selected.maturity
      );
      if (!book) return [];
      const zone = calculateGrossGammaZone(
        day.date,
        book,
        research.market!.hourlyKlines
      );
      return zone ? [zone] : [];
    });
  }, [product, research.days, research.market, selectedAtZero]);
  const backtest = useMemo(
    () =>
      research.market
        ? backtestMaxPain(
            selectedPoints,
            research.market.hourlyKlines,
            backtestHour
          )
        : undefined,
    [backtestHour, research.market, selectedPoints]
  );

  const run = (presetDays?: number) => {
    let nextStart = startDate;
    let nextEnd = endDate;
    if (presetDays) {
      nextEnd = utcDate(1);
      nextStart = utcDate(presetDays);
      setStartDate(nextStart);
      setEndDate(nextEnd);
    }
    const start = Date.parse(`${nextStart}T00:00:00Z`);
    const end = Date.parse(`${nextEnd}T00:00:00Z`);
    const days = Math.floor((end - start) / 86_400_000) + 1;
    if (!Number.isFinite(days) || days < 1 || days > MAX_INTRADAY_QUERY_DAYS) {
      setValidationError(`一次计算必须选择 1-${MAX_INTRADAY_QUERY_DAYS} 天。`);
      return;
    }
    if (nextStart < SIGNALPLUS_EARLIEST_VERIFIED_DATE || end > Date.now()) {
      setValidationError(
        `可选历史从 ${SIGNALPLUS_EARLIEST_VERIFIED_DATE} 开始，结束日期不能晚于今天。`
      );
      return;
    }
    setValidationError(undefined);
    void research.calculate(nextStart, nextEnd, interval);
  };

  const latest = selectedPoints.at(-1);
  const latestSpot =
    latest && research.market
      ? nearestClose(research.market.hourlyKlines, latest.timestamp)
      : undefined;
  const latestNotional =
    latest && latestSpot ? latest.totalOi * latestSpot : undefined;
  const firstMaturityPoint =
    selectedMaturity === "policy" ? undefined : selectedPoints.at(0);
  const latestZeroBook = useMemo(() => {
    for (const day of [...research.days].reverse()) {
      const point = selectedAtZero.get(day.date);
      if (!point) continue;
      const book = day.gammaBooksAtZero.find(
        candidate =>
          candidate.product === product && candidate.maturity === point.maturity
      );
      if (book) return { date: day.date, book };
    }
    return undefined;
  }, [product, research.days, selectedAtZero]);

  return (
    <div className="mx-auto max-w-[1800px] space-y-6">
      <header>
        <div className="mb-2 flex flex-wrap gap-2">
          <Badge variant="outline" className="border-primary/40 text-primary">
            CRONUS · SIGNALPLUS OI
          </Badge>
          <Badge variant="outline">UTC 00/04/08/12/16/20</Badge>
          <Badge variant="outline">NO LOOK-AHEAD</Badge>
        </div>
        <h1 className="text-2xl font-bold text-gold-gradient">
          BTC 历史最大痛点与价格回测
        </h1>
        <p className="mt-2 max-w-5xl text-sm leading-6 text-muted-foreground">
          从逐行权价历史 OI 复算每个到期日的赔付曲线；蓝线为所选期限的 Max
          Pain，叠加 BTC 现货 K 线。K 线自动使用 Coinbase、OKX、Binance
          三级容错，所有观察时间均为 UTC。
        </p>
      </header>

      <Card className="glass-card border-primary/25">
        <CardContent className="p-5">
          <div className="grid gap-4 xl:grid-cols-[1fr_1fr_auto_auto_auto] xl:items-end">
            <label className="space-y-2 text-sm">
              <span className="text-muted-foreground">开始日期</span>
              <input
                type="date"
                min={SIGNALPLUS_EARLIEST_VERIFIED_DATE}
                max={utcDate(0)}
                value={startDate}
                onChange={event => setStartDate(event.target.value)}
                className="h-10 w-full rounded-md border border-border bg-background px-3"
              />
            </label>
            <label className="space-y-2 text-sm">
              <span className="text-muted-foreground">结束日期</span>
              <input
                type="date"
                min={SIGNALPLUS_EARLIEST_VERIFIED_DATE}
                max={utcDate(0)}
                value={endDate}
                onChange={event => setEndDate(event.target.value)}
                className="h-10 w-full rounded-md border border-border bg-background px-3"
              />
            </label>
            <div className="flex gap-2">
              {[7, 30, 90].map(days => (
                <Button key={days} variant="outline" onClick={() => run(days)}>
                  近 {days} 天
                </Button>
              ))}
            </div>
            <div className="flex rounded-md border border-border p-1">
              {INTERVALS.map(value => (
                <SegmentedButton
                  key={value}
                  active={interval === value}
                  onClick={() => setInterval(value)}
                >
                  {value}
                </SegmentedButton>
              ))}
            </div>
            <div className="flex gap-2">
              {research.loading ? (
                <Button variant="outline" onClick={research.cancel}>
                  <X className="mr-2 h-4 w-4" />
                  停止
                </Button>
              ) : null}
              <Button
                onClick={() => run()}
                disabled={research.loading}
                className="min-w-28"
              >
                {research.loading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Calculator className="mr-2 h-4 w-4" />
                )}
                计算
              </Button>
            </div>
          </div>
          {research.loading ? (
            <div className="mt-4 space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>正在逐日抓取并复算，可看到实时进度</span>
                <span>
                  {research.completed}/{research.total}
                </span>
              </div>
              <Progress
                value={
                  research.total
                    ? (research.completed / research.total) * 100
                    : 0
                }
              />
            </div>
          ) : null}
          {validationError ? (
            <p className="mt-3 text-sm text-red-400">{validationError}</p>
          ) : null}
        </CardContent>
      </Card>

      {research.errors.length ? (
        <Alert className="border-amber-500/30 bg-amber-500/5">
          <AlertTriangle className="text-amber-400" />
          <AlertTitle>部分数据未完成</AlertTitle>
          <AlertDescription>
            {research.errors.slice(0, 4).join("；")}
            {research.errors.length > 4
              ? `；另有 ${research.errors.length - 4} 项`
              : ""}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "最新 Max Pain",
            value: money(latest?.maxPain),
            detail: latest
              ? `${latest.date} ${String(latest.hourUtc).padStart(2, "0")}:00 · ${latest.maturity}`
              : "等待计算",
            color: "text-sky-400",
          },
          {
            label: "最新总 OI",
            value: latest
              ? `${latest.totalOi.toLocaleString(undefined, { maximumFractionDigits: 1 })} BTC-eq`
              : "—",
            detail: `Call ${latest?.callOi.toFixed(1) ?? "—"} / Put ${latest?.putOi.toFixed(1) ?? "—"}`,
            color: "",
          },
          {
            label: "OI Notional Value",
            value: money(latestNotional),
            detail: "BTC-eq OI × 同时点 BTC 现货价",
            color: "text-emerald-400",
          },
          {
            label: "有效观察点",
            value: String(selectedPoints.length),
            detail: `${research.days.length} 天 · 最多每日至 6 点`,
            color: "text-primary",
          },
        ].map(card => (
          <Card key={card.label} className="glass-card">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{card.label}</div>
              <div
                className={`mt-2 text-2xl font-bold font-mono ${card.color}`}
              >
                {card.value}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {card.detail}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {sections.chart ? (
        <Card className="glass-card">
          <CardHeader className="gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                BTC K 线 × Max Pain × Gamma 代理区
              </CardTitle>
              <p className="mt-2 text-xs text-muted-foreground">
                绿/红为{" "}
                {research.market
                  ? `${research.market.source} ${research.market.symbol}`
                  : "BTC 现货"}{" "}
                K 线；蓝线连接每日六个观察点；紫色区间是 00:00 毛 Gamma 的
                20%–80% 密集带。
              </p>
              {research.market ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge variant="outline">
                    当前 K 线源：{research.market.source}
                  </Badge>
                  <Badge variant="outline">{research.market.symbol}</Badge>
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex rounded-md border border-border p-1">
                {PRODUCTS.map(option => (
                  <SegmentedButton
                    key={option.value}
                    active={product === option.value}
                    onClick={() => setProduct(option.value)}
                  >
                    {option.label}
                  </SegmentedButton>
                ))}
              </div>
              <label className="flex min-w-48 flex-col gap-1 text-xs text-muted-foreground">
                <span>指定到期日曲线</span>
                <select
                  value={selectedMaturity}
                  onChange={event => setSelectedMaturity(event.target.value)}
                  className="h-9 rounded-md border border-border bg-background px-3 text-foreground"
                >
                  <option value="policy">跟随到期策略</option>
                  {availableMaturities.map(maturity => (
                    <option key={maturity} value={maturity}>
                      {maturity}
                    </option>
                  ))}
                </select>
              </label>
              <div
                className={`flex rounded-md border border-border p-1 ${selectedMaturity === "policy" ? "" : "opacity-55"}`}
              >
                {EXPIRIES.map(option => (
                  <SegmentedButton
                    key={option.value}
                    active={
                      expiryPolicy === option.value &&
                      selectedMaturity === "policy"
                    }
                    onClick={() => {
                      setExpiryPolicy(option.value);
                      setSelectedMaturity("policy");
                    }}
                  >
                    {option.label}
                  </SegmentedButton>
                ))}
              </div>
              <label className="flex items-center gap-2 text-xs">
                <Switch
                  checked={showMaxPain}
                  onCheckedChange={setShowMaxPain}
                />
                Max Pain
              </label>
              {sections.gammaZone ? (
                <label className="flex items-center gap-2 text-xs">
                  <Switch checked={showGamma} onCheckedChange={setShowGamma} />
                  Gamma
                </label>
              ) : null}
            </div>
          </CardHeader>
          <CardContent>
            {selectedMaturity !== "policy" ? (
              <Alert className="mb-4 border-sky-500/20 bg-sky-500/5">
                <Info className="text-sky-400" />
                <AlertTitle>固定到期日：{selectedMaturity}</AlertTitle>
                <AlertDescription>
                  蓝线只连接该到期日在本次查询范围内实际存在的观察点
                  {firstMaturityPoint
                    ? `，当前从 ${firstMaturityPoint.date} ${String(firstMaturityPoint.hourUtc).padStart(2, "0")}:00 开始`
                    : ""}
                  。 若合约更早已挂牌，请把开始日期向前调后重新计算。
                </AlertDescription>
              </Alert>
            ) : null}
            <MaxPainCandlestickChart
              klines={research.market?.displayKlines ?? []}
              maxPainPoints={selectedPoints}
              gammaZones={gammaZones}
              showMaxPain={showMaxPain}
              showGamma={showGamma && sections.gammaZone}
            />
          </CardContent>
        </Card>
      ) : null}

      {sections.details ? (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              六时点 Max Pain 明细
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="max-h-[520px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>UTC 时点</TableHead>
                    <TableHead>产品</TableHead>
                    <TableHead>到期日</TableHead>
                    <TableHead className="text-right">Max Pain</TableHead>
                    <TableHead className="text-right">Call OI</TableHead>
                    <TableHead className="text-right">Put OI</TableHead>
                    <TableHead className="text-right">总 OI</TableHead>
                    <TableHead className="text-right">Notional</TableHead>
                    <TableHead className="text-right">源快照延迟</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...selectedPoints].reverse().map(point => {
                    const spot = research.market
                      ? nearestClose(
                          research.market.hourlyKlines,
                          point.timestamp
                        )
                      : undefined;
                    return (
                      <TableRow
                        key={`${point.timestamp}-${point.product}-${point.maturity}`}
                      >
                        <TableCell>
                          {point.date} {String(point.hourUtc).padStart(2, "0")}
                          :00
                        </TableCell>
                        <TableCell>{point.product}</TableCell>
                        <TableCell>{point.maturity}</TableCell>
                        <TableCell className="text-right font-mono text-sky-400">
                          {money(point.maxPain)}
                        </TableCell>
                        <TableCell className="text-right">
                          {point.callOi.toFixed(1)}
                        </TableCell>
                        <TableCell className="text-right">
                          {point.putOi.toFixed(1)}
                        </TableCell>
                        <TableCell className="text-right">
                          {point.totalOi.toFixed(1)}
                        </TableCell>
                        <TableCell className="text-right">
                          {money(spot ? point.totalOi * spot : undefined)}
                        </TableCell>
                        <TableCell className="text-right">
                          {Math.round(
                            (point.timestamp - point.sourceTimestamp) / 60_000
                          )}{" "}
                          min
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {latestZeroBook ? (
              <details className="rounded-lg border border-border/60 p-4">
                <summary className="cursor-pointer text-sm font-medium text-primary">
                  查看最新 00:00 Strike / OIList · {latestZeroBook.date} ·{" "}
                  {latestZeroBook.book.maturity}
                </summary>
                <div className="mt-3 max-h-[360px] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Strike</TableHead>
                        <TableHead className="text-right">Call OI</TableHead>
                        <TableHead className="text-right">Put OI</TableHead>
                        <TableHead className="text-right">总 OI</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {latestZeroBook.book.strikes.map(row => (
                        <TableRow key={row.strike}>
                          <TableCell>{money(row.strike)}</TableCell>
                          <TableCell className="text-right">
                            {row.callOi.toFixed(4)}
                          </TableCell>
                          <TableCell className="text-right">
                            {row.putOi.toFixed(4)}
                          </TableCell>
                          <TableCell className="text-right">
                            {(row.callOi + row.putOi).toFixed(4)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </details>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        {sections.backtest ? (
          <Card className="glass-card" id="backtest">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FlaskConical className="h-5 w-5 text-emerald-400" />
                Max Pain 吸引力回测
              </CardTitle>
              <div className="flex flex-wrap gap-2 pt-3">
                {OBSERVATION_HOURS.map(hour => (
                  <SegmentedButton
                    key={hour}
                    active={backtestHour === hour}
                    onClick={() => setBacktestHour(hour)}
                  >
                    {String(hour).padStart(2, "0")}:00
                  </SegmentedButton>
                ))}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                {[
                  [
                    "回看向痛点移动率",
                    backtest
                      ? `${backtest.summary.backwardHitRate.toFixed(1)}%`
                      : "—",
                  ],
                  [
                    "未来24h命中率",
                    backtest?.summary.forwardHitRate === undefined
                      ? "—"
                      : `${backtest.summary.forwardHitRate.toFixed(1)}%`,
                  ],
                  [
                    "Pearson",
                    backtest?.summary.pearsonGapVsForwardReturn?.toFixed(3) ??
                      "—",
                  ],
                  [
                    "平均 c→b 涨跌",
                    percent(backtest?.summary.meanBackwardMovePct),
                  ],
                  [
                    "平均距离收敛",
                    percent(backtest?.summary.meanBackwardConvergencePct),
                  ],
                  [
                    "Spearman",
                    backtest?.summary.spearmanGapVsForwardReturn?.toFixed(3) ??
                      "—",
                  ],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-lg border border-border/60 p-3"
                  >
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="mt-1 text-xl font-bold">{value}</div>
                  </div>
                ))}
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                回看：c=观察前24h价格、b=观察时价格、a=Max Pain，比较 |b-a|
                是否小于 |c-a|。预测：只使用观察时已知的 a、b，检查未来24h是否向
                a 靠近。相关系数使用 (a-b)/b 与未来24h收益；Spearman
                对极端值更稳健。
              </p>
              <div className="max-h-[360px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>日期</TableHead>
                      <TableHead className="text-right">a 痛点</TableHead>
                      <TableHead className="text-right">c 前24h</TableHead>
                      <TableHead className="text-right">b 观察价</TableHead>
                      <TableHead className="text-right">c→b</TableHead>
                      <TableHead className="text-right">距离收敛</TableHead>
                      <TableHead>靠近?</TableHead>
                      <TableHead className="text-right">未来24h</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...(backtest?.rows ?? [])].reverse().map(row => (
                      <TableRow key={row.timestamp}>
                        <TableCell>{row.date}</TableCell>
                        <TableCell className="text-right">
                          {money(row.maxPain)}
                        </TableCell>
                        <TableCell className="text-right">
                          {money(row.price24hBefore)}
                        </TableCell>
                        <TableCell className="text-right">
                          {money(row.priceAtObservation)}
                        </TableCell>
                        <TableCell className="text-right">
                          {percent(row.backwardMovePct)}
                        </TableCell>
                        <TableCell className="text-right">
                          {percent(row.backwardConvergencePct)}
                        </TableCell>
                        <TableCell
                          className={
                            row.backwardTowardPain
                              ? "text-emerald-400"
                              : "text-red-400"
                          }
                        >
                          {row.backwardTowardPain ? "是" : "否"}
                        </TableCell>
                        <TableCell className="text-right">
                          {percent(row.forwardReturnPct)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {sections.gammaZone ? (
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sigma className="h-5 w-5 text-purple-400" />
                每日 00:00 Gamma 密集区（代理）
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Alert className="mb-4 border-purple-500/20 bg-purple-500/5">
                <Info className="text-purple-400" />
                <AlertTitle>不能从 OI 得到真实正/负 dealer Gamma</AlertTitle>
                <AlertDescription>
                  OI 没有持仓方向，历史源也没有 IV。这里展示 Black-Scholes
                  合约毛 Gamma × (Call+Put OI) 的 20%–80%
                  集中带，只用于定位敏感行权价。
                </AlertDescription>
              </Alert>
              <div className="max-h-[440px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>日期</TableHead>
                      <TableHead>到期日</TableHead>
                      <TableHead className="text-right">下沿</TableHead>
                      <TableHead className="text-right">峰值</TableHead>
                      <TableHead className="text-right">上沿</TableHead>
                      <TableHead className="text-right">实现波动率</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...gammaZones].reverse().map(zone => (
                      <TableRow key={`${zone.date}-${zone.maturity}`}>
                        <TableCell>{zone.date}</TableCell>
                        <TableCell>{zone.maturity}</TableCell>
                        <TableCell className="text-right">
                          {money(zone.lowerStrike)}
                        </TableCell>
                        <TableCell className="text-right text-purple-400">
                          {money(zone.peakStrike)}
                        </TableCell>
                        <TableCell className="text-right">
                          {money(zone.upperStrike)}
                        </TableCell>
                        <TableCell className="text-right">
                          {(zone.volatility * 100).toFixed(1)}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {sections.methodology ? (
        <Alert className="border-primary/25 bg-primary/5">
          <Database className="text-primary" />
          <AlertTitle>数据范围与计算边界</AlertTitle>
          <AlertDescription>
            SignalPlus 生产接口项目实测从 {SIGNALPLUS_EARLIEST_VERIFIED_DATE}{" "}
            起有数据，但没有公开保留 SLA；上游单次请求必须小于 2
            天。本页一次最多 {MAX_INTRADAY_QUERY_DAYS}{" "}
            天并拆成逐日请求。返回值没有 exchange 字段，Deribit
            风格合约名不能证明数据包含 Binance、Bybit 或 OKX。Max Pain
            只最小化到期内在价值，不含权利金、动态对冲、交易方向和到期前时间价值，因此是结算压力参考，不是价格必然磁铁。
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
