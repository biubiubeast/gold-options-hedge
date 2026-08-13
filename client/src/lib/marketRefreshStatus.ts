export const LAST_MARKET_REFRESH_KEY = "gold-options-last-market-refresh-at-v1";
export const MARKET_REFRESH_EVENT = "gold-options-market-refresh-change";

export function readLastMarketRefreshAt(): string | null {
  const saved = localStorage.getItem(LAST_MARKET_REFRESH_KEY);
  return saved && Number.isFinite(Date.parse(saved)) ? saved : null;
}

export function recordMarketRefreshAt(value = new Date().toISOString()) {
  localStorage.setItem(LAST_MARKET_REFRESH_KEY, value);
  window.dispatchEvent(new CustomEvent(MARKET_REFRESH_EVENT, { detail: value }));
}
