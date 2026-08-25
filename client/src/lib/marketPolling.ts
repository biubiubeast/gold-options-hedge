/**
 * Automatic market polling cadence. Manual refresh actions bypass this delay.
 * Keep market queries fresh for the same interval so window focus does not
 * silently restore the former high-frequency polling behavior.
 */
export const MARKET_POLL_INTERVAL_MS = 5 * 60_000;

export const MARKET_QUERY_OPTIONS = {
  refetchInterval: MARKET_POLL_INTERVAL_MS,
  staleTime: MARKET_POLL_INTERVAL_MS,
  refetchOnWindowFocus: false,
} as const;
