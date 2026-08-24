import { describe, expect, it } from "vitest";
import { getRouterBase, getTrpcUrl, normalizeAppBase } from "../client/src/lib/appBase";

describe("deployment base path", () => {
  it("keeps root deployments unchanged", () => {
    expect(normalizeAppBase("/")).toBe("/");
    expect(getRouterBase("/")).toBeUndefined();
    expect(getTrpcUrl("/")).toBe("/api/trpc");
  });

  it("scopes routes and API calls to a reverse-proxy sub-path", () => {
    expect(normalizeAppBase("optionhedger")).toBe("/optionhedger/");
    expect(getRouterBase("/optionhedger/")).toBe("/optionhedger");
    expect(getTrpcUrl("/optionhedger/")).toBe("/optionhedger/api/trpc");
  });
});
