import type { StrikeOi } from "@shared/maxPainResearch";
import {
  useMemo,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

interface Props {
  strikes: StrikeOi[];
  maxPain?: number;
  maturityLabel: string;
  spot?: number;
}

interface TooltipState {
  left: number;
  top: number;
  strike: number;
  callOi: number;
  putOi: number;
}

function price(value: number) {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function number(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function compact(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

/** Deribit-style stacked Call/Put OI distribution with a Max Pain marker. */
export function OpenInterestByStrikeChart({
  strikes,
  maxPain,
  maturityLabel,
  spot,
}: Props) {
  const [tooltip, setTooltip] = useState<TooltipState>();
  const geometry = useMemo(() => {
    if (!strikes.length) return null;
    const width = Math.max(1000, Math.min(9000, strikes.length * 22));
    const height = 430;
    const margin = { top: 30, right: 86, bottom: 58, left: 20 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const maximumOi = Math.max(
      ...strikes.map(row => row.callOi + row.putOi),
      1
    );
    const step = innerWidth / strikes.length;
    const x = (index: number) => margin.left + (index + 0.5) * step;
    const y = (oi: number) =>
      margin.top + innerHeight - (oi / maximumOi) * innerHeight;
    return {
      width,
      height,
      margin,
      innerWidth,
      innerHeight,
      maximumOi,
      step,
      x,
      y,
    };
  }, [strikes]);

  const showTooltip = (
    event: ReactPointerEvent<SVGGElement>,
    row: StrikeOi
  ) => {
    setTooltip({
      left: Math.max(8, Math.min(event.clientX + 14, window.innerWidth - 292)),
      top: Math.max(8, Math.min(event.clientY + 14, window.innerHeight - 230)),
      ...row,
    });
  };

  if (!geometry) {
    return (
      <div className="flex h-[360px] items-center justify-center rounded-lg border border-dashed border-border/70 text-sm text-muted-foreground">
        所选时点或产品没有可用的逐 Strike OI。
      </div>
    );
  }

  const {
    width,
    height,
    margin,
    innerWidth,
    innerHeight,
    maximumOi,
    step,
    x,
    y,
  } = geometry;
  const barWidth = Math.max(3, Math.min(16, step * 0.72));
  const yTicks = Array.from({ length: 5 }, (_, index) =>
    Math.round((maximumOi * (4 - index)) / 4)
  );
  const labelEvery = Math.max(1, Math.ceil(strikes.length / 12));
  const maxPainIndex = strikes.findIndex(row => row.strike === maxPain);

  return (
    <div className="relative">
      <div className="overflow-x-auto rounded-lg border border-primary/15 bg-[#071018] shadow-inner">
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${maturityLabel} Open Interest By Strike Price 与 Max Pain`}
          onPointerLeave={() => setTooltip(undefined)}
        >
          <rect width={width} height={height} fill="#071018" />
          {yTicks.map(tick => (
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
                fontSize="10"
              >
                {compact(tick)}
              </text>
            </g>
          ))}

          {strikes.map((row, index) => {
            const total = row.callOi + row.putOi;
            const callTop = y(row.callOi);
            const totalTop = y(total);
            const center = x(index);
            return (
              <g
                key={row.strike}
                onPointerEnter={event => showTooltip(event, row)}
                onPointerMove={event => showTooltip(event, row)}
              >
                <rect
                  x={center - Math.max(barWidth, 8) / 2}
                  y={margin.top}
                  width={Math.max(barWidth, 8)}
                  height={innerHeight}
                  fill="transparent"
                />
                <rect
                  x={center - barWidth / 2}
                  y={callTop}
                  width={barWidth}
                  height={Math.max(margin.top + innerHeight - callTop, 0.5)}
                  fill="#22d3ee"
                  opacity="0.8"
                  pointerEvents="none"
                />
                <rect
                  x={center - barWidth / 2}
                  y={totalTop}
                  width={barWidth}
                  height={Math.max(callTop - totalTop, 0.5)}
                  fill="#a78bfa"
                  opacity="0.84"
                  pointerEvents="none"
                />
                <title>{`${price(row.strike)}\nCall OI ${number(row.callOi)}\nPut OI ${number(row.putOi)}\nTotal OI ${number(total)} BTC-eq`}</title>
              </g>
            );
          })}

          {maxPainIndex >= 0 ? (
            <g pointerEvents="none">
              <line
                x1={x(maxPainIndex)}
                x2={x(maxPainIndex)}
                y1={margin.top}
                y2={margin.top + innerHeight}
                stroke="#38bdf8"
                strokeWidth="2"
                strokeDasharray="6 4"
              />
              <rect
                x={x(maxPainIndex) - 54}
                y={7}
                width="108"
                height="19"
                rx="5"
                fill="#0c4a6e"
              />
              <text
                x={x(maxPainIndex)}
                y={20}
                fill="#e0f2fe"
                fontSize="10"
                fontWeight="600"
                textAnchor="middle"
              >
                Max Pain {price(maxPain!)}
              </text>
            </g>
          ) : null}

          {strikes.map((row, index) =>
            index % labelEvery === 0 || index === strikes.length - 1 ? (
              <g key={`label-${row.strike}`}>
                <line
                  x1={x(index)}
                  x2={x(index)}
                  y1={margin.top + innerHeight}
                  y2={margin.top + innerHeight + 5}
                  stroke="#64748b"
                />
                <text
                  x={x(index)}
                  y={height - 18}
                  fill="#9aa8b5"
                  fontSize="10"
                  textAnchor="middle"
                >
                  {price(row.strike)}
                </text>
              </g>
            ) : null
          )}
        </svg>
      </div>
      {tooltip ? (
        <div
          className="pointer-events-none fixed z-[90] w-[276px] rounded-lg border border-primary/30 bg-[#071018]/95 p-3 text-xs shadow-2xl backdrop-blur"
          style={{ left: tooltip.left, top: tooltip.top }}
          role="tooltip"
        >
          <div className="mb-2 flex items-center justify-between gap-4">
            <span className="font-semibold text-primary">
              Strike {price(tooltip.strike)}
            </span>
            {tooltip.strike === maxPain ? (
              <span className="rounded bg-sky-500/15 px-2 py-0.5 text-sky-300">
                Max Pain
              </span>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between gap-4">
              <span className="text-slate-400">Call OI</span>
              <span className="font-mono text-cyan-300">
                {number(tooltip.callOi)} BTC-eq
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-slate-400">Put OI</span>
              <span className="font-mono text-violet-300">
                {number(tooltip.putOi)} BTC-eq
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-slate-400">总 OI</span>
              <span className="font-mono">
                {number(tooltip.callOi + tooltip.putOi)} BTC-eq
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-slate-400">Call / Put</span>
              <span className="font-mono">
                {tooltip.putOi
                  ? (tooltip.callOi / tooltip.putOi).toFixed(3)
                  : "∞"}
              </span>
            </div>
            {spot ? (
              <div className="flex justify-between gap-4">
                <span className="text-slate-400">OI Notional</span>
                <span className="font-mono">
                  {price((tooltip.callOi + tooltip.putOi) * spot)}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
