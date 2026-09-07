import {
  DEFAULT_DISPLAY_TIME_ZONE,
  isDisplayTimeZone,
  type DisplayTimeZone,
} from "@shared/displayTimezone";
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "cronus-display-time-zone-v1";
const CHANGE_EVENT = "cronus-display-time-zone-change";

function loadTimeZone(): DisplayTimeZone {
  if (typeof window === "undefined") return DEFAULT_DISPLAY_TIME_ZONE;
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return isDisplayTimeZone(saved) ? saved : DEFAULT_DISPLAY_TIME_ZONE;
}

/** A browser-local, site-wide display preference. It never changes API timestamps. */
export function useDisplayTimezone() {
  const [timeZone, setTimeZoneState] = useState<DisplayTimeZone>(loadTimeZone);

  useEffect(() => {
    const sync = () => setTimeZoneState(loadTimeZone());
    window.addEventListener("storage", sync);
    window.addEventListener(CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(CHANGE_EVENT, sync);
    };
  }, []);

  const setTimeZone = useCallback((next: DisplayTimeZone) => {
    window.localStorage.setItem(STORAGE_KEY, next);
    setTimeZoneState(next);
    queueMicrotask(() => window.dispatchEvent(new Event(CHANGE_EVENT)));
  }, []);

  return { timeZone, setTimeZone };
}
