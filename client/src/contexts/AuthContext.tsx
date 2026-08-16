import { trpc } from "@/lib/trpc";
import { setAuthToken } from "@/lib/authSession";
import type { AppRouter } from "../../../server/routers";
import type { inferRouterOutputs } from "@trpc/server";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type RouterOutputs = inferRouterOutputs<AppRouter>;
export type AuthUser = RouterOutputs["auth"]["login"]["user"];

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const queryClient = useQueryClient();
  const loginMutation = trpc.auth.login.useMutation();
  const logoutMutation = trpc.auth.logout.useMutation();

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading: false,
    isAuthenticated: user !== null,
    login: async (username, password) => {
      const session = await loginMutation.mutateAsync({ username, password });
      setAuthToken(session.token);
      queryClient.clear();
      setUser(session.user);
      return session.user;
    },
    logout: async () => {
      try {
        await logoutMutation.mutateAsync();
      } finally {
        setAuthToken(null);
        queryClient.clear();
        setUser(null);
      }
    },
  }), [loginMutation, logoutMutation, queryClient, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAppAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAppAuth must be used inside AuthProvider");
  return value;
}

