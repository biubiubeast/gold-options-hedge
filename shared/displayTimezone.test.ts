import { describe, expect, it } from "vitest";
import {
  displayTimeZoneName,
  formatDisplayDateTime,
  formatObservationSlot,
  observationTimestamp,
} from "./displayTimezone";

describe("display timezone conversion", () => {
  it("keeps one instant identical while changing only its display", () => {
    const instant = "2026-01-15T00:00:00.000Z";
    expect(formatDisplayDateTime(instant, "UTC", { includeZone: true })).toBe(
      "2026-01-15 00:00 UTC"
    );
    expect(
      formatDisplayDateTime(instant, "Asia/Hong_Kong", {
        includeZone: true,
      })
    ).toBe("2026-01-15 08:00 HKT");
    expect(
      formatDisplayDateTime(instant, "America/New_York", {
        includeZone: true,
      })
    ).toBe("2026-01-14 19:00 EST");
    expect(observationTimestamp("2026-01-15", 0)).toBe(Date.parse(instant));
  });

  it("handles New York daylight saving time by date", () => {
    const summer = "2026-07-15T00:00:00.000Z";
    expect(
      formatDisplayDateTime(summer, "America/New_York", {
        includeZone: true,
      })
    ).toBe("2026-07-14 20:00 EDT");
    expect(displayTimeZoneName("America/New_York", summer)).toBe(
      "美东 EDT (UTC-4)"
    );
  });

  it("marks source-slot calendar-day changes", () => {
    expect(formatObservationSlot("2026-01-15", 20, "Asia/Hong_Kong")).toBe(
      "04:00 次日"
    );
    expect(formatObservationSlot("2026-01-15", 0, "America/New_York")).toBe(
      "19:00 前一日"
    );
    expect(formatObservationSlot("2026-01-15", 4, "UTC")).toBe("04:00");
  });
});
