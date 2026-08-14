import { describe, expect, it } from "vitest";
import { resolveHeatmapSpots } from "../client/src/lib/spotSelection";

describe("heatmap canonical spot selection", () => {
  it("uses the global GLD quote instead of the different chain-embedded spot", () => {
    const spots = resolveHeatmapSpots({
      gld: { price: 399.52, timestamp: 1, source: "canonical GLD quote" },
      xaut: { price: 4337, timestamp: 1, source: "canonical XAUT quote" },
      gold: { price: 4700, timestamp: 1, source: "canonical XAU quote" },
    }, {
      gld: 398.86,
      xaut: 4335,
    });

    expect(spots).toEqual({ gld: 399.52, xaut: 4337, xau: 4700 });
  });

  it("only uses the option-chain spot when the canonical quote is unavailable", () => {
    expect(resolveHeatmapSpots(undefined, { gld: 398.86, xaut: 4335 }))
      .toEqual({ gld: 398.86, xaut: 4335, xau: 0 });
  });
});
