export type TargetOptionMode = "idle" | "add" | "remove";

export const TARGET_OPTION_STORAGE_KEY = "heatmap-target-option-cells-v1";

export function targetOptionScope(underlying: string, callPut: string) {
  return `${underlying}::${callPut}`;
}

export function targetOptionStorageKey(scope: string, cellKey: string) {
  return `${scope}::${cellKey}`;
}

export function targetCellKeysForScope(storedKeys: ReadonlySet<string>, scope: string) {
  const prefix = `${scope}::`;
  return new Set([...storedKeys].filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length)));
}

export function parseStoredTargetOptions(raw: string | null) {
  if (!raw) return new Set<string>();
  try {
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string" && value.length > 0) : []);
  } catch {
    return new Set<string>();
  }
}
