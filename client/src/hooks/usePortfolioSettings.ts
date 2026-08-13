import {
  DEFAULT_PORTFOLIO_SETTINGS,
  type PortfolioSettings,
} from "@/lib/portfolio";
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "gold-options-portfolio-settings-v3";
const LEGACY_STORAGE_KEY = "gold-options-portfolio-settings-v2";
const SETTINGS_EVENT = "gold-options-portfolio-settings-change";

function loadSettings(): PortfolioSettings {
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    const saved = JSON.parse(current || localStorage.getItem(LEGACY_STORAGE_KEY) || "{}") as Partial<PortfolioSettings>;
    const migrated = {
      ...DEFAULT_PORTFOLIO_SETTINGS,
      ...saved,
      heatmapVisibleFilters: {
        ...DEFAULT_PORTFOLIO_SETTINGS.heatmapVisibleFilters,
        ...saved.heatmapVisibleFilters,
      },
    };
    if (!current && saved.gldSpotScaleOverride === null) migrated.gldSpotScaleOverride = DEFAULT_PORTFOLIO_SETTINGS.gldSpotScaleOverride;
    return migrated;
  } catch {
    return DEFAULT_PORTFOLIO_SETTINGS;
  }
}

export function usePortfolioSettings() {
  const [settings, setSettingsState] = useState<PortfolioSettings>(loadSettings);
  useEffect(() => {
    const sync = () => setSettingsState(loadSettings());
    window.addEventListener("storage", sync);
    window.addEventListener(SETTINGS_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(SETTINGS_EVENT, sync);
    };
  }, []);
  const setSettings = useCallback((next: PortfolioSettings | ((current: PortfolioSettings) => PortfolioSettings)) => {
    setSettingsState(current => {
      const value = typeof next === "function" ? next(current) : next;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      queueMicrotask(() => window.dispatchEvent(new Event(SETTINGS_EVENT)));
      return value;
    });
  }, []);
  const resetSettings = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    setSettingsState(DEFAULT_PORTFOLIO_SETTINGS);
    queueMicrotask(() => window.dispatchEvent(new Event(SETTINGS_EVENT)));
  }, []);
  return { settings, setSettings, resetSettings };
}
