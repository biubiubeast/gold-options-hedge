import { describe, expect, it } from "vitest";
import { parseStoredTargetOptions, targetCellKeysForScope, targetOptionScope, targetOptionStorageKey } from "../client/src/lib/heatmapTargets";

describe("persistent heatmap target options", () => {
  it("keeps the same selected cells across metric changes while isolating market and C/P scopes", () => {
    const callScope = targetOptionScope("GLD", "call");
    const putScope = targetOptionScope("GLD", "put");
    const stored = new Set([
      targetOptionStorageKey(callScope, "2026-09-18|250"),
      targetOptionStorageKey(callScope, "2026-10-16|260"),
      targetOptionStorageKey(putScope, "2026-09-18|250"),
    ]);
    expect([...targetCellKeysForScope(stored, callScope)].sort()).toEqual(["2026-09-18|250", "2026-10-16|260"]);
    expect([...targetCellKeysForScope(stored, putScope)]).toEqual(["2026-09-18|250"]);
  });

  it("loads only valid string keys from browser storage", () => {
    expect([...parseStoredTargetOptions('["GLD::call::2026-09-18|250", 7, null]')]).toEqual(["GLD::call::2026-09-18|250"]);
    expect(parseStoredTargetOptions("not-json").size).toBe(0);
  });
});
