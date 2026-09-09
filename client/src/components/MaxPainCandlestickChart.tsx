import {
  nearestClose,
  type GammaZone,
  type IntradayMaxPainPoint,
  type OptionProduct,
  type ResearchKline,
} from "@shared/maxPainResearch";
import {
  formatDisplayDateTime,
  formatDisplayMonthDayTime,
  type DisplayTimeZone,
} from "@shared/displayTimezone";
import {
  useMemo,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

interface Props {
  klines: ResearchKline[];
  referenceKlines?: ResearchKline[];
  maxPainPoints: IntradayMaxPainPoint[];
  gammaZones: GammaZone[];
  showMaxPain: boolean;
  showGamma: boolean;
  showOiBars: boolean;
  showOiNotional?: boolean;
  timeZone: DisplayTimeZone;
}

interface ChartTooltip {
  left: number;
  top: number;
  title: string;
  rows: Array<{ label: string; value: string; color?: string }>;
}

function priceLabel(value: number) {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function compactNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1_000 ? 1 : 2,
  }).format(value);
}

function productLabel(product: OptionProduct) {
  return product === "inverse" ? "BTC 结算" : "USDC 结算";
}

/** Lightweight SVG chart: no extra chart runtime and safe under Cronus page zoom. */
export function MaxPainCandlestickChart({
  klines,
  referenceKlines,
  maxPainPoints,
  gammaZones,
  showMaxPain,
  showGamma,
  showOiBars,
  showOiNotional = false,
  timeZone,
}: Props) {
  const [tooltip, setTooltip] = useState<ChartTooltip>();
  const geometry = useMemo(() => {
    if (!klines.length) return null;
    const width = Math.max(1000, Math.min(9000, klines.length * 8));
    const height = showOiBars ? 640 : 500;
    const margin = { top: 22, right: 90, bottom: 40, left: 18 };
    const innerWidth = width - margin.left - margin.right;
    const pricePanelHeight = 420;
    const pricePanelBottom = margin.top + pricePanelHeight;
    const oiPanelTop = pricePanelBottom + 34;
    const oiPanelHeight = showOiBars ? 104 : 0;
    const plotBottom = showOiBars
      ? oiPanelTop + oiPanelHeight
      : pricePanelBottom;
    const start = klines[0].openTime;
    const end = Math.max(klines.at(-1)!.closeTime, start + 1);
    const prices = klines.flatMap(kline => [kline.low, kline.high]);
    if (showMaxPain) prices.push(...maxPainPoints.map(point => point.maxPain));
    if (showGamma)
      prices.push(
        ...gammaZones.flatMap(zone => [zone.lowerStrike, zone.upperStrike])
      );
    let minimum = Math.min(...prices);
    let maximum = Math.max(...prices);
    const padding = Math.max((maximum - minimum) * 0.06, maximum * 0.005);
    minimum -= padding;
    maximum += padding;
    const x = (timestamp: number) =>
      margin.left + ((timestamp - start) / (end - start)) * innerWidth;
    const y = (price: number) =>
      margin.top + ((maximum - price) / (maximum - minimum)) * pricePanelHeight;
    return {
      width,
      height,
      margin,
      innerWidth,
      pricePanelHeight,
      oiPanelTop,
      oiPanelHeight,
      plotBottom,
      minimum,
      maximum,
      x,
      y,
    };
  }, [gammaZones, klines, maxPainPoints, showGamma, showMaxPain, showOiBars]);

  const showTooltip = (
    event: ReactPointerEvent<SVGElement>,
    title: string,
    rows: ChartTooltip["rows"]
  ) => {
    const panelWidth = 292;
    const panelHeight = Math.min(300, 64 + rows.length * 25);
    setTooltip({
      left: Math.max(
        8,
        Math.min(event.clientX + 14, window.innerWidth - panelWidth - 8)
      ),
      top: Math.max(
        8,
        Math.min(event.clientY + 14, window.innerHeight - panelHeight - 8)
      ),
      title,
      rows,
    });
  };

  if (!geometry) {
    return (
      <div className="flex h-[420px] items-center justify-center rounded-lg border border-dashed border-border/70 text-sm text-muted-foreground">
        点击“计算”后加载 BTC K 线和 Max Pain。
      </div>
    );
  }

  const {
    width,
    height,
    margin,
    innerWidth,
    pricePanelHeight,
    oiPanelTop,
    oiPanelHeight,
    plotBottom,
    minimum,
    maximum,
    x,
    y,
  } = geometry;
  const candleWidth = Math.max(
    1.5,
    Math.min(6, (innerWidth / Math.max(klines.length, 1)) * 0.62)
  );
  const maxPainPath = maxPainPoints
    .map(
      (point, index) =>
        `${index ? "L" : "M"}${x(point.timestamp).toFixed(2)},${y(point.maxPain).toFixed(2)}`
    )
    .join(" ");
  const priceTicks = Array.from(
    { length: 6 },
    (_, index) => maximum - ((maximum - minimum) * index) / 5
  );
  const dateTickCount = Math.min(8, klines.length);
  const dateTicks = Array.from(
    { length: dateTickCount },
    (_, index) =>
      klines[
        Math.round(
          ((klines.length - 1) * index) / Math.max(dateTickCount - 1, 1)
        )
      ]
  );
  const maxOi = Math.max(...maxPainPoints.map(point => point.totalOi), 1);
  const oiY = (value: number) =>
    oiPanelTop + oiPanelHeight - (value / maxOi) * oiPanelHeight;
  const oiBarWidth = Math.max(
    3,
    Math.min(16, (innerWidth / Math.max(maxPainPoints.length, 1)) * 0.62)
  );
  const spotKlines = referenceKlines?.length ? referenceKlines : klines;

  return (
    <div className="relative">
      <div className="overflow-x-auto rounded-lg border border-primary/15 bg-[#071018] shadow-inner">
        <svg
          width={width}
          height={height}
          role="img"
          aria-label="BTC K线、最大痛点、对应OI柱与Gamma代理区叠加图"
          onPointerLeave={() => setTooltip(undefined)}
        >
          <rect width={width} height={height} fill="#071018" />
          {priceTicks.map(tick => (
            <g key={tick}>
              <line
                x1={margin.left}
                x2={margin.left + innerWidth}
                y1={y(tick)}
                y2={y(tick)}
                stroke="#243343"
                strokeDasharray="3 4"
              />
              <text
                x={width - margin.right + 8}
                y={y(tick) + 4}
                fill="#9aa8b5"
                fontSize="11"
              >
                {priceLabel(tick)}
              </text>
            </g>
          ))}

          {showGamma &&
            gammaZones.map(zone => {
              const dayStart = Date.parse(`${zone.date}T00:00:00Z`);
              const dayEnd = dayStart + 86_400_000;
              return (
                <g key={`${zone.date}-${zone.maturity}-${zone.product}`}>
                  <rect
                    x={x(dayStart)}
                    y={y(zone.upperStrike)}
                    width={Math.max(x(dayEnd) - x(dayStart), 1)}
                    height={Math.max(
                      y(zone.lowerStrike) - y(zone.upperStrike),
                      1
                    )}
                    fill="#a855f7"
                    opacity="0.11"
                  />
                  <line
                    x1={x(dayStart)}
                    x2={x(dayEnd)}
                    y1={y(zone.peakStrike)}
                    y2={y(zone.peakStrike)}
                    stroke="#c084fc"
                    strokeWidth="1"
                    strokeDasharray="4 3"
                    opacity="0.7"
                  />
                </g>
              );
            })}

          {klines.map(kline => {
            const center = x(kline.openTime);
            const rising = kline.close >= kline.open;
            const color = rising ? "#22c55e" : "#ef4444";
            const top = y(Math.max(kline.open, kline.close));
            const bottom = y(Math.min(kline.open, kline.close));
            const changePct = (kline.close / kline.open - 1) * 100;
            const rangePct = (kline.high / kline.low - 1) * 100;
            const rows: ChartTooltip["rows"] = [
              { label: "Open", value: priceLabel(kline.open) },
              {
                label: "High",
                value: priceLabel(kline.high),
                color: "#22c55e",
              },
              { label: "Low", value: priceLabel(kline.low), color: "#ef4444" },
              { label: "Close", value: priceLabel(kline.close) },
              {
                label: "涨跌",
                value: `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`,
                color: rising ? "#4ade80" : "#f87171",
              },
              { label: "振幅", value: `${rangePct.toFixed(2)}%` },
              { label: "成交量", value: compactNumber(kline.volume) },
            ];
            return (
              <g
                key={kline.openTime}
                onPointerEnter={event =>
                  showTooltip(
                    event,
                    `${formatDisplayDateTime(kline.openTime, timeZone, { includeZone: true })} · BTC K线`,
                    rows
                  )
                }
                onPointerMove={event =>
                  showTooltip(
                    event,
                    `${formatDisplayDateTime(kline.openTime, timeZone, { includeZone: true })} · BTC K线`,
                    rows
                  )
                }
              >
                <rect
                  x={center - Math.max(candleWidth, 7) / 2}
                  y={margin.top}
                  width={Math.max(candleWidth, 7)}
                  height={pricePanelHeight}
                  fill="transparent"
                />
                <line
                  x1={center}
                  x2={center}
                  y1={y(kline.high)}
                  y2={y(kline.low)}
                  stroke={color}
                  strokeWidth="1"
                  pointerEvents="none"
                />
                <rect
                  x={center - candleWidth / 2}
                  y={top}
                  width={candleWidth}
                  height={Math.max(bottom - top, 1)}
                  fill={color}
                  opacity="0.86"
                  pointerEvents="none"
                />
                <title>{`${formatDisplayDateTime(kline.openTime, timeZone, { includeZone: true })}\nO ${priceLabel(kline.open)} H ${priceLabel(kline.high)} L ${priceLabel(kline.low)} C ${priceLabel(kline.close)}`}</title>
              </g>
            );
          })}

          {showMaxPain && maxPainPath ? (
            <path
              d={maxPainPath}
              fill="none"
              stroke="#38bdf8"
              strokeWidth="2.25"
              pointerEvents="none"
            />
          ) : null}
          {showMaxPain &&
            maxPainPoints.map(point => {
              const spot = nearestClose(spotKlines, point.timestamp);
              const callShare = point.totalOi
                ? (point.callOi / point.totalOi) * 100
                : 0;
              const rows: ChartTooltip["rows"] = [
                {
                  label: "Max Pain",
                  value: priceLabel(point.maxPain),
                  color: "#38bdf8",
                },
                { label: "到期日", value: point.maturity },
                { label: "产品", value: productLabel(point.product) },
                {
                  label: "Call OI",
                  value: compactNumber(point.callOi),
                },
                {
                  label: "Put OI",
                  value: compactNumber(point.putOi),
                },
                {
                  label: "总 OI",
                  value: compactNumber(point.totalOi),
                },
                {
                  label: "Call / Put",
                  value: `${callShare.toFixed(1)}% / ${(100 - callShare).toFixed(1)}%`,
                },
                { label: "Strike 数", value: String(point.strikeCount) },
                { label: "BTC 参考价", value: spot ? priceLabel(spot) : "—" },
                ...(showOiNotional
                  ? [
                      {
                        label: "OI Notional",
                        value: spot ? priceLabel(point.totalOi * spot) : "—",
                      },
                    ]
                  : []),
                {
                  label: "源快照延迟",
                  value: `${Math.max(0, Math.round((point.timestamp - point.sourceTimestamp) / 60_000))} min`,
                },
              ];
              const title = formatDisplayDateTime(point.timestamp, timeZone, {
                includeZone: true,
              });
              return (
                <g
                  key={`${point.timestamp}-${point.product}-${point.maturity}`}
                  onPointerEnter={event => showTooltip(event, title, rows)}
                  onPointerMove={event => showTooltip(event, title, rows)}
                >
                  <circle
                    cx={x(point.timestamp)}
                    cy={y(point.maxPain)}
                    r="9"
                    fill="transparent"
                  />
                  <circle
                    cx={x(point.timestamp)}
                    cy={y(point.maxPain)}
                    r="3.5"
                    fill="#38bdf8"
                    stroke="#e0f2fe"
                    strokeWidth="1"
                    pointerEvents="none"
                  />
                  <title>{`${title}\nMax Pain ${priceLabel(point.maxPain)}\n到期 ${point.maturity}\nOI ${point.totalOi.toLocaleString()}`}</title>
                </g>
              );
            })}

          {showOiBars ? (
            <g>
              <line
                x1={margin.left}
                x2={margin.left + innerWidth}
                y1={oiPanelTop + oiPanelHeight}
                y2={oiPanelTop + oiPanelHeight}
                stroke="#42566a"
              />
              {[maxOi, maxOi / 2].map((tick, index) => (
                <g key={`oi-${tick}`}>
                  <line
                    x1={margin.left}
                    x2={margin.left + innerWidth}
                    y1={oiY(tick)}
                    y2={oiY(tick)}
                    stroke="#1d3344"
                    strokeDasharray="3 4"
                  />
                  <text
                    x={width - margin.right + 8}
                    y={oiY(tick) + 4}
                    fill="#8294a4"
                    fontSize="10"
                  >
                    {index === 0 ? "OI " : ""}
                    {compactNumber(tick)}
                  </text>
                </g>
              ))}
              <text
                x={margin.left}
                y={oiPanelTop - 9}
                fill="#9aa8b5"
                fontSize="10"
              >
                每个 Max Pain 观察点对应 OI（Call 青 / Put 紫）
              </text>
              {maxPainPoints.map(point => {
                const totalTop = oiY(point.totalOi);
                const callTop = oiY(point.callOi);
                const rows: ChartTooltip["rows"] = [
                  {
                    label: "Max Pain",
                    value: priceLabel(point.maxPain),
                    color: "#38bdf8",
                  },
                  { label: "到期日", value: point.maturity },
                  {
                    label: "Call OI",
                    value: compactNumber(point.callOi),
                    color: "#22d3ee",
                  },
                  {
                    label: "Put OI",
                    value: compactNumber(point.putOi),
                    color: "#a78bfa",
                  },
                  {
                    label: "总 OI",
                    value: compactNumber(point.totalOi),
                  },
                ];
                const title = `${formatDisplayDateTime(point.timestamp, timeZone, { includeZone: true })} · OI`;
                return (
                  <g
                    key={`oi-bar-${point.timestamp}-${point.maturity}`}
                    onPointerEnter={event => showTooltip(event, title, rows)}
                    onPointerMove={event => showTooltip(event, title, rows)}
                  >
                    <rect
                      x={x(point.timestamp) - oiBarWidth / 2}
                      y={callTop}
                      width={oiBarWidth}
                      height={Math.max(
                        oiPanelTop + oiPanelHeight - callTop,
                        0.5
                      )}
                      fill="#22d3ee"
                      opacity="0.72"
                    />
                    <rect
                      x={x(point.timestamp) - oiBarWidth / 2}
                      y={totalTop}
                      width={oiBarWidth}
                      height={Math.max(callTop - totalTop, 0.5)}
                      fill="#a78bfa"
                      opacity="0.78"
                    />
                    <title>{`${title}\nCall OI ${point.callOi.toLocaleString()}\nPut OI ${point.putOi.toLocaleString()}\nTotal OI ${point.totalOi.toLocaleString()}`}</title>
                  </g>
                );
              })}
            </g>
          ) : null}

          {dateTicks.map(item => (
            <g key={`date-${item.openTime}`}>
              <line
                x1={x(item.openTime)}
                x2={x(item.openTime)}
                y1={plotBottom}
                y2={plotBottom + 5}
                stroke="#64748b"
              />
              <text
                x={x(item.openTime)}
                y={height - 14}
                fill="#9aa8b5"
                fontSize="11"
                textAnchor="middle"
              >
                {formatDisplayMonthDayTime(item.openTime, timeZone)}
              </text>
            </g>
          ))}
        </svg>
      </div>
      {tooltip ? (
        <div
          className="pointer-events-none fixed z-[90] w-[292px] rounded-lg border border-sky-400/30 bg-[#071018]/95 p-3 text-xs shadow-2xl backdrop-blur"
          style={{ left: tooltip.left, top: tooltip.top }}
          role="tooltip"
        >
          <div className="mb-2 font-semibold text-sky-300">{tooltip.title}</div>
          <div className="space-y-1.5">
            {tooltip.rows
              .filter(row => showOiNotional || row.label !== "OI Notional")
              .map((row, index) => (
                <div
                  key={`${row.label}-${index}`}
                  className="flex items-center justify-between gap-5"
                >
                  <span className="text-slate-400">{row.label}</span>
                  <span
                    className="text-right font-mono text-slate-100"
                    style={row.color ? { color: row.color } : undefined}
                  >
                    {row.value}
                  </span>
                </div>
              ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
