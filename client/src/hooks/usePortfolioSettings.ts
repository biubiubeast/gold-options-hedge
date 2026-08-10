import {
  DEFAULT_PORTFOLIO_SETTINGS,
  type PortfolioSettings,
} from "@/lib/portfolio";
import { useCallback, useState } from "react";

const STORAGE_KEY = "gold-options-portfolio-settings-v2";

function loadSettings(): PortfolioSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Partial<PortfolioSettings>;
    return { ...DEFAULT_PORTFOLIO_SETTINGS, ...saved };
  } catch {
    return DEFAULT_PORTFOLIO_SETTINGS;
  }
}

export function usePortfolioSettings() {
  const [settings, setSettingsState] = useState<PortfolioSettings>(loadSettings);
  const setSettings = useCallback((next: PortfolioSettings | ((current: PortfolioSettings) => PortfolioSettings)) => {
    setSettingsState(current => {
      const value = typeof next === "function" ? next(current) : next;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      return value;
    });
  }, []);
  const resetSettings = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setSettingsState(DEFAULT_PORTFOLIO_SETTINGS);
  }, []);
  return { settings, setSettings, resetSettings };
}
