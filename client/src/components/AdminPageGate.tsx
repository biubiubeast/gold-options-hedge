import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import type { AdminPasswordPage } from "@/lib/portfolio";
import type { ViewerPagePermissions } from "@shared/access";
import { LockKeyhole, ShieldAlert } from "lucide-react";
import { useLocation } from "wouter";

function viewerCanAccess(page: AdminPasswordPage, permissions: ViewerPagePermissions) {
  if (page === "notFound") return true;
  if (page === "optionDetail") return permissions.positions || permissions.matrix;
  if (page === "settings") return false;
  return permissions[page];
}
export function AdminPageGate({ page, children }: { page: AdminPasswordPage; children: React.ReactNode }) {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const permissions = trpc.access.viewerPages.useQuery(undefined, {
    enabled: user?.role !== "admin",
    staleTime: 5_000,
  });

  if (user?.role === "admin") return <>{children}</>;
  if (permissions.isLoading) return <div className="flex min-h-[55vh] items-center justify-center text-sm text-muted-foreground">正在核对页面权限…</div>;
  if (permissions.data && viewerCanAccess(page, permissions.data)) return <>{children}</>;

  return <div className="mx-auto flex min-h-[65vh] max-w-md items-center justify-center">
    <Card className="glass-card w-full border-red-300/25">
      <CardHeader><CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-red-300" />页面权限受限</CardTitle></CardHeader>
      <CardContent>
        <p className="mb-5 text-sm leading-relaxed text-muted-foreground">当前登录用户无权打开此页面。设置页面仅允许 xauadmin；其他页面由 xauadmin 在设置中为 xauwhales 开启或关闭。</p>
        <div className="grid grid-cols-2 gap-2"><Button variant="outline" onClick={() => setLocation("/positions")}><LockKeyhole className="mr-2 h-4 w-4" />仓位管理</Button><Button onClick={() => setLocation("/matrix")}>市场热力图</Button></div>
      </CardContent>
    </Card>
  </div>;
}
