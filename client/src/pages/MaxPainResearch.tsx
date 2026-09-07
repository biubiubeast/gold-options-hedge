import { MaxPainCandlestickChart } from "@/components/MaxPainCandlestickChart";
import { OpenInterestByStrikeChart } from "@/components/OpenInterestByStrikeChart";
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
import { useDisplayTimezone } from "@/hooks/useDisplayTimezone";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { DEFAULT_MAX_PAIN_VISIBLE_SECTIONS } from "@shared/access";
import {
  displayTimeZoneName,
  formatDisplayDateTime,
  formatObservationSlot,
  observationTimestamp,
} from "@shared/displayTimezone";
import {
  MAX_INTRADAY_QUERY_DAYS,
  OBSERVATION_HOURS,
  SIGNALPLUS_EARLIEST_VERIFIED_DATE,
  backtestMaxPain,
  calculateGrossGammaZone,
  calculateMaxPain,
  mergeStrikeBooks,
  nearestClose,
  selectIntradayExpiry,
  type GammaStrikeBook,
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

function latestObservationHour(): ObservationHour {
  const currentHour = new Date().getUTCHours();
  return (
    [...OBSERVATION_HOURS].reverse().find(hour => hour <= currentHour) ?? 0
  );
}

function observationHasOccurred(date: string, hour: ObservationHour) {
  return (
    Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00Z`) <= Date.now()
  );
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
  disabled = false,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded px-3 py-2 text-xs transition-colors ${
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      } ${disabled ? "cursor-not-allowed opacity-35 hover:bg-transparent" : ""}`}
    >
      {children}
    </button>
  );
}

