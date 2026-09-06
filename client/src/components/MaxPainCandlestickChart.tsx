import type {
  GammaZone,
  IntradayMaxPainPoint,
  ResearchKline,
} from "@shared/maxPainResearch";
import { useMemo } from "react";

interface Props {
  klines: ResearchKline[];
  maxPainPoints: IntradayMaxPainPoint[];
  gammaZones: GammaZone[];
  showMaxPain: boolean;
  showGamma: boolean;
}

function priceLabel(value: number) {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

/** Lightweight SVG chart: no extra chart runtime and safe under Cronus page zoom. */
export function MaxPainCandlestickChart({
  klines,
  maxPainPoints,
  gammaZones,
  showMaxPain,
  showGamma,
}: Props) {
  const geometry = useMemo(() => {
    if (!klines.length) return null;
    const width = Math.max(1000, Math.min(9000, klines.length * 8));
    const height = 500;
    const margin = { top: 22, right: 90, bottom: 40, left: 18 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
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
      margin.top + ((maximum - price) / (maximum - minimum)) * innerHeight;
    return {
      width,
      height,
      margin,
      innerWidth,
      innerHeight,
      minimum,
      maximum,
      x,
      y,
    };
  }, [gammaZones, klines, maxPainPoints, showGamma, showMaxPain]);

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
    innerHeight,
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

  return (
    <div className="overflow-x-auto rounded-lg border border-primary/15 bg-[#071018] shadow-inner">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label="BTC K线、最大痛点与Gamma代理区叠加图"
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
          return (
            <g key={kline.openTime}>
              <line
                x1={center}
                x2={center}
                y1={y(kline.high)}
                y2={y(kline.low)}
                stroke={color}
                strokeWidth="1"
              />
              <rect
                x={center - candleWidth / 2}
                y={top}
                width={candleWidth}
                height={Math.max(bottom - top, 1)}
                fill={color}
                opacity="0.86"
              />
              <title>{`${new Date(kline.openTime).toISOString()}\nO ${priceLabel(kline.open)} H ${priceLabel(kline.high)} L ${priceLabel(kline.low)} C ${priceLabel(kline.close)}`}</title>
            </g>
          );
        })}

        {showMaxPain && maxPainPath ? (
          <path
            d={maxPainPath}
            fill="none"
            stroke="#38bdf8"
            strokeWidth="2.25"
          />
        ) : null}
        {showMaxPain &&
          maxPainPoints.map(point => (
            <circle
              key={`${point.timestamp}-${point.maturity}`}
              cx={x(point.timestamp)}
              cy={y(point.maxPain)}
              r="3.5"
              fill="#38bdf8"
              stroke="#e0f2fe"
              strokeWidth="1"
            >
              <title>{`${point.date} ${String(point.hourUtc).padStart(2, "0")}:00 UTC\nMax Pain ${priceLabel(point.maxPain)}\n到期 ${point.maturity}\nOI ${point.totalOi.toLocaleString()} BTC-eq`}</title>
            </circle>
          ))}

        {dateTicks.map(item => (
          <g key={`date-${item.openTime}`}>
            <line
              x1={x(item.openTime)}
              x2={x(item.openTime)}
              y1={margin.top + innerHeight}
              y2={margin.top + innerHeight + 5}
              stroke="#64748b"
            />
            <text
              x={x(item.openTime)}
              y={height - 14}
              fill="#9aa8b5"
              fontSize="11"
              textAnchor="middle"
            >
              {new Date(item.openTime)
                .toISOString()
                .slice(5, 16)
                .replace("T", " ")}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
