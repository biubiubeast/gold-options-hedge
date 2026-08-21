import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Info, Loader2, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { formatReferenceSnapshotTime, POSITION_SOURCE_DEFAULTS, type PositionExcelPreview } from "@shared/positionExcel";
import { MarketRefreshButton } from "@/components/MarketRefreshButton";
import { calculatePosition, getPositionMarketData, type PortfolioPosition } from "@/lib/portfolio";
import { usePortfolioSettings } from "@/hooks/usePortfolioSettings";
import {
  DEFAULT_GLD_CONTRACT_MULTIPLIER,
  DEFAULT_XAUT_CONTRACT_MULTIPLIER,
  resolveGldContractMultiplier,
  resolveGldXauMultiplier,
  resolveXautContractMultiplier,
  resolveXautXauMultiplier,
} from "@shared/formulaEngine";

interface PositionForm {
  underlying: "XAUT" | "GLD" | "BTC";
  expiry: string;
  strike: string;
  optionType: "call" | "put";
  entryPrice: string;
  quantity: string;
  fee: string;
  entryDelta: string;
  sourceAccount: string;
  venue: string;
  instrument: string;
  currency: "USD" | "USDT";
  referenceDate: string;
  importedMarkPrice: string;
  multiplierXau: string;
  contractMultiplier: string;
  unitGamma: string;
  unitTheta: string;
  unitVega: string;
}

const defaultForm: PositionForm = {
  underlying: "XAUT", expiry: "", strike: "", optionType: "call", entryPrice: "", quantity: "", fee: "0", entryDelta: "",
  sourceAccount: POSITION_SOURCE_DEFAULTS.XAUT.sourceAccount, venue: POSITION_SOURCE_DEFAULTS.XAUT.venue, instrument: "", currency: "USDT", referenceDate: "", importedMarkPrice: "",
  multiplierXau: "1", contractMultiplier: "1", unitGamma: "", unitTheta: "", unitVega: "",
};

const nullable = (value: string) => value.trim() || null;
const numeric = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const money = (value: unknown) => {
  const parsed = numeric(value);
  return parsed === null ? "—" : parsed.toLocaleString("en-US", { maximumFractionDigits: 2 });
};

function bufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