export default function MaxPainResearch() {
  const { user } = useAuth();
  const { settings } = usePortfolioSettings();
  const { timeZone } = useDisplayTimezone();
  const sharedSectionsQuery = trpc.access.maxPainSections.useQuery(undefined, {
    staleTime: 5_000,
    refetchOnWindowFocus: true,
  });
  const sections = sharedSectionsQuery.data?.configured
    ? sharedSectionsQuery.data.sections
    : user?.role === "admin"
      ? settings.maxPainVisibleSections
      : DEFAULT_MAX_PAIN_VISIBLE_SECTIONS;
  const [startDate, setStartDate] = useState(utcDate(7));
  const [endDate, setEndDate] = useState(utcDate(1));
  const [interval, setInterval] = useState<ResearchKlineInterval>("4h");
  const [product, setProduct] = useState<OptionProduct>("combined");
  const [expiryPolicy, setExpiryPolicy] =
    useState<MaxPainExpiryPolicy>("front");
  const [selectedMaturity, setSelectedMaturity] = useState("policy");
  const [backtestHour, setBacktestHour] = useState<ObservationHour>(0);
  const [showMaxPain, setShowMaxPain] = useState(true);
  const [showOiBars, setShowOiBars] = useState(true);
  const [showGamma, setShowGamma] = useState(false);
  const [distributionMode, setDistributionMode] = useState<
    "live" | "historical"
  >("live");
  const [strikeDate, setStrikeDate] = useState(utcDate(0));
  const [strikeHour, setStrikeHour] = useState<ObservationHour>(
    latestObservationHour
  );
  const [strikeProduct, setStrikeProduct] = useState<OptionProduct>("combined");
  const [strikeMaturity, setStrikeMaturity] = useState("front");
  const [validationError, setValidationError] = useState<string>();
  const research = useMaxPainResearch();
  const liveDeribitQuery = trpc.market.deribitBtcOptionChain.useQuery(
    undefined,
    {
      enabled: sections.oiDistribution && distributionMode === "live",
      staleTime: 8_000,
      refetchOnWindowFocus: false,
      retry: 1,
    }
  );
  const strikeSnapshotQuery = trpc.maxPainResearch.strikeSnapshot.useQuery(
    { date: strikeDate, hourUtc: strikeHour },
    {
      enabled:
        sections.oiDistribution &&
        distributionMode === "historical" &&
        strikeDate >= SIGNALPLUS_EARLIEST_VERIFIED_DATE &&
        observationHasOccurred(strikeDate, strikeHour),
      staleTime: 6 * 60 * 60 * 1000,
      retry: 1,
    }
  );

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

  const liveStrikeBooks = useMemo<GammaStrikeBook[]>(() => {
    const chain = liveDeribitQuery.data;
    if (!chain) return [];
    const expiries = new Map<
      string,
      Map<number, { strike: number; callOi: number; putOi: number }>
    >();
    for (const quote of chain.quotes) {
      if (
        quote.openInterest === null ||
        quote.openInterest === undefined ||
        !Number.isFinite(quote.openInterest) ||
        quote.openInterest < 0 ||
        Date.parse(`${quote.expiry}T08:00:00Z`) <= chain.timestamp
      )
        continue;
      const strikes = expiries.get(quote.expiry) ?? new Map();
      const row = strikes.get(quote.strike) ?? {
        strike: quote.strike,
        callOi: 0,
        putOi: 0,
      };
      const btcEquivalent =
        quote.openInterest * (quote.contractMultiplier ?? 1);
      if (quote.optionType === "call") row.callOi += btcEquivalent;
      else row.putOi += btcEquivalent;
      strikes.set(quote.strike, row);
      expiries.set(quote.expiry, strikes);
    }
    return [...expiries.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([maturity, strikes]) => ({
        maturity,
        product: "inverse" as const,
        strikes: [...strikes.values()].sort(
          (left, right) => left.strike - right.strike
        ),
      }));
  }, [liveDeribitQuery.data]);
  const distributionTimestamp =
    distributionMode === "live"
      ? liveDeribitQuery.data?.timestamp
      : strikeSnapshotQuery.data?.timestamp;
  const strikeBooks = useMemo(() => {
    if (distributionMode === "live") return liveStrikeBooks;
    const snapshot = strikeSnapshotQuery.data;
    if (!snapshot) return [];
    return snapshot.books
      .filter(
        book =>
          book.product === strikeProduct &&
          Date.parse(`${book.maturity}T08:00:00Z`) > snapshot.timestamp
      )
      .sort((left, right) => left.maturity.localeCompare(right.maturity));
  }, [
    distributionMode,
    liveStrikeBooks,
    strikeProduct,
    strikeSnapshotQuery.data,
  ]);
  const strikeMaturities = useMemo(
    () => strikeBooks.map(book => book.maturity),
    [strikeBooks]
  );

  useEffect(() => {
    if (
      strikeMaturity !== "front" &&
      strikeMaturity !== "all" &&
      !strikeMaturities.includes(strikeMaturity)
    )
      setStrikeMaturity("front");
  }, [strikeMaturities, strikeMaturity]);

  useEffect(() => {
    if (!observationHasOccurred(strikeDate, strikeHour))
      setStrikeHour(latestObservationHour());
  }, [strikeDate, strikeHour]);

  const displayedStrikeBooks = useMemo(
    () =>
      strikeMaturity === "all"
        ? strikeBooks
        : strikeMaturity === "front"
          ? strikeBooks.slice(0, 1)
          : strikeBooks.filter(book => book.maturity === strikeMaturity),
    [strikeBooks, strikeMaturity]
  );
  const displayedStrikes = useMemo(
    () => mergeStrikeBooks(displayedStrikeBooks),
    [displayedStrikeBooks]
  );
  const distributionMaxPain = useMemo(
    () => calculateMaxPain(displayedStrikes),
    [displayedStrikes]
  );
  const distributionCallOi = displayedStrikes.reduce(
    (sum, row) => sum + row.callOi,
    0
  );
  const distributionPutOi = displayedStrikes.reduce(
    (sum, row) => sum + row.putOi,
    0
  );
  const distributionTotalOi = distributionCallOi + distributionPutOi;
  const snapshotSummary = useMemo(() => {
    if (distributionMode === "live") {
      if (!liveDeribitQuery.data) return [];
      return liveStrikeBooks.flatMap(book => {
        const result = calculateMaxPain(book.strikes);
        if (!result) return [];
        const callOi = book.strikes.reduce((sum, row) => sum + row.callOi, 0);
        const putOi = book.strikes.reduce((sum, row) => sum + row.putOi, 0);
        return [
          {
            timestamp: liveDeribitQuery.data!.timestamp,
            maturity: book.maturity,
            product: book.product,
            maxPain: result.maxPain,
            callOi,
            putOi,
            totalOi: callOi + putOi,
            strikeCount: book.strikes.length,
          },
        ];
      });
    }
    const snapshot = strikeSnapshotQuery.data;
    if (!snapshot) return [];
    return snapshot.points
      .filter(
        point =>
          point.product === strikeProduct &&
          Date.parse(`${point.maturity}T08:00:00Z`) > snapshot.timestamp
      )
      .sort((left, right) => left.maturity.localeCompare(right.maturity));
  }, [
    distributionMode,
    liveDeribitQuery.data,
    liveStrikeBooks,
    strikeProduct,
    strikeSnapshotQuery.data,
  ]);
  const snapshotSpot =
    distributionMode === "live"
      ? liveDeribitQuery.data?.spot
      : strikeSnapshotQuery.data && research.market
        ? nearestClose(
            research.market.hourlyKlines,
            strikeSnapshotQuery.data.timestamp
          )
        : undefined;
  const distributionLoading =
    distributionMode === "live"
      ? liveDeribitQuery.isLoading
      : strikeSnapshotQuery.isLoading;
  const distributionFetching =
    distributionMode === "live"
      ? liveDeribitQuery.isFetching
      : strikeSnapshotQuery.isFetching;
  const distributionError =
    distributionMode === "live"
      ? liveDeribitQuery.error
      : strikeSnapshotQuery.error;
  const distributionReady =
    distributionMode === "live"
      ? Boolean(liveDeribitQuery.data)
      : Boolean(strikeSnapshotQuery.data);

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
        </div>
        <h1 className="text-2xl font-bold text-gold-gradient">
          BTC 历史最大痛点与价格回测
        </h1>
        <p className="mt-2 max-w-5xl text-sm leading-6 text-muted-foreground">
          从逐行权价历史 OI 复算每个到期日的赔付曲线；蓝线为所选期限的 Max
          Pain，叠加 BTC 现货 K 线。K 线自动使用 Coinbase、OKX、Binance
          三级容错。页面时间按顶部所选时区显示，切换不会改变原始行情、OI
          快照或回测配对。
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

      <div className="grid gap-4 md:grid-cols-3">
        {[
          {
            label: "最新 Max Pain",
            value: money(latest?.maxPain),
            detail: latest
              ? `${formatDisplayDateTime(latest.timestamp, timeZone, { includeZone: true })} · ${latest.maturity}`
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
                BTC K 线 × Max Pain
              </CardTitle>
              <p className="mt-2 text-xs text-muted-foreground">
                绿/红为{" "}
                {research.market
                  ? `${research.market.source} ${research.market.symbol}`
                  : "BTC 现货"}{" "}
                K 线；蓝线连接每日六个观察点；下方青/紫柱为每个痛点对应的
                Call/Put OI。鼠标停留可查看 K 线或痛点完整信息。
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
              <label className="flex items-center gap-2 text-xs">
                <Switch checked={showOiBars} onCheckedChange={setShowOiBars} />
                OI 柱
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
                    ? `，当前从 ${formatDisplayDateTime(firstMaturityPoint.timestamp, timeZone, { includeZone: true })} 开始`
                    : ""}
                  。 若合约更早已挂牌，请把开始日期向前调后重新计算。
                </AlertDescription>
              </Alert>
            ) : null}
            <MaxPainCandlestickChart
              klines={research.market?.displayKlines ?? []}
              referenceKlines={research.market?.hourlyKlines ?? []}
              maxPainPoints={selectedPoints}
              gammaZones={gammaZones}
              showMaxPain={showMaxPain}
              showGamma={showGamma && sections.gammaZone}
              showOiBars={showOiBars}
              timeZone={timeZone}
            />
          </CardContent>
        </Card>
      ) : null}

      {sections.oiDistribution ? (
        <Card className="glass-card" id="oi-by-strike">
          <CardHeader className="gap-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-cyan-400" />
                  BTC Open Interest By Strike × Max Pain
                </CardTitle>
                <p className="mt-2 max-w-5xl text-xs leading-5 text-muted-foreground">
                  实时模式读取 Deribit 官方当前 BTC
                  期权链；历史模式可选择任意日期和六个固定源时点读取 SignalPlus
                  OI History。青柱为 Call、紫柱为
                  Put，蓝色虚线为到期内在价值口径复算的 Max Pain。
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex rounded-md border border-border p-1">
                  <SegmentedButton
                    active={distributionMode === "live"}
                    onClick={() => setDistributionMode("live")}
                  >
                    Deribit 实时
                  </SegmentedButton>
                  <SegmentedButton
                    active={distributionMode === "historical"}
                    onClick={() => setDistributionMode("historical")}
                  >
                    SignalPlus 历史
                  </SegmentedButton>
                </div>
                {distributionMode === "historical" ? (
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    <span>历史快照日期</span>
                    <input
                      type="date"
                      min={SIGNALPLUS_EARLIEST_VERIFIED_DATE}
                      max={utcDate(0)}
                      value={strikeDate}
                      onChange={event => setStrikeDate(event.target.value)}
                      className="h-9 rounded-md border border-border bg-background px-3 text-foreground"
                    />
                  </label>
                ) : null}
                <label className="flex min-w-52 flex-col gap-1 text-xs text-muted-foreground">
                  <span>Expiry 到期日</span>
                  <select
                    value={strikeMaturity}
                    onChange={event => setStrikeMaturity(event.target.value)}
                    className="h-9 rounded-md border border-border bg-background px-3 text-foreground"
                  >
                    <option value="front">最近到期（默认）</option>
                    <option value="all">全部到期日合并</option>
                    {strikeMaturities.map(maturity => (
                      <option key={maturity} value={maturity}>
                        {maturity}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  variant="outline"
                  onClick={() =>
                    void (distributionMode === "live"
                      ? liveDeribitQuery.refetch()
                      : strikeSnapshotQuery.refetch())
                  }
                  disabled={distributionFetching}
                >
                  {distributionFetching ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Database className="mr-2 h-4 w-4" />
                  )}
                  刷新快照
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              {distributionMode === "historical" ? (
                <>
                  <div className="flex rounded-md border border-border p-1">
                    {OBSERVATION_HOURS.map(hour => (
                      <SegmentedButton
                        key={hour}
                        active={strikeHour === hour}
                        disabled={!observationHasOccurred(strikeDate, hour)}
                        onClick={() => setStrikeHour(hour)}
                      >
                        {formatObservationSlot(strikeDate, hour, timeZone)}
                      </SegmentedButton>
                    ))}
                  </div>
                  <div className="flex rounded-md border border-border p-1">
                    {PRODUCTS.map(option => (
                      <SegmentedButton
                        key={option.value}
                        active={strikeProduct === option.value}
                        onClick={() => setStrikeProduct(option.value)}
                      >
                        {option.label}
                      </SegmentedButton>
                    ))}
                  </div>
                  <Badge variant="outline">
                    显示：
                    {displayTimeZoneName(
                      timeZone,
                      observationTimestamp(strikeDate, strikeHour)
                    )}
                  </Badge>
                </>
              ) : (
                <>
                  <Badge variant="outline">Deribit BTC inverse</Badge>
                  <Badge variant="outline">
                    {liveDeribitQuery.data?.status === "realtime"
                      ? "实时"
                      : "可能延迟"}
                  </Badge>
                </>
              )}
              {distributionTimestamp ? (
                <Badge variant="outline">
                  源记录：
                  {formatDisplayDateTime(
                    distributionMode === "historical"
                      ? strikeSnapshotQuery.data!.sourceTimestamp
                      : distributionTimestamp,
                    timeZone,
                    { includeZone: true }
                  )}
                </Badge>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {distributionLoading ? (
              <div className="flex h-44 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {distributionMode === "live"
                  ? "正在读取 Deribit 实时 BTC 期权全链…"
                  : `正在读取 ${formatDisplayDateTime(observationTimestamp(strikeDate, strikeHour), timeZone, { includeZone: true })} 的逐 Strike OI…`}
              </div>
            ) : distributionError ? (
              <Alert className="border-amber-500/30 bg-amber-500/5">
                <AlertTriangle className="text-amber-400" />
                <AlertTitle>
                  {distributionMode === "live"
                    ? "Deribit 实时期权链读取失败"
                    : "该历史快照读取失败"}
                </AlertTitle>
                <AlertDescription>{distributionError.message}</AlertDescription>
              </Alert>
            ) : distributionReady ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    [
                      "所选 Max Pain",
                      money(distributionMaxPain?.maxPain),
                      strikeMaturity === "all"
                        ? "全部到期日按 Strike 合并"
                        : (displayedStrikeBooks[0]?.maturity ??
                          "没有有效到期日"),
                    ],
                    [
                      "所选总 OI",
                      `${distributionTotalOi.toLocaleString(undefined, { maximumFractionDigits: 2 })} BTC-eq`,
                      `Call ${distributionCallOi.toFixed(2)} / Put ${distributionPutOi.toFixed(2)}`,
                    ],
                    [
                      "有效到期日",
                      String(snapshotSummary.length),
                      `${displayedStrikes.length} 个合并后 Strike`,
                    ],
                    [
                      "OI Notional",
                      money(
                        snapshotSpot
                          ? distributionTotalOi * snapshotSpot
                          : undefined
                      ),
                      snapshotSpot
                        ? `BTC 参考价 ${money(snapshotSpot)}`
                        : "先计算覆盖该日的 K 线后显示",
                    ],
                  ].map(([label, value, detail]) => (
                    <div
                      key={label}
                      className="rounded-lg border border-border/60 bg-background/20 p-3"
                    >
                      <div className="text-xs text-muted-foreground">
                        {label}
                      </div>
                      <div className="mt-1 font-mono text-xl font-semibold">
                        {value}
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {detail}
                      </div>
                    </div>
                  ))}
                </div>

                {strikeMaturity === "all" ? (
                  <Alert className="border-sky-500/20 bg-sky-500/5">
                    <Info className="text-sky-400" />
                    <AlertTitle>全部到期日合并是跨期限参考值</AlertTitle>
                    <AlertDescription>
                      它把同一观察时点所有未到期合约按 Strike
                      合并后再最小化赔付；由于真实结算日不同，不等同于任何单一到期日的
                      Max Pain。逐到期日结果请看下表或点击某一行。
                    </AlertDescription>
                  </Alert>
                ) : null}

                <OpenInterestByStrikeChart
                  strikes={displayedStrikes}
                  maxPain={distributionMaxPain?.maxPain}
                  maturityLabel={
                    strikeMaturity === "all"
                      ? "全部到期日合并"
                      : (displayedStrikeBooks[0]?.maturity ?? "所选到期日")
                  }
                  spot={snapshotSpot}
                />

                <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-sm font-semibold">
                        同一时点 · 各 Expiry OI 与 Max Pain
                      </h3>
                      <span className="text-[11px] text-muted-foreground">
                        点击行可切换上方图表
                      </span>
                    </div>
                    <div className="max-h-[430px] overflow-auto rounded-lg border border-border/60">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Expiry</TableHead>
                            <TableHead className="text-right">DTE</TableHead>
                            <TableHead className="text-right">
                              Max Pain
                            </TableHead>
                            <TableHead className="text-right">
                              Call OI
                            </TableHead>
                            <TableHead className="text-right">Put OI</TableHead>
                            <TableHead className="text-right">总 OI</TableHead>
                            <TableHead className="text-right">
                              Notional
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {snapshotSummary.map(point => (
                            <TableRow
                              key={`${point.product}-${point.maturity}`}
                              className={`cursor-pointer ${
                                strikeMaturity === point.maturity
                                  ? "bg-sky-500/10"
                                  : ""
                              }`}
                              onClick={() => setStrikeMaturity(point.maturity)}
                            >
                              <TableCell className="font-medium">
                                {point.maturity}
                              </TableCell>
                              <TableCell className="text-right">
                                {(
                                  (Date.parse(`${point.maturity}T08:00:00Z`) -
                                    point.timestamp) /
                                  86_400_000
                                ).toFixed(1)}
                              </TableCell>
                              <TableCell className="text-right font-mono text-sky-400">
                                {money(point.maxPain)}
                              </TableCell>
                              <TableCell className="text-right text-cyan-300">
                                {point.callOi.toFixed(2)}
                              </TableCell>
                              <TableCell className="text-right text-violet-300">
                                {point.putOi.toFixed(2)}
                              </TableCell>
                              <TableCell className="text-right">
                                {point.totalOi.toFixed(2)}
                              </TableCell>
                              <TableCell className="text-right">
                                {money(
                                  snapshotSpot
                                    ? point.totalOi * snapshotSpot
                                    : undefined
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>

                  <div>
                    <h3 className="mb-2 text-sm font-semibold">
                      所选 Expiry · Strike / OIList
                    </h3>
                    <div className="max-h-[430px] overflow-auto rounded-lg border border-border/60">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Strike</TableHead>
                            <TableHead className="text-right">
                              Call OI
                            </TableHead>
                            <TableHead className="text-right">Put OI</TableHead>
                            <TableHead className="text-right">总 OI</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {displayedStrikes.map(row => (
                            <TableRow
                              key={row.strike}
                              className={
                                row.strike === distributionMaxPain?.maxPain
                                  ? "bg-sky-500/10"
                                  : ""
                              }
                            >
                              <TableCell
                                className={
                                  row.strike === distributionMaxPain?.maxPain
                                    ? "font-mono font-semibold text-sky-400"
                                    : "font-mono"
                                }
                              >
                                {money(row.strike)}
                                {row.strike === distributionMaxPain?.maxPain
                                  ? " · Max Pain"
                                  : ""}
                              </TableCell>
                              <TableCell className="text-right text-cyan-300">
                                {row.callOi.toFixed(4)}
                              </TableCell>
                              <TableCell className="text-right text-violet-300">
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
                  </div>
                </div>

                <p className="text-[11px] leading-5 text-muted-foreground">
                  {distributionMode === "live"
                    ? "实时模式来自 Deribit 官方 BTC inverse 全期权链；OI 按合约乘 contract size 转成 BTC-eq，并用同一快照的 Deribit BTC index 计算 Notional。"
                    : "历史模式来自 SignalPlus OI History；接口返回 Deribit 风格的 BTC / BTC_USDC 合约名，但没有 exchange 字段，因此不会把它误标成已经验证的 Deribit 全市场数据。六个源时点是固定快照槽位，也不等于实时逐秒快照。"}
                </p>
              </>
            ) : null}
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
                    <TableHead>
                      观察时点（{displayTimeZoneName(timeZone)}）
                    </TableHead>
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
                          {formatDisplayDateTime(point.timestamp, timeZone, {
                            includeZone: true,
                          })}
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
                  查看最新 Strike / OIList ·{" "}
                  {formatDisplayDateTime(
                    observationTimestamp(latestZeroBook.date, 0),
                    timeZone,
                    { includeZone: true }
                  )}{" "}
                  · {latestZeroBook.book.maturity}
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
                    {formatObservationSlot(endDate, hour, timeZone)}
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
                      <TableHead>观察时点</TableHead>
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
                        <TableCell>
                          {formatDisplayDateTime(row.timestamp, timeZone, {
                            includeZone: true,
                          })}
                        </TableCell>
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
                每日固定快照 Gamma 密集区（代理）
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
                      <TableHead>观察时点</TableHead>
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
                        <TableCell>
                          {formatDisplayDateTime(
                            observationTimestamp(zone.date, 0),
                            timeZone,
                            { includeZone: true }
                          )}
                        </TableCell>
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
