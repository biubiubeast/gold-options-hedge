import {
  DEFAULT_PORTFOLIO_SETTINGS,
  type PortfolioSettings,
} from "@/lib/portfolio";
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "gold-options-portfolio-settings-v11";
const LEGACY_STORAGE_KEYS = [
  "gold-options-portfolio-settings-v10",
  "gold-options-portfolio-settings-v9",
  "gold-options-portfolio-settings-v8",
  "gold-options-portfolio-settings-v7",
  "gold-options-portfolio-settings-v6",
  "gold-options-portfolio-settings-v5",
  "gold-options-portfolio-settings-v4",
  "gold-options-portfolio-settings-v3",
  "gold-options-portfolio-settings-v2",
];
const SETTINGS_EVENT = "gold-options-portfolio-settings-change";

function loadSettings(): PortfolioSettings {
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    const previousVersion = localStorage.getItem(
      "gold-options-portfolio-settings-v10"
    );
    const legacy = LEGACY_STORAGE_KEYS.map(key =>
      localStorage.getItem(key)
    ).find(Boolean);
    const saved = JSON.parse(
      current || legacy || "{}"
    ) as Partial<PortfolioSettings>;
    const migrated = {
      ...DEFAULT_PORTFOLIO_SETTINGS,
      ...saved,
      adminPasswordPages: {
        ...DEFAULT_PORTFOLIO_SETTINGS.adminPasswordPages,
        ...saved.adminPasswordPages,
      },
      heatmapVisibleFilters: {
        ...DEFAULT_PORTFOLIO_SETTINGS.heatmapVisibleFilters,
        ...(current || previousVersion ? saved.heatmapVisibleFilters : {}),
        ...(!current && previousVersion
          ? { reverseStrikes: false, fitAll: false }
          : {}),
      },
      visiblePages: {
        ...DEFAULT_PORTFOLIO_SETTINGS.visiblePages,
        ...saved.visiblePages,
      },
      pageMarketRefreshButtons: {
        ...DEFAULT_PORTFOLIO_SETTINGS.pageMarketRefreshButtons,
        ...saved.pageMarketRefreshButtons,
      },
      positionsVisibleSections: {
        ...DEFAULT_PORTFOLIO_SETTINGS.positionsVisibleSections,
        ...saved.positionsVisibleSections,
      },
      maxPainVisibleSections: {
        ...DEFAULT_PORTFOLIO_SETTINGS.maxPainVisibleSections,
        // v11 changes the first-run research view: advanced backtest/Gamma
        // modules start hidden. Apply it once to older saved settings, then
        // preserve every explicit v11 choice made in Settings.
        ...(current ? saved.maxPainVisibleSections : {}),
      },
      heatmapClickActions: {
        ...DEFAULT_PORTFOLIO_SETTINGS.heatmapClickActions,
        ...saved.heatmapClickActions,
      },
      heatmapFilterOptions: {
        dataset: {
          ...DEFAULT_PORTFOLIO_SETTINGS.heatmapFilterOptions.dataset,
          ...saved.heatmapFilterOptions?.dataset,
        },
        underlying: {
          ...DEFAULT_PORTFOLIO_SETTINGS.heatmapFilterOptions.underlying,
          ...saved.heatmapFilterOptions?.underlying,
          ...(!current ? { all: false } : {}),
        },
        callPut: {
          ...DEFAULT_PORTFOLIO_SETTINGS.heatmapFilterOptions.callPut,
          ...saved.heatmapFilterOptions?.callPut,
          ...(!current ? { combined: true } : {}),
        },
        moneyness: {
          ...DEFAULT_PORTFOLIO_SETTINGS.heatmapFilterOptions.moneyness,
          ...saved.heatmapFilterOptions?.moneyness,
        },
        expiryBucket: {
          ...DEFAULT_PORTFOLIO_SETTINGS.heatmapFilterOptions.expiryBucket,
          ...saved.heatmapFilterOptions?.expiryBucket,
        },
        status: {
          ...DEFAULT_PORTFOLIO_SETTINGS.heatmapFilterOptions.status,
          ...saved.heatmapFilterOptions?.status,
        },
        metric: {
          ...DEFAULT_PORTFOLIO_SETTINGS.heatmapFilterOptions.metric,
          ...saved.heatmapFilterOptions?.metric,
        },
        scale: {
          ...DEFAULT_PORTFOLIO_SETTINGS.heatmapFilterOptions.scale,
          ...saved.heatmapFilterOptions?.scale,
        },
        spot: {
          ...DEFAULT_PORTFOLIO_SETTINGS.heatmapFilterOptions.spot,
          ...saved.heatmapFilterOptions?.spot,
        },
        label: {
          ...DEFAULT_PORTFOLIO_SETTINGS.heatmapFilterOptions.label,
          ...(current || previousVersion
            ? saved.heatmapFilterOptions?.label
            : {}),
        },
        hover: {
          ...DEFAULT_PORTFOLIO_SETTINGS.heatmapFilterOptions.hover,
          ...saved.heatmapFilterOptions?.hover,
          ...(!current && previousVersion ? { pnl: true } : {}),
        },
      },
      heatmapHiddenDynamicOptions: {
        ...DEFAULT_PORTFOLIO_SETTINGS.heatmapHiddenDynamicOptions,
        ...saved.heatmapHiddenDynamicOptions,
      },
      heatmapHeldCellContent: {
        ...DEFAULT_PORTFOLIO_SETTINGS.heatmapHeldCellContent,
        ...saved.heatmapHeldCellContent,
      },
      heatmapHoverContent: {
        ...DEFAULT_PORTFOLIO_SETTINGS.heatmapHoverContent,
        ...saved.heatmapHoverContent,
      },
      heatmapExpiryHoverContent: {
        ...DEFAULT_PORTFOLIO_SETTINGS.heatmapExpiryHoverContent,
        ...saved.heatmapExpiryHoverContent,
      },
      heatmapDetailContent: {
        ...DEFAULT_PORTFOLIO_SETTINGS.heatmapDetailContent,
        ...saved.heatmapDetailContent,
      },
      heatmapVisibleSections: {
        ...DEFAULT_PORTFOLIO_SETTINGS.heatmapVisibleSections,
        ...saved.heatmapVisibleSections,
      },
    };
    if (!current && saved.gldSpotScaleOverride === null)
      migrated.gldSpotScaleOverride =
        DEFAULT_PORTFOLIO_SETTINGS.gldSpotScaleOverride;
    return migrated;
  } catch {
    return DEFAULT_PORTFOLIO_SETTINGS;
  }
}

export function usePortfolioSettings() {
  const [settings, setSettingsState] =
    useState<PortfolioSettings>(loadSettings);
  useEffect(() => {
    const sync = () => setSettingsState(loadSettings());
    window.addEventListener("storage", sync);
    window.addEventListener(SETTINGS_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(SETTINGS_EVENT, sync);
    };
  }, []);
  const setSettings = useCallback(
    (
      next:
        | PortfolioSettings
        | ((current: PortfolioSettings) => PortfolioSettings)
    ) => {
      setSettingsState(current => {
        const value = typeof next === "function" ? next(current) : next;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
        queueMicrotask(() => window.dispatchEvent(new Event(SETTINGS_EVENT)));
        return value;
      });
    },
    []
  );
  const resetSettings = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    LEGACY_STORAGE_KEYS.forEach(key => localStorage.removeItem(key));
    setSettingsState(DEFAULT_PORTFOLIO_SETTINGS);
    queueMicrotask(() => window.dispatchEvent(new Event(SETTINGS_EVENT)));
  }, []);
  return { settings, setSettings, resetSettings };
}
