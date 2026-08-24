import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import { Router as WouterRouter } from "wouter";
import App from "./App";
import "./index.css";
import { getRouterBase, getTrpcUrl } from "./lib/appBase";
import { getAuthToken } from "./lib/authSession";

const deploymentBaseUrl = import.meta.env.BASE_URL;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, retry: 1 },
  },
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: getTrpcUrl(deploymentBaseUrl),
      transformer: superjson,
      fetch(url, options) {
        const headers = new Headers(options?.headers);
        const token = getAuthToken();
        if (token) headers.set("Authorization", `Bearer ${token}`);
        return globalThis.fetch(url, { ...options, headers, cache: "no-store" });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={getRouterBase(deploymentBaseUrl)}>
        <App />
      </WouterRouter>
    </QueryClientProvider>
  </trpc.Provider>,
);
