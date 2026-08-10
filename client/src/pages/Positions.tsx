import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, Loader2, Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface PositionForm {
  underlying: "XAUT" | "GLD";
  expiry: string;
  strike: string;
  optionType: "call" | "put";
  entryPrice: string;
  quantity: string;
  fee: string;
  entryDelta: string;
}

const defaultForm: PositionForm = {
  underlying: "XAUT",
  expiry: "",
  strike: "",
  optionType: "call",
  entryPrice: "",
  quantity: "",
  fee: "0",
  entryDelta: "",
};

export default function Positions() {
  const utils = trpc.useUtils();
  const { data: positions, isLoading } = trpc.positions.list.useQuery();
  const exportQuery = trpc.positions.export.useQuery(undefined, { enabled: false });
  const createMutation = trpc.positions.create.useMutation({
    onSuccess: () => { utils.positions.list.invalidate(); toast.success("仓位已添加"); setOpen(false); },
    onError: (e) => toast.error(e.message),
  });
  const updateMutation = trpc.positions.update.useMutation({
    onSuccess: () => { utils.positions.list.invalidate(); toast.success("仓位已更新"); setOpen(false); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMutation = trpc.positions.delete.useMutation({
    onSuccess: () => { utils.positions.list.invalidate(); toast.success("仓位已删除"); },
    onError: (e) => toast.error(e.message),
  });

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<PositionForm>(defaultForm);

  const handleSubmit = () => {
    if (!form.expiry || !form.strike || !form.entryPrice || !form.quantity || !form.entryDelta) {
      toast.error("请填写所有必填字段");
      return;
    }
    if (editId) {
      updateMutation.mutate({ id: editId, ...form });
    } else {
      createMutation.mutate(form);
    }
  };

  const handleEdit = (pos: any) => {
    setEditId(pos.id);
    setForm({
      underlying: pos.underlying,
      expiry: pos.expiry,
      strike: pos.strike,
      optionType: pos.optionType,
      entryPrice: pos.entryPrice,
      quantity: pos.quantity,
      fee: pos.fee,
      entryDelta: pos.entryDelta,
    });
    setOpen(true);
  };

  const handleNew = () => {
    setEditId(null);
    setForm(defaultForm);
    setOpen(true);
  };

  const handleExport = async () => {
    const result = await exportQuery.refetch();
    if (!result.data) return toast.error("导出失败，请稍后再试");
    const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `gold-options-backup-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success("备份文件已导出");
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gold-gradient">期权仓位管理</h1>
          <p className="text-sm text-muted-foreground mt-1">管理您的 XAUT 和 GLD 期权持仓</p>
        </div>
        <div className="flex gap-2">
        <Button variant="outline" onClick={handleExport} className="gap-2" disabled={exportQuery.isFetching}>
          <Download className="w-4 h-4" /> 导出备份
        </Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={handleNew} className="gap-2">
              <Plus className="w-4 h-4" /> 添加仓位
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg bg-card border-border">
            <DialogHeader>
              <DialogTitle>{editId ? "编辑仓位" : "添加新仓位"}</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div>
                <Label>Underlying</Label>
                <Select value={form.underlying} onValueChange={(v: "XAUT" | "GLD") => setForm({ ...form, underlying: v })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="XAUT">XAUT</SelectItem>
                    <SelectItem value="GLD">GLD</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Type</Label>
                <Select value={form.optionType} onValueChange={(v: "call" | "put") => setForm({ ...form, optionType: v })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="call">Call</SelectItem>
                    <SelectItem value="put">Put</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Expiry (到期日)</Label>
                <Input type="date" value={form.expiry} onChange={e => setForm({ ...form, expiry: e.target.value })} className="mt-1" />
              </div>
              <div>
                <Label>Strike (行权价)</Label>
                <Input type="number" step="0.01" placeholder="4200" value={form.strike} onChange={e => setForm({ ...form, strike: e.target.value })} className="mt-1" />
              </div>
              <div>
                <Label>Entry Price (买入价格)</Label>
                <Input type="number" step="0.000001" placeholder="150.5" value={form.entryPrice} onChange={e => setForm({ ...form, entryPrice: e.target.value })} className="mt-1" />
              </div>
              <div>
                <Label>Quantity (数量)</Label>
                <Input type="number" step="0.0001" placeholder="1" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} className="mt-1" />
              </div>
              <div>
                <Label>Fee (手续费)</Label>
                <Input type="number" step="0.000001" placeholder="0" value={form.fee} onChange={e => setForm({ ...form, fee: e.target.value })} className="mt-1" />
              </div>
              <div>
                <Label>Delta</Label>
                <Input type="number" step="0.000001" placeholder="0.55" value={form.entryDelta} onChange={e => setForm({ ...form, entryDelta: e.target.value })} className="mt-1" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
              <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending}>
                {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {editId ? "更新" : "添加"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Positions Table */}
      <Card className="glass-card">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-border/50">
                <TableHead>Underlying</TableHead>
                <TableHead>Expiry</TableHead>
                <TableHead>Strike</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Entry Price</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Fee</TableHead>
                <TableHead>Delta</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {positions && positions.length > 0 ? positions.map((pos) => (
                <TableRow key={pos.id} className="border-border/30 hover:bg-secondary/30 transition-colors">
                  <TableCell>
                    <Badge variant={pos.underlying === "XAUT" ? "default" : "secondary"} className="font-mono">
                      {pos.underlying}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{pos.expiry}</TableCell>
                  <TableCell className="font-mono">{pos.strike}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={pos.optionType === "call" ? "text-green-400 border-green-400/30" : "text-red-400 border-red-400/30"}>
                      {pos.optionType.toUpperCase()}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono">{pos.entryPrice}</TableCell>
                  <TableCell className="font-mono">{pos.quantity}</TableCell>
                  <TableCell className="font-mono text-muted-foreground">{pos.fee}</TableCell>
                  <TableCell className="font-mono">{pos.entryDelta}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(pos)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => {
                        if (window.confirm(`确认删除 ${pos.underlying} ${pos.strike} ${pos.optionType.toUpperCase()} 仓位？`)) {
                          deleteMutation.mutate({ id: pos.id });
                        }
                      }}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
                    暂无仓位数据，点击"添加仓位"开始录入
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
