import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, RotateCcw, Save, RefreshCw, Trash2, Power } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DEFAULT_FORMULAS } from "@shared/marketTypes";
import { BID_ASK_IV_INVERSION_TOGGLE, isBidAskIvInversionEnabled } from "@shared/impliedVolatility";

type NewFormula = {
  name: string;
  category: "greeks" | "valuation" | "conversion" | "custom";
  expression: string;
  description: string;
  usedIn: string;
};

const emptyFormula: NewFormula = { name: "", category: "custom", expression: "", description: "", usedIn: "供其他公式引用" };

export default function Formulas() {
  const utils = trpc.useUtils();
  const { data: formulas, isLoading } = trpc.formulas.list.useQuery();
  const updateMutation = trpc.formulas.update.useMutation({
    onSuccess: async result => { await utils.invalidate(); toast.success(`公式已生效，已重算 ${result.recalculated} 条仓位`); setEditingId(null); },
    onError: error => toast.error(error.message),
  });
  const createMutation = trpc.formulas.create.useMutation({
    onSuccess: () => { utils.formulas.list.invalidate(); toast.success("公式已添加，可在其他公式中直接引用其名称"); setCreateOpen(false); setNewFormula(emptyFormula); },
    onError: error => toast.error(error.message),
  });
  const deleteMutation = trpc.formulas.delete.useMutation({
    onSuccess: () => { utils.formulas.list.invalidate(); toast.success("自定义公式已删除"); },
    onError: error => toast.error(error.message),
  });
  const resetMutation = trpc.formulas.reset.useMutation({
    onSuccess: async result => { await utils.invalidate(); toast.success(`已恢复默认并重算 ${result.recalculated} 条仓位`); },
    onError: error => toast.error(error.message),
  });
  const resetAllMutation = trpc.formulas.resetAll.useMutation({
    onSuccess: async result => { await utils.invalidate(); toast.success(`所有公式已恢复默认，已重算 ${result.recalculated} 条仓位`); },
    onError: error => toast.error(error.message),
  });

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editExpression, setEditExpression] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editUsedIn, setEditUsedIn] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newFormula, setNewFormula] = useState<NewFormula>(emptyFormula);
  const builtInNames = new Set(DEFAULT_FORMULAS.map(formula => formula.name));
  const ivInversionEnabled = isBidAskIvInversionEnabled(formulas ?? []);

  if (isLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  const grouped = (formulas || []).reduce<Record<string, typeof formulas>>((groups, formula) => {
    (groups[formula.category] ||= []).push(formula);
    return groups;
  }, {});
  const categoryLabels: Record<string, string> = { greeks: "Greeks", valuation: "估值", conversion: "XAU 量纲转换", custom: "自定义组件" };
  const categoryColors: Record<string, string> = { greeks: "text-blue-400 border-blue-400/30", valuation: "text-green-400 border-green-400/30", conversion: "text-purple-400 border-purple-400/30", custom: "text-amber-400 border-amber-400/30" };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gold-gradient">公式管理</h1>
          <p className="text-sm text-muted-foreground mt-1">这里的表达式直接驱动量纲、合约规格、模型估值、IV价格反解与 Greeks 汇总</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild><Button variant="outline" className="gap-2"><Plus className="w-4 h-4" />添加公式</Button></DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader><DialogTitle>添加可引用公式</DialogTitle></DialogHeader>
              <div className="space-y-4 mt-3">
                <div><Label>公式名称</Label><Input className="mt-1 font-mono" placeholder="my_adjustment" value={newFormula.name} onChange={event => setNewFormula({ ...newFormula, name: event.target.value })} /></div>
                <div><Label>分类</Label><Select value={newFormula.category} onValueChange={(category: NewFormula["category"]) => setNewFormula({ ...newFormula, category })}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="custom">自定义</SelectItem><SelectItem value="greeks">Greeks</SelectItem><SelectItem value="valuation">估值</SelectItem><SelectItem value="conversion">转换</SelectItem></SelectContent></Select></div>
                <div><Label>表达式</Label><Textarea className="mt-1 font-mono" placeholder="markPrice * quantity" value={newFormula.expression} onChange={event => setNewFormula({ ...newFormula, expression: event.target.value })} /></div>
                <div><Label>说明</Label><Input className="mt-1" value={newFormula.description} onChange={event => setNewFormula({ ...newFormula, description: event.target.value })} /></div>
                <div><Label>引用位置</Label><Input className="mt-1" value={newFormula.usedIn} onChange={event => setNewFormula({ ...newFormula, usedIn: event.target.value })} /></div>
                <Button className="w-full" disabled={createMutation.isPending} onClick={() => createMutation.mutate(newFormula)}>{createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}添加并启用</Button>
              </div>
            </DialogContent>
          </Dialog>
          <Button variant="outline" onClick={() => resetAllMutation.mutate()} disabled={resetAllMutation.isPending} className="gap-2"><RefreshCw className="w-4 h-4" />恢复所有默认</Button>
        </div>
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-4 text-xs text-muted-foreground leading-relaxed">
          支持 <code>+ - * / ^</code>、括号，以及 <code>sqrt / ln / exp / abs / min / max / pow / N / PDF</code>。变量名和可用变量写在各公式说明中；要复用自定义公式，只需在另一条表达式中写它的名称，例如 <code>current_value + my_adjustment</code>。系统会阻止未知变量和循环引用；错误公式不会保存。
          <br />可用变量：<code>S, K, T, r, sigma, entryPrice, quantity, fee, markPrice, contractMultiplier, currentValue, entryCost, underlyingPrice, xauUsdPrice, delta, gamma, theta, vega, spotScale</code>。四个全局规格公式 <code>gld_xau_multiplier / xaut_xau_multiplier / gld_contract_multiplier / xaut_contract_multiplier</code> 必须返回不依赖行情变量的正数。
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardContent className="p-4">
          <details open>
            <summary className="cursor-pointer text-sm font-semibold">完整使用说明：公式如何影响页面、哪些规则不是表达式</summary>
            <div className="mt-3 grid gap-3 text-xs text-muted-foreground lg:grid-cols-2">
              <div className="border border-border/60 p-3"><strong className="text-foreground">1. 编辑与发布</strong><p className="mt-1 leading-relaxed">点击任一公式的“编辑”，可同时修改表达式、业务说明和生效位置。点击“验证并保存”后，系统检查语法、未知变量和循环引用，并立即重算服务器中的仓位数据；Dashboard、仓位管理、市场热力图、详情和随后导出的 Excel 使用同一结果。内置公式可单独恢复，也可恢复所有默认。</p></div>
              <div className="border border-border/60 p-3"><strong className="text-foreground">2. GLD/XAUT 量纲与合约规格</strong><p className="mt-1 leading-relaxed"><code>gld_xau_multiplier = 0.092</code>、<code>xaut_xau_multiplier = 1</code> 定义 XAU 统一量纲；<code>gld_contract_multiplier = 100</code>、<code>xaut_contract_multiplier = 1</code> 定义每张期权对应的标的数量。Total Delta 乘一次 XAU 比例，Total Gamma 乘比例平方；Theta/Vega 已是 USD 量纲，不乘 XAU 比例，但仍乘合约数量。调整或非标准合约继续优先采用逐仓位实际规格。</p></div>
              <div className="border border-border/60 p-3"><strong className="text-foreground">3. Market IV 与 Model IV 边界</strong><p className="mt-1 leading-relaxed">Market Mark/Bid/Ask IV 只展示交易所或数据商直接返回的字段。Model Mark/Bid/Ask IV 使用对应期权价格和同一快照的 IV Reference Spot 数值反解，统一标记为 MODEL，绝不写回或冒充 Market IV。<code>bid_ask_iv_inversion_enabled</code> 控制整组 Model IV；模型价格由 <code>iv_inversion_model_price_call/put</code> 编辑。</p></div>
              <div className="border border-border/60 p-3"><strong className="text-foreground">4. Largest Data Error</strong><p className="mt-1 leading-relaxed">这是固定的数据质量排序，不是交易公式：FAIL &gt; MISSING &gt; STALE &gt; WARN &gt; LIVE；同级按 Quote Age 最大排序。缺 Source、Mark、Multiplier 或 Greeks 显示 MISSING；Quote Age 超过 15 分钟显示 STALE。该规则为安全校验，不能被自定义表达式改成静默的 0。</p></div>
              <div className="border border-border/60 p-3"><strong className="text-foreground">5. 热力颜色、固定范围与 Roll Priority</strong><p className="mt-1 leading-relaxed">热力颜色为低值绿色、中值黄色、高值红色；默认按当前 metric 做 99 分位裁剪。矩阵页可为每个 metric 单独保存固定 MIN/MAX，切换 GLD/XAUT 时继续使用同一范围以便横向比较。Roll Priority 是透明加权 heuristic（DTE、Theta/MV、距 Strike、Delta、Spread、Time Value、Hedge Contribution、Residual Improvement），详情可在矩阵格弹窗展开。</p></div>
            </div>
          </details>
        </CardContent>
      </Card>

      {Object.entries(grouped).map(([category, categoryFormulas]) => (
        <section key={category} className="space-y-3">
          <Badge variant="outline" className={categoryColors[category] || ""}>{categoryLabels[category] || category}</Badge>
          {categoryFormulas?.map(formula => {
            const isBuiltIn = builtInNames.has(formula.name as (typeof DEFAULT_FORMULAS)[number]["name"]);
            const isIvInversionToggle = formula.name === BID_ASK_IV_INVERSION_TOGGLE;
            return (
              <Card key={formula.id} className="glass-card">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-medium text-primary">{formula.name}</span>
                        <Badge variant="outline" className="text-[10px]">{isBuiltIn ? "内置钩子" : "可引用组件"}</Badge>
                        {isIvInversionToggle && <Badge variant="outline" className={`text-[10px] ${ivInversionEnabled ? "border-sky-400/40 text-sky-300" : "border-muted text-muted-foreground"}`}>IV反解 {ivInversionEnabled ? "ON" : "OFF"}</Badge>}
                        {formula.isDefault === 0 && <Badge variant="outline" className="text-[10px] text-yellow-400 border-yellow-400/30">已修改</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">{formula.description}</p>
                      <p className="text-xs text-muted-foreground/80"><span className="text-primary/80">生效位置：</span>{formula.usedIn || "—"}</p>
                      {editingId === formula.id ? (
                        <div className="space-y-2 pt-2">
                          <Label>表达式</Label>
                          <Textarea value={editExpression} onChange={event => setEditExpression(event.target.value)} className="font-mono text-sm min-h-20 bg-background/50" />
                          <Label>业务说明（可编辑内容）</Label>
                          <Textarea value={editDescription} onChange={event => setEditDescription(event.target.value)} className="min-h-16 bg-background/50 text-xs" />
                          <Label>生效位置 / 引用说明</Label>
                          <Textarea value={editUsedIn} onChange={event => setEditUsedIn(event.target.value)} className="min-h-16 bg-background/50 text-xs" />
                          <div className="flex gap-2"><Button size="sm" onClick={() => updateMutation.mutate({ id: formula.id, expression: editExpression, description: editDescription, usedIn: editUsedIn })} disabled={updateMutation.isPending} className="gap-1"><Save className="w-3 h-3" />验证并保存全部内容</Button><Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>取消</Button></div>
                        </div>
                      ) : <div className="p-3 rounded bg-background/50 border border-border/30 overflow-x-auto"><code className="text-sm font-mono whitespace-nowrap">{formula.expression}</code></div>}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {isIvInversionToggle && editingId !== formula.id && <Button variant="outline" size="sm" aria-pressed={ivInversionEnabled} className={`gap-1 ${ivInversionEnabled ? "border-sky-400/50 text-sky-300" : "text-muted-foreground"}`} onClick={() => updateMutation.mutate({ id: formula.id, expression: ivInversionEnabled ? "0" : "1", description: formula.description ?? "", usedIn: formula.usedIn ?? "" })} disabled={updateMutation.isPending}><Power className="h-3.5 w-3.5" />{ivInversionEnabled ? "关闭" : "开启"}</Button>}
                      {editingId !== formula.id && <Button variant="ghost" size="sm" onClick={() => { setEditingId(formula.id); setEditExpression(formula.expression); setEditDescription(formula.description ?? ""); setEditUsedIn(formula.usedIn ?? ""); }}>编辑</Button>}
                      {formula.isDefault === 0 && isBuiltIn && <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => resetMutation.mutate({ id: formula.id })} title="恢复默认"><RotateCcw className="w-3.5 h-3.5" /></Button>}
                      {!isBuiltIn && <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => {
                        if (window.confirm(`确认删除自定义公式 ${formula.name}？引用它的公式将无法计算。`)) deleteMutation.mutate({ id: formula.id });
                      }} title="删除"><Trash2 className="w-3.5 h-3.5" /></Button>}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </section>
      ))}
    </div>
  );
}
