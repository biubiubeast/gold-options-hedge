import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, RotateCcw, Save, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DEFAULT_FORMULAS } from "@shared/marketTypes";

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
    onSuccess: () => { utils.formulas.list.invalidate(); toast.success("公式已生效"); setEditingId(null); },
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
    onSuccess: () => { utils.formulas.list.invalidate(); toast.success("已恢复默认并立即生效"); },
    onError: error => toast.error(error.message),
  });
  const resetAllMutation = trpc.formulas.resetAll.useMutation({
    onSuccess: () => { utils.formulas.list.invalidate(); toast.success("所有公式已恢复默认"); },
    onError: error => toast.error(error.message),
  });

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editExpression, setEditExpression] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newFormula, setNewFormula] = useState<NewFormula>(emptyFormula);
  const builtInNames = new Set(DEFAULT_FORMULAS.map(formula => formula.name));

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
          <p className="text-sm text-muted-foreground mt-1">这里的表达式直接驱动 GLD 模型估值、组合估值与 Greeks 汇总</p>
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
          <br />可用变量：<code>S, K, T, r, sigma, entryPrice, quantity, fee, markPrice, contractMultiplier, currentValue, entryCost, underlyingPrice, xauUsdPrice, delta, gamma, theta, vega, spotScale</code>。
        </CardContent>
      </Card>

      {Object.entries(grouped).map(([category, categoryFormulas]) => (
        <section key={category} className="space-y-3">
          <Badge variant="outline" className={categoryColors[category] || ""}>{categoryLabels[category] || category}</Badge>
          {categoryFormulas?.map(formula => {
            const isBuiltIn = builtInNames.has(formula.name as (typeof DEFAULT_FORMULAS)[number]["name"]);
            return (
              <Card key={formula.id} className="glass-card">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-medium text-primary">{formula.name}</span>
                        <Badge variant="outline" className="text-[10px]">{isBuiltIn ? "内置钩子" : "可引用组件"}</Badge>
                        {formula.isDefault === 0 && <Badge variant="outline" className="text-[10px] text-yellow-400 border-yellow-400/30">已修改</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">{formula.description}</p>
                      <p className="text-xs text-muted-foreground/80"><span className="text-primary/80">生效位置：</span>{formula.usedIn || "—"}</p>
                      {editingId === formula.id ? (
                        <div className="space-y-2 pt-2">
                          <Textarea value={editExpression} onChange={event => setEditExpression(event.target.value)} className="font-mono text-sm min-h-20 bg-background/50" />
                          <div className="flex gap-2"><Button size="sm" onClick={() => updateMutation.mutate({ id: formula.id, expression: editExpression })} disabled={updateMutation.isPending} className="gap-1"><Save className="w-3 h-3" />验证并保存</Button><Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>取消</Button></div>
                        </div>
                      ) : <div className="p-3 rounded bg-background/50 border border-border/30 overflow-x-auto"><code className="text-sm font-mono whitespace-nowrap">{formula.expression}</code></div>}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {editingId !== formula.id && <Button variant="ghost" size="sm" onClick={() => { setEditingId(formula.id); setEditExpression(formula.expression); }}>编辑</Button>}
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
