import { trpc } from "@/lib/trpc";

/**
 * Compatibility hook for the former Manus-authenticated UI. The app is now a
 * single-user local portfolio, so the server always returns the local profile.
 */
export function useAuth() {
  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: 1,
    refetchOnWindowFocus: false,
  });
  return {
    user: meQuery.data ?? null,
    loading: meQuery.isLoading,
    error: meQuery.error ?? null,
    isAuthenticated: Boolean(meQuery.data),
    refresh: () => meQuery.refetch(),
    logout: async () => undefined,
  };
}
