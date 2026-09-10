import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TrpcContext } from "./_core/context";

let temporaryDirectory = "";
let previousDataFile: string | undefined;
let appRouter: (typeof import("./routers"))["appRouter"];
let localUser: (typeof import("./db"))["localUser"];
let viewerUser: (typeof import("./db"))["viewerUser"];

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "cronus-max-pain-settings-")
  );
  previousDataFile = process.env.DATA_FILE;
  process.env.DATA_FILE = path.join(temporaryDirectory, "portfolio.json");
  await writeFile(
    process.env.DATA_FILE,
    JSON.stringify({
      version: 1,
      nextPositionId: 1,
      nextFormulaId: 1,
      positions: [],
      formulas: [],
      transactionSummaries: [],
      viewerPagePermissions: {
        dashboard: false,
        positions: true,
        matrix: true,
        tradingView: true,
        maxPain: false,
        formulas: false,
        dataSources: false,
      },
      viewerPagePermissionsVersion: 3,
    })
  );
  vi.resetModules();
  ({ appRouter } = await import("./routers"));
  ({ localUser, viewerUser } = await import("./db"));
});

afterAll(async () => {
  if (previousDataFile === undefined) delete process.env.DATA_FILE;
  else process.env.DATA_FILE = previousDataFile;
  if (temporaryDirectory)
    await rm(temporaryDirectory, { recursive: true, force: true });
});

function context(user: typeof localUser): TrpcContext {
  return {
    user,
    authToken: null,
    req: { protocol: "http", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("shared Max Pain access and section settings", () => {
  it("migrates existing xauwhales access to show Max Pain by default", async () => {
    const caller = appRouter.createCaller(context(viewerUser));
    expect((await caller.access.viewerPages()).maxPain).toBe(true);
  });

  it("shares an administrator's chart visibility with xauwhales", async () => {
    const admin = appRouter.createCaller(context(localUser));
    const viewer = appRouter.createCaller(context(viewerUser));
    const hidden = {
      chart: false,
      oiDistribution: true,
      details: true,
      backtest: false,
      gammaZone: false,
      methodology: true,
    };

    expect((await viewer.access.maxPainSections()).configured).toBe(false);
    await admin.access.updateMaxPainSections(hidden);
    expect(await viewer.access.maxPainSections()).toEqual({
      // A saved setting from the previous version has no oiNotional key.
      sections: { ...hidden, oiNotional: false, gammaExposure: true },
      configured: true,
    });
    await admin.access.updateMaxPainSections({ ...hidden, oiNotional: true });
    expect((await viewer.access.maxPainSections()).sections.oiNotional).toBe(
      true
    );
    await admin.access.updateMaxPainSections({ ...hidden, oiNotional: false });
    expect((await viewer.access.maxPainSections()).sections.oiNotional).toBe(
      false
    );
    await admin.access.updateMaxPainSections({
      ...hidden,
      gammaExposure: false,
    });
    expect((await viewer.access.maxPainSections()).sections.gammaExposure).toBe(
      false
    );
    await expect(
      viewer.access.updateMaxPainSections({ ...hidden, chart: true })
    ).rejects.toThrow("You do not have required permission (10002)");
  });
});
