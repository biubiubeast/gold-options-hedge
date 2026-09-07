export const DISPLAY_TIME_ZONES = [
  { value: "UTC", label: "UTC" },
  { value: "Asia/Hong_Kong", label: "香港" },
  { value: "America/New_York", label: "美东" },
] as const;

export type DisplayTimeZone = (typeof DISPLAY_TIME_ZONES)[number]["value"];

export const DEFAULT_DISPLAY_TIME_ZONE: DisplayTimeZone = "UTC";

export function isDisplayTimeZone(value: unknown): value is DisplayTimeZone {
  return DISPLAY_TIME_ZONES.some(option => option.value === value);
}

function dateValue(value: Date | string | number) {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

function dateTimeParts(value: Date, timeZone: DisplayTimeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  return Object.fromEntries(
    parts
      .filter(part => part.type !== "literal")
      .map(part => [part.type, part.value])
  ) as Record<string, string>;
}

/**
 * Return the actual zone abbreviation at a timestamp. New York therefore
 * switches between EST and EDT automatically instead of assuming a fixed UTC-5.
 */
export function displayTimeZoneAbbreviation(
  timeZone: DisplayTimeZone,
  at: Date | string | number = Date.now()
) {
  if (timeZone === "UTC") return "UTC";
  if (timeZone === "Asia/Hong_Kong") return "HKT";
  const value = dateValue(at);
  if (!value) return "ET";
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "short",
  })
    .formatToParts(value)
    .find(part => part.type === "timeZoneName")?.value;
  return name || "ET";
}

export function displayTimeZoneName(
  timeZone: DisplayTimeZone,
  at: Date | string | number = Date.now()
) {
  if (timeZone === "UTC") return "UTC";
  if (timeZone === "Asia/Hong_Kong") return "香港 HKT (UTC+8)";
  const abbreviation = displayTimeZoneAbbreviation(timeZone, at);
  return abbreviation === "EDT" ? "美东 EDT (UTC-4)" : "美东 EST (UTC-5)";
}

export function formatDisplayDateTime(
  rawValue: Date | string | number,
  timeZone: DisplayTimeZone,
  options: { seconds?: boolean; includeZone?: boolean } = {}
) {
  const value = dateValue(rawValue);
  if (!value) return "—";
  const parts = dateTimeParts(value, timeZone);
  const seconds = options.seconds ? `:${parts.second}` : "";
  const zone = options.includeZone
    ? ` ${displayTimeZoneAbbreviation(timeZone, value)}`
    : "";
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}${seconds}${zone}`;
}

export function formatDisplayMonthDayTime(
  rawValue: Date | string | number,
  timeZone: DisplayTimeZone
) {
  const value = dateValue(rawValue);
  if (!value) return "—";
  const parts = dateTimeParts(value, timeZone);
  return `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

export function observationTimestamp(date: string, hourUtc: number) {
  return Date.parse(`${date}T${String(hourUtc).padStart(2, "0")}:00:00.000Z`);
}

/**
 * Convert one of the six UTC source slots to the selected display timezone.
 * A day marker is included when the local calendar day differs from source day.
 */
export function formatObservationSlot(
  sourceDate: string,
  hourUtc: number,
  timeZone: DisplayTimeZone
) {
  const timestamp = observationTimestamp(sourceDate, hourUtc);
  const value = dateValue(timestamp);
  if (!value) return "—";
  const parts = dateTimeParts(value, timeZone);
  const localDate = `${parts.year}-${parts.month}-${parts.day}`;
  const dayMarker =
    localDate < sourceDate ? " 前一日" : localDate > sourceDate ? " 次日" : "";
  return `${parts.hour}:${parts.minute}${dayMarker}`;
}
