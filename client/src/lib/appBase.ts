/**
 * Vite exposes the configured deployment base with a leading and trailing
 * slash. Normalising it here keeps local/root deployments and reverse-proxy
 * sub-path deployments on the same code path.
 */
export function normalizeAppBase(baseUrl: string | undefined) {
  const trimmed = baseUrl?.trim() || "/";
  const leadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return leadingSlash.endsWith("/") ? leadingSlash : `${leadingSlash}/`;
}

export function getRouterBase(baseUrl: string | undefined) {
  const normalized = normalizeAppBase(baseUrl);
  return normalized === "/" ? undefined : normalized.slice(0, -1);
}

export function getTrpcUrl(baseUrl: string | undefined) {
  return `${normalizeAppBase(baseUrl)}api/trpc`;
}