function downloadBase64(base64: string, mimeType: string, fileName: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function Positions() {
  const utils = trpc.useUtils();
  const { data: positions, isLoading } = trpc.positions.list.useQuery();
  const { data: spotPrices } = trpc.market.spotPrices.useQuery(undefined, { refetchInterval: 10_000 });
  const { data: formulas } = trpc.formulas.list.useQuery();
  const { data: xautTickers } = trpc.market.xautTickers.useQuery(undefined, { refetchInterval: 10_000 });
  const { data: btcTickers } = trpc.market.btcTickers.useQuery(undefined, { refetchInterval: 10_000 });
  const { settings } = usePortfolioSettings();
  const gldXauMultiplier = resolveGldXauMultiplier(formulas?.length ? formulas : [], settings.gldSpotScaleOverride ?? 0.092);
  const xautXauMultiplier = resolveXautXauMultiplier(formulas?.length ? formulas : [], settings.xautSpotScaleOverride ?? 1);
  const gldContractMultiplier = resolveGldContractMultiplier(formulas?.length ? formulas : [], settings.gldContractMultiplier);
  const xautContractMultiplier = resolveXautContractMultiplier(formulas?.length ? formulas : [], settings.xautContractMultiplier);
  const exportExcelQuery = trpc.positions.exportExcel.useQuery(undefined, { enabled: false });
  const exportMarketRefreshMutation = trpc.positions.refreshMarketData.useMutation();
  const previewMutation = trpc.positions.previewExcel.useMutation({ onError: error => toast.error(error.message) });
  const importMutation = trpc.positions.importExcel.useMutation({
    onSuccess: result => {
      utils.positions.list.invalidate();
      setImportOpen(false);
      setPreview(null);
      toast.success(`已导入：新增 ${result.created}、更新 ${result.updated}、移除 ${result.removed}；导入前备份 ${result.backupName}`);
    },
    onError: error => toast.error(error.message),
  });
  const createMutation = trpc.positions.create.useMutation({
    onSuccess: () => { utils.positions.list.invalidate(); toast.success("仓位已添加"); setOpen(false); },
    onError: error => toast.error(error.message),
  });
  const updateMutation = trpc.positions.update.useMutation({
    onSuccess: () => { utils.positions.list.invalidate(); toast.success("仓位已更新"); setOpen(false); },
    onError: error => toast.error(error.message),
  });
  const deleteMutation = trpc.positions.delete.useMutation({
    onSuccess: () => { utils.positions.list.invalidate(); toast.success("仓位已删除"); },
    onError: error => toast.error(error.message),
  });

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<PositionForm>(defaultForm);
  const [importOpen, setImportOpen] = useState(false);
  const [preview, setPreview] = useState<PositionExcelPreview | null>(null);
  const [importMode, setImportMode] = useState<"replace" | "upsert">("replace");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const summary = useMemo(() => {
    const all = positions ?? [];
    const forUnderlying = (value: "XAUT" | "GLD" | "BTC") => all.filter(position => position.underlying === value);
    const latestReference = [...all]
      .filter(position => position.referenceDate)
      .sort((left, right) => left.referenceDate!.localeCompare(right.referenceDate!)
        || new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
      .at(-1);
    return {
      count: all.length,
      xaut: forUnderlying("XAUT").length,
      gld: forUnderlying("GLD").length,
      btc: forUnderlying("BTC").length,
      xautQty: forUnderlying("XAUT").reduce((sum, position) => sum + Number(position.quantity), 0),
      gldQty: forUnderlying("GLD").reduce((sum, position) => sum + Number(position.quantity), 0),
      btcQty: forUnderlying("BTC").reduce((sum, position) => sum + Number(position.quantity), 0),
      referenceDate: formatReferenceSnapshotTime(latestReference?.referenceDate, latestReference?.createdAt),
    };
  }, [positions]);

  const formPayload = () => ({
    underlying: form.underlying,
    expiry: form.expiry,
    strike: form.strike,
    optionType: form.optionType,
    entryPrice: form.entryPrice,
    quantity: form.quantity,
    fee: form.fee,
    entryDelta: form.entryDelta,
    sourceAccount: nullable(form.sourceAccount),
    venue: nullable(form.venue),
    instrument: nullable(form.instrument),
    currency: form.currency,
    referenceDate: nullable(form.referenceDate),
    importedMarkPrice: nullable(form.importedMarkPrice),
    multiplierXau: nullable(form.multiplierXau),
    contractMultiplier: nullable(form.contractMultiplier),
    unitGamma: nullable(form.unitGamma),
    unitTheta: nullable(form.unitTheta),
    unitVega: nullable(form.unitVega),
    dataStatus: form.importedMarkPrice ? "STALE" as const : "WARN" as const,
  });

  const handleSubmit = () => {
    if (!form.expiry || !form.strike || !form.entryPrice || !form.quantity || !form.entryDelta) {
      toast.error("请填写所有必填字段");
      return;
    }
    const payload = formPayload();
    if (editId) updateMutation.mutate({ id: editId, ...payload });
    else createMutation.mutate(payload);
  };

  const handleEdit = (position: PortfolioPosition) => {
    setEditId(position.id);
    setForm({
      underlying: position.underlying, expiry: position.expiry, strike: position.strike, optionType: position.optionType,
      entryPrice: position.entryPrice, quantity: position.quantity, fee: position.fee, entryDelta: position.entryDelta,
      sourceAccount: position.sourceAccount ?? POSITION_SOURCE_DEFAULTS[position.underlying].sourceAccount, venue: position.venue ?? POSITION_SOURCE_DEFAULTS[position.underlying].venue, instrument: position.instrument ?? "",
      currency: position.currency ?? (position.underlying === "GLD" ? "USD" : "USDT"), referenceDate: position.referenceDate ?? "",
      importedMarkPrice: position.importedMarkPrice ?? "", multiplierXau: position.multiplierXau ?? (position.underlying === "GLD" ? String(gldXauMultiplier) : position.underlying === "XAUT" ? String(xautXauMultiplier) : ""),
      contractMultiplier: position.contractMultiplier ?? (position.underlying === "GLD" ? String(gldContractMultiplier) : position.underlying === "XAUT" ? String(xautContractMultiplier) : String(settings.btcContractMultiplier)), unitGamma: position.unitGamma ?? "",
      unitTheta: position.unitTheta ?? "", unitVega: position.unitVega ?? "",
    });
    setOpen(true);
  };

  const handleNew = () => {
    setEditId(null);
    setForm({
      ...defaultForm,
      multiplierXau: String(xautXauMultiplier),
      contractMultiplier: String(xautContractMultiplier),
    });
    setOpen(true);
  };

  const handleFile = async (file?: File) => {
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) return toast.error("请选择 .xlsx 文件");
    if (file.size > 12_000_000) return toast.error("Excel 文件不能超过 12 MB");
    setPreview(null);
    const base64 = bufferToBase64(await file.arrayBuffer());
    const result = await previewMutation.mutateAsync({ fileName: file.name, base64 });
    setPreview(result);
  };

  const confirmImport = () => {
    if (!preview || preview.errors.length || preview.positions.length === 0) return;
    importMutation.mutate({ mode: importMode, positions: preview.positions });
  };

  const handleExportExcel = async () => {
    try {
      const refreshed = await exportMarketRefreshMutation.mutateAsync({
        gldMultiplierXau: gldXauMultiplier,
        xautMultiplierXau: xautXauMultiplier,
        btcMultiplierXau: settings.btcSpotScaleOverride,
      });
      await utils.positions.list.invalidate();
      const result = await exportExcelQuery.refetch();
      if (!result.data) return toast.error("Excel 导出失败");
      downloadBase64(result.data.base64, result.data.mimeType, result.data.fileName);
      toast.success(`已更新 ${refreshed.updated}/${refreshed.total} 条市场数据并导出 Excel；缺失 ${refreshed.missing.length} 条`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "市场数据更新或 Excel 导出失败");
    }
  };
  const notionalSize = (position: NonNullable<typeof positions>[number]) => {
    const xautSpot = Number(spotPrices?.xaut?.price);
    const gldSpot = Number(spotPrices?.gld?.price);
    const xauSpot = Number(spotPrices?.gold?.price);
    const btcSpot = Number(spotPrices?.btc?.price);
    if (![xautSpot, gldSpot, btcSpot, xauSpot].every(Number.isFinite)) return null;
    const market = getPositionMarketData({ position: position as PortfolioPosition, xautTickers, btcTickers, gldSpot, formulas, settings });
    return calculatePosition({ position: position as PortfolioPosition, market, xautSpot, btcSpot, gldSpot, xauSpot, formulas, settings }).notionalSize;
  };
  const effectiveMultipliers = (position: NonNullable<typeof positions>[number]) => {
    const importedContract = numeric(position.contractMultiplier);
    if (position.underlying === "GLD") {
      const adjusted = importedContract !== null && Math.abs(importedContract - DEFAULT_GLD_CONTRACT_MULTIPLIER) > 1e-9;
      return { contract: adjusted ? importedContract : gldContractMultiplier, xau: adjusted ? numeric(position.multiplierXau) ?? gldXauMultiplier : gldXauMultiplier };
    }
    if (position.underlying === "XAUT") {
      const nonStandard = importedContract !== null && Math.abs(importedContract - DEFAULT_XAUT_CONTRACT_MULTIPLIER) > 1e-9;
      return { contract: nonStandard ? importedContract : xautContractMultiplier, xau: nonStandard ? numeric(position.multiplierXau) ?? xautXauMultiplier : xautXauMultiplier };
    }
    return { contract: importedContract ?? settings.btcContractMultiplier, xau: numeric(position.multiplierXau) ?? settings.btcSpotScaleOverride };
  };

  if (isLoading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gold-gradient">期权仓位管理</h1>
          <p className="mt-1 text-sm text-muted-foreground">Excel 快照是主导入流程；手工录入用于临时修正或单腿补录。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {settings.pageMarketRefreshButtons.positions && <MarketRefreshButton />}
          <Button variant="outline" onClick={handleExportExcel} className="gap-2" disabled={exportExcelQuery.isFetching || exportMarketRefreshMutation.isPending || !positions?.length}>
            {exportExcelQuery.isFetching || exportMarketRefreshMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} 更新行情并导出 Excel
          </Button>
          <Dialog open={importOpen} onOpenChange={value => { setImportOpen(value); if (!value) setPreview(null); }}>
            <DialogTrigger asChild><Button variant="outline" className="gap-2"><Upload className="h-4 w-4" /> 上传持仓 Excel</Button></DialogTrigger>
            <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-5xl">
              <DialogHeader><DialogTitle>上传、校验并更新仓位</DialogTitle><DialogDescription>校验 期权持仓_XAUT_GLD 的29列必需结构；Shares/Contract及4列Unit Greeks可选，再选择替换或更新。</DialogDescription></DialogHeader>
              <input ref={fileInputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={event => handleFile(event.target.files?.[0])} />
              <button type="button" onClick={() => fileInputRef.current?.click()} className="flex min-h-28 w-full flex-col items-center justify-center gap-2 border border-dashed border-primary/50 bg-primary/5 text-sm hover:bg-primary/10">
                {previewMutation.isPending ? <Loader2 className="h-7 w-7 animate-spin text-primary" /> : <FileSpreadsheet className="h-7 w-7 text-primary" />}
                <span>{previewMutation.isPending ? "正在读取并核对公式/汇总…" : "选择 期权持仓_XAUT_GLD 格式的 .xlsx 文件"}</span>
                <span className="text-xs text-muted-foreground">上限 12 MB；先预览，不会立即覆盖数据</span>
              </button>
              {preview && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
                    {[
                      ["文件", preview.fileName], ["工作表", preview.sheetName], ["Reference", preview.referenceDate ?? "MISSING"],
                      ["明细", preview.summary.detailRows], ["XAUT", `${preview.summary.xautRows} / Qty ${preview.summary.xautNetQty}`], ["GLD", `${preview.summary.gldRows} / Qty ${preview.summary.gldNetQty}`], ["BTC", `${preview.summary.btcRows} / Qty ${preview.summary.btcNetQty}`],
                    ].map(([label, value]) => <div key={String(label)} className="border border-border/60 bg-secondary/20 p-2"><p className="text-[10px] uppercase text-muted-foreground">{label}</p><p className="truncate font-mono text-xs" title={String(value)}>{value}</p></div>)}
                  </div>
                  <div className={`flex items-center gap-2 border p-2 text-xs ${preview.exactHeaderMatch ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-amber-500/40 bg-amber-500/10 text-amber-200"}`}>
                    {preview.exactHeaderMatch ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                    {preview.exactHeaderMatch
                      ? preview.extendedHeaderMatch ? "34列新版模板完整匹配（29列必需字段 + 5列合约规格/Unit Greeks）。" : "29列必需字段完整匹配；新增5列可以不提供，系统会按标准规格及Total Greeks推导。"
                      : "必需列可识别但并非完全同序；请检查预览警告。"}
                  </div>
                  {(preview.errors.length > 0 || preview.warnings.length > 0) && <div className="grid gap-2 md:grid-cols-2">
                    <div className="border border-red-500/30 bg-red-500/5 p-2 text-xs"><strong>Errors ({preview.errors.length})</strong>{preview.errors.length ? preview.errors.map(message => <p key={message} className="mt-1 text-red-300">{message}</p>) : <p className="mt-1 text-muted-foreground">无阻断错误</p>}</div>
                    <div className="border border-amber-500/30 bg-amber-500/5 p-2 text-xs"><strong>Warnings ({preview.warnings.length})</strong>{preview.warnings.length ? preview.warnings.slice(0, 10).map(message => <p key={message} className="mt-1 text-amber-200">{message}</p>) : <p className="mt-1 text-muted-foreground">无警告</p>}</div>
                  </div>}
                  <div className="max-h-64 overflow-auto border border-border/60">
                    <Table><TableHeader><TableRow><TableHead>Instrument</TableHead><TableHead>U</TableHead><TableHead>Expiry</TableHead><TableHead>Strike</TableHead><TableHead>Qty</TableHead><TableHead>Mark</TableHead><TableHead>Total Δ XAU</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                      <TableBody>{preview.positions.slice(0, 15).map(position => <TableRow key={`${position.importRow}-${position.instrument}`}><TableCell className="max-w-56 truncate font-mono text-[11px]">{position.instrument}</TableCell><TableCell>{position.underlying}</TableCell><TableCell className="font-mono text-xs">{position.expiry}</TableCell><TableCell className="font-mono">{position.strike}</TableCell><TableCell className="font-mono">{position.quantity}</TableCell><TableCell className="font-mono">{position.importedMarkPrice ?? "MISSING"}</TableCell><TableCell className="font-mono">{position.importedTotalDeltaXau ?? "MISSING"}</TableCell><TableCell><Badge variant="outline">{position.dataStatus}</Badge></TableCell></TableRow>)}</TableBody>
                    </Table>
                  </div>
                  <div className="flex flex-wrap items-end justify-between gap-3 border-t border-border pt-3">
                    <div className="w-72"><Label>更新模式</Label><Select value={importMode} onValueChange={value => setImportMode(value as typeof importMode)}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="replace">替换快照（推荐）</SelectItem><SelectItem value="upsert">按 Instrument 更新/新增</SelectItem></SelectContent></Select><p className="mt-1 text-[11px] text-muted-foreground">替换只影响当前登录用户；写入前自动备份。</p></div>
                    <Button onClick={confirmImport} disabled={Boolean(preview.errors.length) || !preview.positions.length || importMutation.isPending} className="gap-2">{importMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}确认导入 {preview.positions.length} 条明细</Button>
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button onClick={handleNew} className="gap-2"><Plus className="h-4 w-4" /> 添加仓位</Button></DialogTrigger>
            <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
              <DialogHeader><DialogTitle>{editId ? "编辑仓位" : "添加新仓位"}</DialogTitle><DialogDescription>核心合约信息为必填；账户、快照和 Unit Greeks 可展开补充。</DialogDescription></DialogHeader>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div><Label>Underlying *</Label><Select value={form.underlying} onValueChange={(value: "XAUT" | "GLD" | "BTC") => { const defaults = POSITION_SOURCE_DEFAULTS[value]; setForm({ ...form, underlying: value, sourceAccount: defaults.sourceAccount, venue: defaults.venue, currency: value === "GLD" ? "USD" : "USDT", contractMultiplier: String(value === "GLD" ? gldContractMultiplier : value === "BTC" ? settings.btcContractMultiplier : xautContractMultiplier), multiplierXau: String(value === "GLD" ? gldXauMultiplier : value === "BTC" ? settings.btcSpotScaleOverride ?? "" : xautXauMultiplier) }); }}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="XAUT">XAUT</SelectItem><SelectItem value="GLD">GLD</SelectItem><SelectItem value="BTC">BTC</SelectItem></SelectContent></Select></div>
                <div><Label>Call / Put *</Label><Select value={form.optionType} onValueChange={(value: "call" | "put") => setForm({ ...form, optionType: value })}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="call">Call</SelectItem><SelectItem value="put">Put</SelectItem></SelectContent></Select></div>
                <div><Label>Expiry *</Label><Input type="date" value={form.expiry} onChange={event => setForm({ ...form, expiry: event.target.value })} className="mt-1" /></div>
                <div><Label>Strike *</Label><Input type="number" step="0.01" value={form.strike} onChange={event => setForm({ ...form, strike: event.target.value })} className="mt-1" /></div>
                <div><Label>Entry Price / Share or Unit *</Label><Input type="number" step="any" value={form.entryPrice} onChange={event => setForm({ ...form, entryPrice: event.target.value })} className="mt-1" /></div>
                <div><Label>Net Qty (Contracts) *</Label><Input type="number" step="any" value={form.quantity} onChange={event => setForm({ ...form, quantity: event.target.value })} className="mt-1" /></div>
                <div><Label>Fee</Label><Input type="number" step="any" value={form.fee} onChange={event => setForm({ ...form, fee: event.target.value })} className="mt-1" /></div>
                <div><Label>Unit Delta *</Label><Input type="number" step="any" value={form.entryDelta} onChange={event => setForm({ ...form, entryDelta: event.target.value })} className="mt-1" /></div>
              </div>
              <details className="border border-border/60 p-3" open>
                <summary className="cursor-pointer text-sm font-medium">账户、市场快照与 Unit Greeks</summary>
                <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                  {[
                    ["Source Account", "sourceAccount", "text"], ["Venue", "venue", "text"], ["Instrument", "instrument", "text"], ["Reference Date", "referenceDate", "date"],
                    ["Mark Price / Share or Unit", "importedMarkPrice", "number"], ["Multiplier XAU / Share or Unit", "multiplierXau", "number"], ["Shares/Contract", "contractMultiplier", "number"], ["Unit Gamma", "unitGamma", "number"],
                    ["Unit Theta", "unitTheta", "number"], ["Unit Vega", "unitVega", "number"],
                  ].map(([label, key, type]) => <div key={key}><Label>{label}</Label><Input type={type} step="any" value={form[key as keyof PositionForm]} onChange={event => setForm({ ...form, [key]: event.target.value })} className="mt-1" /></div>)}
                  <div><Label>Currency</Label><Select value={form.currency} onValueChange={(value: "USD" | "USDT") => setForm({ ...form, currency: value })}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="USD">USD</SelectItem><SelectItem value="USDT">USDT</SelectItem></SelectContent></Select></div>
                </div>
              </details>
              <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setOpen(false)}>取消</Button><Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending}>{(createMutation.isPending || updateMutation.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{editId ? "更新" : "添加"}</Button></div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {[["Positions", summary.count], ["XAUT", `${summary.xaut} / Qty ${summary.xautQty}`], ["GLD", `${summary.gld} / Qty ${summary.gldQty}`], ["BTC", `${summary.btc} / Qty ${summary.btcQty}`], ["Reference Date / Time", summary.referenceDate], ["Import Status", positions?.some(position => position.importSource) ? "EXCEL SNAPSHOT" : "MANUAL"]].map(([label, value]) => <Card key={String(label)} className="glass-card"><CardContent className="p-3"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 truncate font-mono text-xs font-semibold" title={String(value)}>{value}</p></CardContent></Card>)}
      </div>

      <Card className="glass-card">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[2350px]">
              <TableHeader><TableRow><TableHead>Source / Venue</TableHead><TableHead>Instrument</TableHead><TableHead>U</TableHead><TableHead>Expiry</TableHead><TableHead>Strike</TableHead><TableHead>C/P</TableHead><TableHead>Qty (Contracts)</TableHead><TableHead>Shares/Contract × XAU/Unit</TableHead><TableHead>Notional USD</TableHead><TableHead>Mark / Unit</TableHead><TableHead>Mark IV</TableHead><TableHead>Bid / Ask</TableHead><TableHead>Entry / Unit</TableHead><TableHead>MV</TableHead><TableHead>Entry Cost</TableHead><TableHead>UPL</TableHead><TableHead>Unit Δ</TableHead><TableHead>Unit Γ</TableHead><TableHead>Unit Θ</TableHead><TableHead>Unit Vega</TableHead><TableHead>Total Δ XAU</TableHead><TableHead>Γ XAU</TableHead><TableHead>Θ USD/d</TableHead><TableHead>Vega USD/v</TableHead><TableHead>As-of / Source</TableHead><TableHead>Status</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader>
              <TableBody>{positions?.length ? positions.map(position => (
                <TableRow key={position.id} className="hover:bg-secondary/30">
                  <TableCell className="max-w-48"><p className="truncate text-xs" title={position.sourceAccount ?? POSITION_SOURCE_DEFAULTS[position.underlying].sourceAccount}>{position.sourceAccount ?? POSITION_SOURCE_DEFAULTS[position.underlying].sourceAccount}</p><p className="truncate text-[10px] text-muted-foreground">{position.venue ?? POSITION_SOURCE_DEFAULTS[position.underlying].venue}</p></TableCell>
                  <TableCell className="max-w-64 truncate font-mono text-[11px]" title={position.instrument ?? ""}>{position.instrument ?? `${position.underlying}-${position.expiry}-${position.strike}`}</TableCell>
                  <TableCell><Badge variant={position.underlying === "XAUT" ? "default" : "secondary"}>{position.underlying}</Badge></TableCell>
                  <TableCell className="font-mono text-xs">{position.expiry}</TableCell><TableCell className="font-mono">{position.strike}</TableCell>
                  <TableCell><Badge variant="outline" className={position.optionType === "call" ? "text-green-400" : "text-red-400"}>{position.optionType.toUpperCase()}</Badge></TableCell>
                  <TableCell className="font-mono">{position.quantity}</TableCell><TableCell className="font-mono text-xs">{effectiveMultipliers(position).contract} × {effectiveMultipliers(position).xau ?? "—"} XAU</TableCell>
                  <TableCell className="font-mono" title="Signed Qty × contract multiplier × current underlying spot">{notionalSize(position) === null ? "—" : `$${money(notionalSize(position))}`}</TableCell>
                  <TableCell className="font-mono">{position.importedMarkPrice ?? "—"}</TableCell>
                  <TableCell className="font-mono">{position.markIv ? `${(Number(position.markIv) * 100).toFixed(2)}%` : "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{position.bid1Price ?? "—"} / {position.ask1Price ?? "—"}</TableCell>
                  <TableCell className="font-mono">{position.entryPrice}</TableCell>
                  <TableCell className="font-mono">{money(position.importedMarketValue)}</TableCell><TableCell className="font-mono">{money(position.importedEntryCost)}</TableCell>
                  <TableCell className={`font-mono ${Number(position.importedUnrealizedPnl) >= 0 ? "text-emerald-400" : "text-red-400"}`}>{money(position.importedUnrealizedPnl)}</TableCell>
                  <TableCell className="font-mono">{money(position.entryDelta)}</TableCell><TableCell className="font-mono">{money(position.unitGamma)}</TableCell><TableCell className="font-mono">{money(position.unitTheta)}</TableCell><TableCell className="font-mono">{money(position.unitVega)}</TableCell><TableCell className="font-mono">{money(position.importedTotalDeltaXau)}</TableCell>
                  <TableCell className="font-mono">{money(position.importedTotalGammaXau)}</TableCell><TableCell className="font-mono">{money(position.importedTotalThetaUsdDay)}</TableCell><TableCell className="font-mono">{money(position.importedTotalVegaUsdVol)}</TableCell>
                  <TableCell className="max-w-60"><p className="truncate font-mono text-[10px]" title={position.marketQuoteTime ?? ""}>{position.marketQuoteTime?.replace("T", " ").slice(0, 19) ?? position.referenceDate ?? "MISSING"}</p><p className="truncate text-[10px] text-muted-foreground" title={position.marketSource ?? ""}>{position.marketSource ?? position.importSource ?? "MISSING"}</p></TableCell>
                  <TableCell><Badge variant="outline" className={position.dataStatus === "STALE" ? "border-amber-500/40 text-amber-300" : ""}>{position.dataStatus ?? (position.importSource ? "STALE" : "WARN")}</Badge></TableCell>
                  <TableCell className="text-right"><div className="flex justify-end gap-1"><Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEdit(position)}><Pencil className="h-3.5 w-3.5" /></Button><Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => { if (window.confirm(`确认删除 ${position.underlying} ${position.strike} ${position.optionType.toUpperCase()}？`)) deleteMutation.mutate({ id: position.id }); }}><Trash2 className="h-3.5 w-3.5" /></Button></div></TableCell>
                </TableRow>
              )) : <TableRow><TableCell colSpan={27} className="py-12 text-center text-muted-foreground"><FileSpreadsheet className="mx-auto mb-2 h-8 w-8 opacity-50" />上传持仓 Excel，或添加第一条仓位</TableCell></TableRow>}</TableBody>
            </Table>
          </div>
          {settings.positionsVisibleSections.marketPersistenceHint && <div className="flex items-center gap-2 border-t border-border/50 px-3 py-2 text-[11px] text-muted-foreground"><Info className="h-3.5 w-3.5 shrink-0" /><span>Notional USD = signed Net Qty × actual contract multiplier × current underlying spot；它是标的名义金额，不是期权 MV。“更新市场数据”会把 Mark、IV、Bid/Ask、Greeks、MV、UPL、Source 与 As-of 写入当前服务器的仓位记录，并用于页面和随后导出的 Excel；Render 免费实例重新部署或重建后可能恢复到部署时数据。</span></div>}
        </CardContent>
      </Card>
    </div>
  );
}
