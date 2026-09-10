import {
  GAMMA_MODELS,
  type GammaModel,
  type SignedGammaSnapshot,
} from "@shared/maxPainGamma";
import {
  formatDisplayDateTime,
  type DisplayTimeZone,
} from "@shared/displayTimezone";
import { Switch } from "./ui/switch";
import { Link } from "wouter";

const dollars = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
export function gammaFlipLabel(s: SignedGammaSnapshot) {
  return s.flipStatus === "balanced"
    ? "逐Strike完全抵消，无唯一Flip"
    : s.flips.length
      ? s.flips.map(dollars).join(" / ")
      : "搜索范围内无Flip";
}

export function MaxPainGammaPanel({
  snapshots,
  model,
  setModel,
  visible,
  setVisible,
  flipVisible,
  setFlipVisible,
  timeZone,
  canViewFormulas,
}: {
  snapshots: SignedGammaSnapshot[];
  model: GammaModel;
  setModel: (m: GammaModel) => void;
  visible: boolean;
  setVisible: (v: boolean) => void;
  flipVisible: boolean;
  setFlipVisible: (v: boolean) => void;
  timeZone: DisplayTimeZone;
  canViewFormulas: boolean;
}) {
  const latest = snapshots.at(-1);
  return (
    <section
      className="mb-4 space-y-3 rounded-lg border border-amber-400/25 bg-amber-400/5 p-3"
      aria-label="Gamma 假设模型"
    >
      <div className="flex flex-wrap items-center gap-4 text-xs">
        <strong>正 / 负 Gamma 与 Gamma Flip（假设模型）</strong>
        <label className="flex items-center gap-2">
          方向假设
          <select
            aria-label="Gamma 方向假设"
            value={model}
            onChange={e => setModel(e.target.value as GammaModel)}
            className="rounded border border-border bg-background p-2"
          >
            {GAMMA_MODELS.map(m => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <Switch
            checked={visible}
            onCheckedChange={setVisible}
            aria-label="显示正负 Gamma 集中带"
          />
          正/负集中带
        </label>
        <label className="flex items-center gap-2">
          <Switch
            checked={flipVisible}
            onCheckedChange={setFlipVisible}
            aria-label="显示 Gamma Flip"
          />
          Gamma Flip
        </label>
        {canViewFormulas && (
          <Link
            href="/formulas#max-pain-gamma"
            className="text-sky-400 underline"
          >
            公式、来源与假设
          </Link>
        )}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        OI 不含客户/做市商持仓方向。颜色来自所选假设，并非测得的 Long/Short
        Gamma；Call 与 Put 本身不决定正负。 每日 UTC 00:00
        固定快照，按所选产品及到期日计算；日内不更新，最晚在到期时停止。
        青色为正集中带，橙色为负集中带，黄色虚线为检测到的 Flip。集中带是
        20%–80% 加权分位带，不是支撑/阻力预测。
      </p>
      {latest ? (
        <>
          <p className="text-xs text-muted-foreground">
            最新可用快照：
            {formatDisplayDateTime(latest.timestamp, timeZone, {
              includeZone: true,
            })}{" "}
            · 到期 {latest.maturity} · 参考价 {dollars(latest.spot)}
          </p>
          <div className="grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
            <div>
              <span className="text-xs text-muted-foreground">
                正 Gamma（假设）
              </span>
              <div className="font-mono text-teal-300">
                {dollars(latest.positiveGamma)}
              </div>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">
                负 Gamma（假设）
              </span>
              <div className="font-mono text-orange-300">
                {dollars(latest.negativeGamma)}
              </div>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">
                净 Gamma（假设）
              </span>
              <div className="font-mono">{dollars(latest.netGamma)}</div>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">
                Gamma Flip（假设）
              </span>
              <div className="text-yellow-300">{gammaFlipLabel(latest)}</div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Gamma 金额单位：USD Delta 变化 / BTC 变动 1%，不是期权赔付。Flip
            搜索范围：各快照参考价的 50%–150%；最新{" "}
            {dollars(latest.searchLower)}～{dollars(latest.searchUpper)}
            。无交点不代表全价格域无交点。
          </p>
          {snapshots.some(s => s.volatilityFallback) && (
            <p role="status" className="text-xs text-amber-300">
              部分日期不足 23 个有效相邻小时收益率，使用 60%
              年化波动率假设，详见下表。
            </p>
          )}
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              展开每日 Gamma 与 Flip 明细（{snapshots.length} 个快照）
            </summary>
            <div className="mt-2 max-h-80 overflow-auto">
              <table className="w-full whitespace-nowrap text-right">
                <thead>
                  <tr>
                    {[
                      "观察时点",
                      "Expiry",
                      "正Gamma USD/1%",
                      "负Gamma USD/1%",
                      "净Gamma USD/1%",
                      "Gamma Flip",
                      "年化RV / 样本",
                    ].map(s => (
                      <th className="p-2" key={s}>
                        {s}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...snapshots].reverse().map(s => (
                    <tr
                      key={`${s.date}-${s.maturity}`}
                      className="border-t border-border/50"
                    >
                      <td className="p-2">
                        {formatDisplayDateTime(s.timestamp, timeZone, {
                          includeZone: true,
                        })}
                      </td>
                      <td className="p-2">{s.maturity}</td>
                      <td className="p-2 text-teal-300">
                        {dollars(s.positiveGamma)}
                      </td>
                      <td className="p-2 text-orange-300">
                        {dollars(s.negativeGamma)}
                      </td>
                      <td className="p-2">{dollars(s.netGamma)}</td>
                      <td className="p-2 text-yellow-300">
                        {gammaFlipLabel(s)}
                      </td>
                      <td className="p-2">
                        {(s.volatility * 100).toFixed(1)}% /{" "}
                        {s.volatilityReturns}
                        {s.volatilityFallback
                          ? "（60%假设）"
                          : s.volatilityFloor
                            ? "（5%下限）"
                            : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          计算历史区间后显示；缺少所选到期日的 00:00 OI 或已收盘参考价时，不填充
          Gamma/Flip。
        </p>
      )}
    </section>
  );
}
