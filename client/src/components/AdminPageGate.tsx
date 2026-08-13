import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { LockKeyhole, ShieldCheck } from "lucide-react";
import { FormEvent, useState } from "react";

export function AdminPageGate({ children }: { children: React.ReactNode }) {
  const [password, setPassword] = useState("");
  const status = trpc.adminAccess.status.useQuery(undefined, { staleTime: 30_000 });
  const verify = trpc.adminAccess.verify.useMutation({
    onSuccess: () => {
      setPassword("");
      status.refetch();
    },
  });

  if (status.data?.unlocked) return <>{children}</>;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    verify.mutate({ password });
  };

  return <div className="mx-auto flex min-h-[65vh] max-w-md items-center justify-center">
    <Card className="glass-card w-full border-amber-300/25">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><LockKeyhole className="h-5 w-5 text-amber-300" />管理员页面</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-5 text-sm text-muted-foreground">此页面需要管理员密码。风险热力图和仓位管理无需输入本密码。</p>
        <form className="space-y-4" onSubmit={submit}>
          <div><Label htmlFor="admin-page-password">管理员密码</Label><Input id="admin-page-password" className="mt-1" type="password" autoFocus autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} aria-invalid={verify.isError} /></div>
          {verify.isError && <p role="alert" className="text-sm text-red-300">{verify.error.message}</p>}
          <Button type="submit" className="w-full gap-2" disabled={!password || verify.isPending}><ShieldCheck className="h-4 w-4" />{verify.isPending ? "验证中…" : "验证并打开"}</Button>
        </form>
      </CardContent>
    </Card>
  </div>;
}
