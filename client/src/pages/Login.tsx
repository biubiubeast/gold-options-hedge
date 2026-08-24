import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LockKeyhole, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const { login } = useAuth();
  const [, setLocation] = useLocation();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      await login(username, password);
      setPassword("");
      // Every successful login starts from the primary trading workspace.
      // Wouter's base router adds a deployment prefix such as /optionhedger.
      setLocation("/matrix");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "登录失败，请重试");
    } finally {
      setPending(false);
    }
  };

  return <main className="flex min-h-screen items-center justify-center bg-background p-4">
    <Card className="glass-card w-full max-w-md border-amber-300/25 shadow-2xl">
      <CardHeader className="space-y-3 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-amber-300/30 bg-amber-300/10"><LockKeyhole className="h-6 w-6 text-amber-300" /></div>
        <CardTitle className="text-xl text-gold-gradient">Cronus</CardTitle>
        <p className="text-xs leading-relaxed text-muted-foreground">请输入网页用户名和密码。为保护交易数据，每次刷新页面后都需要重新登录。</p>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={submit}>
          <div><Label htmlFor="website-username">用户名</Label><Input id="website-username" className="mt-1" autoFocus autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} /></div>
          <div><Label htmlFor="website-password">密码</Label><Input id="website-password" className="mt-1" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /></div>
          {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
          <Button type="submit" className="w-full gap-2" disabled={!username || !password || pending}><ShieldCheck className="h-4 w-4" />{pending ? "登录中…" : "登录"}</Button>
        </form>
      </CardContent>
    </Card>
  </main>;
}
